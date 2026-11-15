import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock, RefreshCw } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { StatusState } from '../../components/StatusState'
import { ErrorAlert } from '../../components/error-alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { adapterHref, featureGlobalHref } from '../../console-routes.mjs'
import { scopeHref } from '../../scope/scope-tree.mjs'
import { cellState, rootFeatureName, setEnabledRequest, type FeatureCell, type FeatureMatrixRow, type FeatureRootRow } from './feature-model.mjs'
import { ConversationOverrideLinks } from './conversation-list'
import { useFeatureMatrix, useFeatureWriter } from './use-feature-data'
import { FeatureSwitch } from './feature-switch'
import { useGlobalPluginSwitch } from './use-global-plugin-switch'
import { FEATURE_TOGGLE_PERMISSION, GLOBAL_PLUGIN_SWITCH_PERMISSION, globalSwitchDeniedTitle, switchPermissionNote } from './plugin-switch-model.mjs'
import { ActionReceipt } from '../../components/ActionReceipt'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'

function CellBadge({ cell, to }: { cell: FeatureCell | undefined; to?: string }) {
  const i18n = useI18n()
  const state = cellState(cell)
  const badge = state === 'locked'
    ? <Badge variant="secondary" title={cell?.lockedBy === 'global' ? i18n.t("已在全局禁用") : cell?.lockedBy === 'endpoint' ? i18n.t("已在账号禁用") : i18n.t("已在适配器禁用")}><Lock aria-hidden="true" />{i18n.t("被上级禁用")}</Badge>
    : state === 'enabled' ? <Badge variant="success">{i18n.t("启用")}</Badge>
      : state === 'disabled' ? <Badge variant="outline">{i18n.t("禁用")}</Badge>
        : <span className="text-muted-foreground">—</span>
  const content = <span className="inline-flex items-center gap-1.5">{badge}{cell?.overridden ? <Badge variant="info" size="sm">{i18n.t("有覆盖")}</Badge> : null}</span>
  return to ? <Link to={to} className="inline-flex rounded-md focus-visible:outline-2">{content}</Link> : content
}

/**
 * The project's own root plugin (#1250 `kind: 'root'`): its commands, components and tools are
 * features too, but it has no instance alias and is always on — no switch, no global configuration link.
 */
function RootRow({ root, adapters }: { root: FeatureRootRow; adapters: readonly string[] }) {
  const i18n = useI18n()
  const { commands, components, tools } = root.capabilities
  const parts = [
    commands.length ? i18n.t('{0} 个命令', [commands.length]) : '',
    components.length ? i18n.t('{0} 个组件', [components.length]) : '',
    tools.length ? i18n.t('{0} 个工具', [tools.length]) : '',
  ].filter(Boolean)
  return (
    <TableRow>
      <TableCell>
        <span className="font-medium">{rootFeatureName(root, i18n.locale)}</span>
        <p className="mt-1 text-xs text-muted-foreground" title={[...commands, ...components, ...tools].join(', ')}>
          {parts.length ? i18n.t('本项目自带：{0}', [parts.join(i18n.t('、'))]) : i18n.t('本项目自带的功能')}
        </p>
      </TableCell>
      {/* D15.1: a normal state is muted text, said once across the 全局 and adapter columns. */}
      <TableCell colSpan={1 + adapters.length} className="text-sm text-muted-foreground" data-root-always-on="">
        {i18n.t('始终启用，在所有适配器上生效，不能在这里关闭。')}
      </TableCell>
    </TableRow>
  )
}

/**
 * `/features` (功能矩阵): where each feature is enabled. Also the 功能 tab of the 全局 object page
 * (`embedded`: no page header, the object page has one).
 */
