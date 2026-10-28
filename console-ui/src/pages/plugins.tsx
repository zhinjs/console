import { useI18n } from '../i18n'
import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AlertCircle, Package, Terminal, Box as IconBox, Layers, Clock, Brain, Wrench, Database, Shield, Settings, Plug, Server, Search, type LucideIcon } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { Card, CardContent } from '../components/ui/card'
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

/** Feature 序列化格式（与后端 FeatureJSON 一致） */
interface FeatureJSON {
  name: string
  icon: string
  desc: string
  count: number
  items: any[]
}

interface Plugin {
  name: string
  status: 'active' | 'inactive'
  description: string
  features: FeatureJSON[]
  instanceKey?: string
  management?: PluginManagementState
  managementError?: string
}

/** 根据后端返回的 icon 名称映射到 lucide-react 图标组件 */
const iconMap: Record<string, LucideIcon> = {
  Terminal,
  Box: IconBox,
  Layers,
  Clock,
  Brain,
  Wrench,
  Database,
  Shield,
  Settings,
  Plug,
  Server,
}

function getIcon(iconName: string): LucideIcon {
  return iconMap[iconName] || Package
}

export default function PluginsPage() {
  const i18n = useI18n()
  const navigate = useNavigate()
  const { data: plugins, loaded, loading, error, refresh } = useConsoleRead<Plugin[]>(async () => {
    const res = await apiFetch('/api/plugins')
    if (!res.ok) throw new Error(res.status === 403 ? i18n.t("当前身份无权读取插件列表") : i18n.t("插件读取失败（HTTP {0}）", [res.status]))
    return validatePluginList(await res.json(), i18n.locale) as Plugin[]
  }, [])
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
    const interval = setInterval(() => void refresh().catch(() => {}), 10000)
    return () => clearInterval(interval)
  }, [refresh])

  if (loading && !loaded) {
    return (
      <PageShell className="console-resource-page console-plugins-page">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 rounded-[var(--console-radius-md)]" />)}
        </div>
      </PageShell>
    )
  }

  if (error && !loaded) {
    return (
      <PageShell className="console-resource-page console-plugins-page items-center justify-center min-h-[40vh]">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{i18n.t("加载失败: ")}{error}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => void refresh().catch(() => {})}>
          {i18n.t("重试")}</Button>
      </PageShell>
    )
  }

  return (
    <PageShell className="console-resource-page console-plugins-page">
      <PageHeader title={i18n.t("子插件")} actions={<Button variant="outline" size="sm" disabled={loading} onClick={() => void refresh().catch(() => {})}>{i18n.t("刷新")}</Button>} />
      {error ? <Alert variant="warning"><AlertCircle className="h-4 w-4" /><AlertDescription className="flex items-center justify-between gap-3"><span>{error}{i18n.t("。以下是上次读取的列表。")}</span><Button variant="outline" size="sm" onClick={() => void refresh().catch(() => {})}>{i18n.t("重试")}</Button></AlertDescription></Alert> : null}

      <div className="console-resource-toolbar console-page-toolbar">
        <div className="console-page-meta">
          <span>{i18n.t("共 ")}{plugins.length} {i18n.t(" 个子插件")}</span>
          <span aria-hidden="true">·</span>
          <span>{plugins.filter(p => p.status === 'active').length} {i18n.t("个代内已加载")}</span>
        </div>
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
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

      <div className="console-resource-list console-plugin-list">
        {filteredPlugins.map((plugin, index) => (
          <Card
            key={`${plugin.name}-${index}`}
            className="console-plugin-row console-surface-interactive cursor-pointer"
            onClick={() => navigate(detailUrl(plugin.instanceKey ?? plugin.name))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                navigate(detailUrl(plugin.instanceKey ?? plugin.name))
              }
            }}
            role="button"
            tabIndex={0}
          >
            <CardContent className="console-plugin-row-content">
              <div className="console-plugin-identity flex items-start gap-3 min-w-0">
                <div className="console-resource-icon">
                  <Package className="w-4 h-4" />
                </div>
                <div className="min-w-0">
                  <span className="block font-semibold text-sm truncate">{plugin.name}</span>
                  <p className="mt-1 text-sm text-muted-foreground line-clamp-2 leading-relaxed">
                    {plugin.description || i18n.t("暂无描述")}
                  </p>
                </div>
              </div>
              <div className="console-plugin-state space-y-2">
                <Badge variant={plugin.management?.status === 'enabled' ? 'success' : plugin.management?.status === 'missing-config' || plugin.management?.status === 'degraded' ? 'warning' : 'secondary'} className="shrink-0">
                  {plugin.management ? managementLabel(plugin.management, i18n.locale) : i18n.t("应用证据未确认")}
                </Badge>
                {plugin.management && !plugin.management.published ? <p className="text-xs text-muted-foreground">{i18n.t("待核对应用")}</p> : null}
                {plugin.managementError ? <p className="text-xs text-destructive">{i18n.t("状态读取失败：{0}", [plugin.managementError])}</p> : null}
              </div>

              {plugin.features.length > 0 ? (
                <div className="console-plugin-features flex flex-wrap gap-x-4 gap-y-2">
                  {plugin.features.map((feature) => {
                    const Icon = getIcon(feature.icon)
                    return (
                      <div key={feature.name} className="console-feature-cell" title={feature.desc}>
                        <Icon aria-hidden="true" />
                        <span className="font-semibold tabular-nums text-foreground">{feature.count}</span>
                        <span>{feature.desc}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">{i18n.t("无注册功能")}</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {plugins.length > 0 && filteredPlugins.length === 0 ? <Card><CardContent className="flex flex-col items-center gap-3 py-10">
        <h3 className="text-base font-semibold">{i18n.t("没有匹配的插件")}</h3>
        <p className="text-sm text-muted-foreground">{i18n.t("试试其他名称，或清除筛选。")}</p>
        <Button variant="outline" size="sm" onClick={() => setSearch('')}>{i18n.t("清除筛选")}</Button>
      </CardContent></Card> : null}
      {plugins.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted border border-[var(--console-border-subtle)]">
              <Package className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">{i18n.t("暂无子插件")}</h3>
          </CardContent>
        </Card>
      )}
    </PageShell>
  )
}
