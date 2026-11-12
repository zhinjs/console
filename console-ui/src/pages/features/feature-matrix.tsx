import { Link } from 'react-router-dom'
import { Lock, RefreshCw, ToggleLeft } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { EmptyState } from '../../components/empty-state'
import { ErrorAlert } from '../../components/error-alert'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { adapterHref, featureGlobalHref } from '../../console-routes.mjs'
import { cellState, setEnabledRequest, type FeatureCell } from './feature-model.mjs'
import { ConversationOverrideLinks } from './conversation-list'
import { FeatureAdminsSection } from './feature-admins'
import { useFeatureMatrix, useFeatureWriter } from './use-feature-data'
import { FeatureSwitch } from './feature-switch'
import { useConfirm } from '../../components/confirm-dialog'
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

export default function FeatureMatrixPage() {
  const i18n = useI18n()
  const { rows, adapters, revision, conversationOverrides, source, loading, error, refresh } = useFeatureMatrix()
  const adapterColumns = source === 'rpc' ? adapters : []
  const access = useConsoleAccess()
  const canToggle = source === 'rpc' && hasConsolePermission('feature.toggle', access)
  const { write, pending } = useFeatureWriter()
  const { confirm, ConfirmDialog } = useConfirm()
  const toggleGlobal = async (plugin: string, enabled: boolean) => {
    // The global switch is `disable_plugins`, which restarts the Host (ADR 0050 §7).
    const ok = await confirm({
      title: enabled ? i18n.t("启用 {0}？", [plugin]) : i18n.t("在全局禁用 {0}？", [plugin]),
      description: enabled ? i18n.t("全局开关会重启 Host。") : i18n.t("全局开关会重启 Host；所有适配器和账号上的该功能都会停用。"),
      variant: enabled ? 'default' : 'destructive',
    })
    if (ok) await write(setEnabledRequest({ plugin, level: 'global', enabled, revision }), refresh, `${plugin}\u0000global`)
  }
  const toggleAdapter = (plugin: string, adapter: string, cell: FeatureCell, enabled: boolean) => {
    // A cell disabled higher up is locked: neither enabled nor disabled here.
    if (cell.lockedBy) return
    void write(setEnabledRequest({ plugin, level: 'adapter', key: adapter, enabled, revision }), refresh, `${plugin}\u0000${adapter}`)
  }
  return (
    <PageShell>
      <PageHeader
        title={i18n.t("功能矩阵")}
        description={i18n.t("机器人在哪里启用了哪些功能。点击功能名进入全局配置。")}
        actions={<Button variant="outline" size="sm" onClick={refresh} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
      />
      {source !== 'rpc' && source !== 'loading' && !error ? (
        <Alert role="status">
          <AlertDescription>
            {source === 'forbidden'
              ? i18n.t("当前身份无权读取按适配器的功能开关，只显示全局状态。")
              : source === 'unsupported'
                ? i18n.t("当前 Host 还不支持按适配器和账号配置功能，只显示全局状态。升级 Host 后会出现每个适配器的列。")
                : i18n.t("暂时无法读取按适配器的功能开关，只显示全局状态。")}
            {' '}<Link className="underline" to="/features/adapters">{i18n.t("查看适配器")}</Link>
          </AlertDescription>
        </Alert>
      ) : null}
      {source === 'rpc' && !canToggle ? <Alert role="status"><AlertDescription>{i18n.t("当前身份只能查看功能开关，无法启停。")}</AlertDescription></Alert> : null}
      {error ? <ErrorAlert error={error} onRetry={refresh} /> : null}
      <Card className="overflow-hidden p-0">
        {loading && !rows.length ? (
          <div className="space-y-2 p-4">{[0, 1, 2, 3].map(index => <Skeleton key={index} className="h-9" />)}</div>
        ) : !rows.length ? (
          <EmptyState icon={ToggleLeft} title={i18n.t("还没有功能")} description={i18n.t("安装插件后，它们的功能会出现在这里。")} />
        ) : (
          <Table aria-label={i18n.t("功能矩阵")}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t("功能")}</TableHead>
                <TableHead>{i18n.t("全局")}</TableHead>
                {adapterColumns.map(adapter => (
                  <TableHead key={adapter} className="align-top">
                    <Link to={adapterHref(adapter)} className="hover:underline">{adapter}</Link>
                    <ConversationOverrideLinks counts={conversationOverrides} adapter={adapter} />
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map(row => (
                <TableRow key={row.plugin}>
                  <TableCell>
                    <Link to={featureGlobalHref(row.plugin)} className="font-medium hover:underline">{row.plugin}</Link>
                    {row.name !== row.plugin ? <span className="ml-2 text-xs text-muted-foreground">{row.name}</span> : null}
                    {row.description ? <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{row.description}</p> : null}
                  </TableCell>
                  <TableCell>
                    {source === 'rpc' ? (
                      <FeatureSwitch label={i18n.t("{0} · 全局", [row.plugin])} plugin={row.plugin} enabled={row.global.enabled}
                        canToggle={canToggle && !row.plugin.includes('/')} pending={pending === `${row.plugin}\u0000global`}
                        onToggle={enabled => void toggleGlobal(row.plugin, enabled)} />
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
                            <Link to={adapterHref(adapter)} className="text-xs text-muted-foreground hover:underline" aria-label={i18n.t("打开 {0}", [adapter])}>{i18n.t("配置")}</Link>
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
      {source === 'rpc' ? <FeatureAdminsSection level="global" adapters={adapters} /> : null}
      {ConfirmDialog}
    </PageShell>
  )
}
