import { useI18n } from '../i18n'
import { useCallback, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { AlertCircle, ChevronRight, Package, Search } from 'lucide-react'
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
import { managementLabel, type PluginManagementState } from './plugin-management-model.mjs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import './plugins.css'

interface Plugin {
  name: string
  status: 'active' | 'inactive'
  description: string
  instanceKey?: string
  management?: PluginManagementState
  managementError?: string
}

export default function PluginsPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <PageShell className="console-plugins-page">
    <PageHeader title={i18n.t("功能管理")} />
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
  const search = searchParams.get('q') ?? ''
  const setSearch = (value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set('q', value)
    else next.delete('q')
    setSearchParams(next, { replace: true })
  }
  const detailUrl = (name: string) => `/plugins/${encodeURIComponent(name)}${search ? `?q=${encodeURIComponent(search)}` : ''}`

  const filteredPlugins = plugins.filter(p =>
    p.name.toLowerCase().includes(search.trim().toLowerCase())
  )

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
      <PageHeader title={i18n.t("功能管理")} actions={<Button variant="outline" size="sm" disabled={loading} onClick={() => void refreshCurrent()}>{i18n.t("刷新")}</Button>} />
      {error ? <Alert variant="warning"><AlertCircle className="h-4 w-4" /><AlertDescription className="flex items-center justify-between gap-3"><span>{error}{i18n.t("。以下是上次读取的列表。")}</span><Button variant="outline" size="sm" onClick={() => void refreshCurrent()}>{i18n.t("重试")}</Button></AlertDescription></Alert> : null}

      <div className="console-plugin-catalog-toolbar">
        <p className="console-plugin-catalog-count">{i18n.t("共 ")}{plugins.length} {i18n.t(" 个子插件")}</p>
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
        {filteredPlugins.map((plugin, index) => (
          <li key={`${plugin.name}-${index}`}>
            <Link className="console-plugin-catalog-row" to={detailUrl(plugin.instanceKey ?? plugin.name)}>
              <span className="console-plugin-catalog-icon" aria-hidden="true"><Package /></span>
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
          </li>
        ))}
      </ul>

      {plugins.length > 0 && filteredPlugins.length === 0 ? <div className="console-plugin-catalog-empty" role="status">
        <h2>{i18n.t("没有匹配的插件")}</h2>
        <p>{i18n.t("试试其他名称，或清除筛选。")}</p>
        <Button variant="outline" size="sm" onClick={() => setSearch('')}>{i18n.t("清除筛选")}</Button>
      </div> : null}
      {plugins.length === 0 ? <div className="console-plugin-catalog-empty" role="status">
        <Package aria-hidden="true" />
        <h2>{i18n.t("暂无子插件")}</h2>
      </div> : null}
    </PageShell>
  )
}
