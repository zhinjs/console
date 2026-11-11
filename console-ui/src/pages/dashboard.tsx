import { startVisiblePolling } from '../hooks/visible-polling.mjs'
import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { readErrorSummary } from '../utils/read-error.mjs'
import { logPayloadAvailability } from './logs/read-state.mjs'
import { summarizeOptional } from './dashboard-health'
import { cpuMeterWidth, cpuUsagePercent, readCpuSample, type CpuSample } from './dashboard-cpu-model.mjs'
import {
  buildMessageFeed,
  hourlyMessageActivity,
  messageRecords,
  replyLatencySeconds,
  summarizeMessages,
  type HourlyActivityBucket,
  type MessageFeedItem,
} from './dashboard-activity-model.mjs'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  AtSign,
  Bot,
  Brain,
  CheckCircle2,
  Clock,
  Command,
  Copy,
  Cpu,
  Eye,
  MessageSquare,
  Package,
  Power,
  Radio,
  RefreshCw,
  Reply,
  Server,
  ShieldAlert,
  Sparkles,
  VolumeX,
  Wrench,
} from 'lucide-react'
import { fetchConsoleEventHistory, SIDE_EVENT_PUSH } from '@zhin.js/client'
import { useConsoleConnected } from '../hooks/use-console-connected'
import { useHostRestart } from '../hooks/use-host-restart'
import { getConsoleTransport } from '../utils/console-client'
import { apiFetch } from '../utils/auth'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { pluginRpc } from '../utils/plugin-rpc'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { useToast } from '../components/toast'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { useConfirm } from '../components/confirm-dialog'
import { ListItemButton } from '../components/ui/list-item-button'
import { MiniRingGauge, StatCard, StatGrid } from '../components/StatCard'
import {
  Sheet,
  SheetBody,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '../components/ui/sheet'
import './dashboard.css'

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
  /** Cumulative `process.cpuUsage()` in microseconds; absent on non-Node hosts. */
  cpu?: { user: number; system: number }
  osMemory?: { freeMem: number; totalMem: number }
  platform: string
  nodeVersion: string
  pid?: number
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

interface RecentLogEvent {
  id: string
  timestamp: string
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  message: string
}

type ControlSwitchKey = 'emergency_stop' | 'muted' | 'read_only' | 'mention_only'

interface ControlState {
  revision: number
  available: boolean
  persistent?: boolean
  instance: Record<ControlSwitchKey, boolean>
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
const DAY_MS = 24 * 60 * 60 * 1000
const MESSAGE_EVENT_LIMIT = 1000
const FEED_LIMIT = 12

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

function parseRecentLogEvents(raw: unknown): RecentLogEvent[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { logs?: unknown[]; items?: unknown[] }).logs)
      ? (raw as { logs: unknown[] }).logs
      : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown[] }).items)
        ? (raw as { items: unknown[] }).items
        : []
  return rows.slice(0, 6).map((item, idx) => {
    const r = (item && typeof item === 'object' ? item : {}) as Record<string, unknown>
    const rawLevel = String(r.level ?? 'info').toLowerCase()
    const level: RecentLogEvent['level'] =
      rawLevel.includes('err') ? 'error' : rawLevel.includes('warn') ? 'warn' : rawLevel.includes('debug') ? 'debug' : 'info'
    const tsRaw = r.timestamp ?? r.time ?? r.createdAt
    let timestamp = '--:--:--'
    if (typeof tsRaw === 'string' || typeof tsRaw === 'number') {
      const d = new Date(tsRaw)
      if (!Number.isNaN(d.getTime())) {
        timestamp = d.toTimeString().slice(0, 8)
      }
    }
    return {
      id: String(r.id ?? `evt-${idx}`),
      timestamp,
      level,
      source: String(r.source ?? r.name ?? r.module ?? 'runtime'),
      message: String(r.message ?? r.msg ?? ''),
    }
  }).filter((item) => item.message.length > 0)
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

function formatClock(timestamp: number): string {
  const date = new Date(timestamp)
  return Number.isNaN(date.getTime()) ? '--:--:--' : date.toTimeString().slice(0, 8)
}

function formatHour(timestamp: number): string {
  return `${String(new Date(timestamp).getHours()).padStart(2, '0')}:00`
}

