import { useI18n } from '../i18n'
import { useEffect, useState, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import {
  Bot,
  Wifi,
  WifiOff,
  Activity,
  Package,
  Zap,
  ChevronRight,
  RefreshCw,
  Plus,
  Search,
  ShieldAlert,
  QrCode,
  KeyRound,
  CheckCircle2,
  XCircle,
  ExternalLink,
  SlidersHorizontal,
  MessageSquare,
  Inbox,
} from 'lucide-react'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { MiniRingGauge, StatCard, StatGrid } from '../components/StatCard'
import { ErrorAlert } from '../components/error-alert'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'
import { ENDPOINT_RPC } from '../contracts/zhin-console'
import { readEndpointList } from './endpoint-list-model.mjs'
import { endpointLifecycleLabel } from './endpoint-presentation.mjs'
import { endpointTestError, endpointTestPresentation, readEndpointTestResult, type EndpointTestResult } from './endpoint-test-result-model.mjs'
import { requestConsole } from '../utils/console-rpc'
import { isDemoMode } from '../utils/demo-mode'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'

interface EndpointInfo {
  name: string
  adapter: string
  connected: boolean
  status: 'online' | 'offline'
  pendingLogin?: boolean
  transportState?: string
  pendingRequestCount?: number
  pendingNoticeCount?: number
}

interface LoginTaskIdentity {
  incarnationId: string
  canonicalId: string
  instanceId: string
  epoch: number
}

interface LoginTask {
  id: string
  adapter: string
  endpointKey: string
  endpointIdentity?: LoginTaskIdentity
  type: string
  payload?: {
    image?: string
    url?: string
    message?: string
    phone?: string
    [key: string]: unknown
  }
  message?: string
  createdAt?: number
  expiresAt?: number
}

interface EndpointTestState {
  loading: boolean
  result?: EndpointTestResult
}

type EndpointStatusFilter = 'all' | 'online' | 'pending_login' | 'offline'

interface PlatformBrandInfo {
  key: string
  label: string
  shortMark: string
  route: string
}

function normalizeAdapterKey(adapter: string): string {
  const cleaned = adapter
    .trim()
    .toLowerCase()
    .replace(/^@zhin\.js\//, '')
    .replace(/^adapter-/, '')
  return cleaned || adapter.trim().toLowerCase()
}

function getPlatformBrand(adapter: string): PlatformBrandInfo {
  const key = normalizeAdapterKey(adapter)
  switch (key) {
    case 'icqq':
      return { key, label: 'ICQQ 协议端', shortMark: 'QQ', route: '/icqq' }
    case 'qq':
      return { key, label: 'QQ 官方机器人', shortMark: 'QQ', route: '/qq' }
    case 'napcat':
      return { key, label: 'NapCat', shortMark: 'NC', route: '/napcat' }
    case 'onebot11':
    case 'onebot-11':
      return { key: 'onebot11', label: 'OneBot 11', shortMark: 'OB', route: '/onebot11' }
    case 'onebot12':
    case 'onebot-12':
      return { key: 'onebot12', label: 'OneBot 12', shortMark: 'OB', route: '/onebot12' }
    case 'telegram':
      return { key, label: 'Telegram', shortMark: 'TG', route: '/telegram' }
    case 'discord':
      return { key, label: 'Discord', shortMark: 'DC', route: '/discord' }
    case 'lark':
    case 'feishu':
      return { key: 'lark', label: '飞书 Lark', shortMark: 'FS', route: `/${encodeURIComponent(key)}` }
    case 'dingtalk':
      return { key, label: '钉钉 DingTalk', shortMark: 'DT', route: '/dingtalk' }
    case 'wecom':
    case 'work-weixin':
      return { key: 'wecom', label: '企业微信', shortMark: 'WC', route: `/${encodeURIComponent(key)}` }
    case 'slack':
      return { key, label: 'Slack', shortMark: 'SL', route: '/slack' }
    case 'kook':
      return { key, label: 'KOOK', shortMark: 'KK', route: '/kook' }
    case 'line':
      return { key, label: 'LINE', shortMark: 'LN', route: '/line' }
    case 'email':
      return { key, label: 'Email', shortMark: 'EM', route: '/email' }
    case 'github':
      return { key, label: 'GitHub', shortMark: 'GH', route: '/github' }
    case 'sandbox':
      return { key, label: 'Sandbox', shortMark: 'SB', route: '/sandbox' }
    default:
      return {
        key,
        label: adapter,
        shortMark: key.slice(0, 2).toUpperCase() || 'IM',
        route: `/${encodeURIComponent(adapter)}`,
      }
  }
}

/**
 * 智能提取滑块 Ticket 或验证码：
 * 支持用户直接粘贴浏览器 Network 面板中的 JSON 响应（含 ticket 字段）或带 ticket=/cap_cd= 的回调 URL。
 */
function extractVerificationValue(raw: string): { value: string; extractedFrom?: 'json' | 'url' } {
  const trimmed = raw.trim()
  if (!trimmed) return { value: '' }

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      const directTicket =
        typeof parsed.ticket === 'string'
          ? parsed.ticket
          : typeof (parsed.data as Record<string, unknown> | undefined)?.ticket === 'string'
            ? ((parsed.data as Record<string, unknown>).ticket as string)
            : undefined
      if (directTicket && directTicket.trim()) {
        return { value: directTicket.trim(), extractedFrom: 'json' }
      }
    } catch {
      // ignore invalid JSON and fall through
    }
  }

  if (/^https?:\/\//i.test(trimmed) || /[?&](?:ticket|cap_cd)=/i.test(trimmed)) {
    try {
      const url = trimmed.startsWith('http') ? new URL(trimmed) : new URL(trimmed, 'http://localhost')
      const ticketParam = url.searchParams.get('ticket') ?? url.searchParams.get('cap_cd')
      if (ticketParam && ticketParam.trim()) {
        return { value: ticketParam.trim(), extractedFrom: 'url' }
      }
    } catch {
      const match = trimmed.match(/[?&](?:ticket|cap_cd)=([^&#\s]+)/i)
      if (match?.[1]) {
        try {
          return { value: decodeURIComponent(match[1]), extractedFrom: 'url' }
        } catch {
          return { value: match[1], extractedFrom: 'url' }
        }
      }
    }
  }

  return { value: trimmed }
}

function isImageSource(value: string): boolean {
  return /^data:image\//i.test(value) || /^https?:\/\/[^\s]+\.(?:png|jpe?g|gif|webp|svg)(?:\?[^\s]*)?$/i.test(value)
}

function isSafeHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value.trim())
}

const ONBOARDING_PLATFORMS = [
  {
    id: 'icqq',
    title: 'ICQQ (QQ个人号)',
    badge: '扫码 / 滑块验证',
    desc: '接入个人 QQ 账号，支持群管、私聊、二维码扫码与滑块票据辅助登录。',
    to: '/icqq',
  },
  {
    id: 'qq',
    title: 'QQ 官方机器人',
    badge: '官方 API',
    desc: '通过 QQ 开放平台 AppID 与 Secret 接入官方频道与群聊机器人。',
    to: '/qq',
  },
  {
    id: 'onebot11',
    title: 'NapCat / OneBot 11',
    badge: 'WebSocket',
    desc: '通过正向或反向 WebSocket 连接 NapCat、Lagrange 等 OneBot v11 协议端。',
    to: '/onebot11',
  },
  {
    id: 'telegram',
    title: 'Telegram',
    badge: 'Bot Token',
    desc: '使用 BotFather 签发的 Token 接入 Telegram 私聊、群组与内联按钮。',
    to: '/telegram',
  },
  {
    id: 'discord',
    title: 'Discord',
    badge: 'Gateway / Slash',
    desc: '接入 Discord 服务器频道、私信会话与机器人交互组件。',
    to: '/discord',
  },
  {
    id: 'enterprise',
    title: '飞书 / 钉钉 / 企微',
    badge: '企业办公 IM',
    desc: '前往插件配置页启用飞书 Lark、钉钉 DingTalk 或企业微信适配器。',
    to: '/plugins',
  },
  {
    id: 'email',
    title: 'Email 邮件',
    badge: 'IMAP / SMTP',
    desc: '配置邮箱收发通道，让机器人通过邮件接收指令与发送通知。',
    to: '/email',
  },
  {
    id: 'marketplace',
    title: '探索更多平台适配器',
    badge: '插件市场',
    desc: '浏览 KOOK、Slack、LINE、GitHub、Satori 等更多社区与官方适配器。',
    to: '/marketplace',
  },
] as const

export default function EndpointsPage() {
  const i18n = useI18n()
  const demo = isDemoMode()
  const cacheScope = useInboxCacheScope()
  const [endpoints, setEndpoints] = useState<EndpointInfo[]>([])
  const [loginTasks, setLoginTasks] = useState<LoginTask[]>([])
  const [loaded, setLoaded] = useState(false)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const fetchSeqRef = useRef(0)

  const [statusFilter, setStatusFilter] = useState<EndpointStatusFilter>('all')
  const [adapterFilter, setAdapterFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [onboardingOpen, setOnboardingOpen] = useState(false)

  const [loginInputs, setLoginInputs] = useState<Record<string, string>>({})
  const [loginBusy, setLoginBusy] = useState<Record<string, boolean>>({})
  const [loginFeedback, setLoginFeedback] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null)
  const [testResults, setTestResults] = useState<Record<string, EndpointTestState>>({})

  const fetchEndpoints = useCallback(async (manual = false) => {
    const seq = ++fetchSeqRef.current
    if (manual) setRefreshing(true)
    try {
      const [data, loginData] = await Promise.all([
        requestConsole<{ endpoints: EndpointInfo[] }>({ type: ENDPOINT_RPC.LIST }),
        demo
          ? Promise.resolve({ tasks: [] as LoginTask[] })
          : requestConsole<{ tasks?: LoginTask[] }>({ type: 'login.list' }).catch(() => ({ tasks: [] as LoginTask[] })),
      ])
      if (seq !== fetchSeqRef.current || !isInboxCacheScopeActive(cacheScope)) return
      setEndpoints(readEndpointList(data, i18n.locale))
      setLoginTasks(Array.isArray(loginData?.tasks) ? loginData.tasks : [])
      setLoaded(true)
      setError(null)
    } catch (err) {
      if (seq === fetchSeqRef.current && isInboxCacheScopeActive(cacheScope)) {
        setError((err as Error).message)
      }
    } finally {
      if (seq === fetchSeqRef.current) {
        setLoading(false)
        if (manual) setRefreshing(false)
      }
    }
  }, [cacheScope, demo, i18n.locale])

  useEffect(() => {
    setLoading(true)
    void fetchEndpoints()
  }, [fetchEndpoints])

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchEndpoints()
    }, 8000)
    return () => {
      clearInterval(interval)
      fetchSeqRef.current++
    }
  }, [fetchEndpoints])

  const loginTaskTypeLabel = (type: string): string => {
    switch (type) {
      case 'qrcode':
        return i18n.t("二维码扫码")
      case 'slider':
        return i18n.t("滑块验证")
      case 'sms':
        return i18n.t("短信验证码")
      case 'device':
        return i18n.t("设备锁确认")
      case 'auth':
        return i18n.t("登录确认")
      default:
        return i18n.t("安全验证")
    }
  }

  const handleSubmitLoginTask = async (task: LoginTask, rawInput?: string) => {
    if (demo) return
    const needsInput = task.type === 'slider' || task.type === 'sms' || task.type === 'device' || task.type === 'other'
    const extracted = needsInput ? extractVerificationValue(rawInput ?? loginInputs[task.id] ?? '') : { value: 'ok' }
    if (needsInput && !extracted.value) return

    setLoginBusy((prev) => ({ ...prev, [task.id]: true }))
    setLoginFeedback(null)
    try {
      await requestConsole({
        type: 'login.submit',
        taskId: task.id,
        value: extracted.value,
        ...(task.endpointIdentity ? { endpointIdentity: task.endpointIdentity } : {}),
      })
      setLoginInputs((prev) => ({ ...prev, [task.id]: '' }))
      setLoginFeedback({
        kind: 'ok',
        text: i18n.t("已提交账号 {0} 的登录验证，请稍候查看连接状态。", [task.endpointKey]),
      })
      await fetchEndpoints()
    } catch (err) {
      setLoginFeedback({
        kind: 'error',
        text: i18n.t("提交登录验证失败：{0}", [(err as Error).message]),
      })
    } finally {
      setLoginBusy((prev) => ({ ...prev, [task.id]: false }))
    }
  }

  const handleCancelLoginTask = async (task: LoginTask) => {
    if (demo) return
    setLoginBusy((prev) => ({ ...prev, [`cancel:${task.id}`]: true }))
    setLoginFeedback(null)
    try {
      await requestConsole({
        type: 'login.cancel',
        taskId: task.id,
        reason: 'console_cancelled',
        ...(task.endpointIdentity ? { endpointIdentity: task.endpointIdentity } : {}),
      })
      await fetchEndpoints()
    } catch (err) {
      setLoginFeedback({
        kind: 'error',
        text: i18n.t("取消登录验证失败：{0}", [(err as Error).message]),
      })
    } finally {
      setLoginBusy((prev) => ({ ...prev, [`cancel:${task.id}`]: false }))
    }
  }

  const handleTestEndpoint = async (endpoint: EndpointInfo) => {
    const key = `${endpoint.adapter}:${endpoint.name}`
    setTestResults((prev) => ({ ...prev, [key]: { loading: true } }))
    try {
      const res = await requestConsole<unknown>({
        type: (ENDPOINT_RPC as { TEST?: string }).TEST ?? 'endpoint.test',
        adapter: endpoint.adapter,
        endpointKey: endpoint.name,
      })
      setTestResults((prev) => ({ ...prev, [key]: { loading: false, result: readEndpointTestResult(res) } }))
    } catch (err) {
      setTestResults((prev) => ({
        ...prev,
        [key]: { loading: false, result: endpointTestError(i18n.t("测试失败：{0}", [(err as Error).message])) },
      }))
    }
  }

  const onlineCount = useMemo(() => endpoints.filter((e) => e.connected).length, [endpoints])
  const pendingLoginEndpointCount = useMemo(
    () =>
      endpoints.filter(
        (e) =>
          Boolean(e.pendingLogin) ||
          loginTasks.some((t) => t.adapter === e.adapter && t.endpointKey === e.name),
      ).length,
    [endpoints, loginTasks],
  )
  const totalPendingEvents = useMemo(
    () =>
      endpoints.reduce(
        (sum, e) => sum + (e.pendingRequestCount ?? 0) + (e.pendingNoticeCount ?? 0),
        0,
      ),
    [endpoints],
  )

  const pendingLoginTotal = Math.max(pendingLoginEndpointCount, loginTasks.length)
  const onlineRate = endpoints.length > 0 ? Math.round((onlineCount / endpoints.length) * 100) : 0

  const uniqueAdapters = useMemo(() => {
    const seen = new Set<string>()
    for (const ep of endpoints) {
      seen.add(ep.adapter)
    }
    return Array.from(seen)
  }, [endpoints])

  const filteredEndpoints = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return endpoints.filter((ep) => {
      const hasTask = Boolean(ep.pendingLogin) || loginTasks.some((t) => t.adapter === ep.adapter && t.endpointKey === ep.name)
      if (statusFilter === 'online' && !ep.connected) return false
      if (statusFilter === 'pending_login' && !hasTask) return false
      if (statusFilter === 'offline' && ep.connected) return false
      if (adapterFilter !== 'all' && ep.adapter !== adapterFilter) return false
      if (q) {
        const brand = getPlatformBrand(ep.adapter)
        const haystack = `${ep.name} ${ep.adapter} ${brand.label}`.toLowerCase()
        if (!haystack.includes(q)) return false
      }
      return true
    })
  }, [endpoints, loginTasks, statusFilter, adapterFilter, searchQuery])

  if (loading && !loaded) {
    return (
      <PageShell className="console-resource-page console-endpoints-page">
        <Skeleton className="h-8 w-48" />
        <div className="space-y-3">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24 rounded-[var(--console-radius-md)]" />)}
        </div>
      </PageShell>
    )
  }

  if (error && !loaded) {
    return (
      <PageShell className="console-resource-page console-endpoints-page">
        <PageHeader title={i18n.t("聊天账号")} />
        <ErrorAlert error={i18n.t("加载失败：{0}", [error])} onRetry={() => void fetchEndpoints(true)} />
      </PageShell>
    )
  }

  return (
    <PageShell className="console-resource-page console-endpoints-page">
      <PageHeader
        title={i18n.t("聊天账号")}
        description={i18n.t("统一管理多平台机器人账号、扫码与滑块登录验证、连接测速及会话入口。")}
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={refreshing}
              onClick={() => void fetchEndpoints(true)}
            >
              <RefreshCw className={refreshing ? 'h-3.5 w-3.5 mr-1.5 animate-spin' : 'h-3.5 w-3.5 mr-1.5'} aria-hidden="true" />
              {refreshing ? i18n.t("刷新中…") : i18n.t("刷新")}
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              aria-expanded={onboardingOpen}
              onClick={() => setOnboardingOpen(true)}
            >
              <Plus className="h-3.5 w-3.5 mr-1.5" aria-hidden="true" />
              {i18n.t("接入新平台账号")}
            </Button>
          </div>
        }
      />

      {error && loaded && (
        <ErrorAlert error={i18n.t("加载失败：{0}", [error])} onRetry={() => void fetchEndpoints(true)} />
      )}

      {endpoints.length > 0 && (
        <div className="console-endpoints-summary-strip">
          <StatGrid label={i18n.t("账号概况")}>
            <StatCard
              icon={Bot}
              label={i18n.t("全部账号")}
              value={endpoints.length}
              sub={i18n.t("{0} 个平台", [uniqueAdapters.length])}
              onOpen={() => setStatusFilter('all')}
              pressed={statusFilter === 'all'}
            />
            <StatCard
              icon={Wifi}
              label={i18n.t("在线")}
              value={onlineCount}
              sub={i18n.t("在线率 {0}%", [onlineRate])}
              aside={<MiniRingGauge percent={onlineRate} tone={onlineRate === 100 ? 'success' : onlineRate >= 60 ? 'primary' : 'warning'} />}
              tone={onlineCount < endpoints.length ? 'warning' : undefined}
              onOpen={() => setStatusFilter('online')}
              pressed={statusFilter === 'online'}
            />
            <StatCard
              icon={QrCode}
              label={i18n.t("等待登录")}
              value={pendingLoginTotal}
              sub={pendingLoginTotal > 0 ? i18n.t("需要扫码或验证") : i18n.t("无需处理")}
              tone={pendingLoginTotal > 0 ? 'warning' : undefined}
              onOpen={() => setStatusFilter('pending_login')}
              pressed={statusFilter === 'pending_login'}
            />
            <StatCard
              icon={Inbox}
              label={i18n.t("待处理事件")}
              value={totalPendingEvents}
              sub={i18n.t("好友申请、入群邀请与通知")}
            />
          </StatGrid>

          <div className="console-endpoints-toolbar" role="region" aria-label={i18n.t("账号筛选")}>
            <div className="console-endpoints-filter-group" role="group" aria-label={i18n.t("运行状态")}>
              {(
                [
                  { id: 'all', label: i18n.t("全部"), count: endpoints.length },
                  { id: 'online', label: i18n.t("在线"), count: onlineCount },
                  { id: 'pending_login', label: i18n.t("等待登录"), count: pendingLoginEndpointCount },
                  { id: 'offline', label: i18n.t("离线"), count: endpoints.length - onlineCount },
                ] as const
              ).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  aria-pressed={statusFilter === item.id}
                  onClick={() => setStatusFilter(item.id)}
                  className={
                    statusFilter === item.id
                      ? 'console-endpoint-filter-pill is-active'
                      : 'console-endpoint-filter-pill'
                  }
                >
                  <span>{item.label}</span>
                  <span className="console-endpoint-filter-count">{item.count}</span>
                </button>
              ))}
            </div>

            {uniqueAdapters.length > 1 && (
              <div className="console-endpoints-filter-group" role="group" aria-label={i18n.t("平台")}>
                <button
                  type="button"
                  aria-pressed={adapterFilter === 'all'}
                  onClick={() => setAdapterFilter('all')}
                  className={
                    adapterFilter === 'all'
                      ? 'console-endpoint-filter-pill is-active'
                      : 'console-endpoint-filter-pill'
                  }
                >
                  {i18n.t("全部平台")}
                </button>
                {uniqueAdapters.map((adapter) => {
                  const brand = getPlatformBrand(adapter)
                  return (
                    <button
                      key={adapter}
                      type="button"
                      aria-pressed={adapterFilter === adapter}
                      onClick={() => setAdapterFilter(adapter)}
                      className={
                        adapterFilter === adapter
                          ? 'console-endpoint-filter-pill is-active'
                          : 'console-endpoint-filter-pill'
                      }
                    >
                      {i18n.t(brand.label)}
                    </button>
                  )
                })}
              </div>
            )}

            <div className="console-endpoints-search">
              <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={i18n.t("搜索账号…")}
                aria-label={i18n.t("搜索账号…")}
                className="h-8 border-0 bg-transparent px-2 text-xs shadow-none focus-visible:ring-0"
              />
            </div>
          </div>
        </div>
      )}

      {(loginTasks.length > 0 || loginFeedback) && (
        <section className="console-login-workbench" aria-label={i18n.t("待完成登录验证工作台")}>
          <div className="console-login-workbench-head">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-warning" aria-hidden="true" />
              <h2 className="text-sm font-semibold">{i18n.t("待完成登录验证工作台")}</h2>
              {loginTasks.length > 0 && (
                <Badge variant="warning">{loginTasks.length}</Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {i18n.t("在此直接完成扫码、滑块 Ticket 或短信验证，无需逐个跳转平台页。")}
            </p>
          </div>

          {loginFeedback && (
            <div
              role="status"
              className={
                loginFeedback.kind === 'error'
                  ? 'console-login-feedback is-error'
                  : 'console-login-feedback is-ok'
              }
            >
              <span>{loginFeedback.text}</span>
              <button
                type="button"
                className="text-xs underline opacity-80 hover:opacity-100"
                onClick={() => setLoginFeedback(null)}
              >
                {i18n.t("关闭")}
              </button>
            </div>
          )}

          {loginTasks.length > 0 && (
            <div className="console-login-task-grid">
              {loginTasks.map((task) => {
                const brand = getPlatformBrand(task.adapter)
                const image = typeof task.payload?.image === 'string' ? task.payload.image : undefined
                const rawUrl = typeof task.payload?.url === 'string' ? task.payload.url.trim() : undefined
                const url = rawUrl && isSafeHttpUrl(rawUrl) ? rawUrl : undefined
                const promptMsg =
                  typeof task.payload?.message === 'string'
                    ? task.payload.message
                    : typeof task.message === 'string'
                      ? task.message
                      : undefined
                const phone = typeof task.payload?.phone === 'string' ? task.payload.phone : undefined
                const needsInput =
                  task.type === 'slider' ||
                  task.type === 'sms' ||
                  task.type === 'device' ||
                  task.type === 'other'
                const rawInput = loginInputs[task.id] ?? ''
                const extracted = needsInput ? extractVerificationValue(rawInput) : { value: 'ok' }
                const submitting = Boolean(loginBusy[task.id])
                const cancelling = Boolean(loginBusy[`cancel:${task.id}`])

                return (
                  <div key={task.id} className="console-login-task-card">
                    <div className="console-login-task-header">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="console-platform-brand-badge">{i18n.t(brand.label)}</span>
                        <strong className="truncate text-sm">{task.endpointKey}</strong>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <Badge variant="warning">{loginTaskTypeLabel(task.type)}</Badge>
                        <Link
                          to={brand.route}
                          className="console-inline-link text-xs"
                        >
                          {i18n.t("前往平台页")}
                        </Link>
                      </div>
                    </div>

                    <div className="console-login-task-body">
                      {image && isImageSource(image) && (
                        <div className="console-login-qr-wrap">
                          <img
                            src={image}
                            alt={`${loginTaskTypeLabel(task.type)} (${task.endpointKey})`}
                            className="console-login-qr"
                          />
                        </div>
                      )}

                      <div className="console-login-task-controls">
                        {promptMsg && <p className="text-xs text-foreground/90">{promptMsg}</p>}
                        {phone && (
                          <p className="text-xs text-muted-foreground">
                            {i18n.t("验证手机号：{0}", [phone])}
                          </p>
                        )}
                        {url && (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="console-login-link"
                          >
                            <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                            <span>
                              {task.type === 'slider'
                                ? i18n.t("打开滑块验证页面")
                                : i18n.t("打开验证链接")}
                            </span>
                          </a>
                        )}

                        {needsInput && (
                          <div className="space-y-1.5">
                            <Input
                              value={rawInput}
                              disabled={submitting}
                              onChange={(e) =>
                                setLoginInputs((prev) => ({ ...prev, [task.id]: e.target.value }))
                              }
                              placeholder={i18n.t("输入验证码，或直接粘贴含 ticket 的 JSON / 回调链接…")}
                              aria-label={i18n.t("输入验证码，或直接粘贴含 ticket 的 JSON / 回调链接…")}
                              className="h-8 text-xs"
                            />
                            {extracted.extractedFrom && (
                              <div className="console-login-extracted-hint">
                                <KeyRound className="h-3 w-3 shrink-0" aria-hidden="true" />
                                <span className="truncate">
                                  {i18n.t("已自动提取 Ticket：{0}", [
                                    extracted.value.length > 28
                                      ? `${extracted.value.slice(0, 28)}…`
                                      : extracted.value,
                                  ])}
                                </span>
                              </div>
                            )}
                          </div>
                        )}

                        <div className="flex flex-wrap items-center gap-2 pt-1">
                          {needsInput ? (
                            <Button
                              type="button"
                              size="sm"
                              disabled={submitting || !extracted.value}
                              onClick={() => void handleSubmitLoginTask(task, rawInput)}
                            >
                              {submitting ? i18n.t("提交中…") : i18n.t("提交验证")}
                            </Button>
                          ) : (
                            <Button
                              type="button"
                              size="sm"
                              disabled={submitting}
                              onClick={() => void handleSubmitLoginTask(task, 'ok')}
                            >
                              {task.type === 'qrcode' ? i18n.t("已扫码，继续") : i18n.t("完成验证")}
                            </Button>
                          )}
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            disabled={cancelling || submitting}
                            onClick={() => void handleCancelLoginTask(task)}
                          >
                            {i18n.t("取消")}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </section>
      )}

      {endpoints.length === 0 && (
        <section className="console-onboarding-launcher" aria-label={i18n.t("快速接入平台账号")}>
          <div className="console-onboarding-head">
            <div>
              <h2 className="text-sm font-semibold">{i18n.t("快速接入平台账号")}</h2>
              <p className="text-xs text-muted-foreground">
                {i18n.t("选择常用聊天平台进入适配器控制台，完成账号新增、Token 填写或扫码登录。")}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {ONBOARDING_PLATFORMS.map((platform) => (
              <Link
                key={platform.id}
                to={platform.to}
                className="console-onboarding-card group"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {i18n.t(platform.title)}
                  </span>
                  <span className="console-platform-brand-badge">
                    {i18n.t(platform.badge)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  {i18n.t(platform.desc)}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-foreground/80 group-hover:text-foreground">
                  {i18n.t("前往配置")}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <Dialog open={onboardingOpen && endpoints.length > 0} onOpenChange={setOnboardingOpen}>
        <DialogContent className="max-w-4xl">
          <DialogHeader className="border-b border-[color:var(--console-border-subtle)] pb-3">
            <DialogTitle>{i18n.t("选择要接入的平台")}</DialogTitle>
            <DialogDescription>
              {i18n.t("选择平台后将进入该适配器的专属工作台完成账号配置或扫码登录。")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2 2xl:grid-cols-4">
            {ONBOARDING_PLATFORMS.map((platform) => (
              <Link
                key={platform.id}
                to={platform.to}
                className="console-onboarding-card group"
                onClick={() => setOnboardingOpen(false)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-semibold text-foreground">
                    {i18n.t(platform.title)}
                  </span>
                  <span className="console-platform-brand-badge">
                    {i18n.t(platform.badge)}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground leading-relaxed">
                  {i18n.t(platform.desc)}
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-primary">
                  {i18n.t("前往接入")}
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
              </Link>
            ))}
          </div>
        </DialogContent>
      </Dialog>

      <div className="console-resource-list console-endpoint-list">
        {filteredEndpoints.map((endpoint, index) => {
          const pending = (endpoint.pendingRequestCount ?? 0) + (endpoint.pendingNoticeCount ?? 0)
          const brand = getPlatformBrand(endpoint.adapter)
          const testKey = `${endpoint.adapter}:${endpoint.name}`
          const testState = testResults[testKey]
          const presentation = testState?.result ? endpointTestPresentation(testState.result, i18n.locale) : null
          const hasPendingLogin =
            Boolean(endpoint.pendingLogin) ||
            loginTasks.some((t) => t.adapter === endpoint.adapter && t.endpointKey === endpoint.name)
          const workspaceUrl = `/endpoints/${encodeURIComponent(endpoint.adapter)}/${encodeURIComponent(endpoint.name)}`

          return (
            <div
              key={`${endpoint.adapter}-${endpoint.name}-${index}`}
              className="console-endpoint-card console-endpoint-row group"
            >
              <Link
                to={workspaceUrl}
                className="console-endpoint-main-link"
              >
                <div className="console-endpoint-identity flex items-start gap-3 min-w-0">
                  <span className={endpoint.connected ? 'console-endpoint-avatar is-online' : 'console-endpoint-avatar'} aria-hidden="true">
                    <Bot />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="truncate text-sm font-semibold">{endpoint.name}</span>
                      <span className="console-platform-brand-badge shrink-0">
                        {i18n.t(brand.label)}
                      </span>
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Package className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      <span className="truncate">{endpoint.adapter}</span>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    <Badge variant={endpoint.connected ? 'success' : hasPendingLogin ? 'warning' : 'secondary'} className="shrink-0">
                      {endpoint.connected ? (
                        <><Wifi className="w-3 h-3 mr-1" />{i18n.t("在线")}</>
                      ) : hasPendingLogin ? (
                        <><QrCode className="w-3 h-3 mr-1" />{i18n.t("等待登录")}</>
                      ) : (
                        <><WifiOff className="w-3 h-3 mr-1" />{i18n.t("离线")}</>
                      )}
                    </Badge>
                  </div>
                </div>

                <dl className="console-endpoint-facts">
                  <div>
                    <dt><Activity aria-hidden="true" />{i18n.t("运行状态")}</dt>
                    <dd className={endpoint.status === 'online' ? 'is-good' : undefined}>
                      {i18n.t(endpointLifecycleLabel(endpoint))}
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
                      {pending} {i18n.t(" 条待处理")}
                    </span>
                  ) : (
                    <span>{i18n.t("暂无待处理")}</span>
                  )}
                  <span className="console-endpoint-open">
                    {i18n.t("点击进入管理")}
                    <ChevronRight aria-hidden="true" />
                  </span>
                </div>
              </Link>

              <div className="console-endpoint-actions">
                {presentation && !testState?.loading && (
                  <span
                    role={presentation.role}
                    className={
                      presentation.tone === 'success'
                        ? 'console-endpoint-test-pill is-ok'
                        : 'console-endpoint-test-pill is-error'
                    }
                    title={`${presentation.label}${presentation.detail ? ` · ${presentation.detail}` : ''}`}
                  >
                    {presentation.tone === 'success' ? (
                      <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                    ) : (
                      <XCircle className="h-3 w-3 shrink-0" aria-hidden="true" />
                    )}
                    {presentation.tone === 'success' && !presentation.latencyText ? (
                      <span>{presentation.label}</span>
                    ) : (
                      <>
                        <span className="sr-only">{presentation.label}{': '}</span>
                        <span>{presentation.tone === 'success' ? presentation.latencyText : presentation.reason}</span>
                      </>
                    )}
                  </span>
                )}

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 px-2.5 text-xs"
                  disabled={Boolean(testState?.loading)}
                  onClick={() => void handleTestEndpoint(endpoint)}
                >
                  <Zap className="h-3 w-3 mr-1" aria-hidden="true" />
                  {testState?.loading ? i18n.t("测试中…") : i18n.t("测试连接")}
                </Button>

                <Link
                  to={brand.route}
                  className="console-endpoint-action-link"
                >
                  <SlidersHorizontal className="h-3 w-3" aria-hidden="true" />
                  <span>{i18n.t("平台账号管理")}</span>
                </Link>

                <Link
                  to={workspaceUrl}
                  className="console-endpoint-action-link is-primary"
                >
                  <MessageSquare className="h-3 w-3" aria-hidden="true" />
                  <span>{i18n.t("进入会话")}</span>
                </Link>
              </div>
            </div>
          )
        })}

        {endpoints.length > 0 && (
          <button
            type="button"
            className="console-endpoint-card console-endpoint-card--add"
            onClick={() => setOnboardingOpen(true)}
          >
            <span className="console-endpoint-add-icon" aria-hidden="true">+</span>
            <span className="text-sm font-semibold text-foreground">{i18n.t("接入新平台账号")}</span>
            <span className="text-xs text-muted-foreground text-center max-w-[16rem]">
              {i18n.t("选择 QQ、Telegram、Discord、飞书、OneBot 等平台新增机器人实例")}
            </span>
          </button>
        )}
      </div>

      {endpoints.length > 0 && filteredEndpoints.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center">
            <p className="text-sm font-medium">{i18n.t("没有符合筛选条件的聊天账号")}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setStatusFilter('all')
                setAdapterFilter('all')
                setSearchQuery('')
              }}
            >
              {i18n.t("清除筛选")}
            </Button>
          </CardContent>
        </Card>
      )}

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
