import { useRef, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Grid3x3, List, RefreshCw } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { Switch } from '../../components/ui/switch'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { StatusState } from '../../components/StatusState'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { adapterHref, endpointHref, featureGlobalHref } from '../../console-routes.mjs'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { SCOPE_LEVEL_LABELS } from '../../scope/scope-tree.mjs'
import { readFeatureWriteResult, setEnabledRequest } from './feature-model.mjs'
import { featureReceiptOutcome, globalFeatureCounts, globalFeatureOverview, type GlobalFeatureOverviewRow } from './feature-scope-model.mjs'
import FeatureMatrixPage from './feature-matrix'
import { useFeatureList, useFeatureMatrix } from './use-feature-data'
import './feature-level-panel.css'

const VIEW_PARAM = 'view'

/**
 * 功能 tab of the 全局 object page: every feature with its global switch, the levels it can be set
 * at, and where lower levels change it (links into the object tree). The matrix (`?view=matrix`)
 * is the second view of the same data; `/features` keeps it as a standalone entry.
 */
export function GlobalFeaturesPanel() {
  const i18n = useI18n()
  const [params, setParams] = useSearchParams()
  const view = params.get(VIEW_PARAM) === 'matrix' ? 'matrix' : 'list'
  const selectView = (next: 'list' | 'matrix') => setParams(previous => {
    const query = new URLSearchParams(previous)
    if (next === 'list') query.delete(VIEW_PARAM); else query.set(VIEW_PARAM, next)
    return query
  }, { replace: true })
  const switcher = (
    <div className="console-feature-view-switch" role="group" aria-label={i18n.t('视图')}>
      <button type="button" aria-pressed={view === 'list'} onClick={() => selectView('list')}><List aria-hidden="true" />{i18n.t('列表')}</button>
      <button type="button" aria-pressed={view === 'matrix'} onClick={() => selectView('matrix')}><Grid3x3 aria-hidden="true" />{i18n.t('矩阵')}</button>
    </div>
  )
  if (view === 'matrix') {
    return (
      <FeatureMatrixPage embedded heading={{ title: i18n.t('功能矩阵'), description: i18n.t('每个功能在全局与各适配器的开关。点适配器名进入它的「功能」页签。'), actions: switcher }} />
    )
  }
  return <GlobalFeatureList switcher={switcher} />
}

