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
import { MIN_RATIO_SAMPLE, observationCoverage, countReading, ratioReading, type Reading } from './dashboard-basis-model.mjs'
import { CONVERSATION_KINDS, type ConversationKind } from './features/feature-model.mjs'
import { conversationHref, CONSOLE_PATHS } from '../console-routes.mjs'
import { instanceSectionHref } from './ops/instance-sections.mjs'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { StatusState } from '../components/StatusState'
import './insights/insights.css'
import type { LucideIcon } from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  AlertTriangle,
  ArrowUpRight,
  AtSign,
  Bot,
  Brain,
  Command,
  Copy,
  Eye,
  MessageSquare,
  Package,
  Power,
  Radio,
  RefreshCw,
  Reply,
  Server,
  ShieldAlert,
  VolumeX,
  Wrench,
} from 'lucide-react'
import { fetchConsoleEventHistory, SIDE_EVENT_PUSH } from '@zhin.js/client'
import { useConsoleConnected } from '../hooks/use-console-connected'
import { useHostRestart } from '../hooks/use-host-restart'
import { RestartProgress } from '../components/ApplyFeedback'
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
import { ATTENTION_PATH, DASHBOARD_ATTENTION_LIMIT } from './attention/attention-model.mjs'
import { AttentionSeverityIcon } from './attention/AttentionItemRow'
import { useAttention } from './attention/use-attention'
import './attention/attention.css'

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
  /** Oldest row in the persistent log store (ISO), when the Host reports it. */
  logSince: string | null
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

