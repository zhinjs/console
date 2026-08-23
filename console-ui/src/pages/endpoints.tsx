import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Wifi, WifiOff, Activity, Package, Zap, ChevronRight } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ErrorAlert } from '../components/error-alert'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'
import { ENDPOINT_RPC } from '../contracts/zhin-console'
import { requestConsole } from '../utils/console-rpc'

interface EndpointInfo {
  name: string
  adapter: string
  connected: boolean
  status: 'online' | 'offline'
  pendingRequestCount?: number
  pendingNoticeCount?: number
}

export default function EndpointsPage() {
  const [endpoints, setEndpoints] = useState<EndpointInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchEndpoints = useCallback(async () => {
    try {
      const data = await requestConsole<{ endpoints: EndpointInfo[] }>({ type: ENDPOINT_RPC.LIST })
      setEndpoints(data.endpoints || [])
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void fetchEndpoints()
  }, [fetchEndpoints])

  useEffect(() => {
    const interval = setInterval(fetchEndpoints, 8000)
    return () => clearInterval(interval)
  }, [fetchEndpoints])

  if (loading) {
    return (
      <PageShell>
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-[var(--console-space-stack)]">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48 rounded-[var(--console-radius-xl)]" />)}
        </div>
      </PageShell>
    )
  }

  if (error) {
    return (
      <PageShell>
        <PageHeader title="机器人管理" description="管理所有已配置的 Endpoint 连接" />
        <ErrorAlert error={`加载失败：${error}`} onRetry={fetchEndpoints} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader title="机器人管理" description="管理所有已配置的 Endpoint 连接" />

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-4">
        {endpoints.map((endpoint, index) => (
          <Link
            key={`${endpoint.adapter}-${endpoint.name}-${index}`}
            to={`/endpoints/${encodeURIComponent(endpoint.adapter)}/${encodeURIComponent(endpoint.name)}`}
            className="block rounded-xl focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Card className="console-surface-interactive h-full">
              <CardContent className="p-5 space-y-4">
                <div className="flex justify-between items-center gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={`p-2 rounded-md shrink-0 ${endpoint.connected ? 'bg-emerald-100 dark:bg-emerald-900/30' : 'bg-muted'}`}>
                      <Bot className={`w-5 h-5 ${endpoint.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`} />
                    </div>
                    <span className="text-lg font-bold truncate">{endpoint.name}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <Badge variant={endpoint.connected ? 'success' : 'secondary'}>
                      {endpoint.connected ? <><Wifi className="w-3 h-3 mr-1" />在线</> : <><WifiOff className="w-3 h-3 mr-1" />离线</>}
                    </Badge>
                    <ChevronRight className="w-4 h-4 text-muted-foreground" />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">适配器:</span>
                  <Badge variant="outline">{endpoint.adapter}</Badge>
                </div>

                <Separator />

                <div className="space-y-2">
                  <div className="flex justify-between items-center p-2 rounded-[var(--console-radius-md)] console-surface-muted">
                    <div className="flex items-center gap-2 text-sm">
                      <Activity className={`w-4 h-4 ${endpoint.status === 'online' ? 'text-emerald-500' : 'text-muted-foreground'}`} />
                      <span className="text-muted-foreground">运行状态</span>
                    </div>
                    <Badge variant={endpoint.status === 'online' ? 'success' : 'secondary'}>
                      {endpoint.status === 'online' ? '运行中' : '已停止'}
                    </Badge>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded-[var(--console-radius-md)] console-surface-muted">
                    <div className="flex items-center gap-2 text-sm">
                      <Package className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">适配器类型</span>
                    </div>
                    <span className="text-sm font-medium">{endpoint.adapter}</span>
                  </div>
                  <div className="flex justify-between items-center p-2 rounded-[var(--console-radius-md)] console-surface-muted">
                    <div className="flex items-center gap-2 text-sm">
                      <Zap className="w-4 h-4 text-muted-foreground" />
                      <span className="text-muted-foreground">连接状态</span>
                    </div>
                    <span className={`text-sm font-medium ${endpoint.connected ? 'text-emerald-600 dark:text-emerald-400' : 'text-muted-foreground'}`}>
                      {endpoint.connected ? '已连接' : '未连接'}
                    </span>
                  </div>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-1.5 pt-1">
                  {(endpoint.pendingRequestCount ?? 0) + (endpoint.pendingNoticeCount ?? 0) > 0 && (
                    <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                      {(endpoint.pendingRequestCount ?? 0) + (endpoint.pendingNoticeCount ?? 0)} 条待处理
                    </span>
                  )}
                  <p className="text-xs text-primary">点击进入管理</p>
                </div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>

      {endpoints.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Bot className="w-16 h-16 text-muted-foreground/30" />
            <div className="text-center">
              <h3 className="text-lg font-semibold">暂无 Endpoint</h3>
              <p className="text-sm text-muted-foreground">请先配置并启动 Endpoint</p>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  )
}
