import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AlertCircle, Package, Terminal, Box as IconBox, Layers, Clock, Brain, Wrench, Database, Shield, Settings, Plug, Server, Search, type LucideIcon } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'

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
  const navigate = useNavigate()
  const [plugins, setPlugins] = useState<Plugin[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')

  const filteredPlugins = plugins.filter(p =>
    p.name.toLowerCase().includes(search.trim().toLowerCase())
  )

  useEffect(() => {
    fetchPlugins()
    const interval = setInterval(fetchPlugins, 10000)
    return () => clearInterval(interval)
  }, [])

  const fetchPlugins = async () => {
    try {
      const res = await apiFetch('/api/plugins')
      if (!res.ok) throw new Error('API 请求失败')
      const data = await res.json()
      if (data.success) { setPlugins(data.data); setError(null) }
      else throw new Error('数据格式错误')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <PageShell>
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-[var(--console-space-stack)]">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 rounded-[var(--console-radius-xl)]" />)}
        </div>
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell className="items-center justify-center min-h-[40vh]">
        <Alert variant="destructive" className="max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载失败: {error}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); void fetchPlugins() }}>
          重试
        </Button>
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader title="插件" description="已加载的插件列表" />

      <div className="console-page-meta">
        <span>共 {plugins.length} 个插件</span>
        <Badge variant="success">{plugins.filter(p => p.status === 'active').length}</Badge>
        <span>个运行中</span>
      </div>

      <div className="console-page-toolbar">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input
            type="search"
            placeholder="搜索插件…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
        {filteredPlugins.map((plugin, index) => (
          <Card
            key={`${plugin.name}-${index}`}
            className="console-surface-interactive cursor-pointer"
            onClick={() => navigate(`/plugins/${encodeURIComponent(plugin.name)}`)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault()
                navigate(`/plugins/${encodeURIComponent(plugin.name)}`)
              }
            }}
            role="button"
            tabIndex={0}
          >
            <CardContent className="p-4 space-y-3">
              <div className="flex justify-between items-center gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex items-center justify-center w-8 h-8 shrink-0 rounded-[var(--console-radius-md)] bg-secondary border border-[var(--console-border-subtle)]">
                    <Package className="w-4 h-4" />
                  </div>
                  <span className="font-semibold text-sm truncate">{plugin.name}</span>
                </div>
                <Badge variant={plugin.status === 'active' ? 'success' : 'secondary'} className="shrink-0">
                  {plugin.status === 'active' ? '运行中' : '已停止'}
                </Badge>
              </div>

              <p className="text-xs text-muted-foreground line-clamp-2 leading-relaxed">
                {plugin.description || '暂无描述'}
              </p>

              <hr className="console-divider" />

              {plugin.features.length > 0 ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-1">
                  {plugin.features.map((feature) => {
                    const Icon = getIcon(feature.icon)
                    return (
                      <div key={feature.name} className="console-feature-cell">
                        <Icon className="w-3 h-3 text-muted-foreground" />
                        <span className="text-sm font-bold tabular-nums">{feature.count}</span>
                        <span className="text-[10px] text-muted-foreground text-center leading-tight">{feature.desc}</span>
                      </div>
                    )
                  })}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-2">无注册功能</p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {plugins.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted border border-[var(--console-border-subtle)]">
              <Package className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold">暂无插件</h3>
            <p className="text-sm text-muted-foreground">请先安装并启用插件</p>
          </CardContent>
        </Card>
      )}
    </PageShell>
  )
}
