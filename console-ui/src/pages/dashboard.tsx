import { startVisiblePolling } from '../hooks/visible-polling.mjs'
import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { readErrorSummary } from '../utils/read-error.mjs'
import { logPayloadAvailability } from './logs/read-state.mjs'
import { summarizeOptional } from './dashboard-health'
import { cpuMeterWidth, cpuUsagePercent, readCpuSample, type CpuSample } from './dashboard-cpu-model.mjs'
import { controlSwitchConfirm } from './dashboard-control-model.mjs'
import {
  buildMessageFeed,
  hourlyMessageActivity,
  visibleActivityRange,
  messageRecords,
  replyLatencySeconds,
  visibleReplies,
  summarizeMessages,
  type HourlyActivityBucket,
  type MessageFeedItem,
} from './dashboard-activity-model.mjs'
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { MIN_RATIO_SAMPLE, observationCoverage, countReading, ratioReading, type Reading } from './dashboard-basis-model.mjs'
import { CONVERSATION_KINDS, type ConversationKind } from './features/feature-model.mjs'
import { conversationHref, CONSOLE_PATHS } from '../console-routes.mjs'
import { instanceSectionHref } from './ops/instance-sections.mjs'
import { VersionHintRow } from './ops/version-panel'
import { Alert, AlertDescription, Badge, Button, Card, HeroCard, InfoHint, ListCaption, ListGroup, ListItemButton, ListRow, MiniRingGauge, PageHeader, PageShell, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle, Skeleton, StatCard, StatGrid, StatusDot, Tile, useConfirm } from '@zhin.js/console-ui'
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
import './dashboard.css'
import { ATTENTION_PATH, DASHBOARD_ATTENTION_LIMIT } from './attention/attention-model.mjs'
import { AttentionSummaryList } from './attention/AttentionSummaryList'
import { useAttention } from './attention/use-attention'
import { endpointStatusLabel, endpointStatusTone, latestConversations } from './dashboard-overview-model.mjs'
import { useEndpointsAndLogin } from './scope/login-tasks'
import { mcpDashboardDetail, summarizeMcp, type McpSummary } from './introspection/mcp-status-model.mjs'
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
  /** null when the MCP list is unreadable or not wired. */
  mcp: McpSummary | null
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
  mcp: null,
}

const DASHBOARD_REQUEST_TIMEOUT_MS = 8_000
const DAY_MS = 24 * 60 * 60 * 1000
const MESSAGE_EVENT_LIMIT = 1000
const MESSAGE_HISTORY_LIMIT = 500
// 首页只看最近几条；完整记录在「查看明细」。
const FEED_LIMIT = 8

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

