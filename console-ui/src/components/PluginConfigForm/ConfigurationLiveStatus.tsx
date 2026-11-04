import { useI18n } from '../../i18n'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { configurationRuntimeStatus, configurationEffectLabel, configurationGroupLabel, configurationPath } from './config-live-status.mjs'

export function ConfigurationLiveStatus({ result, revision, onRefresh, onApply, disabled, applying, actionError }: {
  result: unknown; revision?: string; onRefresh?: () => void; onApply?: () => void; disabled?: boolean; applying?: boolean; actionError?: string | null
}) {
  const i18n = useI18n()
  const state = configurationRuntimeStatus(result, revision, i18n.locale)
  const current = state.kind !== 'stale'
  const counts = [...new Set(state.groups.map(group => group.status))]
  const short = (value: string) => value.length > 20 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value
  return <section aria-label={i18n.t('运行生效状态')} className="rounded-lg border bg-muted/20 p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h3 className="text-sm font-semibold">{i18n.t('运行生效状态')}</h3>
      <div className="flex flex-wrap gap-2">
        {onRefresh ? <Button type="button" size="sm" variant="ghost" onClick={onRefresh}>{i18n.t('刷新运行状态')}</Button> : null}
        {onApply ? <Button type="button" size="sm" variant="outline" disabled={disabled} aria-busy={applying} onClick={onApply}>{i18n.t(applying ? '正在应用已保存配置…' : '应用已保存配置')}</Button> : null}
      </div>
    </div>
    <p role="status" className={state.kind === 'failed' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{state.summary}</p>
    {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
    <p className="text-xs text-muted-foreground">{i18n.t('以下是已保存版本的生效结果。')}</p>
    {revision ? <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      <span title={revision}>{i18n.t('文件版本：{0}', [short(revision)])}</span>
      {state.application ? <>
        {!current ? <span title={state.application.sourceRevision}>{i18n.t('证据文件版本：{0}', [short(state.application.sourceRevision)])}</span> : null}
        <span>{i18n.t('运行代：{0}', [state.application.generation])}</span><span>{i18n.t('应用序号：{0}', [state.application.applicationRevision])}</span>
      </> : null}
    </div> : null}
    {counts.length ? <div className="flex flex-wrap gap-2">{counts.map(status => <Badge key={status}
      variant={!current ? 'outline' : status === 'applied' ? 'success' : status === 'failed' ? 'destructive' : 'warning'}>
      {current ? configurationGroupLabel(status, i18n.locale) : i18n.t('旧版本：{0}', [configurationGroupLabel(status, i18n.locale)])} · {state.groups.filter(group => group.status === status).length}
    </Badge>)}</div> : null}
    {state.groups.length ? <ul className="divide-y text-sm">{state.groups.map(group => <li key={group.id} className="py-2 first:pt-0 last:pb-0 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium break-all">{group.id}</span>
        <span className="text-xs text-muted-foreground">{configurationEffectLabel(group.effect, i18n.locale)} · {current ? configurationGroupLabel(group.status, i18n.locale) : i18n.t('旧版本：{0}', [configurationGroupLabel(group.status, i18n.locale)])}</span></div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{group.paths.map(path => <code className="break-all" key={configurationPath(path)}>{configurationPath(path)}</code>)}</div>
      {group.dependsOn.length ? <p className="text-xs text-muted-foreground break-all">{i18n.t('依赖：{0}', [group.dependsOn.join('、')])}</p> : null}
      {group.reasonCode ? <p className="text-xs text-muted-foreground break-all">{i18n.t('原因代码：{0}', [/^[a-z][a-z0-9:,_-]*$/.test(group.reasonCode) ? group.reasonCode : i18n.t('Host 未提供可显示的原因代码')])}</p> : null}
    </li>)}</ul> : null}
  </section>
}