function formatAgo(timestamp: number, now: number, locale: 'zh-CN' | 'en'): string {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return translate(locale, "刚刚")
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return translate(locale, "{0} 分钟前", [minutes])
  const hours = Math.round(minutes / 60)
  if (hours < 48) return translate(locale, "{0} 小时前", [hours])
  return translate(locale, "{0} 天前", [Math.round(hours / 24)])
}

function percent(part: number, total: number): number | null {
  if (!Number.isFinite(part) || !Number.isFinite(total) || total <= 0) return null
  return Math.min(100, Math.max(0, Math.round((part / total) * 100)))
}

function MessageVolumeChart({ buckets, describe, summary }: {
  buckets: HourlyActivityBucket[]
  describe: (bucket: HourlyActivityBucket) => string
  summary: string
}) {
  const peak = Math.max(1, ...buckets.map((bucket) => bucket.inbound + bucket.outbound))
  const tickIndexes = [0, Math.floor(buckets.length / 2), buckets.length - 1]
  return (
    <div className="console-volume-chart" role="img" aria-label={summary}>
      <div className="console-volume-axis" aria-hidden="true">
        <span>{peak}</span>
        <span>{peak % 2 === 0 ? peak / 2 : ''}</span>
        <span>0</span>
      </div>
      <div className="console-volume-plot" aria-hidden="true">
        <div className="console-volume-bars">
          {buckets.map((bucket) => {
            const total = bucket.inbound + bucket.outbound
            return (
              <div key={bucket.start} className="console-volume-col" title={describe(bucket)}>
                {total > 0 ? (
                  <span className="console-volume-bar" style={{ height: `${Math.max(4, (total / peak) * 100)}%` }}>
                    {bucket.outbound > 0 ? <span className="console-volume-bar-reply" style={{ height: `${(bucket.outbound / total) * 100}%` }} /> : null}
                  </span>
                ) : null}
              </div>
            )
          })}
        </div>
        <div className="console-volume-ticks">
          {tickIndexes.map((index) => <span key={index}>{buckets[index] ? formatHour(buckets[index].start) : ''}</span>)}
        </div>
      </div>
    </div>
  )
}

function MessageFeedRow({ item, kindLabel, t }: {
  item: MessageFeedItem
  kindLabel: string
  t: (message: string, values?: unknown[]) => string
}) {
  const latency = replyLatencySeconds(item)
  const sender = item.sender
    ? item.sender.name && item.sender.id && item.sender.name !== item.sender.id
      ? `${item.sender.name}（${item.sender.id}）`
      : item.sender.name || item.sender.id
    : null
  return (
    <li className="console-message-row">
      <time className="console-message-time" dateTime={new Date(item.timestamp).toISOString()}>{formatClock(item.timestamp)}</time>
      <div className="console-message-body">
        <div className="console-message-meta">
          {item.adapter ? <span className="console-tag">{item.adapter}</span> : null}
          <span className="console-tag is-accent">{kindLabel}</span>
          {item.channelId ? <span className="console-message-channel">{item.channelId}</span> : null}
          {sender ? <span className="console-message-sender">{sender}</span> : null}
          {latency !== null ? <span className="console-message-latency">{latency.toFixed(1)}s</span> : null}
          {item.direction === 'outbound'
            ? <span className="console-tag is-info">{t("主动发送")}</span>
            : item.replies.length > 0
              ? <span className="console-tag is-success">{t("已回复")}</span>
              : <span className="console-tag">{t("未回复")}</span>}
        </div>
        {item.direction === 'inbound'
          ? <p className="console-message-text">{item.text || '—'}</p>
          : <blockquote className="console-message-reply"><span>{item.text || '—'}</span></blockquote>}
        {item.replies.map((reply) => (
          <blockquote key={reply.id} className="console-message-reply"><span>{reply.text || '—'}</span></blockquote>
        ))}
      </div>
    </li>
  )
}

