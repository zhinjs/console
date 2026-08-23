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
  errorLogs: number
  warningLogs: number
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
  errorLogs: 0,
  warningLogs: 0,
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

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (days > 0) return `${days} 天 ${hours} 小时`
  if (hours > 0) return `${hours} 小时 ${minutes} 分钟`
  return `${Math.max(minutes, 1)} 分钟`
}

function formatMemory(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—'
  return `${(bytes / 1024 / 1024).toFixed(0)} MB`
}

export default function HomePage() {
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
        fetchOptionalData(CONSOLE_REST.LOGS_STATS, signal),
        fetchOptionalData(`${CONSOLE_REST.INTROSPECTION}/tools?page=1&pageSize=1`, signal),
        fetchOptionalData(`${CONSOLE_REST.INTROSPECTION}/bindings?page=1&pageSize=1`, signal),
        fetchOptionalData(`${CONSOLE_REST.INTROSPECTION}/mcp?page=1&pageSize=100`, signal),
      ])
      if (requestId !== requestRef.current) return
      if (!statsResponse.ok || !statusResponse.ok) throw new Error('无法读取 Host 状态')

      const [statsBody, statusBody] = await Promise.all([
        statsResponse.json(),
        statusResponse.json(),
      ])
      if (!statsBody.success || !statusBody.success) throw new Error('Host 返回了无效状态')

      setStats(statsBody.data)
      setSystemStatus(statusBody.data)
      setError(null)

      const logStats = logs as { byLevel?: { error?: number; warn?: number } } | null
      const mcpSummary = readMcpSummary(mcp)
      setOptional({
        errorLogs: logStats?.byLevel?.error ?? 0,
        warningLogs: logStats?.byLevel?.warn ?? 0,
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
      setError(reason.name === 'TimeoutError' ? 'Host 响应超时，请检查连接或服务状态' : reason.message)
    } finally {
      if (requestId !== requestRef.current) return
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

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
  const healthy = hostAvailable && offlineEndpoints === 0 && optional.errorLogs === 0

  const capabilities = useMemo<CapabilityItem[]>(() => [
    {
      label: '渠道',
      value: stats?.endpoints.total ?? null,
      detail: stats ? `${stats.endpoints.online} 个在线连接` : '等待 Host 状态',
      icon: Radio,
      path: '/endpoints',
    },
    {
      label: '命令',
      value: stats?.commands ?? null,
      detail: stats ? '可被消息直接调用' : '等待 Host 状态',
      icon: Command,
      path: '/introspection?tab=commands',
    },
    {
      label: 'Agent',
      value: optional.agents,
      detail: optional.agents === null ? '未启用或尚未接线' : '模型与会话绑定',
      icon: Brain,
      path: '/agent/workbench',
    },
    {
      label: '工具',
      value: optional.tools,
      detail: optional.tools === null ? '安装 Agent 后可用' : '供 Agent 按需调用',
      icon: Wrench,
      path: '/introspection?tab=tools',
    },
    {
      label: 'MCP 服务',
      value: optional.mcpServices,
      detail: optional.mcpServices === null
        ? '未启用或尚未接线'
        : `${optional.connectedMcp ?? 0} 个连接正常`,
      icon: Server,
      path: '/introspection?tab=mcp',
    },
    {
      label: '插件',
      value: stats?.plugins.total ?? null,
      detail: stats ? `${stats.plugins.active} 个正在运行` : '等待 Host 状态',
      icon: Package,
      path: '/plugins',
    },
  ], [optional, stats])

  const attentionItems = useMemo<AttentionItem[]>(() => {
    const items: AttentionItem[] = []
    if (!stats && error) {
      return [{
        title: 'Host 暂时不可达',
        detail: '控制面仍可继续使用；恢复连接后会自动刷新运行状态。',
        path: '/logs',
        tone: 'danger',
      }]
    }
    if ((stats?.endpoints.total ?? 0) === 0) {
      items.push({
        title: '还没有连接渠道',
        detail: '先用 Sandbox 验证，再接入真实平台。',
        path: '/endpoints',
        tone: 'neutral',
      })
    } else if (offlineEndpoints > 0) {
      items.push({
        title: `${offlineEndpoints} 个渠道离线`,
        detail: '检查凭据、网络和适配器日志。',
        path: '/endpoints',
        tone: 'warning',
      })
    }
    if (optional.errorLogs > 0) {
      items.push({
        title: `${optional.errorLogs} 条错误日志`,
        detail: '查看最近错误并定位受影响的能力。',
        path: '/logs',
        tone: 'danger',
      })
    }
    if (optional.warningLogs > 0) {
      items.push({
        title: `${optional.warningLogs} 条运行警告`,
        detail: '这些问题尚未中断服务，但值得检查。',
        path: '/logs',
        tone: 'warning',
      })
    }
    if (optional.agents === 0) {
      items.push({
        title: '尚未配置 Agent',
        detail: '配置模型和 Agent 后即可使用工具与记忆。',
        path: '/config',
        tone: 'neutral',
      })
    }
    return items.slice(0, 4)
  }, [error, offlineEndpoints, optional, stats])

  const handleRestart = async () => {
    setRestarting(true)
    try {
      await requestConsole({ type: CONSOLE_RPC.SYSTEM_RESTART })
      success('服务正在重启')
    } catch {
      toastError('重启请求未能发送')
    }
    window.setTimeout(() => window.location.reload(), 3000)
  }

  if (loading) {
    return (
      <div className="console-dashboard space-y-5" aria-label="正在加载工作台">
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
        <div className="console-dashboard-glow" aria-hidden="true" />
        <div className="relative z-10 flex flex-col gap-7">
          <div className="flex flex-col gap-6 xl:flex-row xl:items-start xl:justify-between">
            <div className="max-w-3xl">
              <div className="mb-4 flex items-center gap-2 text-sm font-medium text-primary">
                <span className={healthy ? 'console-status-dot' : 'console-status-dot is-warning'} />
                {!hostAvailable ? 'Host 连接需要恢复' : healthy ? '所有核心服务运行正常' : '有事项需要处理'}
              </div>
              <h1 id="dashboard-title" className="text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl xl:text-[2.8rem] xl:leading-[1.05]">
                {!hostAvailable
                  ? <>Host 暂时不可达，<br className="hidden sm:block" />控制面仍可继续使用</>
                  : <>先处理重要状态，<br className="hidden sm:block" />再进入正在进行的工作</>}
              </h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-muted-foreground sm:text-base">
                {!hostAvailable
                  ? '页面导航、配置入口和能力目录保持可用。重新连接后，渠道、Agent 与运行状态会在这里恢复。'
                  : '这里优先汇总需要处理的渠道、日志和 Agent 状态，再提供能力目录与下一步操作。'}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {hostAvailable ? (
                <Button onClick={() => navigate('/endpoints')}>
                  <Bot className="h-4 w-4" />
                  进入会话
                  <ArrowUpRight className="h-4 w-4" />
                </Button>
              ) : (
                <Button onClick={() => void fetchDashboard(true)} disabled={refreshing}>
                  <RefreshCw className={refreshing ? 'animate-spin' : ''} />
                  重新连接
                </Button>
              )}
              {hostAvailable ? (
                <Button
                  variant="outline"
                  size="icon"
                  onClick={() => void fetchDashboard(true)}
                  disabled={refreshing}
                  aria-label="刷新工作台"
                >
                  <RefreshCw className={refreshing ? 'animate-spin' : ''} />
                </Button>
              ) : null}
              {!readOnly ? (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => setRestartDialogOpen(true)}
                  aria-label="重启服务"
                >
                  <RotateCw />
                </Button>
              ) : null}
            </div>
          </div>

          <div className="console-dashboard-metrics">
            <div className="console-dashboard-metric">
              <span>在线渠道</span>
              <strong>{stats ? stats.endpoints.online : '—'}{stats ? <small> / {stats.endpoints.total}</small> : null}</strong>
            </div>
            <div className="console-dashboard-metric">
              <span>运行插件</span>
              <strong>{stats ? stats.plugins.active : '—'}{stats ? <small> / {stats.plugins.total}</small> : null}</strong>
            </div>
            <div className="console-dashboard-metric">
              <span>可用命令</span>
              <strong>{stats?.commands ?? '—'}</strong>
            </div>
            <div className="console-dashboard-metric">
              <span>持续运行</span>
              <strong className="text-base sm:text-lg">{systemStatus ? formatUptime(systemStatus.uptime) : '—'}</strong>
            </div>
          </div>
        </div>
      </section>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {stats ? '部分状态未能更新' : '运行状态当前不可用'}：{error}
            {lastUpdatedAt ? ` · 上次更新 ${new Date(lastUpdatedAt).toLocaleTimeString()}` : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(19rem,0.7fr)_minmax(0,1.45fr)]">
        <aside className="console-dashboard-panel console-attention-panel" aria-labelledby="attention-title">
          <div className="console-panel-heading">
            <div>
              <span className="console-eyebrow">Attention</span>
              <h2 id="attention-title">现在需要处理</h2>
            </div>
            <span className="text-xs tabular-nums text-muted-foreground">{attentionItems.length} 项</span>
          </div>

          {attentionItems.length === 0 ? (
            <div className="console-all-clear">
              <CheckCircle2 />
              <div>
                <h3>运行状态良好</h3>
                <p>目前没有离线渠道或错误日志。</p>
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
              <span>{systemStatus ? `${formatMemory(systemStatus.memory.rss)} RSS` : '等待运行状态'}</span>
            </div>
          </div>
        </aside>

        <section className="console-dashboard-panel" aria-labelledby="capability-title">
          <div className="console-panel-heading">
            <div>
              <span className="console-eyebrow">Capability map</span>
              <h2 id="capability-title">当前实例的能力</h2>
              <p>从渠道接入到 Agent 工具链，按能力进入对应工作区。</p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => navigate('/introspection')}>
              打开能力中心
              <ArrowUpRight />
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
            <span className="console-eyebrow">Next action</span>
            <h2 id="next-title">继续构建你的 Bot</h2>
            <p>从真实操作进入，不必先理解底层模块。</p>
          </div>
        </div>

        <div className="console-action-grid">
          <button type="button" className="console-primary-action" onClick={() => navigate('/endpoints')}>
            <span className="console-primary-action-icon"><Bot /></span>
            <span className="min-w-0 text-left">
              <span className="block text-base font-semibold">连接和管理会话</span>
              <span className="mt-1 block text-sm text-muted-foreground">查看好友、群组、统一收件箱并直接收发消息。</span>
            </span>
            <ArrowUpRight />
          </button>

          <div className="console-secondary-actions">
            <button type="button" onClick={() => navigate('/agent/workrooms')}>
              <span><Workflow />查看 Workroom 任务</span>
              <ArrowUpRight />
            </button>
            <button type="button" onClick={() => navigate('/marketplace')}>
              <span><Package />从市场添加能力</span>
              <ArrowUpRight />
            </button>
            <button type="button" onClick={() => navigate('/config')}>
              <span><Settings2 />调整运行配置</span>
              <ArrowUpRight />
            </button>
            <button type="button" onClick={() => navigate('/logs')}>
              <span><FileText />检查运行记录</span>
              <ArrowUpRight />
            </button>
          </div>
        </div>
      </section>

      {!readOnly && <Dialog open={restartDialogOpen} onOpenChange={setRestartDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>重启 Zhin 服务</DialogTitle>
            <DialogDescription>
              所有连接将短暂断开，进行中的对话也会被中止。守护进程会在几秒内重新拉起服务。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">取消</Button>
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
              {restarting ? '正在重启' : '确认重启'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  )
}
