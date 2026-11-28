import { useI18n } from '../../i18n'
import { Badge, Button } from '@zhin.js/console-ui'
import { configurationRuntimeStatus, configurationEffectLabel, configurationGroupLabel, configurationGroupTitle, configurationPath, configurationPathLabel } from './config-live-status.mjs'

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
        {onApply ? <Button type="button" size="sm" variant="secondary" disabled={disabled} aria-busy={applying} onClick={onApply}>{i18n.t(applying ? '正在应用已保存配置…' : '应用已保存配置')}</Button> : null}
      </div>
    </div>
    <p role="status" className={state.kind === 'failed' ? 'text-sm text-destructive' : 'text-sm text-muted-foreground'}>{state.summary}</p>
    {actionError ? <p role="alert" className="text-sm text-destructive">{actionError}</p> : null}
    {/* One sentence says the state (zhinjs/zhin#1250 apply-status-redundant-sentences): 「已保存的配置都已生效。」 stands
        alone; only a result from an older file adds which file it belongs to. */}
    {revision && state.application && !current ? <p className="text-xs text-muted-foreground">{i18n.t('结果来自较早保存的配置文件，不代表当前文件。')}</p> : null}
    {counts.length ? <div className="flex flex-wrap gap-2">{counts.map(status => <Badge key={status}
      variant={!current ? 'outline' : status === 'applied' ? 'outline' : status === 'failed' ? 'destructive' : 'warning'}>
      {current ? configurationGroupLabel(status, i18n.locale) : i18n.t('旧版本：{0}', [configurationGroupLabel(status, i18n.locale)])} · {state.groups.filter(group => group.status === status).length}
    </Badge>)}</div> : null}
    {state.groups.length ? <ul className="divide-y text-sm">{state.groups.map(group => <li key={group.id} className="py-2 first:pt-0 last:pb-0 space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-2"><span className="font-medium break-all">{configurationGroupTitle(group.id, i18n.locale)}</span>
        <span className="text-xs text-muted-foreground">{configurationEffectLabel(group.effect, i18n.locale)} · {current ? configurationGroupLabel(group.status, i18n.locale) : i18n.t('旧版本：{0}', [configurationGroupLabel(group.status, i18n.locale)])}</span></div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">{group.paths.map(path => <span className="break-all" key={configurationPath(path)} title={configurationPath(path)}>{configurationPathLabel(path, i18n.locale)}</span>)}</div>
      {group.dependsOn.length ? <p className="text-xs text-muted-foreground break-all">{i18n.t('依赖：{0}', [group.dependsOn.map(id => configurationGroupTitle(id, i18n.locale)).join(i18n.t('、'))])}</p> : null}
    </li>)}</ul> : null}
    {revision ? <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer">{i18n.t('详情')}</summary>
      <div className="mt-2 space-y-1 break-all">
        <p title={revision}>{i18n.t('文件版本：{0}', [short(revision)])}</p>
        {state.application ? <>
          {!current ? <p title={state.application.sourceRevision}>{i18n.t('证据文件版本：{0}', [short(state.application.sourceRevision)])}</p> : null}
          <p>{i18n.t('运行代：{0}', [state.application.generation])} · {i18n.t('应用序号：{0}', [state.application.applicationRevision])}</p>
        </> : null}
        {state.groups.map(group => <p key={group.id}>
          <code>{group.id}</code>{' '}{group.paths.map(path => <code className="mr-2" key={configurationPath(path)}>{configurationPath(path)}</code>)}
          {group.reasonCode ? <span>{i18n.t('原因代码：{0}', [/^[a-z][a-z0-9:,_-]*$/.test(group.reasonCode) ? group.reasonCode : i18n.t('Host 未提供可显示的原因代码')])}</span> : null}
        </p>)}
      </div>
    </details> : null}
  </section>
}