export default function HomePage() {
  const i18n = useI18n()
  const navigate = useNavigate()
  const [stats, setStats] = useState<Stats | null>(null)
  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null)
  const [cpuRate, setCpuRate] = useState<number | null>(null)
  const cpuSampleRef = useRef<CpuSample | null>(null)
  const [optional, setOptional] = useState<OptionalOverview>(EMPTY_OPTIONAL)
  const [recentEvents, setRecentEvents] = useState<RecentLogEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdatedAt, setLastUpdatedAt] = useState<number | null>(null)
  const [controlState, setControlState] = useState<ControlState | null>(null)
  const [controlUpdating, setControlUpdating] = useState<ControlSwitchKey | null>(null)
  const { confirm, ConfirmDialog: ConfirmDialogHost } = useConfirm()
  const { restarting, confirmRestart } = useHostRestart(confirm)
  const requestRef = useRef(0)
  const requestAbortRef = useRef<AbortController | null>(null)
  const readOnly = !hasConsolePermission('agent.configure')
  const { success, error: toastError } = useToast()
  const connected = useConsoleConnected()
  const [messageEvents, setMessageEvents] = useState<unknown[]>([])
  const [messagesLoaded, setMessagesLoaded] = useState(false)
  const messageAbortRef = useRef<AbortController | null>(null)

  const loadMessages = useCallback(async () => {
    messageAbortRef.current?.abort()
    const controller = new AbortController()
    messageAbortRef.current = controller
    try {
      const page = await fetchConsoleEventHistory({ limit: 500 }, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(DASHBOARD_REQUEST_TIMEOUT_MS)]),
      })
      if (controller.signal.aborted) return
      setMessageEvents([...page.items].slice(-MESSAGE_EVENT_LIMIT))
    } catch {
      // History is optional: the live subscription still fills the feed.
    } finally {
      if (!controller.signal.aborted) setMessagesLoaded(true)
    }
  }, [])

  useEffect(() => {
    void loadMessages()
    const manager = getConsoleTransport()
    const offMessage = manager.onConsoleEvent(SIDE_EVENT_PUSH.MESSAGE_RECEIVE, (event) => {
      setMessageEvents((previous) => [...previous, event].slice(-MESSAGE_EVENT_LIMIT))
    })
    const offGap = manager.onConsoleEventRecoveryGap(() => { void loadMessages() })
    return () => {
      offMessage()
      offGap()
      messageAbortRef.current?.abort()
    }
  }, [loadMessages])

  const previewLabels = useMemo(() => ({
    image: i18n.t("[图片]"),
    audio: i18n.t("[语音]"),
    video: i18n.t("[视频]"),
    file: i18n.t("[文件]"),
    sticker: i18n.t("[表情]"),
  }), [i18n])
  const records = useMemo(() => messageRecords(messageEvents, previewLabels), [messageEvents, previewLabels])
  const activityNow = Math.max(lastUpdatedAt ?? 0, records[records.length - 1]?.timestamp ?? 0) || Date.now()
  const activity = useMemo(() => hourlyMessageActivity(records, activityNow, 24), [records, activityNow])
  const messageSummary = useMemo(() => summarizeMessages(records, activityNow - DAY_MS), [records, activityNow])
  const messageFeed = useMemo(() => buildMessageFeed(records, FEED_LIMIT), [records])
  const latestMessageAt = records[records.length - 1]?.timestamp ?? null

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
      const [statsResponse, statusResponse, logs, recentLogsRaw, tools, agents, mcp, control] = await Promise.all([
        apiFetch(CONSOLE_REST.STATS, { signal }),
        apiFetch(CONSOLE_REST.SYSTEM_STATUS, { signal }),
        fetchLogOverview(signal, i18n.locale),
        fetchOptionalData(`${CONSOLE_REST.LOGS}?limit=6`, signal),
        fetchOptionalData(`${CONSOLE_REST.INTROSPECTION}/tools?page=1&pageSize=1`, signal),
        fetchOptionalData(`${CONSOLE_REST.INTROSPECTION}/bindings?page=1&pageSize=1`, signal),
        fetchOptionalData(`${CONSOLE_REST.INTROSPECTION}/mcp?page=1&pageSize=100`, signal),
        readOnly ? Promise.resolve(null) : pluginRpc<ControlState>('root', 'control', undefined, { signal }).catch(() => null),
      ])
      if (requestId !== requestRef.current || controller.signal.aborted) return
      if (!statsResponse.ok || !statusResponse.ok) throw new Error(i18n.t("无法读取 Host 状态"))

      const [statsBody, statusBody] = await Promise.all([
        statsResponse.json(),
        statusResponse.json(),
      ])
      if (requestId !== requestRef.current || controller.signal.aborted) return
      if (!statsBody.success || !statusBody.success) throw new Error(i18n.t("Host 返回了无效状态"))

      setStats(statsBody.data)
      setSystemStatus(statusBody.data)
      const cpuSample = readCpuSample(statusBody.data)
      setCpuRate(cpuUsagePercent(cpuSampleRef.current, cpuSample))
      cpuSampleRef.current = cpuSample
      setError(null)
      setControlState(control && typeof control === 'object' && control.available ? control : null)
      setRecentEvents(parseRecentLogEvents(recentLogsRaw))

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
      setCpuRate(null)
      cpuSampleRef.current = null
      setOptional(EMPTY_OPTIONAL)
      setControlState(null)
      setError(reason.name === 'TimeoutError' ? i18n.t("Host 响应超时，请检查连接或服务状态") : reason.message)
    } finally {
      if (requestId !== requestRef.current) return
      setLoading(false)
      setRefreshing(false)
    }
  }, [i18n, readOnly])

  useEffect(() => {
    void fetchDashboard()
    const stopPolling = startVisiblePolling(() => void fetchDashboard(), 10000)
    return () => {
      requestAbortRef.current?.abort()
      stopPolling()
    }
  }, [fetchDashboard])

  const offlineEndpoints = Math.max(
    0,
    (stats?.endpoints.total ?? 0) - (stats?.endpoints.online ?? 0),
  )
  const hostAvailable = stats !== null && systemStatus !== null
  const disconnectedMcp = Math.max(0, (optional.mcpServices ?? 0) - (optional.connectedMcp ?? 0))
  const healthy = hostAvailable && offlineEndpoints === 0 && disconnectedMcp === 0 && optional.errorLogs === 0

  const endpointRate = stats && stats.endpoints.total > 0
    ? Math.min(100, Math.max(0, Math.round((stats.endpoints.online / stats.endpoints.total) * 100)))
    : null

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
  ], [optional, stats, i18n, disconnectedMcp])

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

  const displayEvents = useMemo<RecentLogEvent[]>(() => {
    if (recentEvents.length > 0) return recentEvents
    if (!stats || !systemStatus) return []
    const nowTime = new Date(lastUpdatedAt ?? Date.now()).toTimeString().slice(0, 8)
    return [
      {
        id: 'synth-1',
        timestamp: nowTime,
        level: offlineEndpoints > 0 ? 'warn' : 'info',
        source: 'adapter-host',
        message: i18n.t("{0}/{1} 个平台账号在线，已加载 {2} 个子插件与 {3} 条命令", [stats.endpoints.online, stats.endpoints.total, stats.plugins.active, stats.commands]),
      },
      {
        id: 'synth-2',
        timestamp: nowTime,
        level: 'info',
        source: 'runtime',
        message: i18n.t("Node {0} ({1}) 持续运行 {2} · RSS {3}", [systemStatus.nodeVersion, systemStatus.platform, formatUptime(systemStatus.uptime, i18n.locale), formatMemory(systemStatus.memory.rss)]),
      },
    ]
  }, [recentEvents, stats, systemStatus, lastUpdatedAt, offlineEndpoints, i18n.locale])

  const handleToggleControl = async (key: ControlSwitchKey) => {
    if (!controlState?.available || readOnly || controlUpdating) return
    const currentValue = Boolean(controlState.instance?.[key])
    setControlUpdating(key)
    try {
      const updated = await pluginRpc<ControlState>('root', 'control-set', {
        expectedRevision: controlState.revision,
        instance: { [key]: !currentValue },
      })
      if (updated && typeof updated === 'object' && updated.instance) {
        setControlState(updated)
      } else {
        setControlState((prev) =>
          prev
            ? {
                ...prev,
                revision: prev.revision + 1,
                instance: { ...prev.instance, [key]: !currentValue },
              }
            : prev,
        )
      }
      success(i18n.t("已更新 AI 运行控制开关"))
    } catch (err) {
      toastError(err instanceof Error ? err.message : i18n.t("更新 AI 运行控制开关失败"))
      try {
        const fresh = await pluginRpc<ControlState>('root', 'control')
        if (fresh && typeof fresh === 'object' && fresh.available) setControlState(fresh)
      } catch {
        // ignore
      }
    } finally {
      setControlUpdating(null)
    }
  }

  const controlSwitches: Array<{ key: ControlSwitchKey; label: string; icon: LucideIcon; danger?: boolean }> = [
    { key: 'emergency_stop', label: i18n.t("紧急停机"), icon: ShieldAlert, danger: true },
    { key: 'muted', label: i18n.t("全局静默"), icon: VolumeX },
    { key: 'read_only', label: i18n.t("只读观察"), icon: Eye },
    { key: 'mention_only', label: i18n.t("仅提及响应"), icon: AtSign },
  ]


  const [selectedEvent, setSelectedEvent] = useState<RecentLogEvent | null>(null)
  const eventCounts = useMemo(() => {
    const counts = { info: 0, warn: 0, error: 0 }
    for (const evt of displayEvents) {
      if (evt.level === 'error') counts.error += 1
      else if (evt.level === 'warn') counts.warn += 1
      else counts.info += 1
    }
    return counts
  }, [displayEvents])

  const replyRate = percent(messageSummary.outbound, messageSummary.inbound)
  const heapRate = systemStatus ? percent(systemStatus.memory.heapUsed, systemStatus.memory.heapTotal) : null
  const osMemoryRate = systemStatus?.osMemory
    ? percent(systemStatus.osMemory.totalMem - systemStatus.osMemory.freeMem, systemStatus.osMemory.totalMem)
    : null
  const errorTone = (optional.errorLogs ?? 0) > 0 ? 'danger' : (optional.warningLogs ?? 0) > 0 ? 'warning' : undefined

  const refreshAll = () => {
    void fetchDashboard(true)
    void loadMessages()
  }

  if (loading) {
    return (
      <div className="console-dashboard console-overview-page space-y-4" aria-label={i18n.t("正在加载工作台")}>
        <Skeleton className="h-14 w-72 rounded-[var(--console-radius-md)]" />
        <div className="console-stat-grid">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-[7.25rem] rounded-[var(--console-radius-lg)]" />)}
        </div>
        <div className="console-overview-row">
          <Skeleton className="h-64 rounded-[var(--console-radius-lg)]" />
          <Skeleton className="h-64 rounded-[var(--console-radius-lg)]" />
          <Skeleton className="h-64 rounded-[var(--console-radius-lg)]" />
        </div>
      </div>
    )
  }

  return (
    <div className="console-dashboard console-overview-page">
      <header className="console-overview-head" aria-labelledby="dashboard-title">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2.5">
            <h1 id="dashboard-title" className="console-dashboard-title">
              {!hostAvailable
                ? <>{i18n.t("Host 暂时不可达，")}{i18n.t("控制面仍可继续使用")}</>
                : i18n.t("总览")}
            </h1>
            <span className={healthy ? 'console-health-pill' : 'console-health-pill is-warning'}>
              <span className={healthy ? 'console-status-dot' : 'console-status-dot is-warning'} />
              {!hostAvailable ? i18n.t("Host 连接需要恢复") : healthy ? i18n.t("所有核心服务运行正常") : i18n.t("有事项需要处理")}
            </span>
          </div>
          <p className="console-dashboard-lede">
            {!hostAvailable
              ? i18n.t("页面导航、配置入口和能力目录保持可用。重新连接后，渠道、Agent 与运行状态会在这里恢复。")
              : i18n.t("机器人运行状态、消息量和实时事件")}
          </p>
        </div>
        <div className="console-overview-actions">
          {!readOnly ? (
            <Button variant="outline" className="console-danger-outline" disabled={restarting} onClick={() => { void confirmRestart() }}>
              <Power />
              {i18n.t("重启")}
            </Button>
          ) : null}
          <Button variant="outline" onClick={refreshAll} disabled={refreshing} aria-label={hostAvailable ? i18n.t("刷新工作台") : undefined}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            {hostAvailable ? i18n.t("刷新") : i18n.t("重新连接")}
          </Button>
          {hostAvailable ? (
            <Button onClick={() => navigate('/endpoints')}>
              <Bot className="h-4 w-4" />
              {i18n.t("进入会话")}
            </Button>
          ) : null}
        </div>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {stats ? i18n.t("部分状态未能更新") : i18n.t("运行状态当前不可用")}：{error}
            {lastUpdatedAt ? i18n.t(" · 上次更新 {0}", [new Date(lastUpdatedAt).toLocaleTimeString(i18n.locale)]) : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      <StatGrid label={i18n.t("关键指标")}>
        <StatCard
          icon={MessageSquare}
          label={i18n.t("收到消息")}
          value={messageSummary.inbound.toLocaleString(i18n.locale)}
          sub={i18n.t("近 24 小时 · {0} 个会话", [messageSummary.conversations])}
          onOpen={() => navigate('/agent/sessions')}
        />
        <StatCard
          icon={Reply}
          label={i18n.t("已回复")}
          value={messageSummary.outbound.toLocaleString(i18n.locale)}
          sub={replyRate !== null ? i18n.t("回复率 {0}%", [replyRate]) : i18n.t("近 24 小时")}
          onOpen={() => navigate('/agent/sessions')}
        />
        <StatCard
          icon={AlertTriangle}
          label={i18n.t("错误日志")}
          value={optional.errorLogs ?? '—'}
          sub={optional.warningLogs !== null ? i18n.t("警告 {0} 条", [optional.warningLogs]) : i18n.t("日志状态暂时不可读")}
          tone={errorTone}
          onOpen={() => navigate((optional.errorLogs ?? 0) > 0 ? '/logs?level=error' : '/logs')}
        />
        <StatCard
          icon={Radio}
          label={i18n.t("在线渠道")}
          value={stats ? <>{stats.endpoints.online}<small> / {stats.endpoints.total}</small></> : '—'}
          sub={endpointRate !== null ? i18n.t("在线率 {0}%", [endpointRate]) : i18n.t("还没有连接渠道")}
          tone={offlineEndpoints > 0 ? 'warning' : undefined}
          aside={endpointRate !== null
            ? <MiniRingGauge percent={endpointRate} tone={endpointRate === 100 ? 'success' : endpointRate >= 60 ? 'primary' : 'warning'} />
            : null}
          onOpen={() => navigate('/endpoints')}
        />
      </StatGrid>

      <div className="console-overview-row">
        <section className="console-dashboard-panel console-volume-panel" aria-labelledby="volume-title">
          <div className="console-card-heading">
            <h2 id="volume-title">{i18n.t("最近 24 小时消息量")}</h2>
            {latestMessageAt !== null
              ? <span className="console-soft-badge">{i18n.t("最近消息 {0}", [formatAgo(latestMessageAt, Date.now(), i18n.locale)])}</span>
              : null}
          </div>
          <MessageVolumeChart
            buckets={activity}
            summary={i18n.t("最近 24 小时收到 {0} 条消息，回复 {1} 条", [messageSummary.inbound, messageSummary.outbound])}
            describe={(bucket) => i18n.t("{0} · 收到 {1} · 回复 {2}", [formatHour(bucket.start), bucket.inbound, bucket.outbound])}
          />
          <div className="console-volume-legend">
            <span><i className="is-inbound" aria-hidden="true" />{i18n.t("收到")}</span>
            <span><i className="is-reply" aria-hidden="true" />{i18n.t("回复")}</span>
            <small>{i18n.t("按 Host 事件缓冲统计，重启后重新计数")}</small>
          </div>
        </section>

        <section className="console-dashboard-panel" aria-labelledby="runtime-title">
          <div className="console-card-heading">
            <h2 id="runtime-title">{i18n.t("运行信息")}</h2>
            <Clock className="console-card-heading-icon" aria-hidden="true" />
          </div>
          <dl className="console-kv-list">
            <div><dt>{i18n.t("运行时长")}</dt><dd>{systemStatus ? formatUptime(systemStatus.uptime, i18n.locale) : '—'}</dd></div>
            <div><dt>{i18n.t("运行子插件")}</dt><dd>{stats ? `${stats.plugins.active} / ${stats.plugins.total}` : '—'}</dd></div>
            <div><dt>{i18n.t("命令")}</dt><dd>{stats?.commands ?? '—'}</dd></div>
            <div><dt>Agent</dt><dd>{optional.agents ?? '—'}</dd></div>
            <div><dt>{i18n.t("实时")}</dt><dd className={connected ? 'is-success' : 'is-warning'}>{connected ? i18n.t("已连接") : i18n.t("未连接")}</dd></div>
          </dl>
        </section>

        <section className="console-dashboard-panel" aria-labelledby="resource-title">
          <div className="console-card-heading">
            <h2 id="resource-title">{i18n.t("资源占用")}</h2>
            <Cpu className="console-card-heading-icon" aria-hidden="true" />
          </div>
          <dl className="console-kv-list">
            <div>
              <dt>{i18n.t("堆内存")}</dt>
              <dd>{systemStatus ? `${formatMemory(systemStatus.memory.heapUsed)} / ${formatMemory(systemStatus.memory.heapTotal)}` : '—'}</dd>
              {heapRate !== null ? <span className="console-meter" aria-hidden="true"><span style={{ width: `${heapRate}%` }} /></span> : null}
            </div>
            <div><dt>{i18n.t("RSS 内存")}</dt><dd>{systemStatus ? formatMemory(systemStatus.memory.rss) : '—'}</dd></div>
            <div>
              <dt>{i18n.t("系统内存")}</dt>
              <dd>{osMemoryRate !== null ? `${osMemoryRate}%` : '—'}</dd>
              {osMemoryRate !== null ? <span className="console-meter" aria-hidden="true"><span style={{ width: `${osMemoryRate}%` }} className={osMemoryRate >= 85 ? 'is-warning' : ''} /></span> : null}
            </div>
            <div>
              <dt>{i18n.t("CPU 占用")}</dt>
              <dd title={i18n.t("进程 CPU 时间占单核的比例，按两次刷新之间的差值计算")}>{cpuRate !== null ? `${cpuRate}%` : '—'}</dd>
              {cpuRate !== null ? <span className="console-meter" aria-hidden="true"><span style={{ width: `${cpuMeterWidth(cpuRate)}%` }} className={cpuRate >= 85 ? 'is-warning' : ''} /></span> : null}
            </div>
            <div><dt>{i18n.t("运行环境")}</dt><dd>{systemStatus ? `Node ${systemStatus.nodeVersion} · ${systemStatus.platform}` : '—'}</dd></div>
          </dl>
        </section>
      </div>

      {attentionItems.length > 0 ? (
        <section className="console-attention-strip" aria-label={i18n.t("需要关注")}>
          {attentionItems.map((item) => (
            <ListItemButton
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
            </ListItemButton>
          ))}
        </section>
      ) : null}

      <section className="console-dashboard-panel console-event-feed-panel" aria-labelledby="event-feed-title">
        <div className="console-card-heading">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="event-feed-title">{i18n.t("实时事件")}</h2>
            <span className={connected ? 'console-event-live-badge' : 'console-event-live-badge is-offline'}>
              <span className="console-event-live-dot" aria-hidden="true" />
              {connected ? i18n.t("实时推送中") : i18n.t("实时事件未连接")}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/agent/sessions')}>
            {i18n.t("查看明细")}<ArrowUpRight />
          </Button>
        </div>

        {messageFeed.length > 0 ? (
          <ol className="console-message-feed">
            {messageFeed.map((item) => (
              <MessageFeedRow key={item.id} item={item} kindLabel={
                item.kind === 'private' ? i18n.t("私聊")
                  : item.kind === 'group' ? i18n.t("群聊")
                    : item.kind === 'channel' ? i18n.t("频道")
                      : item.kind || i18n.t("会话")
              } t={i18n.t} />
            ))}
          </ol>
        ) : displayEvents.length > 0 ? (
          <>
            <div className="console-event-feed-hint">
              <span>{messagesLoaded ? i18n.t("暂时还没有消息，先显示最近的运行日志。") : i18n.t("正在读取消息事件…")}</span>
              <span className="flex items-center gap-1.5 text-xs tabular-nums">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">INFO {eventCounts.info}</span>
                {eventCounts.warn > 0 ? (
                  <span className="rounded-full bg-[hsl(var(--warning)/0.12)] px-2 py-0.5 font-medium text-[hsl(var(--warning))]">WARN {eventCounts.warn}</span>
                ) : null}
                {eventCounts.error > 0 ? (
                  <span className="rounded-full bg-destructive/12 px-2 py-0.5 font-medium text-destructive">ERROR {eventCounts.error}</span>
                ) : null}
              </span>
            </div>
            <div className="console-event-feed">
              {displayEvents.map((evt) => (
                <button key={evt.id} type="button" className="console-event-feed-row" onClick={() => setSelectedEvent(evt)}>
                  <time className="console-event-feed-time">{evt.timestamp}</time>
                  <span className={`console-event-feed-level is-${evt.level}`}>{evt.level.toUpperCase()}</span>
                  <span className="console-event-feed-source">{evt.source}</span>
                  <span className="console-event-feed-msg">{evt.message}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="console-event-feed-empty">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <span>{i18n.t("等待新事件进入...")}</span>
          </div>
        )}
      </section>

      <section className="console-dashboard-panel" aria-labelledby="capability-title">
        <div className="console-card-heading">
          <div>
            <h2 id="capability-title">{i18n.t("当前实例的能力")}</h2>
            <p className="console-card-sub">{i18n.t("运行时能力矩阵与全局 AI 行为开关")}</p>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate('/introspection')}>
            {i18n.t("打开能力中心")}<ArrowUpRight />
          </Button>
        </div>

        {hostAvailable && !readOnly && controlState?.available ? (
          <div className="console-control-bar" aria-label={i18n.t("AI 运行控制开关")}>
            <div className="console-control-switches">
              {controlSwitches.map((item) => {
                const Icon = item.icon
                const active = Boolean(controlState.instance?.[item.key])
                const busy = controlUpdating === item.key
                return (
                  <button
                    key={item.key}
                    type="button"
                    role="switch"
                    aria-checked={active}
                    disabled={controlUpdating !== null}
                    onClick={() => { void handleToggleControl(item.key) }}
                    className={[
                      'console-control-switch',
                      active ? 'is-active' : '',
                      active && item.danger ? 'is-danger' : '',
                      busy ? 'opacity-60' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    <span className="console-control-switch-icon"><Icon /></span>
                    <span className="console-control-switch-label">{item.label}</span>
                    <span className="console-control-switch-track" aria-hidden="true">
                      <span className="console-control-switch-thumb" />
                    </span>
                  </button>
                )
              })}
            </div>
          </div>
        ) : null}

        <div className="console-capability-grid">
          {capabilities.map((capability) => {
            const Icon = capability.icon
            return (
              <ListItemButton
                key={capability.label}
                type="button"
                className="console-capability-item"
                onClick={() => navigate(capability.path)}
              >
                <span className="console-capability-icon"><Icon /></span>
                <span className="min-w-0 flex-1 text-left">
                  <span className="block text-sm font-semibold">{capability.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground">{capability.detail}</span>
                </span>
                <strong>{capability.value ?? '—'}</strong>
              </ListItemButton>
            )
          })}
        </div>
      </section>

      <Sheet open={Boolean(selectedEvent)} onOpenChange={(open) => { if (!open) setSelectedEvent(null) }}>
        <SheetContent side="right">
          <SheetHeader>
            <div className="flex items-center gap-2">
              {selectedEvent ? (
                <span className={`console-event-feed-level is-${selectedEvent.level}`}>
                  {selectedEvent.level.toUpperCase()}
                </span>
              ) : null}
              <span className="font-mono text-xs text-muted-foreground">{selectedEvent?.timestamp}</span>
            </div>
            <SheetTitle>{i18n.t("运行事件详情")}</SheetTitle>
            <SheetDescription>
              {selectedEvent ? `${i18n.t("来源模块")}：${selectedEvent.source}` : ''}
            </SheetDescription>
          </SheetHeader>
          {selectedEvent ? (
            <SheetBody>
              <div className="console-surface-inset p-3.5">
                <p className="font-mono text-xs leading-relaxed whitespace-pre-wrap break-words text-foreground">
                  {selectedEvent.message}
                </p>
              </div>
              <dl className="console-runtime-kv-grid">
                <div className="console-runtime-kv-item">
                  <span>{i18n.t("事件级别")}</span>
                  <strong>{selectedEvent.level.toUpperCase()}</strong>
                </div>
                <div className="console-runtime-kv-item">
                  <span>{i18n.t("来源组件")}</span>
                  <strong>{selectedEvent.source || 'runtime'}</strong>
                </div>
              </dl>
            </SheetBody>
          ) : null}
          <SheetFooter>
            {selectedEvent ? (
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      `[${selectedEvent.timestamp}] [${selectedEvent.level.toUpperCase()}] [${selectedEvent.source}] ${selectedEvent.message}`,
                    )
                    success(i18n.t("已复制事件内容"))
                  } catch {
                    toastError(i18n.t("剪贴板复制失败"))
                  }
                }}
              >
                <Copy className="h-3.5 w-3.5" />
                {i18n.t("复制事件")}
              </Button>
            ) : null}
            <Button
              size="sm"
              onClick={() => {
                const src = selectedEvent?.source
                setSelectedEvent(null)
                navigate(src && !src.startsWith('synth') ? `/logs?q=${encodeURIComponent(src)}` : '/logs')
              }}
            >
              {i18n.t("打开日志工作台")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {ConfirmDialogHost}
    </div>
  )
}
