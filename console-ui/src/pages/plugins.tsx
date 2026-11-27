import { startVisiblePolling } from '../hooks/visible-polling.mjs'
import { useI18n } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { ArrowDown, ArrowUp, ArrowUpDown, Blocks, Clock, Plug, Puzzle, RefreshCw, Sparkles, Search, Store, ToggleLeft } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { CONSOLE_PATHS, featureGlobalHref } from '../console-routes.mjs'
import { Badge, Banner, Button, Card, cn, Input, PageHeader, PageShell, Segmented, SelectField, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@zhin.js/console-ui'
import { StatusState } from '../components/StatusState'
import { useConsoleRead } from '../hooks/use-console-read'
import {
  applyInventorySort, INVENTORY_SORT_KEYS, groupInventory, inventoryCounts, matchesHealthFilter, needsStateLabel, pluginInventory, pluginsFirstReadPending, pluginIconType, pluginSource, pluginType, sortInventory, validatePluginList,
  type HealthFilter, type InventoryGroupBy, type InventoryPlugin, type InventoryRow, type InventorySortKey, type PluginHealth, type PluginSource, type PluginType,
} from './plugin-list-model.mjs'
import { managementLabel } from './plugin-management-model.mjs'
import { GATEWAY_RPC, readPackageList } from './ops/gateway-model.mjs'
import { gatewayRequest } from './ops/use-gateway'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import './plugins.css'

const HEALTH_LABELS: Record<PluginHealth, string> = {
  healthy: '运行正常',
  pending: '需要处理',
  inactive: '未加载',
  undeclared: '已安装，待配置',
  unreported: '实例未报告',
}
const HEALTH_TONES: Record<PluginHealth, 'enabled' | 'warning' | 'disabled'> = {
  // 已安装，待配置 is not a fault: a neutral badge, not a column of warning color (console#125).
  healthy: 'enabled', pending: 'warning', inactive: 'disabled', undeclared: 'disabled', unreported: 'disabled',
}
const FILTERS: { key: HealthFilter; label: string }[] = [
  { key: 'all', label: '已安装' },
  { key: 'healthy', label: '运行正常' },
  { key: 'pending', label: '需要处理' },
  { key: 'inactive', label: '未加载' },
]

const TYPE_LABELS: Record<PluginType, string> = { adapter: '适配器', ai: 'AI', feature: '功能插件' }
// One icon per plugin type (console#125); a row whose type cannot be told gets none.
const TYPE_ICONS: Record<PluginType, typeof Plug> = { adapter: Plug, ai: Sparkles, feature: Puzzle }
const SOURCE_LABELS: Record<PluginSource, string> = { official: '官方', npm: 'npm', local: '本地' }
const GROUPS: { key: InventoryGroupBy; label: string }[] = [
  { key: 'none', label: '不分组' },
  { key: 'type', label: '按类型' },
  { key: 'source', label: '按来源' },
]
const SORT_KEYS = INVENTORY_SORT_KEYS
const SORT_LABELS: Record<InventorySortKey, string> = { name: '名称', type: '类型', source: '来源', version: '版本', status: '状态' }

type PackagesState = { status: 'loading' | 'skipped' } | { status: 'ready'; value: ReturnType<typeof readPackageList> } | { status: 'failed'; error: unknown }

export default function PluginsPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <PageShell className="console-plugins-page">
    <PageHeader title={i18n.t("插件")} />
    <StatusState kind="disconnected" description={i18n.t("请连接 Host 后读取功能。")} />
  </PageShell>
  return <PluginsPageSession key={scope} connectionScope={scope} />
}

