import { useI18n } from '../../i18n'
import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, MoreHorizontal, Plus, Trash2 } from 'lucide-react'
import { Button, Card, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger, Input, SearchableSelectField, type SearchableSelectOption, SelectField, useConfirm } from '@zhin.js/console-ui'
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

const decisionTaskLabels = (t: ReturnType<typeof useI18n>['t']): Record<string, string> => ({
  skills: t('技能选择'),
  tools: t('工具选择'),
  memory: t('记忆选择'),
  agents: t('Agent 选择'),
  approval: t('工具审批建议'),
  ambient: t('旁听参与判断'),
})
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
        saveFeedback.reset()
        if (!(await probeNewBindings())) return
        setSaving(true)
        try {
          const saved = await m.savePlan({ version: 1, purposes: purposePlan(draft, view.purposes!, { fallbacks }) }, {
            source,
            onCommitted: (next) => setEditor((current) => ({
              source: next,
              // Only this confirmed save can move the baseline. Keep edits made while it waited.
              draft: current === submitted ? structuredClone(next.view.purposes!) : current.draft,
            })),
          })
          // The result is shown on the button (保存中… → ✓ 已保存), not in a toast.
          if (saved && m.active()) saveFeedback.markSaved()
        } finally {
          setSaving(false)
        }
      }}
    >
      {confirmDialog}
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
          ).map(([key, label]) => (
            <div className="min-w-0 space-y-2 text-sm" key={key}>
              <label className="block space-y-2">
                <span>{label}</span>
                <SearchableSelectField
                  aria-label={label}
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
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">{i18n.t("决策")}</h4>
        {Object.entries(decisionTaskLabels(i18n.t)).map(([task, label]) => {
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
  return <p className="text-xs text-destructive" role="status">{describeUnavailability(entry, i18n.locale)}</p>
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