export default function FeatureMatrixPage({ embedded = false, heading }: {
  embedded?: boolean
  /** Embedded only: the section around the matrix; its actions get the refresh button. */
  heading?: { title: string; description: string; actions?: ReactNode }
} = {}) {
  const i18n = useI18n()
  const { rows, adapters, revision, conversationOverrides, root, source, loading, error, refresh } = useFeatureMatrix()
  const adapterColumns = source === 'rpc' ? adapters : []
  const access = useConsoleAccess()
  // Adapter cells are feature switches (`feature.toggle`); the 全局 column is the global plugin
  // switch, a management gateway transaction (stop → write → start, rollback) needing `plugin.manage`.
  const canToggle = source === 'rpc' && hasConsolePermission(FEATURE_TOGGLE_PERMISSION, access)
  const canToggleGlobal = source === 'rpc' && hasConsolePermission(GLOBAL_PLUGIN_SWITCH_PERMISSION, access)
  const permissionNote = source === 'rpc' ? switchPermissionNote({ global: canToggleGlobal, lower: canToggle, hasLower: adapterColumns.length > 0 }, i18n.t) : null
  const { write, pending } = useFeatureWriter()
  const globalSwitch = useGlobalPluginSwitch(refresh)
  const toggleGlobal = (row: FeatureMatrixRow, enabled: boolean) => {
    globalSwitch.prepare({ plugin: row.plugin, name: row.name, current: row.global.enabled === true, enabled, revision })
  }
  const toggleAdapter = (plugin: string, adapter: string, cell: FeatureCell, enabled: boolean) => {
    // A cell disabled higher up is locked: neither enabled nor disabled here.
    if (cell.lockedBy) return
    void write(setEnabledRequest({ plugin, level: 'adapter', key: adapter, enabled, revision }), refresh, `${plugin}\u0000${adapter}`)
  }
  const refreshButton = <Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
  const frame = (children: ReactNode) => embedded
    ? <ObjectSection title={heading?.title ?? i18n.t("功能矩阵")} description={heading?.description} actions={<>{heading?.actions}{refreshButton}</>}>{children}</ObjectSection>
    : <PageShell>{children}</PageShell>
  return frame(
    <>
      {embedded ? null : (
        <PageHeader
          title={i18n.t("功能矩阵")}
          description={i18n.t("机器人在哪里启用了哪些功能。点击功能名进入全局配置。")}
          actions={refreshButton}
        />
      )}
      {source !== 'rpc' && source !== 'loading' && !error ? (
        <Alert role="status">
          <AlertDescription>
            {source === 'forbidden'
              ? i18n.t("当前身份无权读取按适配器的功能开关，只显示全局状态。")
              : source === 'unsupported'
                ? i18n.t("当前 Host 还不支持按适配器和账号配置功能，只显示全局状态。升级 Host 后会出现每个适配器的列。")
                : i18n.t("暂时无法读取按适配器的功能开关，只显示全局状态。")}
            {' '}<Link className="underline" to={scopeHref()}>{i18n.t("查看适配器")}</Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {permissionNote ? <Alert role="status"><AlertDescription>{permissionNote}</AlertDescription></Alert> : null}
      {error ? <ErrorAlert error={error} onRetry={refresh} /> : null}
      <ActionReceipt controller={globalSwitch.receipt} />
      <Card className="overflow-hidden p-0">
        {loading && !rows.length && !root ? (
          <StatusState kind="loading" className="m-4" placeholder={<div className="space-y-2 p-4">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-9" />)}</div>} />
        ) : !rows.length && !root ? (
          <StatusState kind="empty" className="m-3" title={i18n.t("还没有功能")} description={i18n.t("安装插件后，它们的功能会出现在这里。")}
            actions={<Button asChild size="sm" variant="outline"><Link to="/marketplace">{i18n.t("去插件市场")}</Link></Button>} />
        ) : (
          <Table aria-label={i18n.t("功能矩阵")}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t("功能")}</TableHead>
                <TableHead>{i18n.t("全局")}</TableHead>
                {adapterColumns.map(adapter => (
                  <TableHead key={adapter} className="align-top">
                    <Link to={adapterHref(adapter, 'features')} className="hover:underline">{adapter}</Link>
                    <ConversationOverrideLinks counts={conversationOverrides} adapter={adapter} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {root ? <RootRow root={root} adapters={adapterColumns} /> : null}
              {rows.map(row => (
                <TableRow key={row.plugin}>
                  <TableCell>
                    <Link to={featureGlobalHref(row.plugin)} className="font-medium hover:underline">{row.name}</Link>
                    {row.name !== row.plugin ? <code className="ml-2 text-xs text-muted-foreground">{row.plugin}</code> : null}
                    {row.description ? <p className="mt-1 line-clamp-1 text-xs text-muted-foreground">{row.description}</p> : null}
                  </TableCell>
                  <TableCell>
                    {source === 'rpc' ? (
                      <FeatureSwitch label={i18n.t("{0} · 全局", [row.plugin])} plugin={row.plugin} enabled={row.global.enabled}
                        canToggle={canToggleGlobal && !row.plugin.includes('/') && !globalSwitch.busy} deniedTitle={canToggleGlobal ? undefined : globalSwitchDeniedTitle(i18n.t)}
                        onToggle={enabled => toggleGlobal(row, enabled)} />
                    ) : <CellBadge cell={row.global} to={featureGlobalHref(row.plugin)} />}
                  </TableCell>
                  {adapterColumns.map(adapter => {
                    const cell = row.adapters[adapter]
                    return (
                      <TableCell key={adapter}>
                        {cell ? (
                          <span className="inline-flex items-center gap-2">
                            <FeatureSwitch label={i18n.t("{0} · {1}", [row.plugin, adapter])} plugin={row.plugin} adapter={adapter}
                              enabled={cell.enabled} lockedBy={cell.lockedBy} overridden={cell.overridden}
                              canToggle={canToggle} pending={pending === `${row.plugin}\u0000${adapter}`}
                              onToggle={enabled => toggleAdapter(row.plugin, adapter, cell, enabled)} />
                            <Link to={adapterHref(adapter, 'features')} className="text-xs text-muted-foreground hover:underline" aria-label={i18n.t("打开 {0}", [adapter])}>{i18n.t("配置")}</Link>
                          </span>
                        ) : <CellBadge cell={cell} />}
                      </TableCell>
                    )
                  })}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </>,
  )
}