function PluginsPageSession({ connectionScope }: { connectionScope: string }) {
  const i18n = useI18n()
  const { data: plugins, loaded, loading, error, refresh } = useConsoleRead<InventoryPlugin[]>(async () => {
    const current = () => {
      if (!isInboxCacheScopeActive(connectionScope)) throw new Error(i18n.t("连接身份已变化，请重新读取。"))
    }
    current()
    const res = await apiFetch('/api/plugins')
    current()
    if (!res.ok) {
      const body = await res.json().catch(() => null) as { code?: string; error?: string } | null
      throw Object.assign(new Error(res.status === 403 ? i18n.t("当前身份无权读取插件列表") : body?.error || i18n.t("插件读取失败（HTTP {0}）", [res.status])),
        { status: res.status, ...(body?.code ? { details: { serverCode: body.code } } : {}) })
    }
    const body = await res.json()
    current()
    return validatePluginList(body, i18n.locale) as InventoryPlugin[]
  }, [])
  // The gateway knows installed packages even while the instance is down (ADR 0054).
  const [packages, setPackages] = useState<PackagesState>(hasConsolePermission('feature.view') ? { status: 'loading' } : { status: 'skipped' })
  const loadPackages = useCallback(async () => {
    if (!hasConsolePermission('feature.view')) return
    try {
      const value = readPackageList(await gatewayRequest(GATEWAY_RPC.PACKAGES_LIST, {}, i18n.t))
      if (isInboxCacheScopeActive(connectionScope)) setPackages({ status: 'ready', value })
    } catch (caught) {
      if (isInboxCacheScopeActive(connectionScope)) setPackages(previous => previous.status === 'ready' ? previous : { status: 'failed', error: caught })
    }
  }, [connectionScope, i18n])
  const refreshCurrent = useCallback(async () => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    await Promise.all([refresh().catch(() => {}), loadPackages()])
  }, [connectionScope, refresh, loadPackages])
  const [searchParams, setSearchParams] = useSearchParams()
  const search = searchParams.get('q') ?? ''
  const rawStatus = searchParams.get('status')
  const statusFilter: HealthFilter = rawStatus === 'healthy' || rawStatus === 'pending' || rawStatus === 'inactive' ? rawStatus : 'all'
  const rawSort = searchParams.get('sort')
  const sortKey: InventorySortKey = SORT_KEYS.includes(rawSort as InventorySortKey) ? rawSort as InventorySortKey : 'name'
  const sortDirection = searchParams.get('dir') === 'desc' ? 'desc' : 'asc'
  const rawGroup = searchParams.get('group')
  const groupBy: InventoryGroupBy = rawGroup === 'type' || rawGroup === 'source' ? rawGroup : 'none'
  const updateParams = (change: (next: URLSearchParams) => void) => {
    const next = new URLSearchParams(searchParams)
    change(next)
    setSearchParams(next, { replace: true })
  }
  const setSortTo = (key: InventorySortKey, direction: 'asc' | 'desc') => updateParams(next => { applyInventorySort(next, key, direction) })
  // A header click sorts by that column, or flips the direction of the current one.
  const setSort = (key: InventorySortKey) => setSortTo(key, key === sortKey && sortDirection === 'asc' ? 'desc' : 'asc')
  const setGroupBy = (value: InventoryGroupBy) => updateParams(next => { if (value === 'none') next.delete('group'); else next.set('group', value) })
  const setSearch = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('q', value)
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }
  const setStatusFilter = (value: HealthFilter) => {
    const next = new URLSearchParams(searchParams)
    if (value && value !== 'all') next.set('status', value)
    else next.delete('status')
    setSearchParams(next, { replace: true })
  }
  const clearFilters = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('q')
    next.delete('status')
    setSearchParams(next, { replace: true })
  }
  const detailUrl = (name: string) => `/plugins/${encodeURIComponent(name)}${search ? `?q=${encodeURIComponent(search)}` : ''}`

  useEffect(() => { void loadPackages() }, [loadPackages])
  useEffect(() => startVisiblePolling(() => void refreshCurrent(), 10000), [refreshCurrent])

  if (!isInboxCacheScopeActive(connectionScope)) return null

  const instanceDown = Boolean(error) && !loaded
  const rows = pluginInventory(loaded ? plugins : null, packages.status === 'ready' ? packages.value : null)
  const term = search.trim().toLowerCase()
  const filtered = sortInventory(rows.filter(row => (!term || row.name.toLowerCase().includes(term) || row.packageName.toLowerCase().includes(term)) && matchesHealthFilter(row, statusFilter)), sortKey, sortDirection)
  const groups = groupInventory(filtered, groupBy)
  const counts = inventoryCounts(rows)
  // Not until the instance list is in: the gateway's packages alone read as 「none running」 (#64 plugins-loading-looks-final).
  const waiting = pluginsFirstReadPending({ loaded, error })

  return (
    <PageShell className="console-plugins-page">
      <PageHeader
        title={i18n.t("插件")}
        description={i18n.t("已安装的插件：来源、版本与健康状态。插件在哪些范围开启，在功能矩阵和对象树里设置。")}
        actions={<>
          <Button variant="text" size="sm" asChild><Link to={CONSOLE_PATHS.introspection}><Blocks />{i18n.t("运行时能力")}</Link></Button>
          <Button variant="secondary" size="sm" disabled={loading} aria-busy={loading || undefined} onClick={() => void refreshCurrent()}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}
          </Button>
          {/* The page's one primary action (the Plugins design): install from the marketplace. */}
          <Button variant="primary" size="sm" asChild><Link to={CONSOLE_PATHS.marketplace}><Store />{i18n.t("安装插件")}</Link></Button>
        </>}
      />
      {error && loaded ? <StatusState compact error={error} description={i18n.t("刷新失败，以下是上次读取的列表。")} onRetry={() => void refreshCurrent()} /> : null}
      {instanceDown ? (
        <StatusState compact error={error} description={rows.length
          ? i18n.t("实例没有返回插件列表；下面是网关记录的已安装包，健康状态要等实例恢复后才能读取。")
          : undefined} onRetry={() => void refreshCurrent()} />
      ) : null}

      {waiting ? (
        <StatusState kind="loading" placeholder={<div className="space-y-3">
          {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-16 rounded-[var(--console-radius-md)]" />)}
        </div>} />
      ) : <>
        {counts.pending > 0 && statusFilter !== 'pending' ? (
          <Banner tone="warn" icon={<Clock aria-hidden="true" />}
            action={<Button variant="white" size="sm" onClick={() => setStatusFilter('pending')}>{i18n.t("去处理")}</Button>}>
            {i18n.t("{0} 个插件需处理", [counts.pending])}
          </Banner>
        ) : null}

        <div className="console-plugin-catalog-toolbar">
          <div className="console-plugin-catalog-toolbar-meta">
            <p className="sr-only">{i18n.t("共 {0} 个", [rows.length])}</p>
            {/* The Plugins design's filter: one segmented control with the counts (formerly the four stat cards). */}
            <Segmented role="radiogroup" aria-label={i18n.t("健康状态")} value={statusFilter} onValueChange={setStatusFilter} className="console-plugin-catalog-filters"
              options={FILTERS.map(option => ({ value: option.key, label: <>{i18n.t(option.label)} <span className="console-plugin-filter-count">{counts[option.key]}</span></> }))} />
            <Segmented role="radiogroup" aria-label={i18n.t("分组方式")} value={groupBy} onValueChange={setGroupBy} className="console-plugin-catalog-groups"
              options={GROUPS.map(option => ({ value: option.key, label: i18n.t(option.label) }))} />
          </div>
          <div className="console-plugin-catalog-search">
            <Search aria-hidden="true" />
            <Input type="search" aria-label={i18n.t("搜索插件…")} placeholder={i18n.t("搜索插件…")} value={search}
              onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        {filtered.length ? (
          <Card className="overflow-hidden p-0">
            {/* Card mode (< 40rem) hides the table header, and its sort buttons with it: the same sort,
                on the same ?sort=&dir=, as a control above the cards (#64 plugins-sort-hidden-mobile). It
                sits in the same `console-cq` box as the table, so both switch at the same width. */}
            <div className="console-cq">
            <div className="hidden @max-[40rem]/console:flex items-center gap-2 border-b px-4 py-3" data-card-sort="">
              <span className="shrink-0 text-sm text-muted-foreground">{i18n.t("排序")}</span>
              <div className="min-w-0 flex-1">
                <SelectField aria-label={i18n.t("排序字段")} value={sortKey}
                  onValueChange={value => { if (SORT_KEYS.includes(value as InventorySortKey)) setSortTo(value as InventorySortKey, sortDirection) }}
                  options={SORT_KEYS.map(key => ({ value: key, label: i18n.t(SORT_LABELS[key]) }))} />
              </div>
              <Button type="button" variant="outline" className="shrink-0 min-h-11"
                onClick={() => setSortTo(sortKey, sortDirection === 'asc' ? 'desc' : 'asc')}>
                {sortDirection === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
                {sortDirection === 'asc' ? i18n.t("升序") : i18n.t("降序")}
              </Button>
            </div>
            <Table className="console-plugin-table" aria-label={i18n.t("已安装的插件")}>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <SortableHead label={i18n.t("名称")} column="name" sortKey={sortKey} direction={sortDirection} onSort={setSort} />
                  <SortableHead label={i18n.t("类型")} column="type" sortKey={sortKey} direction={sortDirection} onSort={setSort} className="max-md:hidden" />
                  <SortableHead label={i18n.t("来源")} column="source" sortKey={sortKey} direction={sortDirection} onSort={setSort} className="max-lg:hidden" />
                  <SortableHead label={i18n.t("版本")} column="version" sortKey={sortKey} direction={sortDirection} onSort={setSort} className="max-md:hidden" />
                  <SortableHead label={i18n.t("状态")} column="status" sortKey={sortKey} direction={sortDirection} onSort={setSort} />
                  <TableHead className="text-right">{i18n.t("操作")}</TableHead>
                </TableRow>
              </TableHeader>
              {groups.map(group => (
                <TableBody key={group.key}>
                  {groupBy !== 'none' ? (
                    <TableRow className="console-plugin-group-row hover:bg-transparent">
                      <TableHead scope="colgroup" colSpan={6}>
                        {i18n.t(groupBy === 'type' ? TYPE_LABELS[group.key as PluginType] : SOURCE_LABELS[group.key as PluginSource])}
                        <span className="console-plugin-group-count">{group.rows.length}</span>
                      </TableHead>
                    </TableRow>
                  ) : null}
                  {group.rows.map(row => <InventoryItem key={row.key} row={row} href={detailUrl(row.kind === 'plugin' ? row.instanceKey : row.packageName)} />)}
                </TableBody>
              ))}
            </Table>
            </div>
          </Card>
        ) : rows.length ? (
          <StatusState kind="empty" title={i18n.t("没有匹配的插件")} description={i18n.t("试试其他名称，或清除筛选。")}
            actions={<Button variant="outline" size="sm" onClick={clearFilters}>{i18n.t("清除筛选")}</Button>} />
        ) : !instanceDown ? (
          <StatusState kind="empty" title={i18n.t("还没有安装插件")} description={i18n.t("从插件市场安装，网关会停止实例、安装、校验并重新启动。")}
            actions={<Button size="sm" asChild><Link to={CONSOLE_PATHS.marketplace}><Store />{i18n.t("去插件市场")}</Link></Button>} />
        ) : null}
      </>}
    </PageShell>
  )
}

