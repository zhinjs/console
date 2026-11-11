import { useI18n } from '../i18n'
import { useCallback, useEffect } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, CheckCircle2, ChevronRight, Clock, Package, PauseCircle, Search } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PageHeader } from '../components/PageHeader'
import { useConsoleRead } from '../hooks/use-console-read'
import { validatePluginList } from './plugin-list-model.mjs'
import { PageShell } from '../components/PageShell'
import { StatCard, StatGrid } from '../components/StatCard'
import { managementLabel, waitForEnabledManagementState, type PluginManagementState } from './plugin-management-model.mjs'
import type { ConsoleRpcRequest } from '../utils/console-rpc'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import './plugins.css'

type PluginStatusFilter = 'all' | 'enabled' | 'pending' | 'disabled'

interface Plugin {
  name: string
  status: 'active' | 'inactive'
  description: string
  instanceKey?: string
  config?: { configured?: boolean; hasSchema?: boolean }
  management?: PluginManagementState
  managementError?: string
}

function isDemoMode(): boolean {
  return Boolean((globalThis as { __ZHIN_DEMO_MODE__?: boolean }).__ZHIN_DEMO_MODE__)
}

async function requestConsole<T = unknown>(request: ConsoleRpcRequest): Promise<T> {
  const { requestConsole: send } = await import('../utils/console-rpc')
  return send<T>(request)
}

const inFlightToggles = new Set<string>()

function matchesStatusFilter(plugin: Plugin, filter: PluginStatusFilter): boolean {
  if (filter === 'all') return true
  const m = plugin.management
  const statusText = String(m?.status ?? '')
  if (filter === 'enabled') {
    return m ? m.status === 'enabled' && !m.disabled : plugin.status === 'active'
  }
  if (filter === 'pending') {
    if (plugin.managementError) return true
    if (!m) return false
    return (
      m.status === 'missing-config' ||
      m.status === 'degraded' ||
      m.status === 'pending-restart' ||
      statusText === 'failed' ||
      m.dependencies === 'failed' ||
      !m.published
    )
  }
  if (filter === 'disabled') {
    return m ? Boolean(m.disabled) || statusText === 'disabled' : plugin.status === 'inactive'
  }
  return true
}

function pluginStatusTone(plugin: Plugin): 'enabled' | 'warning' | 'disabled' {
  const m = plugin.management
  const statusText = String(m?.status ?? '')
  if (m?.disabled || statusText === 'disabled') return 'disabled'
  if (m?.status === 'enabled' && m.published && !plugin.managementError) return 'enabled'
  if (
    plugin.managementError ||
    m?.status === 'missing-config' ||
    m?.status === 'degraded' ||
    m?.status === 'pending-restart' ||
    statusText === 'failed' ||
    m?.dependencies === 'failed' ||
    (m && !m.published)
  ) {
    return 'warning'
  }
  return plugin.status === 'active' ? 'enabled' : 'disabled'
}

export default function PluginsPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <PageShell className="console-plugins-page">
    <PageHeader title={i18n.t("插件管理")} />
    <Alert><AlertDescription>{i18n.t("请连接 Host 后读取功能。")}</AlertDescription></Alert>
  </PageShell>
  return <PluginsPageSession key={scope} connectionScope={scope} />
}