function GlobalFeatureList({ switcher }: { switcher: ReactNode }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const matrix = useFeatureMatrix()
  const list = useFeatureList()
  const rows = globalFeatureOverview(matrix.rows, matrix.source === 'rpc' ? matrix.adapters : [], list.value?.features ?? null)
  const counts = globalFeatureCounts(rows)
  const canToggle = matrix.source === 'rpc' && hasConsolePermission('feature.toggle', access)
  const pending = useRef<{ plugin: string; enabled: boolean } | null>(null)
  const receipt = useActionReceipt({
    submit: async () => {
      const target = pending.current
      if (!target) throw new Error('No change')
      try {
        const outcome = featureReceiptOutcome(readFeatureWriteResult(await requestConsole<unknown>(setEnabledRequest({ plugin: target.plugin, level: 'global', enabled: target.enabled, revision: matrix.revision }))))
        if (outcome.locked) throw Object.assign(new Error(outcome.message), { code: 'locked', lockedBy: outcome.lockedBy })
        return outcome
      } finally {
        matrix.refresh()
      }
    },
    verify: async () => {
      const target = pending.current
      if (!target) return undefined
      const reply = await requestConsole<{ enabled?: boolean }>({ type: 'feature.get', plugin: target.plugin, level: 'global' })
      return { applied: reply?.enabled === target.enabled }
    },
  })
  const busy = receipt.state.phase !== 'idle' && receipt.state.phase !== 'succeeded' && receipt.state.phase !== 'failed' && receipt.state.phase !== 'partial' && receipt.state.phase !== 'unknown'
  const prepareToggle = (row: GlobalFeatureOverviewRow, enabled: boolean) => {
    pending.current = { plugin: row.plugin, enabled }
    receipt.prepare({
      title: enabled ? i18n.t('在全局启用 {0}', [row.name]) : i18n.t('在全局关闭 {0}', [row.name]),
      summary: enabled ? i18n.t('全局开关会重启 Host。') : i18n.t('全局开关会重启 Host；所有适配器、账号与会话上的这个功能都会停用。'),
      changes: [i18n.t('{0}：{1} → {2}', [row.plugin, row.enabled ? i18n.t('启用') : i18n.t('关闭'), enabled ? i18n.t('启用') : i18n.t('关闭')])],
      danger: true,
      confirmLabel: enabled ? i18n.t('启用') : i18n.t('关闭'),
    })
  }
  const levelSupport = matrix.source === 'rpc' || list.status === 'ready'
  return (
    <ObjectSection
      title={i18n.t('全部功能')}
      description={matrix.loading && !rows.length ? undefined : i18n.t('{0} 个功能，{1} 个已启用，{2} 个在下级另有设置。点功能名打开它的全局配置。', [counts.total, counts.enabled, counts.customized])}
      actions={<>{switcher}<Button variant="outline" size="sm" onClick={() => { matrix.refresh(); list.refresh() }} disabled={matrix.loading}><RefreshCw className={matrix.loading ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button></>}
    >
      {matrix.source !== 'rpc' && matrix.source !== 'loading' && !matrix.error ? (
        <Alert role="status"><AlertDescription>
          {matrix.source === 'forbidden' ? i18n.t('当前身份无权读取按层级的功能设置，只显示全局状态。')
            : matrix.source === 'unsupported' ? i18n.t('当前 Host 还不支持按适配器、账号与会话设置功能，只显示全局状态。升级 Host 后这里会列出下级设置。')
              : i18n.t('暂时无法读取按层级的功能设置，只显示全局状态。')}
        </AlertDescription></Alert>
      ) : null}
      {matrix.error ? <StatusState error={matrix.error} onRetry={matrix.refresh} /> : null}
      <ActionReceipt controller={receipt} />
      <Card className="overflow-hidden p-0">
        {matrix.loading && !rows.length ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-10" />)}</div>
        ) : !rows.length ? (
          <StatusState kind="empty" compact className="m-3" title={i18n.t('还没有功能')} description={i18n.t('安装插件后，它们的功能会出现在这里。')}
            actions={<Button asChild size="sm" variant="outline"><Link to="/marketplace">{i18n.t('去插件市场')}</Link></Button>} />
        ) : (
          <Table aria-label={i18n.t('全部功能')}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t('功能')}</TableHead>
                <TableHead>{i18n.t('全局')}</TableHead>
                {levelSupport ? <TableHead className="max-md:hidden">{i18n.t('可设置层级')}</TableHead> : null}
                {levelSupport ? <TableHead className="max-md:hidden">{i18n.t('下级设置')}</TableHead> : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.plugin}>
                  <TableCell className="max-w-[18rem]">
                    <Link to={featureGlobalHref(row.plugin)} className="font-medium hover:underline">{row.name}</Link>
                    {row.name !== row.plugin ? <code className="ml-2 text-xs text-muted-foreground">{row.plugin}</code> : null}
                    {row.description && row.description !== row.name ? <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.description}</p> : null}
                    {levelSupport && (row.below.length || row.conversations.length) ? (
                      <p className="mt-0.5 text-xs text-muted-foreground md:hidden">{i18n.t('{0} 处下级另有设置', [row.below.length + row.conversations.length])}</p>
                    ) : null}
                  </TableCell>
                  <TableCell>
                    <span className="inline-flex items-center gap-2">
                      <Switch aria-label={i18n.t('{0} · 全局', [row.plugin])} checked={row.enabled}
                        disabled={!canToggle || row.nested || busy} title={!canToggle ? i18n.t('当前身份不能启停功能') : undefined}
                        onCheckedChange={checked => prepareToggle(row, checked === true)} />
                      <span className="text-xs text-muted-foreground">{row.enabled ? i18n.t('启用') : i18n.t('关闭')}</span>
                    </span>
                  </TableCell>
                  {levelSupport ? (
                    <TableCell className="max-md:hidden">
                      {row.levels ? (
                        <span className="console-feature-levels">
                          {row.levels.map(level => <Badge key={level} variant="secondary" size="sm">{i18n.t(SCOPE_LEVEL_LABELS[level])}</Badge>)}
                        </span>
                      ) : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                  ) : null}
                  {levelSupport ? (
                    <TableCell className="max-md:hidden">
                      {row.below.length || row.conversations.length ? (
                        <span className="console-feature-below">
                          {row.below.map(item => (
                            <Link key={item.adapter} to={adapterHref(item.adapter, 'features')}>
                              {item.state === 'disabled' ? i18n.t('{0} 已关闭', [item.adapter]) : i18n.t('{0} 有覆盖', [item.adapter])}
                            </Link>
                          ))}
                          {row.conversations.map(item => (
                            <Link key={`${item.adapter}/${item.endpoint}`} to={endpointHref(item.adapter, item.endpoint)}>
                              {i18n.t('{0} 的 {1} 个会话', [item.endpoint, item.count])}
                            </Link>
                          ))}
                        </span>
                      ) : <span className="text-xs text-muted-foreground">{i18n.t('全部沿用全局')}</span>}
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </ObjectSection>
  )
}