function SortableHead({ label, column, sortKey, direction, onSort, className }: {
  label: string; column: InventorySortKey; sortKey: InventorySortKey; direction: 'asc' | 'desc'; onSort: (key: InventorySortKey) => void; className?: string
}) {
  const active = sortKey === column
  const Icon = !active ? ArrowUpDown : direction === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead className={className} aria-sort={active ? (direction === 'asc' ? 'ascending' : 'descending') : 'none'}>
      {/* In card mode the header is clipped to 1px: invisible there, so the button is not focusable either. */}
      <button type="button" className={cn(active ? 'console-plugin-sort is-active' : 'console-plugin-sort', '@max-[40rem]/console:invisible')} onClick={() => onSort(column)}>
        {label}<Icon aria-hidden="true" />
      </button>
    </TableHead>
  )
}

function InventoryItem({ row, href }: { row: InventoryRow; href: string }) {
  const i18n = useI18n()
  const management = row.plugin?.management
  const tone = HEALTH_TONES[row.health]
  const type = i18n.t(TYPE_LABELS[pluginType(row)])
  const iconType = pluginIconType(row), TypeIcon = iconType ? TYPE_ICONS[iconType] : null
  const source = i18n.t(SOURCE_LABELS[pluginSource(row)])
  return (
    <TableRow className="console-plugin-table-row">
      <TableCell className="console-plugin-table-name">
        <Link to={href} className="console-plugin-table-link">
          <span className="console-plugin-catalog-icon" aria-hidden="true">
            {TypeIcon ? <TypeIcon /> : null}
            <span className={`console-plugin-status-dot is-${tone}`} />
          </span>
          <span className="min-w-0">
            <strong>{row.name}</strong>
            {row.packageName && row.packageName !== row.name ? <code className="console-plugin-table-package">{row.packageName}</code> : null}
            {row.description ? <span className="console-plugin-table-description" title={row.description}>{row.description}</span> : null}
            {/* Narrow screens drop the 类型 / 版本 columns; the same facts move under the name. */}
            <span className="console-plugin-table-compact md:hidden">{type}{row.version ? <> · <code>v{row.version}</code></> : null}</span>
          </span>
        </Link>
      </TableCell>
      <TableCell className="max-md:hidden whitespace-nowrap">{type}</TableCell>
      <TableCell className="max-lg:hidden whitespace-nowrap">{source}</TableCell>
      <TableCell className="max-md:hidden whitespace-nowrap"><code className="console-plugin-table-version">{row.version ? `v${row.version}` : '—'}</code></TableCell>
      <TableCell className="console-plugin-table-state">
        {needsStateLabel(row) ? (
          <Badge variant={tone === 'warning' ? 'warning' : 'secondary'}>
            {management ? managementLabel(management, i18n.locale) : i18n.t(HEALTH_LABELS[row.health])}
          </Badge>
        ) : <span className="console-plugin-table-ok">{i18n.t("正常")}</span>}
        {row.plugin?.managementError ? <small className="block text-destructive">{i18n.t("状态读取失败：{0}", [row.plugin.managementError])}</small> : null}
      </TableCell>
      <TableCell className="text-right">
        {row.kind === 'plugin' ? (
          <Button variant="ghost" size="sm" asChild>
            <Link to={featureGlobalHref(row.instanceKey)} aria-label={i18n.t("{0} 的功能配置", [row.name])}><ToggleLeft />{i18n.t("功能")}</Link>
          </Button>
        ) : null}
      </TableCell>
    </TableRow>
  )
}
