import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Lock, RefreshCw } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription, Badge, Button, Card, ErrorAlert, PageHeader, PageShell, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@zhin.js/console-ui'
import { StatusState } from '../../components/StatusState'
import { adapterHref, featureGlobalHref } from '../../console-routes.mjs'
import { cellState, rootFeatureName, type FeatureCell, type FeatureMatrixRow, type FeatureRootRow } from './feature-model.mjs'
import { ConversationOverrideLinks } from './conversation-list'
import { useFeatureMatrix } from './use-feature-data'
import { FeatureSwitch } from './feature-switch'
import { useGlobalPluginSwitch } from './use-global-plugin-switch'
import { FEATURE_TOGGLE_PERMISSION, GLOBAL_PLUGIN_SWITCH_PERMISSION, globalSwitchDeniedTitle, switchPermissionNote } from './plugin-switch-model.mjs'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { receiptBlocksActions } from '../../components/action-receipt-model.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { SCOPE_LEVEL_LABELS, scopeHref } from '../../scope/scope-tree.mjs'
import { adapterSwitchHandlers, adapterSwitchPayload, featureReceiptKey } from './adapter-switch-model.mjs'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'

function CellBadge({ cell, to }: { cell: FeatureCell | undefined; to?: string }) {
  const i18n = useI18n()
  const state = cellState(cell)
  const badge = state === 'locked'
    ? <Badge variant="secondary" title={cell?.lockedBy === 'global' ? i18n.t("已在全局禁用") : cell?.lockedBy === 'endpoint' ? i18n.t("已在账号禁用") : i18n.t("已在适配器禁用")}><Lock aria-hidden="true" />{i18n.t("被上级禁用")}</Badge>
    : state === 'enabled' ? <Badge variant="outline">{i18n.t("启用")}</Badge>
      : state === 'disabled' ? <Badge variant="outline">{i18n.t("禁用")}</Badge>
        : <span className="text-muted-foreground">—</span>
  const content = <span className="inline-flex items-center gap-1.5">{badge}{cell?.overridden ? <Badge variant="info" size="sm">{i18n.t("有覆盖")}</Badge> : null}</span>
  return to ? <Link to={to} className="inline-flex rounded-md focus-visible:outline-2">{content}</Link> : content
}

/**
 * The write receipt of one adapter cell (#64 `feature-matrix-adapter-receipt`). Its key is the one the
 * adapter's 功能 tab uses, so both views show the same receipt: a write whose outcome is unknown keeps
 * the switch disabled and offers only a read-only check, wherever it is opened again.
 */
function useAdapterSwitchReceipt(plugin: string, adapter: string, reload: () => void) {
  const i18n = useI18n()
  const handlers = adapterSwitchHandlers({ plugin, adapter, request: body => requestConsole<unknown>(body), reload, t: i18n.t })
  return useActionReceipt({ persistKey: featureReceiptKey('adapter', adapter, plugin), submit: handlers.submit, verify: handlers.verify })
}

/** The receipt panel of one adapter cell, shown above the table while that cell has a write to show. */
function AdapterSwitchReceipt({ plugin, adapter, reload }: { plugin: string; adapter: string; reload: () => void }) {
  return <ActionReceipt controller={useAdapterSwitchReceipt(plugin, adapter, reload)} lockHref={featureGlobalHref(plugin)} onRestarted={reload} />
}

function AdapterSwitchCell({ row, adapter, cell, canToggle, revision, reload }: {
  row: FeatureMatrixRow
  adapter: string
  cell: FeatureCell
  canToggle: boolean
  revision?: string
  reload: () => void
}) {
  const i18n = useI18n()
  const receipt = useAdapterSwitchReceipt(row.plugin, adapter, reload)
  const busy = receiptBlocksActions(receipt.state)
  const toggle = (enabled: boolean) => {
    // A cell disabled higher up is locked: neither enabled nor disabled here.
    if (cell.lockedBy || busy) return
    const where = `${i18n.t(SCOPE_LEVEL_LABELS.adapter)} ${adapter}${i18n.locale.startsWith('zh') ? ' ' : ''}`
    const state = (value: boolean) => value ? i18n.t('启用') : i18n.t('关闭')
    receipt.prepare({
      payload: adapterSwitchPayload({ plugin: row.plugin, adapter, enabled, revision }),
      title: enabled ? i18n.t('在{0}启用 {1}', [where, row.name]) : i18n.t('在{0}关闭 {1}', [where, row.name]),
      changes: [i18n.t('启用状态：{0} → {1}', [state(cell.enabled === true), state(enabled)])],
      summary: enabled ? undefined : i18n.t('关闭后，这一层以下的范围都不能再打开它。'),
      // Turning a feature off for a whole adapter affects every account under it.
      danger: !enabled,
      confirmLabel: state(enabled),
    })
  }
  return (
    <span className="inline-flex items-center gap-2">
      <FeatureSwitch label={i18n.t("{0} · {1}", [row.plugin, adapter])} plugin={row.plugin} adapter={adapter}
        enabled={cell.enabled} lockedBy={cell.lockedBy} overridden={cell.overridden}
        canToggle={canToggle && !busy} pending={receipt.state.phase === 'submitting'}
        onToggle={toggle} />
      <Link to={adapterHref(adapter, 'features')} className="text-xs text-muted-foreground hover:underline" aria-label={i18n.t("打开 {0}", [adapter])}>{i18n.t("配置")}</Link>
    </span>
  )
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
  const globalSwitch = useGlobalPluginSwitch(refresh)
  const toggleGlobal = (row: FeatureMatrixRow, enabled: boolean) => {
    globalSwitch.prepare({ plugin: row.plugin, name: row.name, current: row.global.enabled === true, enabled, revision })
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
      {canToggle ? rows.flatMap(row => adapterColumns.filter(adapter => row.adapters[adapter]).map(adapter => (
        <AdapterSwitchReceipt key={`${row.plugin}\u0000${adapter}`} plugin={row.plugin} adapter={adapter} reload={refresh} />
      ))) : null}
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
                        {cell ? <AdapterSwitchCell row={row} adapter={adapter} cell={cell} canToggle={canToggle} revision={revision} reload={refresh} />
                          : <CellBadge cell={cell} />}
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