function PluginsPageSession({ connectionScope }: { connectionScope: string }) {
  const i18n = useI18n()
  const { data: plugins, loaded, loading, error, refresh } = useConsoleRead<Plugin[]>(async () => {
    const current = () => {
      if (!isInboxCacheScopeActive(connectionScope)) throw new Error(i18n.t("连接身份已变化，请重新读取。"))
    }
    current()
    const res = await apiFetch('/api/plugins')
    current()
    if (!res.ok) throw new Error(res.status === 403 ? i18n.t("当前身份无权读取插件列表") : i18n.t("插件读取失败（HTTP {0}）", [res.status]))
    const body = await res.json()
    current()
    return validatePluginList(body, i18n.locale) as Plugin[]
  }, [])
  const refreshCurrent = useCallback(async () => {
    if (isInboxCacheScopeActive(connectionScope)) await refresh().catch(() => {})
  }, [connectionScope, refresh])
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = typeof useNavigate === 'function' ? useNavigate() : undefined
  const readOnly = isDemoMode()
  const search = searchParams.get('q') ?? ''
  const rawStatus = searchParams.get('status')
  const statusFilter: PluginStatusFilter =
    rawStatus === 'enabled' || rawStatus === 'pending' || rawStatus === 'disabled' ? rawStatus : 'all'
  const setSearch = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('q', value)
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }
  const setStatusFilter = (value: PluginStatusFilter) => {
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

  const filteredPlugins = plugins.filter(p =>
    p.name.toLowerCase().includes(search.trim().toLowerCase()) && matchesStatusFilter(p, statusFilter)
  )

  const statusCounts = {
    enabled: plugins.filter(p => matchesStatusFilter(p, 'enabled')).length,
    pending: plugins.filter(p => matchesStatusFilter(p, 'pending')).length,
    disabled: plugins.filter(p => matchesStatusFilter(p, 'disabled')).length,
  }

  const filterOptions: Array<{ key: PluginStatusFilter; label: string }> = [
    { key: 'all', label: i18n.t("全部") },
    { key: 'enabled', label: i18n.t("已启用") },
    { key: 'pending', label: i18n.t("待处理") },
    { key: 'disabled', label: i18n.t("已停用") },
  ]

  useEffect(() => {
    const interval = setInterval(() => void refreshCurrent(), 10000)
    return () => clearInterval(interval)
  }, [refreshCurrent])

  if (!isInboxCacheScopeActive(connectionScope)) return null

  if (loading && !loaded) {
    return (
      <PageShell className="console-plugins-page">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-[var(--console-radius-md)]" />)}
        </div>
      </PageShell>
    )
  }

  if (error && !loaded) {
    return (
      <PageShell className="console-plugins-page items-center justify-center min-h-[40vh]">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{i18n.t("加载失败: ")}{error}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => void refreshCurrent()}>
          {i18n.t("重试")}</Button>
      </PageShell>
    )
  }

  return (
    <PageShell className="console-plugins-page">
      <PageHeader
        title={i18n.t("插件管理")}
        description={i18n.t("管理当前实例已加载的功能插件、适配器与服务模块，支持热启停与参数配置。")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="console-plugin-catalog-filters" role="group" aria-label={i18n.t("扩展视图")}>
              <button type="button" className="console-plugin-filter-pill is-active">
                {i18n.t("已装插件")}
              </button>
              <button
                type="button"
                className="console-plugin-filter-pill"
                onClick={() => {
                  if (navigate) navigate('/marketplace')
                  else if (typeof window !== 'undefined') window.location.assign('/marketplace')
                }}
              >
                {i18n.t("插件市场")}
              </button>
              <button
                type="button"
                className="console-plugin-filter-pill"
                onClick={() => {
                  if (navigate) navigate('/introspection')
                  else if (typeof window !== 'undefined') window.location.assign('/introspection')
                }}
              >
                {i18n.t("能力中心")}
              </button>
            </div>
            <Button variant="outline" size="sm" disabled={loading} onClick={() => void refreshCurrent()}>
              {i18n.t("刷新")}
            </Button>
          </div>
        }
      />
      {error ? <Alert variant="warning"><AlertCircle className="h-4 w-4" /><AlertDescription className="flex items-center justify-between gap-3"><span>{error}{i18n.t("。以下是上次读取的列表。")}</span><Button variant="outline" size="sm" onClick={() => void refreshCurrent()}>{i18n.t("重试")}</Button></AlertDescription></Alert> : null}

      <StatGrid label={i18n.t("插件概况")}>
        <StatCard
          icon={Package}
          label={i18n.t("子插件")}
          value={plugins.length}
          sub={i18n.t("当前实例已加载")}
          onOpen={() => setStatusFilter('all')}
          pressed={statusFilter === 'all'}
        />
        <StatCard
          icon={CheckCircle2}
          label={i18n.t("已启用")}
          value={statusCounts.enabled}
          sub={i18n.t("正在提供功能")}
          onOpen={() => setStatusFilter('enabled')}
          pressed={statusFilter === 'enabled'}
        />
        <StatCard
          icon={Clock}
          label={i18n.t("待处理")}
          value={statusCounts.pending}
          sub={statusCounts.pending > 0 ? i18n.t("缺少配置、待重启或运行异常") : i18n.t("无需处理")}
          tone={statusCounts.pending > 0 ? 'warning' : undefined}
          onOpen={() => setStatusFilter('pending')}
          pressed={statusFilter === 'pending'}
        />
        <StatCard
          icon={PauseCircle}
          label={i18n.t("已停用")}
          value={statusCounts.disabled}
          sub={i18n.t("已关闭，可随时重新启用")}
          onOpen={() => setStatusFilter('disabled')}
          pressed={statusFilter === 'disabled'}
        />
      </StatGrid>

      <div className="console-plugin-catalog-toolbar">
        <div className="console-plugin-catalog-toolbar-meta">
          <p className="console-plugin-catalog-count">{i18n.t("共 ")}{plugins.length} {i18n.t(" 个子插件")}</p>
          <div className="console-plugin-catalog-filters" role="group" aria-label={i18n.t("状态")}>
            {filterOptions.map(option => (
              <button
                key={option.key}
                type="button"
                aria-pressed={statusFilter === option.key}
                className={statusFilter === option.key ? 'console-plugin-filter-pill is-active' : 'console-plugin-filter-pill'}
                onClick={() => setStatusFilter(option.key)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
        <div className="console-plugin-catalog-search">
          <Search aria-hidden="true" />
          <Input
            type="search"
            aria-label={i18n.t("搜索插件…")}
            placeholder={i18n.t("搜索插件…")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <ul className="console-plugin-catalog-list">
        {filteredPlugins.map((plugin, index) => {
          const instanceKey = plugin.instanceKey ?? plugin.name
          const toggleKey = `${connectionScope}:${instanceKey}`
          const tone = pluginStatusTone(plugin)
          const canToggle = Boolean(plugin.management?.declared)
          const isEnabled = plugin.management ? !plugin.management.disabled : plugin.status === 'active'
          return (
            <li key={`${plugin.name}-${index}`} className="console-plugin-catalog-item">
              <Link className="console-plugin-catalog-row" to={detailUrl(instanceKey)}>
                <span className="console-plugin-catalog-icon" aria-hidden="true">
                  <Package />
                  <span className={`console-plugin-status-dot is-${tone}`} />
                </span>
                <span className="console-plugin-catalog-identity">
                  <strong>{plugin.name}</strong>
                  <span>{plugin.description || i18n.t("暂无描述")}</span>
                </span>
                <span className="console-plugin-catalog-state">
                  <Badge variant={plugin.management?.status === 'enabled' ? 'success' : plugin.management?.status === 'missing-config' || plugin.management?.status === 'degraded' ? 'warning' : 'secondary'}>
                    {managementLabel(plugin.management, i18n.locale)}
                  </Badge>
                  {plugin.management && !plugin.management.published ? <small>{i18n.t("待核对应用")}</small> : null}
                  {plugin.managementError ? <small className="text-destructive">{i18n.t("状态读取失败：{0}", [plugin.managementError])}</small> : null}
                </span>
                <ChevronRight className="console-plugin-catalog-arrow" aria-hidden="true" />
              </Link>
              {!readOnly ? (
                <div className="console-plugin-catalog-actions">
                  {canToggle && plugin.management ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className={isEnabled ? 'console-plugin-toggle-btn is-on' : 'console-plugin-toggle-btn'}
                      disabled={inFlightToggles.has(toggleKey)}
                      onClick={async (e: { preventDefault?: () => void; stopPropagation?: () => void }) => {
                        e?.preventDefault?.()
                        e?.stopPropagation?.()
                        const previous = plugin.management
                        if (!previous || inFlightToggles.has(toggleKey)) return
                        inFlightToggles.add(toggleKey)
                        const nextEnabled = !isEnabled
                        try {
                          try {
                            await requestConsole({
                              type: 'plugin:set-enabled',
                              instanceKey,
                              enabled: nextEnabled,
                            })
                          } catch {
                            // Host may restart before RPC response returns; reconcile via inspect polling
                          }
                          await waitForEnabledManagementState(
                            () => requestConsole({ type: 'plugin:inspect', instanceKey }),
                            previous,
                            nextEnabled,
                            AbortSignal.timeout(20_000),
                            undefined,
                            i18n.locale,
                          )
                        } catch {
                          // Poll timeout or inspect failure; refreshCurrent in finally will sync latest list state
                        } finally {
                          inFlightToggles.delete(toggleKey)
                          await refreshCurrent()
                        }
                      }}
                    >
                      {isEnabled ? i18n.t("停用") : i18n.t("启用")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={(e: { preventDefault?: () => void; stopPropagation?: () => void }) => {
                      e?.preventDefault?.()
                      e?.stopPropagation?.()
                      const target =
                        plugin.config?.configured || plugin.config?.hasSchema
                          ? `/config?plugin=${encodeURIComponent(instanceKey)}`
                          : detailUrl(instanceKey)
                      if (navigate) navigate(target)
                      else if (typeof window !== 'undefined') window.location.assign(target)
                    }}
                  >
                    {i18n.t("配置")}
                  </Button>
                </div>
              ) : null}
            </li>
          )
        })}
      </ul>

      {plugins.length > 0 && filteredPlugins.length === 0 ? <div className="console-plugin-catalog-empty" role="status">
        <h2>{i18n.t("没有匹配的插件")}</h2>
        <p>{i18n.t("试试其他名称，或清除筛选。")}</p>
        <Button variant="outline" size="sm" onClick={clearFilters}>{i18n.t("清除筛选")}</Button>
      </div> : null}
      {plugins.length === 0 ? <div className="console-plugin-catalog-empty" role="status">
        <Package aria-hidden="true" />
        <h2>{i18n.t("暂无子插件")}</h2>
      </div> : null}
    </PageShell>
  )
}
