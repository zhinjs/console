import { useI18n } from '../../i18n'
import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SelectField, type SelectFieldOption } from '../../components/ui/select'
import { supportLabel } from './SupportInfo'
import { Card } from '../../components/ui/card'
import {
  purposePlan,
  profileSupport,
  inferenceError,
  type Purposes as PurposeState,
  type ScopeModels,
  type Kind,
  type Targets,
  type DecisionPolicy,
} from './model.mjs'
import type { InferenceManagement } from './useInferenceManagement'

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
  const disabled = m.busy || !!m.pending
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
  const choices = (kind: Kind, inherit = i18n.t("未设置")) => [
    { value: '', label: inherit },
    ...Object.values(view.profiles)
      .filter((profile) => {
        const account = view.accounts[profile.accountId]
        return view.services[account.serviceId].models[profile.model].kinds.includes(kind)
      })
      .map((profile) => ({
        value: profile.id,
        label: supportLabel(profile.label ?? profile.model, profileSupport(view, profile)),
      })),
  ]
  function defaultValue(key: 'chat' | 'summary' | 'ambient' | 'image', value: string) {
    setDraft((previous) => ({
      ...previous,
      defaults: { ...previous.defaults, [key]: value || undefined },
    }))
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
        await m.savePlan({ version: 1, purposes: purposePlan(draft, view.purposes!) }, {
          source,
          onCommitted: (next) => setEditor((current) => ({
            source: next,
            // Only this confirmed save can move the baseline. Keep edits made while it waited.
            draft: current === submitted ? structuredClone(next.view.purposes!) : current.draft,
          })),
        })
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">{i18n.t("模型用途")}</h3>
        <Button type="submit" disabled={disabled}>
          {i18n.t("保存")}
        </Button>
      </div>
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">{i18n.t("默认模型")}</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['chat', i18n.t("聊天")],
              ['summary', i18n.t("摘要")],
              ['ambient', i18n.t("旁听")],
              ['image', i18n.t("图片生成")],
            ] as const
          ).map(([key, label]) => (
            <label className="space-y-2 text-sm" key={key}>
              <span>{label}</span>
              <SelectField
                value={draft.defaults[key] ?? ''}
                onValueChange={(value) => defaultValue(key, value)}
                options={choices(
                  key === 'image' ? 'image' : 'language',
                  key === 'summary' || key === 'ambient' ? i18n.t("跟随部署聊天") : i18n.t("未设置")
                )}
              />
            </label>
          ))}
        </div>
        <Perception
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
            <div key={task} className="grid gap-3 border-b pb-4 last:border-0 sm:grid-cols-3">
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
              <SelectField
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
                  <div className="grid gap-3 mt-3 sm:grid-cols-3">
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
        ].map((name) => (
          <label key={name} className="grid gap-3 sm:grid-cols-2 text-sm">
            <span className="self-center">
              {targets?.agents.find((agent) => agent.name === name)?.nickname ?? name}
            </span>
            <SelectField
              value={draft.agents?.[name] ?? ''}
              onValueChange={(value) =>
                setDraft((previous) => {
                  const agents: Record<string, string> = { ...previous.agents }
                  if (value) agents[name] = value
                  else delete agents[name]
                  return { ...previous, agents }
                })
              }
              options={choices('language', i18n.t("跟随聊天"))}
            />
          </label>
        ))}
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
          <SelectField
            className="min-w-0 flex-1"
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
          <div key={key} className="space-y-3 rounded-md border p-3">
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
            <SelectField
              value={value.chat ?? ''}
              onValueChange={(chat) => changeScope(key, { ...value, chat: chat || undefined })}
              options={choices('language', i18n.t("继承上层聊天模型"))}
            />
            {level !== 'scenes' ? (
              <Perception
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
    </form>
  )
}
function Perception({
  value,
  choices,
  onChange,
}: {
  value?: { profile: string; fallbacks?: string[] }
  choices: SelectFieldOption[]
  onChange: (value: { profile: string; fallbacks?: string[] } | undefined) => void
}) {
  const i18n = useI18n()
  return (
    <div className="space-y-3">
      <label className="block space-y-2 text-sm">
        <span>{i18n.t("识图")}</span>
        <SelectField
          value={value?.profile ?? ''}
          onValueChange={(profile) =>
            onChange(profile ? { profile, fallbacks: value?.fallbacks } : undefined)
          }
          options={choices}
        />
      </label>
      {value ? (
        <div className="space-y-2">
          {(value.fallbacks ?? []).map((id, index) => (
            <div key={index} className="flex gap-2">
              <SelectField
                className="flex-1"
                aria-label={i18n.t("识图备用模型 {0}", [index + 1])}
                value={id}
                onValueChange={(selected) =>
                  onChange({
                    ...value,
                    fallbacks: value.fallbacks!.map((item, i) => (i === index ? selected : item)),
                  })
                }
                options={choices.filter((item) => item.value)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label={i18n.t("删除备用模型")}
                onClick={() =>
                  onChange({ ...value, fallbacks: value.fallbacks!.filter((_, i) => i !== index) })
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <SelectField
            aria-label={i18n.t("添加识图备用模型")}
            value=""
            onValueChange={(id) => {
              if (id) onChange({ ...value, fallbacks: [...(value.fallbacks ?? []), id] })
            }}
            options={[
              { value: '', label: i18n.t("添加备用模型") },
              ...choices.filter(
                (item) =>
                  item.value &&
                  item.value !== value.profile &&
                  !value.fallbacks?.includes(item.value)
              ),
            ]}
          />
        </div>
      ) : null}
    </div>
  )
}
