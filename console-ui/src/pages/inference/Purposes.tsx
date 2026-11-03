import { useEffect, useState } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { Card } from '../../components/ui/card'
import {
  purposePlan,
  inferenceError,
  type Purposes as PurposeState,
  type ScopeModels,
  type Kind,
  type Targets,
  type DecisionPolicy,
} from './model.mjs'
import type { InferenceManagement } from './useInferenceManagement'

const taskLabels: Record<string, string> = {
  skills: '技能选择',
  tools: '工具选择',
  memory: '记忆选择',
  agents: 'Agent 选择',
  approval: '工具审批建议',
  ambient: '旁听参与判断',
}
export function Purposes({ management: m }: { management: InferenceManagement }) {
  const view = m.view!,
    [draft, setDraft] = useState<PurposeState>(() => structuredClone(view.purposes!)),
    [targets, setTargets] = useState<Targets | null>(null)
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
        if (alive && m.active()) m.setError(inferenceError(error))
      }
    )
    return () => {
      alive = false
    }
  }, [view.rootId])
  const choices = (kind: Kind, inherit = '未设置') => [
    { value: '', label: inherit },
    ...Object.values(view.profiles)
      .filter((profile) => {
        const account = view.accounts[profile.accountId]
        return view.services[account.serviceId].models[profile.model].kinds.includes(kind)
      })
      .map((profile) => ({ value: profile.id, label: profile.label ?? profile.model })),
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
      if (m.active()) m.setError(inferenceError(error))
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
        await m.savePlan({ version: 1, purposes: purposePlan(draft, view.purposes!) })
      }}
    >
      <div className="flex items-center justify-between gap-3">
        <h3 className="font-semibold">模型用途</h3>
        <Button type="submit" disabled={disabled}>
          保存
        </Button>
      </div>
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">默认模型</h4>
        <div className="grid gap-4 sm:grid-cols-2">
          {(
            [
              ['chat', '聊天'],
              ['summary', '摘要'],
              ['ambient', '旁听'],
              ['image', '图片生成'],
            ] as const
          ).map(([key, label]) => (
            <label className="space-y-2 text-sm" key={key}>
              <span>{label}</span>
              <SelectField
                value={draft.defaults[key] ?? ''}
                onValueChange={(value) => defaultValue(key, value)}
                options={choices(
                  key === 'image' ? 'image' : 'language',
                  key === 'summary' || key === 'ambient' ? '跟随部署聊天' : '未设置'
                )}
              />
            </label>
          ))}
        </div>
        <Perception
          value={draft.defaults.perception}
          choices={choices('language', '未设置')}
          onChange={(value) =>
            setDraft((previous) => ({
              ...previous,
              defaults: { ...previous.defaults, perception: value },
            }))
          }
        />
      </Card>
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">决策</h4>
        {Object.entries(taskLabels).map(([task, label]) => {
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
                aria-label={`${label}模式`}
                value={policy?.mode ?? 'off'}
                onValueChange={(mode) =>
                  change({ ...policy, mode: mode as DecisionPolicy['mode'] })
                }
                options={[
                  { value: 'off', label: '关闭' },
                  { value: 'shadow', label: '仅评估' },
                  { value: 'active', label: '启用' },
                ]}
              />
              <SelectField
                aria-label={`${label}模型`}
                value={policy?.profile ?? ''}
                onValueChange={(profile) =>
                  change({ ...policy, mode: policy?.mode ?? 'off', profile: profile || undefined })
                }
                options={choices('decision')}
              />
              {policy ? (
                <details className="sm:col-span-3 text-sm">
                  <summary className="cursor-pointer text-muted-foreground">调整决策参数</summary>
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
                              timeoutMs: '超时（毫秒）',
                              minConfidence: '置信度',
                              topK: '候选数量',
                              maxCandidates: '候选上限',
                              maxSelections: '选择上限',
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
              options={choices('language', '跟随聊天')}
            />
          </label>
        ))}
      </Card>
      <Card className="p-4 space-y-4">
        <h4 className="font-medium">按场景选择</h4>
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
              { value: 'adapters', label: '适配器' },
              { value: 'endpoints', label: '账号终端' },
              { value: 'scenes', label: '会话场景' },
            ]}
          />
          <SelectField
            className="min-w-0 flex-1"
            value={target}
            onValueChange={setTarget}
            options={[{ value: '', label: '选择目标' }, ...candidates]}
          />
          <Button
            type="button"
            variant="outline"
            disabled={!target || disabled}
            onClick={() => changeScope(target, draft[level]?.[target] ?? {})}
          >
            <Plus />
            添加
          </Button>
        </div>
        {Object.entries(draft[level] ?? {}).map(([key, value]) => (
          <div key={key} className="space-y-3 rounded-md border p-3">
            <div className="flex justify-between items-center gap-2">
              <span className="text-sm break-all">
                {candidates.find((item) => item.value === key)?.label ?? '已配置目标（当前未列出）'}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="移除覆盖"
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
              options={choices('language', '继承上层聊天模型')}
            />
            {level !== 'scenes' ? (
              <Perception
                value={(value as ScopeModels).perception}
                choices={choices('language', '继承上层识图模型')}
                onChange={(perception) => changeScope(key, { ...value, perception })}
              />
            ) : null}
          </div>
        ))}
        {level === 'scenes' && targets?.sceneHasMore ? (
          <Button type="button" variant="outline" onClick={() => void loadScenes()}>
            加载更多场景
          </Button>
        ) : null}
        {level === 'scenes' && targets?.scenesError && targets.scenesError !== 'not_requested' ? (
          <p role="alert" className="text-sm text-destructive">
            场景目录暂不可用，已有配置保留。
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
  choices: Array<{ value: string; label: string }>
  onChange: (value: { profile: string; fallbacks?: string[] } | undefined) => void
}) {
  return (
    <div className="space-y-3">
      <label className="block space-y-2 text-sm">
        <span>识图</span>
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
                aria-label={`识图备用模型 ${index + 1}`}
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
                aria-label="删除备用模型"
                onClick={() =>
                  onChange({ ...value, fallbacks: value.fallbacks!.filter((_, i) => i !== index) })
                }
              >
                <Trash2 />
              </Button>
            </div>
          ))}
          <SelectField
            aria-label="添加识图备用模型"
            value=""
            onValueChange={(id) => {
              if (id) onChange({ ...value, fallbacks: [...(value.fallbacks ?? []), id] })
            }}
            options={[
              { value: '', label: '添加备用模型' },
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