const EMPTY_OPTIONAL: OptionalOverview = {
  logReadError: null,
  logSince: null,
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
const MESSAGE_HISTORY_LIMIT = 500
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

function readOldestLog(value: unknown): string | null {
  const oldest = value && typeof value === 'object' ? (value as { oldestTimestamp?: unknown }).oldestTimestamp : null
  return typeof oldest === 'string' && !Number.isNaN(new Date(oldest).getTime()) ? oldest : null
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
  // 能定位到会话对象时，会话标识直接链到它的「记录」页签。
  const conversation = item.adapter && item.endpoint && CONVERSATION_KINDS.includes(item.kind as never) && item.channelId
    ? conversationHref(item.adapter, item.endpoint, item.kind as ConversationKind, item.channelId, 'records')
    : null
  return (
    <li className="console-message-row">
      <time className="console-message-time" dateTime={new Date(item.timestamp).toISOString()}>{formatClock(item.timestamp)}</time>
      <div className="console-message-body">
        <div className="console-message-meta">
          {item.adapter ? <span className="console-tag">{item.adapter}</span> : null}
          <span className="console-tag is-accent">{kindLabel}</span>
          {item.channelId
            ? conversation
              ? <Link to={conversation} className="console-message-channel console-message-link" title={t("打开这个会话的记录")}>{item.channelId}</Link>
              : <span className="console-message-channel">{item.channelId}</span>
            : null}
          {sender ? <span className="console-message-sender">{sender}</span> : null}
          {item.direction === 'outbound'
            ? <span className="console-tag is-info">{t("机器人发出")}</span>
            : item.replies.length > 0
              ? <span className="console-tag">{t("有可能相关的回复")}</span>
              : <span className="console-tag">{t("之后两分钟内未发出消息")}</span>}
        </div>
        {item.direction === 'inbound'
          ? <p className="console-message-text">{item.text || '—'}</p>
          : <blockquote className="console-message-reply"><span>{item.text || '—'}</span></blockquote>}
        {item.replies.map((reply) => (
          <blockquote key={reply.id} className="console-message-reply"><span>{reply.text || '—'}</span></blockquote>
        ))}
        {item.replies.length > 0 ? (
          <span className="console-message-pairing">
            {latency !== null ? t("可能相关 · 按同一会话的时间先后推测，相隔 {0} 秒", [latency.toFixed(1)]) : t("可能相关 · 按同一会话的时间先后推测")}
          </span>
        ) : null}
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
  const attention = useAttention()
  const [messageEvents, setMessageEvents] = useState<unknown[]>([])
  const [messagesLoaded, setMessagesLoaded] = useState(false)
  const [messagesTruncated, setMessagesTruncated] = useState(false)
  const messageAbortRef = useRef<AbortController | null>(null)

  const loadMessages = useCallback(async () => {
    messageAbortRef.current?.abort()
    const controller = new AbortController()
    messageAbortRef.current = controller
    try {
      const page = await fetchConsoleEventHistory({ limit: MESSAGE_HISTORY_LIMIT }, {
        signal: AbortSignal.any([controller.signal, AbortSignal.timeout(DASHBOARD_REQUEST_TIMEOUT_MS)]),
      })
      if (controller.signal.aborted) return
      setMessageEvents([...page.items].slice(-MESSAGE_EVENT_LIMIT))
      // 缓冲还有更早的事件、或已经接不上：最早一条之前的消息不在统计里。
      setMessagesTruncated(page.hasMore || page.gap || page.items.length >= MESSAGE_HISTORY_LIMIT)
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
        logSince: readOldestLog(logs.data),
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
      label: i18n.t("命令"),
      value: stats?.commands ?? null,
      detail: stats ? i18n.t("可被消息直接调用") : i18n.t("等待 Host 状态"),
      icon: Command,
      path: '/introspection?tab=commands',
    },
    {
      label: 'Agent',
      value: optional.agents,
      detail: optional.agentStatus === 'unavailable' ? i18n.t("未安装 Agent（只用 IM 也可以）") : optional.agentStatus === 'unknown' ? i18n.t("状态暂时不可读") : optional.agents === 0 ? i18n.t("可选能力：需要 AI 时安装并配置 Agent") : i18n.t("模型与会话绑定"),
      icon: Brain,
      path: CONSOLE_PATHS.agentWorkbench,
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
      label: i18n.t("插件"),
      value: stats?.plugins.total ?? null,
      detail: stats ? i18n.t("{0} 个正在运行", [stats.plugins.active]) : i18n.t("等待 Host 状态"),
      icon: Package,
      path: '/plugins',
    },
  ], [optional, stats, i18n, disconnectedMcp])

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
    for (const evt of recentEvents) {
      if (evt.level === 'error') counts.error += 1
      else if (evt.level === 'warn') counts.warn += 1
      else counts.info += 1
    }
    return counts
  }, [recentEvents])

  // 统计口径：消息数来自 Host 事件缓冲（缓冲内观察），错误日志来自日志库（持久统计）。
  const coverage = observationCoverage(records, { now: activityNow, windowMs: DAY_MS, truncated: messagesTruncated })
  const inboundReading = countReading(messagesLoaded || records.length ? messageSummary.inbound : null)
  const outboundReading = countReading(messagesLoaded || records.length ? messageSummary.outbound : null)
  const outboundShare = ratioReading(messageSummary.outbound, messageSummary.inbound)
  const heapRate = systemStatus ? percent(systemStatus.memory.heapUsed, systemStatus.memory.heapTotal) : null
  const osMemoryRate = systemStatus?.osMemory
    ? percent(systemStatus.osMemory.totalMem - systemStatus.osMemory.freeMem, systemStatus.osMemory.totalMem)
    : null
  const errorTone = (optional.errorLogs ?? 0) > 0 ? 'danger' : (optional.warningLogs ?? 0) > 0 ? 'warning' : undefined
  const formatStamp = (timestamp: number) => new Date(timestamp).toLocaleString(i18n.locale, { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
  const unrecorded = <span className="console-sample-missing">{i18n.t("未记录")}</span>
  const readingValue = (reading: Reading) => reading.kind === 'value' ? reading.value.toLocaleString(i18n.locale) : unrecorded
  const coverageText = coverage.kind === 'none'
    ? i18n.t("缓冲里还没有消息事件")
    : coverage.kind === 'full'
      ? i18n.t("覆盖最近 24 小时")
      : coverage.kind === 'partial'
        ? i18n.t("缓冲只保留到 {0}，更早的消息未计入", [formatStamp(coverage.since!)])
        : i18n.t("自 {0} 起（缓冲里最早的一条）", [formatStamp(coverage.since!)])

  const refreshAll = () => {
    void fetchDashboard(true)
    void loadMessages()
  }

  if (loading) {
    return (
      <StatusState kind="loading" title={i18n.t("正在加载工作台")} onRetry={refreshAll} placeholder={<div className="console-dashboard console-overview-page space-y-4">
        <Skeleton className="h-14 w-72 rounded-[var(--console-radius-md)]" />
        <div className="console-stat-grid">
          {[0, 1, 2, 3].map((index) => <Skeleton key={index} className="h-[7.25rem] rounded-[var(--console-radius-lg)]" />)}
        </div>
        <div className="console-overview-row">
          <Skeleton className="h-64 rounded-[var(--console-radius-lg)]" />
          <Skeleton className="h-64 rounded-[var(--console-radius-lg)]" />
        </div>
      </div>} />
    )
  }

  return (
    <PageShell className="console-dashboard console-overview-page">
      <PageHeader
        title={!hostAvailable ? `${i18n.t("Host 暂时不可达，")}${i18n.t("控制面仍可继续使用")}` : i18n.t("首页")}
        description={!hostAvailable
          ? i18n.t("页面导航、配置入口和能力目录保持可用。重新连接后，聊天账号、Agent 与运行状态会在这里恢复。")
          : i18n.t("现在需要处理什么、消息量和最近的消息。")}
        actions={<>
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
            <Button onClick={() => navigate('/scope')}>
              <Bot className="h-4 w-4" />
              {i18n.t("进入会话")}
            </Button>
          ) : null}
        </>}
      />
      <RestartProgress onRestarted={refreshAll} />

      <div className="console-overview-status">
        <span className={healthy ? 'console-health-pill' : 'console-health-pill is-warning'}>
          <span className={healthy ? 'console-status-dot' : 'console-status-dot is-warning'} />
          {!hostAvailable ? i18n.t("Host 连接需要恢复") : healthy ? i18n.t("所有核心服务运行正常") : i18n.t("有事项需要处理")}
        </span>
        {systemStatus ? <span>{i18n.t("已运行 {0}", [formatUptime(systemStatus.uptime, i18n.locale)])}</span> : null}
        <span>{connected ? i18n.t("实时推送已连接") : i18n.t("实时推送未连接")}</span>
        {lastUpdatedAt ? <span>{i18n.t("上次更新 {0}", [new Date(lastUpdatedAt).toLocaleTimeString(i18n.locale)])}</span> : null}
        <Link to={CONSOLE_PATHS.opsInstance}>{i18n.t("查看实例")}</Link>
      </div>

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {stats ? i18n.t("部分状态未能更新") : i18n.t("运行状态当前不可用")}：{error}
            {lastUpdatedAt ? i18n.t(" · 上次更新 {0}", [new Date(lastUpdatedAt).toLocaleTimeString(i18n.locale)]) : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      {attention.allowed && (attention.active.length > 0 || (attention.state.status === 'error' && !attention.state.data)) ? (
        <section className="console-dashboard-panel" aria-labelledby="attention-title">
          <div className="console-card-heading">
            <h2 id="attention-title">{i18n.t("需要你处理")}</h2>
            <Button variant="ghost" size="sm" asChild>
              <Link to={ATTENTION_PATH}>{i18n.t("查看全部 ({0})", [attention.active.length])}<ArrowUpRight /></Link>
            </Button>
          </div>
          {attention.active.length > 0 ? (
            <div className="console-attention-strip">
              {attention.active.slice(0, DASHBOARD_ATTENTION_LIMIT).map((item) => (
                <ListItemButton
                  key={item.id}
                  type="button"
                  className={`console-attention-item is-${item.severity}`}
                  onClick={() => navigate(item.action.path)}
                >
                  <AttentionSeverityIcon severity={item.severity} />
                  <span className="min-w-0 flex-1 text-left">
                    <span className="block text-sm font-semibold">{item.title}</span>
                    {item.detail ? <span className="mt-0.5 block text-xs leading-5 text-muted-foreground">{item.detail}</span> : null}
                  </span>
                  <ArrowUpRight />
                </ListItemButton>
              ))}
            </div>
          ) : (
            <StatusState compact error={attention.state.error} onRetry={attention.refresh} />
          )}
        </section>
      ) : null}

      <StatGrid label={i18n.t("关键指标")}>
        <StatCard
          icon={MessageSquare}
          label={i18n.t("收到消息")}
          value={readingValue(inboundReading)}
          sub={inboundReading.kind === 'value' ? i18n.t("缓冲内观察 · {0} 个会话", [messageSummary.conversations]) : i18n.t("缓冲内观察 · 事件缓冲读取未完成")}
          onOpen={() => navigate(CONSOLE_PATHS.agentSessions)}
        />
        <StatCard
          icon={Reply}
          label={i18n.t("机器人发出")}
          value={readingValue(outboundReading)}
          sub={outboundShare.kind === 'value'
            ? i18n.t("缓冲内观察 · 发出约为收到的 {0}%", [outboundShare.value])
            : outboundShare.kind === 'insufficient'
              ? i18n.t("缓冲内观察 · 收到不足 {0} 条，不计算比例", [MIN_RATIO_SAMPLE])
              : i18n.t("缓冲内观察")}
          onOpen={() => navigate(CONSOLE_PATHS.agentSessions)}
        />
        <StatCard
          icon={AlertTriangle}
          label={i18n.t("错误日志")}
          value={optional.errorLogs ?? unrecorded}
          sub={optional.warningLogs !== null
            ? optional.logSince
              ? i18n.t("持久统计 · 自 {0} 起 · 警告 {1} 条", [formatStamp(new Date(optional.logSince).getTime()), optional.warningLogs])
              : i18n.t("持久统计 · 警告 {0} 条", [optional.warningLogs])
            : i18n.t("日志状态暂时不可读")}
          tone={errorTone}
          onOpen={() => navigate((optional.errorLogs ?? 0) > 0 ? '/logs?level=error' : '/logs')}
        />
        <StatCard
          icon={Radio}
          label={i18n.t("在线聊天账号")}
          value={stats ? <>{stats.endpoints.online}<small> / {stats.endpoints.total}</small></> : unrecorded}
          sub={endpointRate !== null ? i18n.t("当前状态 · 在线率 {0}%", [endpointRate]) : stats ? i18n.t("还没有聊天账号") : i18n.t("等待 Host 状态")}
          tone={offlineEndpoints > 0 ? 'warning' : undefined}
          aside={endpointRate !== null
            ? <MiniRingGauge percent={endpointRate} tone={endpointRate === 100 ? 'success' : endpointRate >= 60 ? 'primary' : 'warning'} />
            : null}
          onOpen={() => navigate('/scope')}
        />
      </StatGrid>
      <p className="console-basis-note">
        <span><strong>{i18n.t("缓冲内观察")}</strong>{i18n.t("：消息数来自 Host 的事件缓冲，重启后清空；")}<span className={coverage.kind === 'partial' ? 'is-partial' : undefined}>{coverageText}</span></span>
        <span><strong>{i18n.t("持久统计")}</strong>{i18n.t("：错误与警告来自日志库，清理日志后重新计数。")}</span>
      </p>

      <div className="console-overview-row">
        <section className="console-dashboard-panel console-volume-panel" aria-labelledby="volume-title">
          <div className="console-card-heading">
            <h2 id="volume-title">{i18n.t("最近 24 小时消息量")}</h2>
            {latestMessageAt !== null
              ? <span className="console-soft-badge">{i18n.t("最近消息 {0}", [formatAgo(latestMessageAt, Date.now(), i18n.locale)])}</span>
              : null}
          </div>
          {coverage.kind === 'none' && messagesLoaded ? (
            <StatusState kind="empty" compact title={i18n.t("缓冲里还没有消息")} description={i18n.t("机器人收到或发出消息后会出现在这里；实例重启会清空缓冲。")} />
          ) : (
            <MessageVolumeChart
              buckets={activity}
              summary={i18n.t("最近 24 小时收到 {0} 条消息，机器人发出 {1} 条", [messageSummary.inbound, messageSummary.outbound])}
              describe={(bucket) => i18n.t("{0} · 收到 {1} · 发出 {2}", [formatHour(bucket.start), bucket.inbound, bucket.outbound])}
            />
          )}
          <div className="console-volume-legend">
            <span><i className="is-inbound" aria-hidden="true" />{i18n.t("收到")}</span>
            <span><i className="is-reply" aria-hidden="true" />{i18n.t("发出")}</span>
            <small className={coverage.kind === 'partial' ? 'text-[hsl(var(--warning))]' : undefined}>{i18n.t("缓冲内观察")} · {coverageText}</small>
          </div>
        </section>

        <section className="console-dashboard-panel" aria-labelledby="resource-title">
          <div className="console-card-heading">
            <h2 id="resource-title">{i18n.t("进程与资源")}</h2>
            <Button variant="ghost" size="sm" asChild><Link to={instanceSectionHref('status', CONSOLE_PATHS.opsInstance)}>{i18n.t("实例")}<ArrowUpRight /></Link></Button>
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

      <section className="console-dashboard-panel console-event-feed-panel" aria-labelledby="event-feed-title">
        <div className="console-card-heading">
          <div className="flex flex-wrap items-center gap-2.5">
            <h2 id="event-feed-title">{i18n.t("最近的消息")}</h2>
            <span className={connected ? 'console-event-live-badge' : 'console-event-live-badge is-offline'}>
              <span className="console-event-live-dot" aria-hidden="true" />
              {connected ? i18n.t("实时推送中") : i18n.t("实时事件未连接")}
            </span>
          </div>
          <Button variant="ghost" size="sm" onClick={() => navigate(CONSOLE_PATHS.agentSessions)}>
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
        ) : !messagesLoaded ? (
          <div className="space-y-2" aria-label={i18n.t("正在读取消息事件…")}><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
        ) : recentEvents.length > 0 ? (
          <>
            <div className="console-event-feed-hint">
              <span>{i18n.t("缓冲里还没有消息，先显示最近的运行日志。")}</span>
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
              {recentEvents.map((evt) => (
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
          <StatusState kind="empty" compact title={i18n.t("还没有消息")} description={i18n.t("机器人收到或发出消息后，最近的消息会按会话出现在这里。")} />
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
                navigate(src ? `/logs?source=${encodeURIComponent(src)}` : '/logs')
              }}
            >
              {i18n.t("打开日志工作台")}
              <ArrowUpRight className="h-3.5 w-3.5" />
            </Button>
          </SheetFooter>
        </SheetContent>
      </Sheet>

      {ConfirmDialogHost}
    </PageShell>
  )
}
