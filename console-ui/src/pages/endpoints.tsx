import { useI18n } from '../i18n'
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Bot, Wifi, WifiOff, Activity, Package, Zap, ChevronRight } from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ErrorAlert } from '../components/error-alert'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'
import { ENDPOINT_RPC } from '../contracts/zhin-console'
import { readEndpointList } from './endpoint-list-model.mjs'
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
  const i18n = useI18n()
  const [endpoints, setEndpoints] = useState<EndpointInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const fetchEndpoints = useCallback(async () => {
    try {
      const data = await requestConsole<{ endpoints: EndpointInfo[] }>({ type: ENDPOINT_RPC.LIST })
      setEndpoints(readEndpointList(data, i18n.locale))
      setError(null)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [i18n])

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
        <PageHeader title={i18n.t("聊天账号")} description={i18n.t("看看机器人登录的聊天账号是否在线，点进去查看会话、好友申请和通知。")} />
        <ErrorAlert error={i18n.t("加载失败：{0}", [error])} onRetry={fetchEndpoints} />
      </PageShell>
    )
  }

  return (
    <PageShell>
      <PageHeader title={i18n.t("聊天账号")} description={i18n.t("看看机器人登录的聊天账号是否在线，点进去查看会话、好友申请和通知。")} />

      {endpoints.length > 0 && (
        <div className="console-page-meta">
          <span>{i18n.t("共 {0} 个账号", [String(endpoints.length)])}</span>
          <span aria-hidden="true">·</span>
          <span className="inline-flex items-center gap-1.5">
            <span className="console-status-dot" aria-hidden="true" />
            {i18n.t("{0} 个在线", [String(endpoints.filter((endpoint) => endpoint.connected).length)])}
          </span>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
        {endpoints.map((endpoint, index) => {
          const pending = (endpoint.pendingRequestCount ?? 0) + (endpoint.pendingNoticeCount ?? 0)
          return (
            <Link
              key={`${endpoint.adapter}-${endpoint.name}-${index}`}
              to={`/endpoints/${encodeURIComponent(endpoint.adapter)}/${encodeURIComponent(endpoint.name)}`}
              className="console-endpoint-card group"
            >
              <div className="flex items-start gap-3 min-w-0">
                <span className={endpoint.connected ? 'console-endpoint-avatar is-online' : 'console-endpoint-avatar'} aria-hidden="true">
                  <Bot />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">{endpoint.name}</div>
                  <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Package className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    <span className="truncate font-mono">{endpoint.adapter}</span>
                  </div>
                </div>
                <Badge variant={endpoint.connected ? 'success' : 'secondary'} className="shrink-0">
                  {endpoint.connected ? <><Wifi className="w-3 h-3 mr-1" />{i18n.t("在线")}</> : <><WifiOff className="w-3 h-3 mr-1" />{i18n.t("离线")}</>}
                </Badge>
              </div>

              <dl className="console-endpoint-facts">
                <div>
                  <dt><Activity aria-hidden="true" />{i18n.t("运行状态")}</dt>
                  <dd className={endpoint.status === 'online' ? 'is-good' : undefined}>
                    {endpoint.status === 'online' ? i18n.t("运行中") : i18n.t("已停止")}
                  </dd>
                </div>
                <div>
                  <dt><Zap aria-hidden="true" />{i18n.t("连接状态")}</dt>
                  <dd className={endpoint.connected ? 'is-good' : undefined}>
                    {endpoint.connected ? i18n.t("已连接") : i18n.t("未连接")}
                  </dd>
                </div>
              </dl>

              <div className="console-endpoint-footer">
                {pending > 0 ? (
                  <span className="console-endpoint-pending">
                    {pending} {i18n.t(" 条待处理")}</span>
                ) : (
                  <span>{i18n.t("暂无待处理")}</span>
                )}
                <span className="console-endpoint-open">
                  {i18n.t("点击进入管理")}
                  <ChevronRight aria-hidden="true" />
                </span>
              </div>
            </Link>
          )
        })}
      </div>

      {endpoints.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Bot className="w-16 h-16 text-muted-foreground/30" />
            <div className="text-center">
              <h3 className="text-lg font-semibold">{i18n.t("暂无渠道")}</h3>
              <p className="text-sm text-muted-foreground">{i18n.t("请先配置平台适配器及机器人账号，然后启动 Host。")}</p>
            </div>
          </CardContent>
        </Card>
      )}
    </PageShell>
  )
}
