import { useI18n } from '../../i18n'
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, InlineCode, Input, SearchableSelectField, type SearchableSelectOption, SelectField, Switch, useConfirm } from '@zhin.js/console-ui'
import { pluginRpc } from '../../utils/plugin-rpc'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import {
  AMBIENT_JUDGE_REVERT_COMMAND,
  DECISION_TASKS,
  DEFAULT_AMBIENT_JUDGE_TIMEOUT_MS,
  DEFAULT_AMBIENT_MIN_CONFIDENCE,
  ambientAgreement,
  ambientJudgeChoices,
  ambientJudgeDocUrl,
  ambientJudgeDraft,
  ambientJudgeHints,
  ambientJudgeKindLabel,
  ambientJudgePlanEntry,
  ambientJudgeSupport,
  ambientMigrationFailure,
  ambientMigrationNotice,
  noticeAmbientJudgeMigration,
  planWarningText,
  profileName,
  readAmbientJudgeView,
  sameAmbientJudgePolicy,
  validateAmbientJudgeDraft,
  type AmbientAgreement,
  type AmbientJudgeDraft,
  type AmbientJudgeProblem,
  type AmbientJudgeView,
  type PlanWarning,
} from './ambient-judge-model.mjs'
import { supportLabel } from './SupportInfo'
import {
  purposePlan,
  profileSupport,
  purposeProfileChoices,
  inferenceError,
  newlyBoundLanguageProfiles,
  describeProbe,
  InferenceRequestError,
  cleanFallbacks,
  moveFallback,
  supportsPurposeFallbacks,
  profileAvailability,
  describeUnavailability,
  recentFallbackRows,
  type ProbeResult,
  type View,
  type Purposes as PurposeState,
  type ScopeModels,
  type Kind,
  type Targets,
  type DecisionPolicy,
} from './model.mjs'
import type { InferenceManagement } from './useInferenceManagement'
import { SaveButton, useSaveFeedback } from '../../components/SaveButton'

/** Decision purposes; an ADR 0066 instance has five (旁听参与判断 became part of 插话判断). */
const decisionTaskLabels = (t: ReturnType<typeof useI18n>['t'], merged = false): Record<string, string> => {
  const labels: Record<string, string> = {
    skills: t('技能选择'),
    tools: t('工具选择'),
    memory: t('记忆选择'),
    agents: t('Agent 选择'),
    approval: t('工具审批建议'),
    ambient: t('旁听参与判断'),
  }
  return merged ? Object.fromEntries(DECISION_TASKS.map((task) => [task, labels[task]!])) : labels
}

