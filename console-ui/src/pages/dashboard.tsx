import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { readErrorSummary } from '../utils/read-error.mjs'
import { logPayloadAvailability } from './logs/read-state.mjs'
import { summarizeOptional } from './dashboard-health'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  Bot,
  Brain,
  CheckCircle2,
  Command,
  Cpu,
  FileText,
  MemoryStick,
  Package,
  Radio,
  RefreshCw,
  RotateCw,
  Server,
  Settings2,
  Sparkles,
  Workflow,
  Wrench,
} from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { CONSOLE_REST, CONSOLE_RPC } from '../contracts/zhin-console'
import { requestConsole } from '../utils/console-rpc'
import { isDemoMode } from '../utils/demo-mode'
import { useToast } from '../components/toast'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog'

interface Stats {
  plugins: { total: number; active: number }
  endpoints: { total: number; online: number }
  commands: number
  uptime: number
  memory: number
}

interface SystemStatus {
  uptime: number
  memory: { rss: number; heapTotal: number; heapUsed: number; external: number }
  cpu: { user: number; system: number }
  platform: string
  nodeVersion: string
}

interface OptionalOverview {
  logReadError: string | null
  errorLogs: number | null
  warningLogs: number | null
  agentStatus: 'unknown' | 'unavailable' | 'available'
  tools: number | null
  agents: number | null
  mcpServices: number | null
  connectedMcp: number | null
}

interface IntrospectionEnvelope {
  total?: number
  items?: Array<Record<string, unknown>>
}

interface CapabilityItem {
  label: string
  value: number | null
  detail: string
  icon: LucideIcon
  path: string
}

interface AttentionItem {
  title: string
  detail: string
  path: string
  tone: 'warning' | 'danger' | 'neutral'
}

const EMPTY_OPTIONAL: OptionalOverview = {
  logReadError: null,
  errorLogs: null,
  warningLogs: null,
  agentStatus: 'unknown',
  tools: null,
  agents: null,
  mcpServices: null,
  connectedMcp: null,
}

const DASHBOARD_REQUEST_TIMEOUT_MS = 8_000

async function fetchOptionalData(path: string, signal: AbortSignal): Promise<unknown | null> {
  try {
    const response = await apiFetch(path, { signal })
    if (!response.ok) return null
    const body = await response.json()
    return body?.success === false ? null : body?.data ?? null
  } catch {
    return null
  }
}