function readMcpSummary(value: unknown): McpSummary | null {
  if (!value || typeof value !== 'object') return null
  const envelope = value as IntrospectionEnvelope
  if (typeof envelope.total !== 'number') return null
  return summarizeMcp(Array.isArray(envelope.items) ? envelope.items : [], envelope.total)
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

/** A round, even axis maximum (1, 2, 4, 5 × 10ⁿ, at least 2) at or above the busiest hour, so the scale reads cleanly. */
function niceAxisMax(peak: number): number {
  if (peak <= 2) return 2
  const magnitude = 10 ** Math.floor(Math.log10(peak))
  for (const step of [1, 2, 4, 5, 10]) if (step * magnitude >= peak) return step * magnitude
  return 10 * magnitude
}

/**
 * Hourly received / sent bars. One tab stop: arrow keys, Home and End move between hours; each hour is announced
 * with `describe`. Hover or focus shows a small readout with the two counts (console#125).
 */
function MessageVolumeChart({ buckets, describe, summary }: {
  buckets: HourlyActivityBucket[]
  describe: (bucket: HourlyActivityBucket) => string
  summary: string
}) {
  const i18n = useI18n()
  const axisMax = niceAxisMax(Math.max(0, ...buckets.map((bucket) => bucket.inbound + bucket.outbound)))
  const ticks = [axisMax, axisMax / 2, 0]
  const tickIndexes = [...new Set([0, Math.floor(buckets.length / 4), Math.floor(buckets.length / 2), Math.floor((buckets.length * 3) / 4), buckets.length - 1])]
  const lastWithData = buckets.reduce((found, bucket, index) => (bucket.inbound + bucket.outbound > 0 ? index : found), buckets.length - 1)
  const [active, setActive] = useState<number | null>(null)
  const [stop, setStop] = useState(lastWithData)
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null)
  const barsRef = useRef<HTMLDivElement>(null)
  const columns = useRef<Array<HTMLDivElement | null>>([])
  const tabStop = Math.min(stop, buckets.length - 1)
  const shown = active !== null ? buckets[active] : undefined

  const fromPointer = (event: ReactPointerEvent<HTMLDivElement>) => {
    const box = barsRef.current?.getBoundingClientRect()
    if (!box || !box.width || !buckets.length) return
    const x = Math.min(Math.max(event.clientX - box.left, 0), box.width - 1)
    setActive(Math.floor((x / box.width) * buckets.length))
    setPointer({ x, y: Math.max(event.clientY - box.top, 0) })
  }
  const moveTo = (index: number) => {
    const next = Math.max(0, Math.min(buckets.length - 1, index))
    setStop(next)
    columns.current[next]?.focus()
  }
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>, index: number) => {
    const target = event.key === 'ArrowRight' || event.key === 'ArrowUp' ? index + 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowDown' ? index - 1
        : event.key === 'Home' ? 0
          : event.key === 'End' ? buckets.length - 1
            : null
    if (target === null) return
    event.preventDefault()
    moveTo(target)
  }
  // The readout follows the pointer; with the keyboard it sits above the focused hour.
  let readoutLeft = 0, readoutTop = 0
  if (shown && pointer) { readoutLeft = pointer.x; readoutTop = pointer.y }
  else if (shown && active !== null) {
    const column = columns.current[active]
    if (column) { readoutLeft = column.offsetLeft + column.offsetWidth / 2; readoutTop = column.offsetHeight * 0.35 }
  }

  return (
    <div className="console-volume-chart" role="group" aria-label={summary}>
      <div className="console-volume-axis" aria-hidden="true">
        {ticks.map((tick) => <span key={tick}>{Number.isInteger(tick) ? tick : ''}</span>)}
      </div>
      <div className="console-volume-plot">
        <div
          ref={barsRef}
          className="console-volume-bars"
          onPointerMove={fromPointer}
          onPointerLeave={() => { setPointer(null); if (!barsRef.current?.contains(document.activeElement)) setActive(null) }}
        >
          <span className="console-volume-gridline is-top" aria-hidden="true" />
          <span className="console-volume-gridline is-mid" aria-hidden="true" />
          {buckets.map((bucket, index) => {
            const total = bucket.inbound + bucket.outbound
            return (
              <div
                key={bucket.start}
                ref={(node) => { columns.current[index] = node }}
                className={`console-volume-col${total > 0 ? '' : ' is-empty'}${active === index ? ' is-active' : ''}`}
                role="img"
                aria-label={describe(bucket)}
                tabIndex={index === tabStop ? 0 : -1}
                onFocus={() => { setStop(index); setActive(index); setPointer(null) }}
                onBlur={() => setActive((current) => (current === index ? null : current))}
                onKeyDown={(event) => onKeyDown(event, index)}
              >
                {total > 0 ? (
                  <span className="console-volume-bar" style={{ height: `${Math.max(3, (total / axisMax) * 100)}%` }}>
                    {bucket.outbound > 0 ? <span className="console-volume-bar-reply" style={{ height: `${(bucket.outbound / total) * 100}%` }} /> : null}
                  </span>
                ) : null}
              </div>
            )
          })}
          {shown ? (
            <div className="console-volume-readout" aria-hidden="true" style={{ left: `clamp(4.75rem, ${readoutLeft}px, calc(100% - 4.75rem))`, top: readoutTop }}>
              <strong>{formatHour(shown.start)}–{formatHour(shown.start + 3_600_000)}</strong>
              <span><i className="is-inbound" />{i18n.t("收到")}<b>{shown.inbound}</b></span>
              <span><i className="is-reply" />{i18n.t("发出")}<b>{shown.outbound}</b></span>
            </div>
          ) : null}
        </div>
        <div className="console-volume-ticks" aria-hidden="true">
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
  // Names first; IDs stay one hover away.
  const sender = item.sender ? item.sender.name || item.sender.id : null
  const senderTitle = item.sender?.id ? t("用户 ID：{0}", [item.sender.id]) : undefined
  const conversationLabel = item.conversationName || item.channelId
  const conversationTitle = t("会话 ID：{0}", [item.channelId])
  // 能定位到会话对象时，会话标识直接链到它的「记录」页签。
  const conversation = item.adapter && item.endpoint && CONVERSATION_KINDS.includes(item.kind as never) && item.channelId
    ? conversationHref(item.adapter, item.endpoint, item.kind as ConversationKind, item.channelId, 'records')
    : null
  // How a reply was paired is a detail: it sits in the tag's tooltip, not under every message.
  // A burst of replies stays a couple of lines; the rest are one link away.
  const replies = visibleReplies(item.replies)
  const pairing = latency !== null ? t("可能相关 · 按同一会话的时间先后推测，相隔 {0} 秒", [latency.toFixed(1)]) : t("可能相关 · 按同一会话的时间先后推测")
  return (
    <li className="console-message-row">
      <time className="console-message-time" dateTime={new Date(item.timestamp).toISOString()}>{formatClock(item.timestamp)}</time>
      <div className="console-message-body">
        <div className="console-message-meta">
          {item.adapter ? <span className="console-tag">{item.adapter}</span> : null}
          <span className="console-tag">{kindLabel}</span>
          {item.channelId
            ? conversation
              ? <Link to={conversation} className="console-message-channel console-message-link" title={`${conversationTitle} · ${t("打开这个会话的记录")}`}>{conversationLabel}</Link>
              : <span className="console-message-channel" title={conversationTitle}>{conversationLabel}</span>
            : null}
          {sender ? <span className="console-message-sender" title={senderTitle}>{sender}</span> : null}
          {item.direction === 'outbound'
            ? <span className="console-tag is-outbound">{t("机器人发出")}</span>
            : item.replies.length > 0
              ? <span className="console-tag" title={pairing}>{t("有可能相关的回复")}</span>
              : <span className="console-tag">{t("之后两分钟内未发出消息")}</span>}
        </div>
        {item.direction === 'inbound'
          ? <p className="console-message-text">{item.text || '—'}</p>
          : <blockquote className="console-message-reply"><span>{item.text || '—'}</span></blockquote>}
        {replies.shown.map((reply) => (
          <blockquote key={reply.id} className="console-message-reply"><span>{reply.text || '—'}</span></blockquote>
        ))}
        {replies.hidden > 0
          ? conversation
            ? <Link to={conversation} className="console-message-more console-message-link">{t("另有 {0} 条回复，打开会话记录查看", [replies.hidden])}</Link>
            : <p className="console-message-more">{t("另有 {0} 条回复", [replies.hidden])}</p>
          : null}
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
  // 聊天账号 list of the Main design: the object tree's own `endpoint.list` read, when the identity may see accounts.
  const accountsAllowed = hasConsolePermission('endpoint.view')
  const accountState = useEndpointsAndLogin(accountsAllowed)
  const accounts = { ...accountState, allowed: accountsAllowed }
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
  const activity = useMemo(() => visibleActivityRange(hourlyMessageActivity(records, activityNow, 24)), [records, activityNow])
  const messageSummary = useMemo(() => summarizeMessages(records, activityNow - DAY_MS), [records, activityNow])
  const messageFeed = useMemo(() => buildMessageFeed(records, FEED_LIMIT), [records])
  const recentConversations = useMemo(() => latestConversations(records, 4), [records])
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
      setOptional({
        ...optionalSummary,
        logReadError: logs.error,
        logSince: readOldestLog(logs.data),
        tools: readTotal(tools),
        agents: readTotal(agents),
        mcp: readMcpSummary(mcp),
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
  // 只有连接失败算问题；待连接 / 未加载不影响「健康」。旧 Host 没有 status 时沿用「总数 − 已连接」。
  const mcpProblems = optional.mcp?.problems ?? 0
  const healthy = hostAvailable && offlineEndpoints === 0 && mcpProblems === 0 && optional.errorLogs === 0

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
      value: optional.mcp?.total ?? null,
      detail: optional.mcp === null
        ? i18n.t("未启用或尚未接线")
        : mcpDashboardDetail(optional.mcp, i18n.locale),
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
  ], [optional, stats, i18n])

  const handleToggleControl = async (key: ControlSwitchKey) => {
    if (!controlState?.available || readOnly || controlUpdating) return
    const currentValue = Boolean(controlState.instance?.[key])
    // Turning a switch on silences the bot everywhere: say so first, like 「重启」 (#64 control-switches-no-confirm).
    const ask = controlSwitchConfirm(key, !currentValue, i18n.locale)
    if (ask && !(await confirm(ask))) return
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
  // The card's number is the error count: 0 errors is the steady state and stays uncolored even when
  // warnings exist (they are counted in the line below the number), console#125.
  const errorTone = (optional.errorLogs ?? 0) > 0 ? 'danger' : undefined
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

  const heroTitle = !hostAvailable ? i18n.t("Host 暂时不可达") : healthy ? i18n.t("实例运行正常") : i18n.t("有事项需要处理")
  const accountRows = accounts.endpoints.slice(0, 6)
  const attentionCount = attention.allowed ? attention.active.length : null

  return (
    <PageShell className="console-dashboard console-overview-page">
      <PageHeader
        title={i18n.t("首页")}
        actions={<Button variant="secondary" onClick={refreshAll} disabled={refreshing} aria-label={hostAvailable ? i18n.t("刷新工作台") : undefined}>
          <RefreshCw className={refreshing ? 'animate-spin' : ''} />
          {hostAvailable ? i18n.t("刷新") : i18n.t("重新连接")}
        </Button>}
      />
      <RestartProgress onRestarted={refreshAll} />

      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {stats ? i18n.t("部分状态未能更新") : i18n.t("运行状态当前不可用")}：{error}
            {lastUpdatedAt ? i18n.t(" · 上次更新 {0}", [new Date(lastUpdatedAt).toLocaleTimeString(i18n.locale)]) : ''}
          </AlertDescription>
        </Alert>
      ) : null}

      {/* The Main design: the instance as the page's one hero card, 需处理 next to it. */}
      <div className="console-overview-hero-row" data-attention={attentionCount !== null ? 'true' : undefined}>
        <HeroCard className="console-overview-hero" aria-label={i18n.t("实例")}>
          <div className="console-overview-hero-head">
            {/* On the gradient only ink text: the state is a progress dot or plain words (D34). */}
            <StatusDot tone={healthy ? 'neutral' : 'progress'}>{!hostAvailable ? i18n.t("连接需要恢复") : healthy ? i18n.t("运行中") : i18n.t("需留意")}</StatusDot>
            {systemStatus ? <span className="console-overview-hero-muted">{i18n.t("已运行 {0}", [formatUptime(systemStatus.uptime, i18n.locale)])}</span> : null}
          </div>
          <h2 className="console-hero-title">{heroTitle}</h2>
          {/* Host unreachable: the short state, then what still works and what comes back (secondary text). */}
          {!hostAvailable ? <div className="console-overview-hero-muted">
            <p>{i18n.t("控制面仍可继续使用")}</p>
            <p>{i18n.t("页面导航、配置入口和能力目录保持可用。重新连接后，聊天账号、Agent 与运行状态会在这里恢复。")}</p>
          </div> : null}
          <dl className="console-overview-hero-stats">
            <div>
              <dd>{stats ? <>{stats.endpoints.online}<small> / {i18n.t("{0} 在线", [stats.endpoints.total])}</small></> : '—'}</dd>
              <dt>{i18n.t("聊天账号")}</dt>
            </div>
            <div>
              <dd>{stats ? <>{stats.plugins.active}<small> {i18n.t("个")}</small></> : '—'}</dd>
              <dt>{i18n.t("已启用插件")}</dt>
            </div>
            <div>
              <dd>{readingValue(inboundReading)}{inboundReading.kind === 'value' ? <small> {i18n.t("条")}</small> : null}</dd>
              <dt>{i18n.t("24 小时消息")}</dt>
            </div>
          </dl>
          <div className="console-overview-hero-actions">
            {/* The page's one primary action; on the hero card the others are white / text (soft cards). */}
            {hostAvailable ? <Button variant="primary" size="sm" onClick={() => navigate('/scope')}>{i18n.t("进入会话")}</Button> : null}
            {!readOnly ? (
              <Button variant="white" size="sm" disabled={restarting} onClick={() => { void confirmRestart() }}>
                <Power />
                {i18n.t("重启")}
              </Button>
            ) : null}
            <Button variant="text" size="sm" asChild><Link to="/logs">{i18n.t("看日志")}</Link></Button>
            <span className="console-overview-hero-muted">
              {connected ? i18n.t("实时推送已连接") : i18n.t("实时推送未连接")}
              {lastUpdatedAt ? ` · ${i18n.t("上次更新 {0}", [new Date(lastUpdatedAt).toLocaleTimeString(i18n.locale)])}` : ''}
            </span>
          </div>
        </HeroCard>

        {attentionCount !== null ? (
          <Card className="console-overview-attention" aria-labelledby="attention-title">
            <div className="console-overview-attention-head">
              <h2 id="attention-title">{i18n.t("需处理")}</h2>
              <span className="console-overview-attention-count">{attentionCount}</span>
            </div>
            {attention.active.length > 0 ? (
              <AttentionSummaryList items={attention.active.slice(0, DASHBOARD_ATTENTION_LIMIT)} />
            ) : attention.state.status === 'error' && !attention.state.data ? (
              <StatusState compact error={attention.state.error} onRetry={attention.refresh} />
            ) : (
              <p className="console-overview-hero-muted">{i18n.t("没有要处理的")}</p>
            )}
            {attention.active.length > 0 ? (
              <Button variant="text" size="sm" asChild className="self-start">
                <Link to={ATTENTION_PATH}>{i18n.t("查看全部 ({0})", [attention.active.length])}</Link>
              </Button>
            ) : null}
          </Card>
        ) : null}
      </div>

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
            // 「100%」 at the ring's label size is wider than the ring's inside: the wrapper names the digit count
            // so the design system shrinks three-digit labels to fit (zhinjs/zhin#1250 dashboard-online-ring-text-overflow).
            ? <span className="console-ring-fit" data-digits={String(endpointRate).length}>
                <MiniRingGauge percent={endpointRate} tone={offlineEndpoints > 0 ? 'warning' : 'primary'} />
              </span>
            : null}
          onOpen={() => navigate('/scope')}
        />
      </StatGrid>
      <div className="console-basis-hints">
        <span>{i18n.t("统计口径")}</span>
        <InfoHint label={i18n.t("缓冲内观察")} tone={coverage.kind === 'partial' ? 'warning' : undefined}>
          <p>{i18n.t("收到与发出的消息数来自 Host 的事件缓冲，实例重启后清空。")}</p>
          <p className={coverage.kind === 'partial' ? 'is-partial' : undefined}>{coverageText}</p>
        </InfoHint>
        <InfoHint label={i18n.t("持久统计")}>
          <p>{i18n.t("错误与警告来自日志库，清理日志后重新计数。")}</p>
        </InfoHint>
      </div>

      <div className="console-overview-row">
        <div className="console-overview-column">
          {accounts.allowed ? (
            <section className="console-overview-list" aria-labelledby="accounts-title">
              <ListCaption id="accounts-title" level={2}>{i18n.t("聊天账号")}</ListCaption>
              {accountRows.length > 0 ? (
                <ListGroup>
                  {accountRows.map((endpoint) => {
                    const tone = endpointStatusTone(endpoint, accounts.tasks)
                    return (
                      <ListRow key={`${endpoint.adapter}/${endpoint.name}`} asChild title={null}>
                        <Link to={`/scope/${encodeURIComponent(endpoint.adapter)}/${encodeURIComponent(endpoint.name)}`}>
                          <Tile tone={1}><AtSign /></Tile>
                          <span className="console-list-row-body">
                            <span className="console-list-row-title">{endpoint.name}</span>
                            <span className="console-list-row-description">{endpoint.transportLabel ? `${endpoint.adapter} · ${endpoint.transportLabel}` : endpoint.adapter}</span>
                          </span>
                          <span className="console-list-row-end"><StatusDot tone={tone}>{endpointStatusLabel(endpoint, i18n.t, accounts.tasks)}</StatusDot></span>
                        </Link>
                      </ListRow>
                    )
                  })}
                </ListGroup>
              ) : accounts.error && !accounts.loaded ? (
                <Card><StatusState compact error={accounts.error} onRetry={accounts.refresh} /></Card>
              ) : accounts.loaded ? (
                <Card><StatusState kind="empty" compact title={i18n.t("还没有聊天账号")} /></Card>
              ) : (
                <ListGroup aria-label={i18n.t("正在读取聊天账号")}><Skeleton className="h-14" /><Skeleton className="h-14" /></ListGroup>
              )}
            </section>
          ) : null}

          <section className="console-dashboard-panel" aria-labelledby="resource-title">
            <div className="console-card-heading">
              <h2 id="resource-title">{i18n.t("进程与资源")}</h2>
              <Button variant="text" size="sm" asChild><Link to={instanceSectionHref('status', CONSOLE_PATHS.opsInstance)}>{i18n.t("实例")}</Link></Button>
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
              <VersionHintRow enabled={hasConsolePermission('status.view')} />
            </dl>
          </section>
        </div>

        <div className="console-overview-column">
          <section className="console-dashboard-panel console-volume-panel" aria-labelledby="volume-title">
            <div className="console-card-heading">
              <h2 id="volume-title">{i18n.t("最近 24 小时消息量")}</h2>
              {latestMessageAt !== null
                ? <Badge variant="neutral">{i18n.t("最近消息 {0}", [formatAgo(latestMessageAt, Date.now(), i18n.locale)])}</Badge>
                : null}
            </div>
            {coverage.kind === 'none' && messagesLoaded ? (
              <StatusState kind="empty" compact illustration="messages" title={i18n.t("缓冲里还没有消息")} description={i18n.t("机器人收到或发出消息后会出现在这里；实例重启会清空缓冲。")} />
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

          {recentConversations.length > 0 ? (
            <section className="console-overview-list" aria-labelledby="recent-conversations-title">
              <ListCaption id="recent-conversations-title" level={2}>{i18n.t("最近会话")}</ListCaption>
              <ListGroup>
                {recentConversations.map((item) => {
                  const href = item.adapter && item.endpoint && CONVERSATION_KINDS.includes(item.kind as never) && item.channelId
                    ? conversationHref(item.adapter, item.endpoint, item.kind as ConversationKind, item.channelId, 'records')
                    : null
                  const body = <>
                    <Tile tone={4}><MessageSquare /></Tile>
                    <span className="console-list-row-body">
                      <span className="console-list-row-title">{item.conversationName || item.channelId || i18n.t("会话")}</span>
                      <span className="console-list-row-description">{item.text || '—'}</span>
                    </span>
                    <span className="console-list-row-end console-overview-hero-muted">{formatAgo(item.timestamp, Date.now(), i18n.locale)}</span>
                  </>
                  return href
                    ? <ListRow key={item.id} asChild title={null}><Link to={href}>{body}</Link></ListRow>
                    : <ListRow key={item.id} asChild title={null}><div>{body}</div></ListRow>
                })}
              </ListGroup>
            </section>
          ) : null}
        </div>
      </div>

      <section className="console-dashboard-panel console-event-feed-panel" aria-labelledby="event-feed-title">
        <div className="console-card-heading">
          <div className="flex flex-wrap items-center gap-3">
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
              <span className="flex items-center gap-2 text-xs">
                <span className="rounded-full bg-[hsl(var(--foreground)/0.06)] px-2 py-1 font-medium text-muted-foreground">INFO {eventCounts.info}</span>
                {eventCounts.warn > 0 ? (
                  <span className="rounded-full bg-[hsl(var(--warning)/0.12)] px-2 py-1 font-medium text-[hsl(var(--warning))]">WARN {eventCounts.warn}</span>
                ) : null}
                {eventCounts.error > 0 ? (
                  <span className="rounded-full bg-destructive/12 px-2 py-1 font-medium text-destructive">ERROR {eventCounts.error}</span>
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
          <StatusState kind="empty" compact illustration="messages" title={i18n.t("还没有消息")} description={i18n.t("机器人收到或发出消息后，最近的消息会按会话出现在这里。")} />
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
                  <span className="mt-1 block truncate text-xs text-muted-foreground">{capability.detail}</span>
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
              <div className="console-event-detail-message">
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
                variant="secondary"
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
