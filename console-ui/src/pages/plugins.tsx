import { startVisiblePolling } from '../hooks/visible-polling.mjs'
import { useI18n } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Blocks, CheckCircle2, ChevronRight, Clock, Package, PauseCircle, RefreshCw, Search, Store, ToggleLeft } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { CONSOLE_PATHS, featureGlobalHref } from '../console-routes.mjs'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { StatusState } from '../components/StatusState'
import { StatCard, StatGrid } from '../components/StatCard'
import { useConsoleRead } from '../hooks/use-console-read'
import {
  inventoryCounts, matchesHealthFilter, pluginInventory, validatePluginList, type HealthFilter, type InventoryPlugin, type InventoryRow, type PluginHealth,
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
  healthy: 'enabled', pending: 'warning', inactive: 'disabled', undeclared: 'warning', unreported: 'disabled',
}
const FILTERS: { key: HealthFilter; label: string }[] = [
  { key: 'all', label: '已安装' },
  { key: 'healthy', label: '运行正常' },
  { key: 'pending', label: '需要处理' },
  { key: 'inactive', label: '未加载' },
]

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
  const filtered = rows.filter(row => (!term || row.name.toLowerCase().includes(term) || row.packageName.toLowerCase().includes(term)) && matchesHealthFilter(row, statusFilter))
  const counts = inventoryCounts(rows)
  const waiting = (loading && !loaded) && packages.status === 'loading'

  return (
    <PageShell className="console-plugins-page">
      <PageHeader
        title={i18n.t("插件")}
        description={i18n.t("已安装的插件：来源、版本与健康状态。插件在哪些范围开启，在功能矩阵和对象树里设置。")}
        actions={<>
          <Button variant="outline" size="sm" asChild><Link to={CONSOLE_PATHS.marketplace}><Store />{i18n.t("插件市场")}</Link></Button>
          <Button variant="outline" size="sm" asChild><Link to={CONSOLE_PATHS.introspection}><Blocks />{i18n.t("运行时能力")}</Link></Button>
          <Button variant="outline" size="sm" disabled={loading} aria-busy={loading || undefined} onClick={() => void refreshCurrent()}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}
          </Button>
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
        <StatGrid label={i18n.t("插件概况")}>
          <StatCard icon={Package} label={i18n.t("已安装")} value={counts.all} sub={i18n.t("实例插件与待配置的包")} onOpen={() => setStatusFilter('all')} pressed={statusFilter === 'all'} />
          <StatCard icon={CheckCircle2} label={i18n.t("运行正常")} value={counts.healthy} sub={i18n.t("当前代已应用")} onOpen={() => setStatusFilter('healthy')} pressed={statusFilter === 'healthy'} />
          <StatCard icon={Clock} label={i18n.t("需要处理")} value={counts.pending} sub={counts.pending > 0 ? i18n.t("缺少配置、待应用或运行异常") : i18n.t("无需处理")}
            tone={counts.pending > 0 ? 'warning' : undefined} onOpen={() => setStatusFilter('pending')} pressed={statusFilter === 'pending'} />
          <StatCard icon={PauseCircle} label={i18n.t("未加载")} value={counts.inactive} sub={i18n.t("已停用或未在当前代加载")} onOpen={() => setStatusFilter('inactive')} pressed={statusFilter === 'inactive'} />
        </StatGrid>

        <div className="console-plugin-catalog-toolbar">
          <div className="console-plugin-catalog-toolbar-meta">
            <p className="console-plugin-catalog-count">{i18n.t("共 {0} 个", [rows.length])}</p>
            <div className="console-plugin-catalog-filters" role="group" aria-label={i18n.t("健康状态")}>
              {FILTERS.map(option => (
                <button key={option.key} type="button" aria-pressed={statusFilter === option.key}
                  className={statusFilter === option.key ? 'console-plugin-filter-pill is-active' : 'console-plugin-filter-pill'}
                  onClick={() => setStatusFilter(option.key)}>
                  {i18n.t(option.label)}
                </button>
              ))}
            </div>
          </div>
          <div className="console-plugin-catalog-search">
            <Search aria-hidden="true" />
            <Input type="search" aria-label={i18n.t("搜索插件…")} placeholder={i18n.t("搜索插件…")} value={search}
              onChange={e => setSearch(e.target.value)} className="pl-9" />
          </div>
        </div>

        {filtered.length ? (
          <ul className="console-plugin-catalog-list">
            {filtered.map(row => <InventoryItem key={row.key} row={row} href={detailUrl(row.kind === 'plugin' ? row.instanceKey : row.packageName)} />)}
          </ul>
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

function InventoryItem({ row, href }: { row: InventoryRow; href: string }) {
  const i18n = useI18n()
  const management = row.plugin?.management
  const tone = HEALTH_TONES[row.health]
  return (
    <li className="console-plugin-catalog-item">
      <Link className="console-plugin-catalog-row" to={href}>
        <span className="console-plugin-catalog-icon" aria-hidden="true">
          <Package />
          <span className={`console-plugin-status-dot is-${tone}`} />
        </span>
        <span className="console-plugin-catalog-identity">
          <strong>{row.name}</strong>
          {row.packageName || row.version ? (
            <code className="console-plugin-catalog-package" title={`${row.packageName}${row.version ? `@${row.version}` : ''}`}>
              {row.packageName && row.packageName !== row.name ? row.packageName : null}{row.version ? <> v{row.version}</> : null}
            </code>
          ) : null}
          {row.description ? <span>{row.description}</span> : null}
        </span>
        <span className="console-plugin-catalog-state">
          <Badge variant={tone === 'enabled' ? 'success' : tone === 'warning' ? 'warning' : 'secondary'}>
            {management ? managementLabel(management, i18n.locale) : i18n.t(HEALTH_LABELS[row.health])}
          </Badge>
          {row.plugin?.managementError ? <small className="text-destructive">{i18n.t("状态读取失败：{0}", [row.plugin.managementError])}</small> : null}
        </span>
        <ChevronRight className="console-plugin-catalog-arrow" aria-hidden="true" />
      </Link>
      {row.kind === 'plugin' ? (
        <div className="console-plugin-catalog-actions">
          <Button variant="ghost" size="sm" asChild>
            <Link to={featureGlobalHref(row.instanceKey)} aria-label={i18n.t("{0} 的功能配置", [row.name])}><ToggleLeft />{i18n.t("功能")}</Link>
          </Button>
        </div>
      ) : null}
    </li>
  )
}