/** `GET /ambient-judge` of the held view: the judge in effect, or why it could not be read. */
type JudgeRead = { judge: AmbientJudgeView | null; error: unknown }
export function Purposes({ management: m }: { management: InferenceManagement }) {
  const i18n = useI18n()
  const [editor, setEditor] = useState(() => ({
    source: m.source!,
    draft: structuredClone(m.source!.view.purposes!),
  }))
  const { source, draft } = editor
  const view = source.view
  const [targets, setTargets] = useState<Targets | null>(null)
  function setDraft(update: (previous: PurposeState) => PurposeState) {
    setEditor((previous) => ({ ...previous, draft: update(previous.draft) }))
  }
  const [level, setLevel] = useState<'adapters' | 'endpoints' | 'scenes'>('adapters'),
    [target, setTarget] = useState(''),
    [sceneOffset, setSceneOffset] = useState(0)
  const [probing, setProbing] = useState(false)
  const [saving, setSaving] = useState(false)
  // ADR 0066: the interjection judge is read from its own route (Host administrators), its draft kept here.
  const [judgeRead, setJudgeRead] = useState<JudgeRead | null>(null)
  const [judgeEditor, setJudgeEditor] = useState<{ draft: AmbientJudgeDraft; touched: boolean } | null>(null)
  const [warnings, setWarnings] = useState<PlanWarning[]>([])
  const [judgeProblems, setJudgeProblems] = useState<AmbientJudgeProblem[]>([])
  const support = ambientJudgeSupport({ view, judge: judgeRead?.judge, judgeError: judgeRead?.error })
  const merged = support === 'merged'
  // What the editor starts from (ADR 0066 review H2): the judge read from its route, or a stored
  // `purposes.ambient` in the view. Never an empty policy: until one of them is there the section is
  // disabled (still reading) or shows the read error, and nothing about the judge is written.
  const judgeBase: { policy: NonNullable<PurposeState['ambient']>; source: AmbientJudgeView['source'] } | null = judgeRead?.judge
    ? { policy: judgeRead.judge.policy, source: judgeRead.judge.source }
    : view.purposes?.ambient !== undefined ? { policy: view.purposes.ambient, source: 'stored' } : null
  const judgeOriginal = judgeBase?.policy ?? {}
  const judgeDraftValue = judgeEditor?.draft ?? ambientJudgeDraft(judgeOriginal)
  async function readJudge() {
    if (!view.hostAdministrator) return setJudgeRead({ judge: null, error: new InferenceRequestError('forbidden', 403) })
    try {
      const judge = readAmbientJudgeView(await m.request<unknown>('/ambient-judge'))
      if (m.active()) setJudgeRead({ judge, error: null })
      return judge
    } catch (error) {
      if (m.active()) setJudgeRead({ judge: null, error })
      return null
    }
  }
  useEffect(() => {
    void readJudge()
  }, [view.rootId])
  // The draft follows what was read until it is edited.
  useEffect(() => {
    if (!judgeBase) return
    setJudgeEditor((current) => current?.touched ? current : { draft: ambientJudgeDraft(judgeBase.policy), touched: false })
  }, [judgeRead])
  const saveFeedback = useSaveFeedback()
  const { confirm, ConfirmDialog: confirmDialog } = useConfirm()
  const disabled = m.busy || !!m.pending || probing
  /**
   * #1250: before saving, send one minimal tool-carrying request to every newly bound model, so a
   * relay that hangs or rejects tools does not silently break chat. Failures ask for confirmation.
   */
  async function probeNewBindings(): Promise<boolean> {
    const ids = newlyBoundLanguageProfiles(draft, view.purposes)
    if (!ids.length) return true
    setProbing(true)
    const failures: string[] = []
    try {
      for (const id of ids) {
        const label = view.profiles[id]?.label ?? view.profiles[id]?.model ?? id
        try {
          const result = await m.request<ProbeResult>('/probe', { profileId: id })
          if (!m.active()) return false
          if (result.status !== 'ok') failures.push(`${label}${i18n.locale === 'en' ? ': ' : '：'}${describeProbe(result, i18n.locale)}`)
        } catch (error) {
          // A Host before #1250 has no probe route: save as before.
          if (error instanceof InferenceRequestError && error.code === 'not-installed') return true
          if (!m.active()) return false
          failures.push(`${label}${i18n.locale === 'en' ? ': ' : '：'}${inferenceError(error, i18n.locale)}`)
        }
      }
    } finally {
      setProbing(false)
    }
    if (!failures.length) return true
    return confirm({
      title: i18n.t("新绑定的模型连通性测试未通过"),
      description: i18n.t("仍然保存的话，使用这些用途的对话可能没有回复。确定保存吗？"),
      children: (
        <ul className="list-disc space-y-1 pl-5 text-sm" role="list">
          {failures.map((line) => <li key={line}>{line}</li>)}
        </ul>
      ),
      confirmLabel: i18n.t("仍然保存"),
      variant: 'destructive',
    })
  }
  useEffect(() => {
    let alive = true
    void m.request<Targets>('/targets').then(
      (value) => {
        if (alive && m.active()) setTargets(value)
      },
      (error) => {
        if (alive && m.active()) m.setError(inferenceError(error, i18n.locale))
      }
    )
    return () => {
      alive = false
    }
  }, [view.rootId])
  // Searchable and grouped by service; profiles only Agents use form their own 「Agent 绑定」 group (#1250).
  const choices = (kind: Kind, inherit = i18n.t("未设置")): SearchableSelectOption[] => [
    { value: '', label: inherit },
    ...purposeProfileChoices(view, kind, i18n.locale).map((choice) => ({
      value: choice.value,
      label: supportLabel(choice.profile.label ?? choice.profile.model, profileSupport(view, choice.profile)),
      group: choice.group,
      description: choice.description,
      keywords: choice.keywords,
    })),
  ]
  // #1250: every language purpose may carry an ordered fallback chain; older Hosts keep only vision's.
  const fallbacks = supportsPurposeFallbacks(view)
  function defaultValue(key: 'chat' | 'summary' | 'ambient' | 'image', value: string) {
    setDraft((previous) => {
      const defaults: PurposeState['defaults'] = { ...previous.defaults, [key]: value || undefined }
      if (key !== 'image') {
        const chainKey = `${key}Fallbacks` as const
        const chain = value ? cleanFallbacks(value, previous.defaults[chainKey]) : []
        if (chain.length) defaults[chainKey] = chain
        else delete defaults[chainKey]
      }
      return { ...previous, defaults }
    })
  }
  function defaultChain(key: 'chat' | 'summary' | 'ambient', chain: string[]) {
    setDraft((previous) => {
      const defaults: PurposeState['defaults'] = { ...previous.defaults, [`${key}Fallbacks`]: chain }
      if (!chain.length) delete defaults[`${key}Fallbacks`]
      return { ...previous, defaults }
    })
  }
  function agentValue(name: string, value: string, chain?: string[]) {
    setDraft((previous) => {
      const agents: Record<string, string> = { ...previous.agents }
      const agentFallbacks: Record<string, string[]> = { ...previous.agentFallbacks }
      if (value) agents[name] = value
      else delete agents[name]
      const next = value ? cleanFallbacks(value, chain ?? previous.agentFallbacks?.[name]) : []
      if (next.length) agentFallbacks[name] = next
      else delete agentFallbacks[name]
      const result: PurposeState = { ...previous, agents, agentFallbacks }
      if (!Object.keys(agentFallbacks).length) delete result.agentFallbacks
      return result
    })
  }
  /** A scope override's chat model; its chain follows it (cleared with it, never containing it). */
  function scopeChat(value: ScopeModels, chat: string, chain?: string[]): ScopeModels {
    const next: ScopeModels = { ...value, chat: chat || undefined }
    const list = chat ? cleanFallbacks(chat, chain ?? value.chatFallbacks) : []
    if (list.length) next.chatFallbacks = list
    else delete next.chatFallbacks
    return next
  }
  async function loadScenes() {
    try {
      const result = await m.request<Targets>(`/targets?limit=50&offset=${sceneOffset}`)
      if (!m.active()) return
      setTargets((previous) => ({
        ...result,
        scenes: [
          ...new Map(
            [...(previous?.scenes ?? []), ...result.scenes].map((row) => [row.key, row])
          ).values(),
        ],
      }))
      setSceneOffset(sceneOffset + result.scenes.length)
    } catch (error) {
      if (m.active()) m.setError(inferenceError(error, i18n.locale))
    }
  }
  function changeScope(key: string, value: ScopeModels) {
    setDraft((previous) => ({ ...previous, [level]: { ...previous[level], [key]: value } }))
  }
  const candidates =
    level === 'adapters'
      ? targets?.adapters.map((value) => ({ value: value.platform, label: value.platform })) ?? []
      : level === 'endpoints'
      ? targets?.endpoints.map((value) => ({
          value: value.key,
          label: `${value.address.platform} · ${value.address.endpoint}`,
        })) ?? []
      : targets?.scenes.map((value) => ({
          value: value.key,
          label: `${value.address.platform} · ${value.address.endpoint} · ${
            value.address.conversation.id
          }${
            value.address.conversation.threadId ? ` / ${value.address.conversation.threadId}` : ''
          }`,
        })) ?? []
  return (
    <form
      className="space-y-6"
      onSubmit={async (event) => {
        event.preventDefault()
        const submitted = editor
        const submittedJudge = judgeEditor
        saveFeedback.reset()
        setWarnings([])
        // ADR 0066: the judge is checked like the Host checks it, before anything is sent. Without a
        // base read from the Host nothing about it is written.
        const entry = merged && judgeBase ? ambientJudgePlanEntry(judgeDraftValue, judgeBase.policy, { source: judgeBase.source }) : undefined
        const problems = entry !== undefined ? validateAmbientJudgeDraft(judgeDraftValue, view, i18n.locale) : []
        setJudgeProblems(problems)
        if (problems.length) return
        if (entry !== undefined && judgeBase) {
          // Review H3: read the judge again; a policy changed elsewhere since this page read it is not
          // overwritten silently.
          let latest: AmbientJudgeView | null = null
          try {
            latest = readAmbientJudgeView(await m.request<unknown>('/ambient-judge'))
          } catch (error) {
            if (m.active()) m.setError(i18n.t("插话判断没有保存：{0}", [inferenceError(error, i18n.locale)]))
            return
          }
          if (!m.active()) return
          if (!latest || !sameAmbientJudgePolicy(latest.policy, judgeBase.policy)) {
            m.setError(i18n.t("插话判断刚在别处被修改过，这次没有保存。请重新读取，确认后再修改。"))
            return
          }
        }
        if (!(await probeNewBindings())) return
        setSaving(true)
        try {
          const ambientJudge = merged ? { entry } : undefined
          const saved = await m.savePlan({ version: 1, purposes: purposePlan(draft, view.purposes!, { fallbacks, ambientJudge }) }, {
            source,
            onWarnings: (list) => setWarnings(list),
            onCommitted: (next) => setEditor((current) => ({
              source: next,
              // Only this confirmed save can move the baseline. Keep edits made while it waited.
              draft: current === submitted ? structuredClone(next.view.purposes!) : current.draft,
            })),
          })
          // The result is shown on the button (保存中… → ✓ 已保存), not in a toast.
          if (saved && m.active()) {
            saveFeedback.markSaved()
            if (merged) {
              // Re-read the judge; the draft follows it unless it was edited while the save ran.
              setJudgeEditor((current) => current === submittedJudge ? null : current)
              await readJudge()
            }
          }
        } finally {
          setSaving(false)
        }
      }}
    >
      {confirmDialog}
      {warnings.length ? (
        <Alert variant="warning" role="status">
          <AlertTitle>{i18n.t("已保存，有旧写法被换算")}</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-5" role="list">
              {warnings.map((warning, index) => <li key={index}>{planWarningText(warning, i18n.locale)}</li>)}
            </ul>
          </AlertDescription>
        </Alert>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{i18n.t("模型用途")}</h3>
        <SaveButton type="submit" disabled={disabled} saving={probing || saving} saved={saveFeedback.saved}
          savingLabel={probing ? i18n.t("正在测试连通性…") : undefined}>
          {i18n.t("保存")}
        </SaveButton>
      </div>
      <p className="text-sm text-muted-foreground">
        {i18n.t("聊天模型的优先级：子 Agent 的绑定高于适配器、账号和会话场景的聊天覆盖，这些覆盖又高于默认聊天模型。")}
        {fallbacks ? ' ' + i18n.t("主模型额度用完、余额不足或密钥被拒时，按顺序换用这一层配置的备用模型。") : null}
      </p>
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">{i18n.t("默认模型")}</h4>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {(
            [
              ['chat', i18n.t("聊天")],
              ['summary', i18n.t("摘要")],
              ['ambient', i18n.t("旁听")],
              ['image', i18n.t("图片生成")],
            ] as const
          // ADR 0066: 旁听 is part of 插话判断 below; older instances keep it here.
          ).filter(([key]) => !merged || key !== 'ambient').map(([key, label]) => (
            <div className="min-w-0 space-y-2 text-sm" key={key}>
              <label className="block space-y-2">
                <span>{label}</span>
                <SearchableSelectField
                  aria-label={label}
                  // Purposes other than 聊天 follow it until set: secondary fields stay borderless (ADR 0063 D29).
                  variant={key !== 'chat' && !draft.defaults[key] ? 'ghost' : 'default'}
                  value={draft.defaults[key] ?? ''}
                  onValueChange={(value) => defaultValue(key, value)}
                  options={choices(
                    key === 'image' ? 'image' : 'language',
                    key === 'summary' || key === 'ambient' ? i18n.t("跟随部署聊天") : i18n.t("未设置")
                  )}
                />
              </label>
              {fallbacks && key !== 'image' ? (
                <FallbackChain
                  label={label}
                  view={view}
                  primary={draft.defaults[key]}
                  chain={draft.defaults[`${key}Fallbacks`]}
                  choices={choices('language')}
                  onChange={(chain) => defaultChain(key, chain)}
                />
              ) : null}
            </div>
          ))}
        </div>
        {support === 'legacy' ? (
          <p className="text-xs text-muted-foreground" role="note">
            {i18n.t("这个实例还是旧版本：「旁听」和决策「旁听参与判断」仍是分开的两项。升级 Zhin 后会合成一项「插话判断」，配置自动迁移。")}
          </p>
        ) : null}
        <Perception
          view={view}
          value={draft.defaults.perception}
          choices={choices('language', i18n.t("未设置"))}
          onChange={(value) =>
            setDraft((previous) => ({
              ...previous,
              defaults: { ...previous.defaults, perception: value },
            }))
          }
        />
      </Card>
      {merged && !judgeBase ? (
        <Card className="p-4 space-y-2" data-ambient-judge-unavailable="">
          <h4 className="font-medium">{i18n.t("插话判断")}</h4>
          {judgeRead === null
            ? <p className="text-sm text-muted-foreground" role="status">{i18n.t("正在读取插话判断…")}</p>
            : <>
              <p className="text-sm text-destructive" role="alert">
                {i18n.t("插话判断没有读到：{0}。读到之前不能修改，保存其他用途时也不会改动它。", [inferenceError(judgeRead.error ?? new InferenceRequestError('unavailable'), i18n.locale)])}
              </p>
              <Button type="button" size="sm" variant="outline" onClick={() => { setJudgeRead(null); void readJudge() }}>{i18n.t("重新读取")}</Button>
            </>}
        </Card>
      ) : null}
      {merged && judgeBase ? (
        <AmbientJudgeSection
          view={view}
          judge={judgeRead?.judge ?? null}
          draft={judgeDraftValue}
          problems={judgeProblems}
          fallbacks={fallbacks}
          onChange={(update) => {
            setJudgeProblems([])
            setJudgeEditor((current) => ({ draft: update(current?.draft ?? judgeDraftValue), touched: true }))
          }}
          onNoticed={async () => {
            try {
              await noticeAmbientJudgeMigration(m.request)
            } catch (error) {
              // Review M2: a refusal is not a page error; the banner is then hidden in this browser.
              if (error instanceof InferenceRequestError && (error.status === 403 || error.code === 'forbidden')) return false
              m.setError(inferenceError(error, i18n.locale))
              return true
            }
            await readJudge()
            return true
          }}
        />
      ) : null}
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">{i18n.t("决策")}</h4>
        {Object.entries(decisionTaskLabels(i18n.t, merged)).map(([task, label]) => {
          const policy = draft.decisions?.[task],
            change = (value: DecisionPolicy) =>
              setDraft((previous) => ({
                ...previous,
                decisions: { ...previous.decisions, [task]: value },
              }))
          return (
            <div key={task} className="grid grid-cols-1 gap-3 border-b pb-4 last:border-0 sm:grid-cols-3">
              <span className="text-sm self-center">{label}</span>
              <SelectField
                aria-label={i18n.t("{0}模式", [label])}
                // An unset decision slot (off, no model) is secondary: borderless until hovered or focused.
                variant={policy?.mode && policy.mode !== 'off' ? 'default' : 'ghost'}
                value={policy?.mode ?? 'off'}
                onValueChange={(mode) =>
                  change({ ...policy, mode: mode as DecisionPolicy['mode'] })
                }
                options={[
                  { value: 'off', label: i18n.t("关闭", undefined, 'state') },
                  { value: 'shadow', label: i18n.t("仅评估") },
                  { value: 'active', label: i18n.t("启用", undefined, 'state') },
                ]}
              />
              <SearchableSelectField
                aria-label={i18n.t("{0}模型", [label])}
                variant={policy?.profile ? 'default' : 'ghost'}
                value={policy?.profile ?? ''}
                onValueChange={(profile) =>
                  change({ ...policy, mode: policy?.mode ?? 'off', profile: profile || undefined })
                }
                options={choices('decision')}
              />
              {policy ? (
                <details className="sm:col-span-3 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">{i18n.t("调整决策参数")}</summary>
                  <div className="grid grid-cols-1 gap-3 mt-3 sm:grid-cols-3">
                    {(
                      [
                        'timeoutMs',
                        'minConfidence',
                        'topK',
                        'maxCandidates',
                        'maxSelections',
                      ] as const
                    ).map((key) => (
                      <label key={key} className="space-y-1">
                        <span>
                          {
                            {
                              timeoutMs: i18n.t("超时（毫秒）"),
                              minConfidence: i18n.t("置信度"),
                              topK: i18n.t("候选数量"),
                              maxCandidates: i18n.t("候选上限"),
                              maxSelections: i18n.t("选择上限"),
                            }[key]
                          }
                        </span>
                        <Input
                          type="number"
                          step={key === 'minConfidence' ? 'any' : 1}
                          value={policy[key] ?? ''}
                          onChange={(event) =>
                            change({
                              ...policy,
                              [key]:
                                event.target.value === '' ? undefined : Number(event.target.value),
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          )
        })}
      </Card>
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">Agent</h4>
        {[
          ...new Set([
            ...(targets?.agents.map((agent) => agent.name) ?? []),
            ...Object.keys(draft.agents ?? {}),
          ]),
        ].map((name) => {
          const label = targets?.agents.find((agent) => agent.name === name)?.nickname ?? name
          return (
            <div key={name} className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-sm">
              <span className="self-center">{label}</span>
              <SearchableSelectField
                aria-label={label}
                variant={draft.agents?.[name] ? 'default' : 'ghost'}
                value={draft.agents?.[name] ?? ''}
                onValueChange={(value) => agentValue(name, value)}
                options={choices('language', i18n.t("跟随聊天"))}
              />
              {fallbacks ? (
                <div className="min-w-0 sm:col-span-2">
                  <FallbackChain
                    label={label}
                    view={view}
                    primary={draft.agents?.[name]}
                    chain={draft.agentFallbacks?.[name]}
                    choices={choices('language')}
                    onChange={(chain) => agentValue(name, draft.agents?.[name] ?? '', chain)}
                  />
                </div>
              ) : null}
            </div>
          )
        })}
      </Card>
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">{i18n.t("按场景选择")}</h4>
        <div className="flex flex-wrap gap-2">
          <SelectField
            className="w-36"
            value={level}
            onValueChange={(value) => {
              setLevel(value as typeof level)
              setTarget('')
              if (value === 'scenes' && !targets?.scenesAvailable) void loadScenes()
            }}
            options={[
              { value: 'adapters', label: i18n.t("适配器") },
              { value: 'endpoints', label: i18n.t("账号终端") },
              { value: 'scenes', label: i18n.t("会话场景") },
            ]}
          />
          <SearchableSelectField
            className="min-w-0 flex-1"
            aria-label={i18n.t("选择目标")}
            value={target}
            onValueChange={setTarget}
            options={[{ value: '', label: i18n.t("选择目标") }, ...candidates]}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!target || disabled}
            onClick={() => changeScope(target, draft[level]?.[target] ?? {})}
          >
            <Plus />
            {i18n.t("添加")}
          </Button>
        </div>
        {Object.entries(draft[level] ?? {}).map(([key, value]) => (
          <div key={key} className="min-w-0 space-y-3 rounded-md border p-3">
            <div className="flex justify-between items-center gap-2">
              <span className="text-sm break-all">
                {candidates.find((item) => item.value === key)?.label ?? i18n.t("已配置目标（当前未列出）")}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={i18n.t("移除覆盖")}
                onClick={() =>
                  setDraft((previous) => {
                    const values: Record<string, ScopeModels> = { ...previous[level] }
                    delete values[key]
                    return { ...previous, [level]: values }
                  })
                }
              >
                <Trash2 />
              </Button>
            </div>
            <SearchableSelectField
              aria-label={i18n.t("聊天")}
              value={value.chat ?? ''}
              onValueChange={(chat) => changeScope(key, scopeChat(value, chat))}
              options={choices('language', i18n.t("继承上层聊天模型"))}
            />
            {fallbacks ? (
              <FallbackChain
                label={i18n.t("聊天")}
                view={view}
                primary={value.chat}
                chain={value.chatFallbacks}
                choices={choices('language')}
                onChange={(chain) => changeScope(key, scopeChat(value, value.chat ?? '', chain))}
              />
            ) : null}
            {level !== 'scenes' ? (
              <Perception
                view={view}
                value={(value as ScopeModels).perception}
                choices={choices('language', i18n.t("继承上层识图模型"))}
                onChange={(perception) => changeScope(key, { ...value, perception })}
              />
            ) : null}
          </div>
        ))}
        {level === 'scenes' && targets?.sceneHasMore ? (
          <Button type="button" variant="outline" onClick={() => void loadScenes()}>
            {i18n.t("加载更多场景")}
          </Button>
        ) : null}
        {level === 'scenes' && targets?.scenesError && targets.scenesError !== 'not_requested' ? (
          <p role="alert" className="text-sm text-destructive">
            {i18n.t("场景目录暂不可用，已有配置保留。")}
          </p>
        ) : null}
      </Card>
      {fallbacks ? <RecentFallbacks view={view} /> : null}
    </form>
  )
}
function Perception({
  view,
  value,
  choices,
  onChange,
}: {
  view: View
  value?: { profile: string; fallbacks?: string[] }
  choices: SearchableSelectOption[]
  onChange: (value: { profile: string; fallbacks?: string[] } | undefined) => void
}) {
  const i18n = useI18n()
  return (
    <div className="space-y-3">
      <label className="block space-y-2 text-sm">
        <span>{i18n.t("识图")}</span>
        <SearchableSelectField
          aria-label={i18n.t("识图")}
          variant={value?.profile ? 'default' : 'ghost'}
          value={value?.profile ?? ''}
          onValueChange={(profile) => {
            if (!profile) return onChange(undefined)
            const fallbacks = cleanFallbacks(profile, value?.fallbacks)
            onChange(fallbacks.length ? { profile, fallbacks } : { profile })
          }}
          options={choices}
        />
      </label>
      <FallbackChain
        label={i18n.t("识图")}
        view={view}
        primary={value?.profile}
        chain={value?.fallbacks}
        choices={choices}
        onChange={(fallbacks) => {
          if (value) onChange(fallbacks.length ? { ...value, fallbacks } : { profile: value.profile })
        }}
      />
    </div>
  )
}

/** A skipped model's note (`modelAvailability.unavailable`), or nothing while it is usable. */
function AvailabilityNote({ view, profileId }: { view: View; profileId?: string }) {
  const i18n = useI18n()
  const entry = profileId ? profileAvailability(view, profileId) : undefined
  if (!entry) return null
  return <p className="text-xs text-warning" role="status">{describeUnavailability(entry, i18n.locale)}</p>
}

/**
 * The ordered fallbacks of one language purpose (#1250): add, remove and reorder. Shown only once
 * the purpose has its own primary model; the chain is written back with it (`{ profile, fallbacks }`).
 */
function FallbackChain({
  label,
  view,
  primary,
  chain,
  choices,
  onChange,
}: {
  label: string
  view: View
  primary?: string
  chain?: string[]
  choices: SearchableSelectOption[]
  onChange: (chain: string[]) => void
}) {
  const i18n = useI18n()
  if (!primary) return null
  const list = chain ?? []
  const options = choices.filter((item) => item.value)
  return (
    <div className="min-w-0 space-y-2" data-fallback-chain={label}>
      <AvailabilityNote view={view} profileId={primary} />
      {list.map((id, index) => (
        <div key={`${index}:${id}`} className="space-y-1">
          <div className="flex items-center gap-2">
            <SearchableSelectField
              variant="ghost"
              className="min-w-0 flex-1"
              aria-label={i18n.t("{0}备用模型 {1}", [label, index + 1])}
              value={id}
              onValueChange={(selected) =>
                onChange(cleanFallbacks(primary, list.map((item, i) => (i === index ? selected : item))))
              }
              options={options.filter((item) => item.value === id || (item.value !== primary && !list.includes(item.value)))}
            />
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-label={i18n.t("调整{0}备用模型 {1}", [label, index + 1])}>
                  <MoreHorizontal />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={index === 0} onSelect={() => onChange(moveFallback(list, index, -1))}>
                  <ArrowUp />{i18n.t("上移")}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={index === list.length - 1} onSelect={() => onChange(moveFallback(list, index, 1))}>
                  <ArrowDown />{i18n.t("下移")}
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onSelect={() => onChange(list.filter((_, i) => i !== index))}>
                  <Trash2 />{i18n.t("删除备用模型")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <AvailabilityNote view={view} profileId={id} />
        </div>
      ))}
      <SearchableSelectField
        variant="ghost"
        aria-label={i18n.t("添加{0}备用模型", [label])}
        value=""
        onValueChange={(id) => {
          if (id) onChange(cleanFallbacks(primary, [...list, id]))
        }}
        options={[
          { value: '', label: i18n.t("添加备用模型") },
          ...options.filter((item) => item.value !== primary && !list.includes(item.value)),
        ]}
      />
    </div>
  )
}

/** The Host's recent switches to a fallback model (newest first); nothing when there were none. */
function RecentFallbacks({ view }: { view: View }) {
  const i18n = useI18n()
  const rows = recentFallbackRows(view, i18n.locale)
  if (!rows.length) return null
  return (
    <Card className="p-4 space-y-3">
      <h4 className="font-medium">{i18n.t("最近的备用模型切换")}</h4>
      <ul className="space-y-1 text-sm" role="list">
        {rows.map((row) => (
          <li key={row.key}>
            {i18n.t("{0}：{1} → {2}（{3}）", [row.purpose, row.from, row.to, row.reason])}
            <span className="text-muted-foreground"> · {row.at}{row.selection ? ` · ${i18n.t("主模型已被跳过")}` : ''}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

/**
 * 插话判断（ADR 0066 D1–D4, D7）：一个模型（语言模型和决策模型可以混选）、可混排的备用链、
 * 可选的对照模型、门槛、「只观察」和决策模型超时，写入 `purposes.ambient`。
 */
function AmbientJudgeSection({
  view,
  judge,
  draft,
  problems,
  fallbacks,
  onChange,
  onNoticed,
}: {
  view: View
  judge: AmbientJudgeView | null
  draft: AmbientJudgeDraft
  problems: AmbientJudgeProblem[]
  fallbacks: boolean
  onChange: (update: (draft: AmbientJudgeDraft) => AmbientJudgeDraft) => void
  /** `false`: the Host refused (no permission); the banner is then hidden in this browser only. */
  onNoticed: () => Promise<boolean>
}) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const canNotice = hasConsolePermission('agent.configure', access)
  const canReadStatus = hasConsolePermission('ambient:read', access)
  const [agreement, setAgreement] = useState<AmbientAgreement | null>(null)
  const [noticing, setNoticing] = useState(false)
  const noticeKey = judge?.migration ? `zhin.console.ambient-judge-notice:${view.rootId}:${judge.migration.at}` : ''
  const [hiddenNow, setHiddenLocally] = useState(false)
  // Read on every render: the migration record (and so the key) may arrive after the first one.
  let hiddenStored = false
  try { hiddenStored = Boolean(noticeKey) && sessionStorage.getItem(noticeKey) === 'hidden' } catch { hiddenStored = false }
  const hiddenLocally = hiddenNow || hiddenStored
  const hideLocally = () => {
    try { if (noticeKey) sessionStorage.setItem(noticeKey, 'hidden') } catch { /* storage blocked: hidden for this render only */ }
    setHiddenLocally(true)
  }
  useEffect(() => {
    let alive = true
    // Agreement lives in the interjection status (ambient:read); without that permission it is not read.
    if (!canReadStatus) { setAgreement(null); return }
    void pluginRpc<unknown>('root', 'ambient').then(
      (status) => { if (alive) setAgreement(ambientAgreement(status, i18n.locale, (id) => profileName(view, id))) },
      () => { if (alive) setAgreement(null) },
    )
    return () => { alive = false }
  }, [view.rootId, i18n.locale, canReadStatus])
  const options: SearchableSelectOption[] = ambientJudgeChoices(view, i18n.locale).map((choice) => ({
    value: choice.value,
    label: supportLabel(choice.profile.label ?? choice.profile.model, profileSupport(view, choice.profile)),
    group: choice.group,
    description: choice.description,
    keywords: `${choice.keywords} ${ambientJudgeKindLabel(choice.kind, i18n.locale)}`,
  }))
  const chain = draft.profile ? [draft.profile, ...draft.fallbacks] : []
  const inheritedChain = !draft.profile ? [view.purposes?.defaults.chat, ...(view.purposes?.defaults.chatFallbacks ?? [])].filter((id): id is string => Boolean(id)) : []
  const hints = ambientJudgeHints(draft, view, inheritedChain, i18n.locale)
  const notice = hiddenLocally ? null : ambientMigrationNotice(judge, view, i18n.locale)
  const failure = ambientMigrationFailure(judge, i18n.locale)
  const problemsOf = (field: AmbientJudgeProblem['field']) => problems.filter((problem) => problem.field === field)
  const problemList = (field: AmbientJudgeProblem['field']) => problemsOf(field).map((problem) => (
    <p key={problem.message} className="text-xs text-destructive" role="alert">{problem.message}</p>
  ))
  const notice_ = async () => {
    setNoticing(true)
    try { if (!(await onNoticed())) hideLocally() } finally { setNoticing(false) }
  }
  return (
    <Card className="p-4 space-y-4" data-ambient-judge="">
      <div className="space-y-1">
        <h4 className="font-medium">{i18n.t("插话判断")}</h4>
        <p className="text-sm text-muted-foreground">
          {i18n.t("插话判断：群里没人叫机器人时，决定要不要插话。只决定说不说，说什么由「聊天」用途写。可以选普通语言模型或决策模型（如 TypeSafe），两类可以混排成备用链。")}
        </p>
      </div>
      {notice ? (
        <Alert role="status">
          <AlertTitle>{i18n.t("插话判断已从旧配置迁移")}</AlertTitle>
          <AlertDescription className="space-y-2">
            <p>{i18n.t("原来的「旁听」和决策「旁听参与判断」已在 {0} 合成这一项：", [new Date(notice.at).toLocaleString(i18n.locale === 'en' ? 'en-US' : 'zh-CN', { hour12: false })])}</p>
            {notice.rows.length ? (
              <ul className="list-disc space-y-1 pl-5" role="list">
                {notice.rows.map((row) => (
                  <li key={row.key}>
                    {i18n.t("{0}：{1}", [row.field, row.value])}
                    {row.from ? <span className="text-muted-foreground"> · {i18n.t("来自 {0}", [row.from])}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {notice.notes.map((note) => <p key={note}>{note}</p>)}
            <p>
              {i18n.t("要回退到迁移前的写法，在 Host 上运行")} <InlineCode>{AMBIENT_JUDGE_REVERT_COMMAND}</InlineCode>
              {i18n.t("（只在迁移后没改过插话判断时可用；降级到旧版本前必须先回退）。")}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {canNotice
                ? <Button type="button" size="sm" variant="outline" disabled={noticing} onClick={() => void notice_()}>{i18n.t("知道了")}</Button>
                : <Button type="button" size="sm" variant="outline" onClick={hideLocally}>{i18n.t("在这个浏览器里隐藏")}</Button>}
              <Button type="button" size="sm" variant="ghost" asChild>
                <a href={ambientJudgeDocUrl(i18n.locale)} target="_blank" rel="noreferrer">{i18n.t("查看迁移说明")}</a>
              </Button>
            </div>
          </AlertDescription>
        </Alert>
      ) : null}
      {failure ? <p className="text-xs text-warning" role="status">{failure}</p> : null}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="min-w-0 space-y-2 text-sm">
          <label className="block space-y-2">
            <span>{i18n.t("插话判断模型")}</span>
            <SearchableSelectField
              aria-label={i18n.t("插话判断模型")}
              variant={draft.profile ? 'default' : 'ghost'}
              value={draft.profile}
              onValueChange={(profile) => onChange((previous) => ({
                ...previous,
                profile,
                fallbacks: profile ? cleanFallbacks(profile, previous.fallbacks) : [],
                compare: previous.compare === profile ? '' : previous.compare,
              }))}
              options={[{ value: '', label: i18n.t("跟随部署聊天") }, ...options]}
            />
          </label>
          {problemList('profile')}
          {!draft.profile ? (
            <p className="text-xs text-muted-foreground">
              {inheritedChain.length
                ? i18n.t("跟随聊天：{0}", [inheritedChain.map((id) => profileName(view, id)).join(' → ')])
                : i18n.t("跟随聊天：还没有设置聊天模型。")}
            </p>
          ) : null}
          {fallbacks ? (
            <FallbackChain
              label={i18n.t("插话判断")}
              view={view}
              primary={draft.profile || undefined}
              chain={draft.fallbacks}
              choices={options}
              onChange={(next) => onChange((previous) => ({ ...previous, fallbacks: next, compare: next.includes(previous.compare) ? '' : previous.compare }))}
            />
          ) : null}
          {problemList('fallbacks')}
        </div>
        <div className="min-w-0 space-y-2 text-sm">
          <label className="block space-y-2">
            <span>{i18n.t("对照模型")}</span>
            <SearchableSelectField
              aria-label={i18n.t("对照模型")}
              variant={draft.compare ? 'default' : 'ghost'}
              value={draft.compare}
              onValueChange={(compare) => onChange((previous) => ({ ...previous, compare }))}
              options={[{ value: '', label: i18n.t("不对照") }, ...options.filter((option) => option.value === draft.compare || !chain.includes(option.value))]}
            />
          </label>
          <p className="text-xs text-muted-foreground">
            {i18n.t("对照模型对同一份消息也判一次，只记录它会怎么判，从不影响插不插话。开了对照，每次判断的模型调用翻倍。")}
          </p>
          {problemList('compare')}
          {agreement ? <AmbientAgreementLine agreement={agreement} /> : null}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <label className="block space-y-1 text-sm">
          <span>{i18n.t("门槛（0 到 1）")}</span>
          <Input
            type="number" min={0} max={1} step="any" inputMode="decimal"
            aria-label={i18n.t("门槛（0 到 1）")}
            placeholder={String(DEFAULT_AMBIENT_MIN_CONFIDENCE)}
            value={draft.minConfidence}
            onChange={(event) => { const minConfidence = event.target.value; onChange((previous) => ({ ...previous, minConfidence })) }}
          />
          <span className="block text-xs text-muted-foreground">{i18n.t("判断选「插话」且把握不低于门槛才插话；不填为 {0}。", [DEFAULT_AMBIENT_MIN_CONFIDENCE])}</span>
          {problemList('minConfidence')}
        </label>
        <label className="block space-y-1 text-sm">
          <span>{i18n.t("决策模型超时（毫秒）")}</span>
          <Input
            type="number" min={1} step={1} inputMode="numeric"
            aria-label={i18n.t("决策模型超时（毫秒）")}
            placeholder={String(DEFAULT_AMBIENT_JUDGE_TIMEOUT_MS)}
            value={draft.timeoutMs}
            onChange={(event) => { const timeoutMs = event.target.value; onChange((previous) => ({ ...previous, timeoutMs })) }}
          />
          <span className="block text-xs text-muted-foreground">{i18n.t("只对链里的决策模型生效；不填为 {0}。", [DEFAULT_AMBIENT_JUDGE_TIMEOUT_MS])}</span>
          {problemList('timeoutMs')}
        </label>
        <div className="space-y-1 text-sm">
          <label className="flex items-center gap-3">
            <Switch
              aria-label={i18n.t("只观察（不插话）")}
              checked={draft.mode === 'shadow'}
              onCheckedChange={(checked) => onChange((previous) => ({ ...previous, mode: checked ? 'shadow' : 'active' }))}
            />
            <span>{i18n.t("只观察（不插话）")}</span>
          </label>
          <span className="block text-xs text-muted-foreground">{i18n.t("照常判断并记录，但不在群里开口。")}</span>
        </div>
      </div>
      {hints.map((hint) => <p key={hint} className="text-xs text-warning" role="note">{hint}</p>)}
    </Card>
  )
}

/** 「与对照模型一致 N%（共 M 次，最近 24 小时）」 and the two kinds of disagreement. */
function AmbientAgreementLine({ agreement }: { agreement: AmbientAgreement }) {
  const i18n = useI18n()
  return (
    <div className="text-xs text-muted-foreground" role="status">
      <p className="font-medium text-foreground">{agreement.text}</p>
      <p>{agreement.detail}</p>
      {agreement.byMember.length > 1 ? (
        <ul className="mt-1 space-y-0.5" role="list">
          {agreement.byMember.map((row) => <li key={row.key}>{i18n.t("{0}：{1}", [row.label, row.text])}</li>)}
        </ul>
      ) : null}
    </div>
  )
}
