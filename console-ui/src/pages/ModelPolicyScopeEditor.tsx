import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { SelectField } from '../components/ui/select'
import { Button } from '../components/ui/button'
import { policyAddressKey, type ModelPolicyRefs, type ModelPolicyView } from './model-policy-model.mjs'

type Purpose = 'chat' | 'perception' | 'summary'
type Scope = 'adapters' | 'endpoints' | 'scenes'
export function ModelPolicyScopeEditor({ view, draft, onChange, onLoadScenes, loading }: {
  view: ModelPolicyView; draft: ModelPolicyRefs; onChange(value: ModelPolicyRefs): void; onLoadScenes(): void; loading: boolean
}) {
  const i18n = useI18n()
  const [targets, setTargets] = useState<Record<Scope, string>>({ adapters: '', endpoints: '', scenes: '' })
  const choices = (current?: string, inherited = i18n.t('继承')) => [{ value: '', label: inherited }, ...view.presets.map(preset => ({ value: preset.id, label: `${preset.id} · ${preset.model} (${preset.sdk})` })),
    ...(current && !view.presets.some(preset => preset.id === current) ? [{ value: current, label: `${current} · ${i18n.t('当前预设不可用')}` }] : [])]
  const labels = { chat: '聊天', perception: '识图', summary: '摘要' }
  const purposeFields = (patch: Partial<Record<Purpose, string>>, purposes: Purpose[], change: (patch: Partial<Record<Purpose, string>>) => void, prefix: string, disabled = false) => <div className="grid gap-3 sm:grid-cols-3">{purposes.map(purpose => <label key={purpose} className="space-y-2 text-sm"><span>{i18n.t(labels[purpose])}</span><SelectField aria-label={`${prefix} ${i18n.t(labels[purpose])}`} disabled={disabled} value={patch[purpose] ?? ''} options={choices(patch[purpose], prefix === i18n.t('默认用途') ? purpose === 'summary' && view.baseline.defaults?.summary === undefined ? i18n.t('跟随部署默认聊天') : view.baseline.defaults?.[purpose] ? i18n.t('继承启动基线：{0}', [view.baseline.defaults[purpose]!]) : i18n.t('继承') : i18n.t('继承'))} onValueChange={value => { const next = { ...patch }; if (value) next[purpose] = value; else delete next[purpose]; change(next) }} /></label>)}</div>
  const directory = view.targets
  const options: Record<Scope, Array<{ value: string; label: string; address?: unknown }>> = {
    adapters: [...new Set(directory?.adapters.map(item => item.platform) ?? [])].map(platform => ({ value: platform, label: platform })),
    endpoints: directory?.endpoints.map(item => ({ value: policyAddressKey(item.address), label: `${item.address.platform} · ${item.address.endpoint}`, address: item.address })) ?? [],
    scenes: directory?.scenes.map(item => ({ value: policyAddressKey(item.address), label: `${item.address.platform} · ${item.address.endpoint} · ${item.address.conversation.kind}:${item.address.conversation.id}${item.address.conversation.parent ? ` / ${item.address.conversation.parent.id}` : ''}${item.address.conversation.threadId ? ` / ${item.address.conversation.threadId}` : ''}`, address: item.address })) ?? [],
  }
  function changeRows(scope: Scope, rows: unknown) { onChange({ ...draft, [scope]: rows }) }
  return <div className="space-y-5">
    <section className="space-y-3"><h4 className="font-medium">{i18n.t('默认用途')}</h4>
      {purposeFields(draft.defaults ?? {}, ['chat', 'perception', 'summary'], defaults => onChange({ ...draft, defaults }), i18n.t('默认用途'))}
    </section>
    {(['adapters', 'endpoints', 'scenes'] as const).map(scope => {
      const title = scope === 'adapters' ? 'Adapter' : scope === 'endpoints' ? 'Endpoint' : 'Scene'
      const rows = scope === 'adapters' ? Object.entries(draft.adapters ?? {}).map(([platform, models]) => ({ key: platform, label: platform, models }))
        : (draft[scope] ?? []).map(row => ({ key: policyAddressKey(row.address), label: options[scope].find(item => item.value === policyAddressKey(row.address))?.label ?? `${row.address.platform} · ${row.address.endpoint}${'conversation' in row.address ? ` · ${row.address.conversation.kind}:${row.address.conversation.id}` : ''}`, models: row.models }))
      const remove = (key: string) => {
        if (scope === 'adapters') { const next = { ...draft.adapters }; delete next[key]; changeRows(scope, next) }
        else changeRows(scope, (draft[scope] ?? []).filter(row => policyAddressKey(row.address) !== key))
      }
      return <section className="space-y-3 border-t pt-4" key={scope}><h4 className="font-medium">{title}</h4>
        {rows.map(row => <div key={row.key} className="space-y-3"><div className="flex items-center justify-between gap-2"><span className="text-sm break-all">{row.label}{!options[scope].some(item => item.value === row.key) ? ` · ${i18n.t('作用域暂不可选')}` : ''}</span><Button variant="ghost" size="sm" title={i18n.t('恢复继承')} aria-label={`${title} ${row.label} ${i18n.t('恢复继承')}`} onClick={() => remove(row.key)}><Trash2 /></Button></div>
          {purposeFields(row.models, scope === 'scenes' ? ['chat'] : ['chat', 'perception'], models => {
            if (scope === 'adapters') changeRows(scope, { ...draft.adapters, [row.key]: models })
            else changeRows(scope, (draft[scope] ?? []).map(item => policyAddressKey(item.address) === row.key ? { ...item, models } : item))
          }, `${title} ${row.label}`, !options[scope].some(item => item.value === row.key))}
        </div>)}
        <div className="flex flex-wrap items-center gap-2"><SelectField aria-label={`${title} ${i18n.t('选择作用域')}`} value={options[scope].some(item => item.value === targets[scope]) ? targets[scope] : ''} options={[{ value: '', label: i18n.t('选择作用域') }, ...options[scope].filter(item => !rows.some(row => row.key === item.value))]} disabled={!directory?.adaptersAvailable || !options[scope].length} onValueChange={value => setTargets(current => ({ ...current, [scope]: value }))} />
          <Button size="sm" variant="outline" disabled={!options[scope].some(item => item.value === targets[scope])} onClick={() => {
            const target = options[scope].find(item => item.value === targets[scope]); if (!target) return
            if (scope === 'adapters') changeRows(scope, { ...draft.adapters, [target.value]: {} })
            else changeRows(scope, [...draft[scope] ?? [], { address: target.address, models: {} }])
            setTargets(current => ({ ...current, [scope]: '' }))
          }}>{i18n.t('添加作用域')}</Button>
          {scope === 'scenes' && (!directory?.scenesAvailable || directory.sceneHasMore) ? <Button variant="outline" size="sm" disabled={loading} onClick={onLoadScenes}>{i18n.t(directory?.scenesAvailable ? '加载更多' : '加载已记录会话')}</Button> : null}
        </div>
        {scope === 'scenes' && directory?.scenesError && directory.scenesError !== 'not_requested' ? <p role="alert" className="text-sm text-destructive">{i18n.t('会话目录暂不可用。')}</p> : null}
        {!directory?.adaptersAvailable ? <p role="status" className="text-sm text-muted-foreground">{i18n.t('作用域目录暂不可用。')}</p> : null}
      </section>
    })}
  </div>
}