async function fetchLogOverview(signal: AbortSignal, locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<{ data: unknown | null; error: string | null }> {
  try {
    const response = await apiFetch(CONSOLE_REST.LOGS_STATS, { signal })
    if (!response.ok) return { data: null, error: readErrorSummary(`HTTP ${response.status}`, translate(locale, "日志统计"), locale) }
    const body = await response.json()
    if (body?.success !== true) return { data: null, error: readErrorSummary(body?.error, translate(locale, "日志统计"), locale) }
    const availability = logPayloadAvailability(body, locale)
    return availability.available ? { data: body.data ?? null, error: null } : { data: null, error: availability.message }
  } catch (cause) {
    return { data: null, error: readErrorSummary(cause instanceof Error ? cause.message : cause, translate(locale, "日志统计"), locale) }
  }
}

function readTotal(value: unknown): number | null {
  if (!value || typeof value !== 'object') return null
  const total = (value as IntrospectionEnvelope).total
  return typeof total === 'number' ? total : null
}

function readMcpSummary(value: unknown): { total: number | null; connected: number | null } {
  if (!value || typeof value !== 'object') return { total: null, connected: null }
  const envelope = value as IntrospectionEnvelope
  const rows = Array.isArray(envelope.items) ? envelope.items : []
  return {
    total: typeof envelope.total === 'number' ? envelope.total : null,
    connected: rows.length ? rows.filter((row) => row.connected === true).length : 0,
  }
}

function formatUptime(seconds: number, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return translate(locale, "{0} 天 {1} 小时", [days, hours])
  if (hours > 0) return translate(locale, "{0} 小时 {1} 分钟", [hours, minutes])
  return translate(locale, "{0} 分钟", [Math.max(minutes, 1)])
}

function formatMemory(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

export default function HomePage() {
  const i18n = useI18n()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [optional, setOptional] = useState<OptionalOverview>(EMPTY_OPTIONAL)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [restartDialogOpen, setRestartDialogOpen] = useState(false)
  const [restarting, setRestarting] = useState(false)
  const requestRef = useRef(0)
  const requestAbortRef = useRef<AbortController | null>(null)
  const readOnly = isDemoMode()
  const { success, error: toastError } = useToast()

  const fetchDashboard = useCallback(async (background = false) => {
    requestAbortRef.current?.abort()
    const controller = new AbortController()
    requestAbortRef.current = controller
    const requestId = ++requestRef.current
    if (background) setRefreshing(true)
    try {
      const signal = AbortSignal.any([
        controller.signal,
        AbortSignal.timeout(DASHBOARD_REQUEST_TIMEOUT_MS),
      ])
      const [statsResponse, statusResponse, logs, tools, agents, mcp] = await Promise.all([
        apiFetch(CONSOLE_REST.STATS, { signal }),
        apiFetch(CONSOLE_REST.SYSTEM_STATUS, { signal }),
        fetchLogOverview(signal, i18n.locale),
        fetchOptionalData(`${CONSOLE_REST.INTROSPECTION}/tools?page=1&pageSize=1`, signal),
        fetchOptionalData(`${CONSOLE_REST.INTROSPECTION}/bindings?page=1&pageSize=1`, signal),
        fetchOptionalData(`${CONSOLE_REST.INTROSPECTION}/mcp?page=1&pageSize=100`, signal),
      ])
      if (requestId !== requestRef.current) return
      if (!statsResponse.ok || !statusResponse.ok) throw new Error(i18n.t("无法读取 Host 状态"))

      const [statsBody, statusBody] = await Promise.all([
        statsResponse.json(),
        statusResponse.json(),
      ])
      if (!statsBody.success || !statusBody.success) throw new Error(i18n.t("Host 返回了无效状态"))

      setStats(statsBody.data)
      setSystemStatus(statusBody.data)
      setError(null)

      const optionalSummary = summarizeOptional(logs.data, agents)
      const mcpSummary = readMcpSummary(mcp)
      setOptional({
        ...optionalSummary,
        logReadError: logs.error,
        tools: readTotal(tools),
        agents: readTotal(agents),
        mcpServices: mcpSummary.total,
        connectedMcp: mcpSummary.connected,
      })
      setLastUpdatedAt(Date.now())
    } catch (caught) {
      if (requestId !== requestRef.current || controller.signal.aborted) return
      const reason = caught as Error
      setStats(null)
      setSystemStatus(null)
      setOptional(EMPTY_OPTIONAL)
      setError(reason.name === 'TimeoutError' ? i18n.t("Host 响应超时，请检查连接或服务状态") : reason.message)
    } finally {
      if (requestId !== requestRef.current) return
      setLoading(false)
      setRefreshing(false)
    }
  }, [i18n])

  useEffect(() => {
    void fetchDashboard()
    const interval = window.setInterval(() => void fetchDashboard(), 10000)
    return () => {
      requestAbortRef.current?.abort()
      window.clearInterval(interval)
    }
  }, [fetchDashboard])

  const offlineEndpoints = Math.max(
    0,
    (stats?.endpoints.total ?? 0) - (stats?.endpoints.online ?? 0),
  )
  const hostAvailable = stats !== null && systemStatus !== null
  const disconnectedMcp = Math.max(0, (optional.mcpServices ?? 0) - (optional.connectedMcp ?? 0))
  const healthy = hostAvailable && offlineEndpoints === 0 && disconnectedMcp === 0 && optional.errorLogs === 0

  const capabilities = useMemo<CapabilityItem[]>(() => [
    {
      label: i18n.t("渠道"),
      value: stats?.endpoints.total ?? null,
      detail: stats ? i18n.t("{0} 个在线连接", [stats.endpoints.online]) : i18n.t("等待 Host 状态"),
      icon: Radio,
      path: '/endpoints',
    },
    {
      label: i18n.t("命令"),
      value: stats?.commands ?? null,
      detail: stats ? i18n.t("可被消息直接调用") : i18n.t("等待 Host 状态"),
      icon: Command,
      path: '/introspection?tab=commands',
    },
    {
      label: 'Agent',
      value: optional.agents,
      detail: optional.agentStatus === 'unavailable' ? i18n.t("未安装或装配 Agent") : optional.agentStatus === 'unknown' ? i18n.t("状态暂时不可读") : optional.agents === 0 ? i18n.t("可选能力：需要 AI 时安装并配置 Agent") : i18n.t("模型与会话绑定"),
      icon: Brain,
      path: '/agent/workbench',
    },
    {
      label: i18n.t("工具"),
      value: optional.tools,
      detail: optional.tools === null ? i18n.t("安装 Agent 后可用") : i18n.t("供 Agent 按需调用"),
      icon: Wrench,
      path: '/introspection?tab=tools',
    },
    {
      label: i18n.t("MCP 服务"),
      value: optional.mcpServices,
      detail: optional.mcpServices === null
        ? i18n.t("未启用或尚未接线")
        : disconnectedMcp > 0 ? i18n.t("{0} 个未连接", [disconnectedMcp]) : i18n.t("{0} 个连接正常", [optional.connectedMcp ?? 0]),
      icon: Server,
      path: '/introspection?tab=mcp',
    },
    {
      label: i18n.t("子插件"),
      value: stats?.plugins.total ?? null,
      detail: stats ? i18n.t("{0} 个子插件正在运行", [stats.plugins.active]) : i18n.t("等待 Host 状态"),
      icon: Package,
      path: '/plugins',
    },
  ], [optional, stats, i18n])

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    if (!stats && error) {
      return [{
        title: i18n.t("Host 暂时不可达"),
        detail: i18n.t("控制面仍可继续使用；恢复连接后会自动刷新运行状态。"),
        path: '/logs',
        tone: 'danger',
      }]
    }
    if ((stats?.endpoints.total ?? 0) === 0) {
      items.push({
        title: i18n.t("还没有连接渠道"),
        detail: i18n.t("先用 Sandbox 验证，再接入真实平台。"),
        path: '/endpoints',
        tone: 'neutral',
      })
    } else if (offlineEndpoints > 0) {
      items.push({
        title: i18n.t("{0} 个渠道离线", [offlineEndpoints]),
        detail: i18n.t("检查凭据、网络和适配器日志。"),
        path: '/endpoints',
        tone: 'warning',
      })
    }
    if (disconnectedMcp > 0) {
      items.push({
        title: i18n.t("{0} 个 MCP 服务未连接", [disconnectedMcp]),
        detail: i18n.t("Agent 暂时无法调用这些服务提供的工具。"),
        path: '/introspection?tab=mcp',
        tone: 'warning',
      })
    }
    if ((optional.errorLogs ?? 0) > 0) {
      items.push({
        title: i18n.t("历史错误 {0} 条", [optional.errorLogs]),
        detail: i18n.t("打开错误日志"),
        path: '/logs?level=error',
        tone: 'danger',
      })
    }
    if ((optional.warningLogs ?? 0) > 0) {
      items.push({
        title: i18n.t("历史警告 {0} 条", [optional.warningLogs]),
        detail: i18n.t("打开警告日志"),
        path: '/logs?level=warn',
        tone: 'warning',
      })
    }
    if (optional.errorLogs === null) {
      items.push({ title: i18n.t("日志状态暂时不可读"), detail: optional.logReadError ?? i18n.t("尚无法确认是否有运行错误，请打开日志页检查读取详情。"), path: '/logs', tone: 'warning' })
    }
    return items.slice(0, 4)
  }, [error, offlineEndpoints, disconnectedMcp, optional, stats, i18n])

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await requestConsole({ type: CONSOLE_RPC.SYSTEM_RESTART })
      success(i18n.t("重启请求已发送，连接将在服务恢复后自动重连"))
    } catch {
      toastError(i18n.t("重启请求未能发送"))
    }
    window.setTimeout(() => window.location.reload(), 3000)
  }

  if (loading) {
    return (
      <div className="console-dashboard space-y-5" aria-label={i18n.t("正在加载工作台")}>
        <Skeleton className="h-72 rounded-[1.75rem]" />
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.5fr)_minmax(18rem,0.7fr)]">
          <Skeleton className="h-96 rounded-[1.4rem]" />
          <Skeleton className="h-96 rounded-[1.4rem]" />
        </div>
      </div>
    )
  }

  return (
    <div className="console-dashboard space-y-5">
      <section className="console-dashboard-hero" aria-labelledby="dashboard-title">
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0 max-w-3xl">
              <div className={healthy ? 'console-health-pill' : 'console-health-pill is-warning'}>
                <span className={healthy ? 'console-status-dot' : 'console-status-dot is-warning'} />
                {!hostAvailable ? i18n.t("Host 连接需要恢复") : healthy ? i18n.t("所有核心服务运行正常") : i18n.t("有事项需要处理")}
              </div>
              <h1 id="dashboard-title" className="console-dashboard-title">
                {!hostAvailable
                  ? <>{i18n.t("Host 暂时不可达，")}{i18n.t("控制面仍可继续使用")}</>
                  : i18n.t("运行概览")}
              </h1>
              <p className="console-dashboard-lede">
                {!hostAvailable
                  ? i18n.t("页面导航、配置入口和能力目录保持可用。重新连接后，渠道、Agent 与运行状态会在这里恢复。")
                  : i18n.t("这里优先汇总需要处理的渠道、日志和 Agent 状态，再提供能力目录与下一步操作。")}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hostAvailable ? (
                <Button onClick={() => navigate('/endpoints')}>
                  <Bot className="h-4 w-4" />
                  {i18n.t("进入会话")}<ArrowUpRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => void fetchDashboard(true)} disabled={refreshing}>
                  <RefreshCw className={refreshing ? 'animate-spin' : ''} />
                  {i18n.t("重新连接")}</Button>
              )}
              {hostAvailable ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void fetchDashboard(true)}
                  disabled={refreshing}
                  aria-label={i18n.t("刷新工作台")}
                >
                  <RefreshCw className={refreshing ? 'animate-spin' : ''} />
                </Button>
              ) : null}
              {!readOnly ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRestartDialogOpen(true)}
                  aria-label={i18n.t("重启服务")}
                >
                  <RotateCw />
                </Button>
              ) : null}
            </div>
          </div>

          <div className="console-dashboard-metrics">
            <div className="console-dashboard-metric">
              <span>{i18n.t("在线渠道")}</span>
              <strong>{stats ? stats.endpoints.online : '—'}{stats ? <small> / {stats.endpoints.total}</small> : null}</strong>
            </div>
            <div className="console-dashboard-metric">
              <span>{i18n.t("运行子插件")}</span>
              <strong>{stats ? stats.plugins.active : '—'}{stats ? <small> / {stats.plugins.total}</small> : null}</strong>
            </div>
            <div className="console-dashboard-metric">
              <span>{i18n.t("可用命令")}</span>
              <strong>{stats?.commands ?? '—'}</strong>
            </div>
            <div className="console-dashboard-metric">
              <span>{i18n.t("持续运行")}</span>
              <strong className="text-base sm:text-lg">{systemStatus ? formatUptime(systemStatus.uptime, i18n.locale) : '—'}</strong>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {stats ? i18n.t("部分状态未能更新") : i18n.t("运行状态当前不可用")}：{error}
            {lastUpdatedAt ? i18n.t(" · 上次更新 {0}", [new Date(lastUpdatedAt).toLocaleTimeString(i18n.locale)]) : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(19rem,0.7fr)_minmax(0,1.45fr)]">
        <aside className="console-dashboard-panel console-attention-panel" aria-labelledby="attention-title">
          <div className="console-panel-heading">
            <div>

              <h2 id="attention-title">{i18n.t("状态与日志")}</h2>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{attentionItems.length} {i18n.t(" 项")}</span>
          </div>

          {attentionItems.length === 0 ? (
            <div className="console-all-clear">
              <CheckCircle2 />
              <div>
                <h3>{i18n.t("渠道在线")}</h3>
                <p>{i18n.t("暂无警告或错误日志")}</p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {attentionItems.map((item) => (
                <button
                  key={item.title}
                  type="button"
                  className={`console-attention-item is-${item.tone}`}
                  onClick={() => navigate(item.path)}
                >
                  {item.tone === 'neutral' ? <Sparkles /> : <AlertTriangle />}
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-semibold">{item.title}</span>
                    <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.detail}</span>
                  </span>
                  <ArrowUpRight />
                </button>
              ))}
            </div>
          )}

          <div className="console-runtime-strip">
            <div>
              <Cpu />
              <span>{systemStatus?.platform ?? '—'} · Node {systemStatus?.nodeVersion ?? '—'}</span>
            </div>
            <div>
              <MemoryStick />
              <span>{systemStatus ? `${formatMemory(systemStatus.memory.rss)} RSS` : i18n.t("等待运行状态")}</span>
            </div>
          </div>
        </aside>

        <section className="console-dashboard-panel" aria-labelledby="capability-title">
          <div className="console-panel-heading">
            <div>

              <h2 id="capability-title">{i18n.t("当前实例的能力")}</h2>

            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/introspection')}>
              {i18n.t("打开能力中心")}<ArrowUpRight />
            </Button>
          </div>

          <div className="console-capability-grid">
            {capabilities.map((capability) => {
              const Icon = capability.icon
              return (
                <button
                  key={capability.label}
                  type="button"
                  className="console-capability-item"
                  onClick={() => navigate(capability.path)}
                >
                  <span className="console-capability-icon"><Icon /></span>
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-semibold">{capability.label}</span>
                    <span className="mt-1 block truncate text-xs text-muted-foreground">{capability.detail}</span>
                  </span>
                  <strong>{capability.value ?? '—'}</strong>
                </button>
              )
            })}
          </div>
        </section>
      </div>

      <section className="console-dashboard-panel" aria-labelledby="next-title">
        <div className="console-panel-heading">
          <div>

            <h2 id="next-title">{i18n.t("常用操作")}</h2>

          </div>
        </div>

        <div className="console-action-grid">
          <button type="button" className="console-primary-action" onClick={() => navigate('/endpoints')}>
            <span className="console-primary-action-icon"><Bot /></span>
            <span className="min-w-0 text-left">
              <span className="block text-base font-semibold">{i18n.t("连接和管理会话")}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{i18n.t("查看好友、群组、统一收件箱并直接收发消息。")}</span>
            </span>
            <ArrowUpRight />
          </button>

          <div className="console-secondary-actions">
            <button type="button" onClick={() => navigate('/agent/workrooms')}>
              <span><Workflow />{i18n.t("查看 Workroom 任务")}</span>
              <ArrowUpRight />
            </button>
            <button type="button" onClick={() => navigate('/marketplace')}>
              <span><Package />{i18n.t("从市场添加能力")}</span>
              <ArrowUpRight />
            </button>
            <button type="button" onClick={() => navigate('/config')}>
              <span><Settings2 />{i18n.t("调整运行配置")}</span>
              <ArrowUpRight />
            </button>
            <button type="button" onClick={() => navigate('/logs')}>
              <span><FileText />{i18n.t("检查运行记录")}</span>
              <ArrowUpRight />
            </button>
          </div>
        </div>
      </section>

      {!readOnly && <Dialog open={restartDialogOpen} onOpenChange={setRestartDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18n.t("重启 Zhin 服务")}</DialogTitle>
            <DialogDescription>
              {i18n.t("所有连接将断开，进行中的对话可能被中止。通过 zhin runtime start 启动的前台和 daemon 服务会自动重新启动；--once 模式不会自动恢复。若使用自定义启动器，请确认其重启机制。")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">{i18n.t("取消")}</Button>
            </DialogClose>
            <Button
              variant="destructive"
              onClick={() => {
                setRestartDialogOpen(false)
                void handleRestart()
              }}
              disabled={restarting}
            >
              {restarting ? <RotateCw className="animate-spin" /> : <RotateCw />}
              {restarting ? i18n.t("正在重启") : i18n.t("确认重启")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  )
}
