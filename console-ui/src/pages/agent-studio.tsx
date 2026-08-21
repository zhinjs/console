import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  Brain,
  Check,
  ChevronDown,
  CircleDashed,
  Clock3,
  Coins,
  ExternalLink,
  GitBranch,
  History,
  LoaderCircle,
  MessagesSquare,
  Pause,
  Play,
  PlugZap,
  Radio,
  RefreshCw,
  Route,
  Server,
  ShieldAlert,
  SkipBack,
  SkipForward,
  Sparkles,
  Workflow,
  Wrench,
  XCircle,
} from 'lucide-react'
import { app, cn, useWebSocket } from '@zhin.js/client'
import { apiFetch } from '../utils/auth'
import {
  agentSessionsPath,
  parseImSessionKey,
  parseSessionKeyFromQuery,
  SESSION_SCOPE_LABELS,
} from '../utils/agent-session'
import {
  loadAgentSessionHistory,
  pushAgentSessionHistory,
} from '../utils/agent-session-history'
import { PageHeader } from '../components/PageHeader'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Skeleton } from '../components/ui/skeleton'

interface TreePoint {
  index: number
  messageId: number
  preview: string
}

interface SessionTree {
  sessionId: string
  activeLeafMessageId: number | null
  points: TreePoint[]
}

interface BindingItem {
  name: string
  provider: string
  model: string
  mcpServers: string[]
  hasAgentFile: boolean
}

interface ToolItem {
  name: string
  description: string
  source?: string
}

interface McpItem {
  name: string
  connected: boolean
  toolCount: number
}

interface EndpointItem {
  name: string
  adapter: string
  connected: boolean
}

interface IntrospectionEnvelope<T> {
  items: T[]
}

interface AgentTraceEvent {
  sequence: number
  recordedAt: number
  sessionKey: string
  turnId: string
  type: string
  data: Record<string, unknown>
}

interface AgentTraceSnapshot {
  sessionKey: string
  events: AgentTraceEvent[]
  latestSequence: number
  activeTurnIds: string[]
}

type TraceFilter = 'all' | 'model' | 'tools' | 'delegation' | 'problems'

interface TraceTurnSummary {
  turnId: string
  startedAt: number
  endedAt: number | null
  eventCount: number
  toolCount: number
  tokenCount: number
  status: 'running' | 'completed' | 'failed' | 'cancelled'
}

const TRACE_FILTERS: ReadonlyArray<{ id: TraceFilter; label: string }> = [
  { id: 'all', label: '全部' },
  { id: 'model', label: '推理' },
  { id: 'tools', label: '工具与 MCP' },
  { id: 'delegation', label: '子 Agent' },
  { id: 'problems', label: '异常' },
]

const terminalTraceTypes = new Set(['turn_end', 'turn_cancelled', 'budget_exceeded', 'error'])
const problemTraceTypes = new Set(['tool_denied', 'tool_failed', 'tool_cancelled', 'turn_cancelled', 'budget_exceeded', 'error'])
const toolTraceTypes = new Set(['tool_call', 'tool_result', 'tool_denied', 'tool_failed', 'tool_cancelled', 'mcp_connect', 'mcp_tool_call'])
const delegationTraceTypes = new Set(['subagent_start', 'subagent_progress', 'subagent_end'])
const modelTraceTypes = new Set(['turn_start', 'capability_resolution', 'iteration_start', 'thinking', 'usage', 'turn_end'])

async function readJson(response: Response): Promise<Record<string, unknown>> {
  try {
    return await response.json() as Record<string, unknown>
  } catch {
    return {}
  }
}

async function fetchIntrospection<T>(kind: string): Promise<T[]> {
  const response = await apiFetch(`/api/introspection/${kind}?page=1&pageSize=100`)
  const body = await readJson(response)
  if (!response.ok || body.success === false) throw new Error(String(body.error ?? `无法读取 ${kind}`))
  return ((body.data as IntrospectionEnvelope<T> | undefined)?.items ?? [])
}

function displayTime(timestamp: number): string {
  if (!timestamp) return '刚刚'
  return new Date(timestamp).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function tracePresentation(event: AgentTraceEvent): {
  eyebrow: string
  title: string
  summary: string
  icon: typeof Activity
  tone: string
  badge: string
} {
  const data = event.data
  const toolName = String(data.toolName ?? 'tool')
  switch (event.type) {
    case 'turn_start': return { eyebrow: 'Agent turn', title: '开始新一轮', summary: `turn ${event.turnId}`, icon: LoaderCircle, tone: 'running', badge: 'running' }
    case 'capability_resolution': return { eyebrow: 'Capability plan', title: '能力解析完成', summary: `${arrayLength(data.tools)} tools · ${arrayLength(data.skills)} skills · ${String(data.mode ?? 'direct')}`, icon: Route, tone: 'capability', badge: String(data.mode ?? 'ready') }
    case 'iteration_start': return { eyebrow: 'Reasoning loop', title: `第 ${String(data.iteration ?? '?')} 次推理`, summary: `最多 ${String(data.maxIterations ?? '?')} 次迭代`, icon: Brain, tone: 'thinking', badge: 'thinking' }
    case 'thinking': return { eyebrow: 'Model reasoning', title: '模型正在思考', summary: previewValue(data.text), icon: Brain, tone: 'thinking', badge: 'thinking' }
    case 'tool_call': return { eyebrow: 'Tool call', title: `调用 ${toolName}`, summary: `tool use ${String(data.toolUseId ?? '')}`, icon: Wrench, tone: 'tool', badge: 'calling' }
    case 'tool_result': return { eyebrow: 'Tool result', title: `${toolName} 执行完成`, summary: durationText(data.durationMs), icon: Check, tone: 'success', badge: 'ok' }
    case 'tool_denied': return { eyebrow: 'Policy guard', title: `${toolName} 被策略拒绝`, summary: String(data.reason ?? data.policy ?? ''), icon: ShieldAlert, tone: 'error', badge: 'denied' }
    case 'tool_failed': return { eyebrow: 'Tool failure', title: `${toolName} 执行失败`, summary: `${durationText(data.durationMs)} · ${String(data.error ?? '')}`, icon: XCircle, tone: 'error', badge: 'failed' }
    case 'tool_cancelled': return { eyebrow: 'Tool cancelled', title: `${toolName} 已取消`, summary: String(data.reason ?? ''), icon: XCircle, tone: 'muted', badge: 'cancelled' }
    case 'usage': return { eyebrow: 'Token usage', title: `${usageTotal(data)} tokens`, summary: usageSummary(data), icon: Coins, tone: 'usage', badge: 'usage' }
    case 'subagent_start': return { eyebrow: 'Delegation', title: `委派给 ${String(data.agentName ?? 'subagent')}`, summary: String(data.description ?? ''), icon: GitBranch, tone: 'capability', badge: 'delegated' }
    case 'subagent_progress': return { eyebrow: 'Subagent progress', title: '子 Agent 更新', summary: String(data.summary ?? ''), icon: Activity, tone: 'running', badge: 'progress' }
    case 'subagent_end': return { eyebrow: 'Delegation result', title: '子 Agent 已返回', summary: previewValue(data.result), icon: Check, tone: data.status === 'error' ? 'error' : 'success', badge: String(data.status ?? 'done') }
    case 'mcp_connect': return { eyebrow: 'MCP connection', title: `${String(data.serverName ?? 'MCP')} · ${String(data.status ?? '')}`, summary: '外部能力连接状态变化', icon: Server, tone: data.status === 'error' ? 'error' : 'capability', badge: String(data.status ?? 'mcp') }
    case 'mcp_tool_call': return { eyebrow: 'MCP tool', title: String(data.toolName ?? 'MCP tool'), summary: `via ${String(data.serverName ?? 'MCP')}`, icon: Server, tone: 'tool', badge: 'mcp' }
    case 'turn_end': return { eyebrow: 'Agent reply', title: '本轮处理完成', summary: outputPreview(data.output), icon: Check, tone: 'success', badge: 'completed' }
    case 'turn_cancelled': return { eyebrow: 'Agent turn', title: '本轮已取消', summary: String(data.reason ?? ''), icon: XCircle, tone: 'muted', badge: String(data.code ?? 'cancelled') }
    case 'budget_exceeded': return { eyebrow: 'Budget guard', title: '本轮达到预算上限', summary: String(data.budget ?? ''), icon: ShieldAlert, tone: 'error', badge: 'limited' }
    case 'error': return { eyebrow: 'Agent error', title: '本轮执行失败', summary: errorPreview(data.error), icon: XCircle, tone: 'error', badge: data.recoverable ? 'recoverable' : 'failed' }
    default: return { eyebrow: event.type.replaceAll('_', ' '), title: 'Agent 状态更新', summary: '', icon: Activity, tone: 'muted', badge: event.type }
  }
}

function arrayLength(value: unknown): number {
  return Array.isArray(value) ? value.length : 0
}

function previewValue(value: unknown): string {
  if (typeof value === 'string') return value.slice(0, 180)
  return value == null ? '' : JSON.stringify(value).slice(0, 180)
}

function durationText(value: unknown): string {
  const duration = Number(value)
  return Number.isFinite(duration) ? `${duration.toLocaleString()} ms` : '执行完成'
}

function usageRecord(data: Record<string, unknown>): Record<string, unknown> {
  return data.usage && typeof data.usage === 'object' ? data.usage as Record<string, unknown> : {}
}

function usageTotal(data: Record<string, unknown>): number {
  return Number(usageRecord(data).totalTokens ?? 0)
}

function usageSummary(data: Record<string, unknown>): string {
  const usage = usageRecord(data)
  return `输入 ${Number(usage.promptTokens ?? 0).toLocaleString()} · 输出 ${Number(usage.completionTokens ?? 0).toLocaleString()}`
}

function outputPreview(value: unknown): string {
  if (!Array.isArray(value)) return 'Agent 已生成最终结果'
  const text = value
    .map((item) => item && typeof item === 'object' ? String((item as Record<string, unknown>).content ?? '') : '')
    .filter(Boolean)
    .join(' ')
  return text.slice(0, 180) || `生成 ${value.length} 个输出元素`
}

function errorPreview(value: unknown): string {
  if (value && typeof value === 'object') return String((value as Record<string, unknown>).message ?? '未知错误')
  return String(value ?? '未知错误')
}

function traceDetail(data: Record<string, unknown>): string {
  return JSON.stringify(data, null, 2)
}

function matchesTraceFilter(event: AgentTraceEvent, filter: TraceFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'model') return modelTraceTypes.has(event.type)
  if (filter === 'tools') return toolTraceTypes.has(event.type)
  if (filter === 'delegation') return delegationTraceTypes.has(event.type)
  return problemTraceTypes.has(event.type)
}

function summarizeTraceTurns(events: AgentTraceEvent[], activeTurnIds: string[]): TraceTurnSummary[] {
  const active = new Set(activeTurnIds)
  const turns = new Map<string, AgentTraceEvent[]>()
  for (const event of events) {
    const bucket = turns.get(event.turnId) ?? []
    bucket.push(event)
    turns.set(event.turnId, bucket)
  }
  return Array.from(turns, ([turnId, turnEvents]) => {
    const terminal = [...turnEvents].reverse().find((event) => terminalTraceTypes.has(event.type))
    const failed = turnEvents.some((event) => event.type === 'error' || event.type === 'budget_exceeded')
    const cancelled = turnEvents.some((event) => event.type === 'turn_cancelled')
    return {
      turnId,
      startedAt: turnEvents[0]?.recordedAt ?? 0,
      endedAt: terminal?.recordedAt ?? null,
      eventCount: turnEvents.length,
      toolCount: turnEvents.filter((event) => event.type === 'tool_call' || event.type === 'mcp_tool_call').length,
      tokenCount: turnEvents
        .filter((event) => event.type === 'usage')
        .reduce((total, event) => total + usageTotal(event.data), 0),
      status: active.has(turnId)
        ? 'running'
        : failed
          ? 'failed'
          : cancelled
            ? 'cancelled'
            : 'completed',
    }
  }).sort((left, right) => right.startedAt - left.startedAt)
}

function traceDuration(turn: TraceTurnSummary): number | null {
  if (!turn.endedAt) return null
  return Math.max(0, turn.endedAt - turn.startedAt)
}

function compactDuration(duration: number | null): string {
  if (duration == null) return '执行中'
  if (duration < 1_000) return `${duration} ms`
  return `${(duration / 1_000).toFixed(duration < 10_000 ? 1 : 0)} s`
}

function shortTurnId(turnId: string): string {
  return turnId.length > 10 ? turnId.slice(0, 8) : turnId
}

function SessionIdentity({ sessionKey, compact = false }: { sessionKey: string; compact?: boolean }) {
  const parsed = parseImSessionKey(sessionKey)
  if (!parsed) {
    return <span className="truncate font-mono text-xs">{sessionKey}</span>
  }
  return (
    <span className="min-w-0">
      <strong className="block truncate">{parsed.sceneId}</strong>
      <small className="block truncate">
        {compact
          ? `${parsed.endpointId} · ${SESSION_SCOPE_LABELS[parsed.scope]}`
          : `${SESSION_SCOPE_LABELS[parsed.scope]} · ${parsed.platform} / ${parsed.endpointId}`}
      </small>
    </span>
  )
}

export default function AgentStudioPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const keyFromUrl = parseSessionKeyFromQuery(searchParams.get('sessionKey'))
  const [history, setHistory] = useState<string[]>(() => loadAgentSessionHistory())
  const [sessionKey, setSessionKey] = useState(keyFromUrl || history[0] || '')
  const [tree, setTree] = useState<SessionTree | null>(null)
  const [trace, setTrace] = useState<AgentTraceSnapshot | null>(null)
  const [bindings, setBindings] = useState<BindingItem[]>([])
  const [tools, setTools] = useState<ToolItem[]>([])
  const [mcpServices, setMcpServices] = useState<McpItem[]>([])
  const [endpoints, setEndpoints] = useState<EndpointItem[]>([])
  const [loading, setLoading] = useState(false)
  const [capabilityLoading, setCapabilityLoading] = useState(true)
  const [treeNotice, setTreeNotice] = useState<string | null>(null)
  const [traceNotice, setTraceNotice] = useState<string | null>(null)
  const [traceRefreshing, setTraceRefreshing] = useState(false)
  const [livePaused, setLivePaused] = useState(false)
  const [traceFilter, setTraceFilter] = useState<TraceFilter>('all')
  const [selectedTurnId, setSelectedTurnId] = useState<string | null>(null)
  const [replayStep, setReplayStep] = useState<number | null>(null)
  const loadedKeyRef = useRef('')
  const traceRef = useRef<AgentTraceSnapshot | null>(null)
  const { connected, sendRequest } = useWebSocket()

  const routes = useSyncExternalStore(app.subscribe, () => app._getRoutes())
  const workroomRoute = useMemo(
    () => routes.find((route) => route.path.toLowerCase().includes('workroom')),
    [routes],
  )
  const parsed = useMemo(() => parseImSessionKey(sessionKey), [sessionKey])
  const candidates = useMemo(
    () => Array.from(new Set([sessionKey, ...history].filter(Boolean))).slice(0, 10),
    [history, sessionKey],
  )
  const endpoint = useMemo(
    () => parsed
      ? endpoints.find((item) => item.adapter === parsed.platform && item.name === parsed.endpointId)
      : undefined,
    [endpoints, parsed],
  )
  const endpointPath = useMemo(() => {
    if (!parsed) return '/endpoints'
    const base = `/endpoints/${encodeURIComponent(parsed.platform)}/${encodeURIComponent(parsed.endpointId)}`
    return `${base}?${new URLSearchParams({ channelType: parsed.scope, channelId: parsed.sceneId })}`
  }, [parsed])

  const loadCapabilities = useCallback(async () => {
    setCapabilityLoading(true)
    const [bindingResult, toolResult, mcpResult] = await Promise.allSettled([
      fetchIntrospection<BindingItem>('bindings'),
      fetchIntrospection<ToolItem>('tools'),
      fetchIntrospection<McpItem>('mcp'),
    ])
    if (bindingResult.status === 'fulfilled') setBindings(bindingResult.value)
    if (toolResult.status === 'fulfilled') setTools(toolResult.value)
    if (mcpResult.status === 'fulfilled') setMcpServices(mcpResult.value)
    if (connected) {
      try {
        const data = await sendRequest<{ endpoints: EndpointItem[] }>({ type: 'endpoint:list' })
        setEndpoints(data.endpoints ?? [])
      } catch {
        setEndpoints([])
      }
    }
    setCapabilityLoading(false)
  }, [connected, sendRequest])

  const loadTrace = useCallback(async (key: string, quiet = false) => {
    if (!quiet) setTraceRefreshing(true)
    try {
      const current = traceRef.current?.sessionKey === key ? traceRef.current : null
      const after = quiet ? current?.latestSequence ?? 0 : 0
      const response = await apiFetch(`/api/agent/traces?${new URLSearchParams({
        sessionKey: key,
        limit: '300',
        ...(after ? { after: String(after) } : {}),
      })}`)
      const body = await readJson(response)
      if (!response.ok || body.success === false) {
        throw new Error(response.status === 404
          ? '当前 Agent Host 尚未提供 Trace 投影。'
          : String(body.error ?? 'Agent Trace 暂不可用'))
      }
      if (loadedKeyRef.current === key) {
        const incoming = body.data as unknown as AgentTraceSnapshot
        setTrace((previous) => {
          const merged = after && previous?.sessionKey === key
            ? {
                ...incoming,
                events: [...previous.events, ...incoming.events]
                  .filter((event, index, all) => all.findIndex((candidate) => candidate.sequence === event.sequence) === index)
                  .slice(-300),
              }
            : incoming
          traceRef.current = merged
          return merged
        })
        setTraceNotice(null)
      }
    } catch (error) {
      if (loadedKeyRef.current === key) {
        setTraceNotice(error instanceof Error ? error.message : 'Agent Trace 暂不可用')
      }
    } finally {
      if (!quiet && loadedKeyRef.current === key) setTraceRefreshing(false)
    }
  }, [])

  const loadSession = useCallback(async (key: string) => {
    const trimmed = key.trim()
    if (!trimmed) return
    loadedKeyRef.current = trimmed
    setLoading(true)
    setTree(null)
    setTrace(null)
    traceRef.current = null
    setTreeNotice(null)
    setTraceNotice(null)
    setTraceFilter('all')
    setSelectedTurnId(null)
    setReplayStep(null)
    setLivePaused(false)

    const encoded = encodeURIComponent(trimmed)
    const [treeResult] = await Promise.allSettled([
      apiFetch(`/api/agent/sessions/${encoded}/tree`),
      loadTrace(trimmed),
    ])

    if (treeResult.status === 'fulfilled') {
      const body = await readJson(treeResult.value)
      if (treeResult.value.ok && body.success !== false) {
        setTree(body.data as unknown as SessionTree)
      } else {
        setTreeNotice(treeResult.value.status === 404
          ? '这段对话还没有形成可切换的 Agent 分支。'
          : String(body.error ?? '会话树暂不可用'))
      }
    } else {
      setTreeNotice('无法连接会话树服务。')
    }

    setSessionKey(trimmed)
    setHistory(pushAgentSessionHistory(trimmed))
    setSearchParams({ sessionKey: trimmed }, { replace: true })
    setLoading(false)
  }, [loadTrace, setSearchParams])

  useEffect(() => {
    void loadCapabilities()
  }, [loadCapabilities])

  useEffect(() => {
    const initial = keyFromUrl || history[0]
    if (initial && initial !== loadedKeyRef.current) void loadSession(initial)
    // 首次进入或 URL 深链变化时读取；history 由 loadSession 更新，不作为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyFromUrl, loadSession])

  useEffect(() => {
    if (!sessionKey || livePaused) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadTrace(sessionKey, true)
    }, 2_000)
    return () => window.clearInterval(timer)
  }, [livePaused, loadTrace, sessionKey])

  const selectSession = (key: string) => {
    if (key === sessionKey && (tree || treeNotice)) return
    void loadSession(key)
  }

  const connectedMcp = mcpServices.filter((item) => item.connected)
  const primaryBinding = bindings[0]
  const traceEvents = trace?.events ?? []
  const traceTurns = useMemo(
    () => summarizeTraceTurns(traceEvents, trace?.activeTurnIds ?? []),
    [trace?.activeTurnIds, traceEvents],
  )
  const scopedTraceEvents = useMemo(
    () => traceEvents.filter((event) =>
      (!selectedTurnId || event.turnId === selectedTurnId) && matchesTraceFilter(event, traceFilter)),
    [selectedTurnId, traceEvents, traceFilter],
  )
  const visibleTraceEvents = replayStep == null
    ? scopedTraceEvents.slice(-80)
    : scopedTraceEvents.slice(0, replayStep + 1)
  const toolExecutions = traceEvents.filter((event) => event.type === 'tool_call' || event.type === 'mcp_tool_call').length
  const problemCount = traceEvents.filter((event) => problemTraceTypes.has(event.type)).length
  const tokenCount = traceEvents
    .filter((event) => event.type === 'usage')
    .reduce((total, event) => total + usageTotal(event.data), 0)
  const completedDurations = traceTurns.map(traceDuration).filter((duration): duration is number => duration != null)
  const averageDuration = completedDurations.length
    ? Math.round(completedDurations.reduce((total, duration) => total + duration, 0) / completedDurations.length)
    : null

  useEffect(() => {
    if (replayStep != null && replayStep >= scopedTraceEvents.length) {
      setReplayStep(scopedTraceEvents.length ? scopedTraceEvents.length - 1 : null)
    }
  }, [replayStep, scopedTraceEvents.length])

  return (
    <div className="console-agent-studio">
      <PageHeader
        title="Agent Studio"
        description="沿着一段真实渠道会话，实时观察 Agent 的推理、工具、用量、分支和执行结果。"
        actions={
          <div className="flex items-center gap-2">
            {workroomRoute ? (
              <Button variant="outline" size="sm" asChild>
                <Link to={workroomRoute.path}><Workflow />Project Workroom</Link>
              </Button>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              disabled={!sessionKey || loading || traceRefreshing}
              onClick={() => void loadSession(sessionKey)}
            >
              <RefreshCw className={loading || traceRefreshing ? 'animate-spin' : ''} />刷新轨迹
            </Button>
          </div>
        }
      />

      <div className="console-studio-frame">
        <aside className="console-studio-conversations" aria-label="对话上下文">
          <div className="console-studio-pane-head">
            <div><span>Contexts</span><h2>对话上下文</h2></div>
            <Button variant="ghost" size="icon" asChild title="浏览渠道会话">
              <Link to="/endpoints"><MessagesSquare /></Link>
            </Button>
          </div>

          <div className="console-studio-context-list">
            {candidates.length ? candidates.map((key) => (
              <button
                key={key}
                type="button"
                className={cn('console-studio-context', key === sessionKey && 'is-active')}
                onClick={() => selectSession(key)}
                title={key}
              >
                <span>{key === sessionKey ? <Radio /> : <History />}</span>
                <SessionIdentity sessionKey={key} compact />
                <ArrowRight />
              </button>
            )) : (
              <div className="console-studio-context-empty">
                <MessagesSquare />
                <p>还没有对话上下文。先从渠道选择一段真实会话。</p>
                <Button size="sm" asChild><Link to="/endpoints">选择会话</Link></Button>
              </div>
            )}
          </div>

          <div className="console-studio-pane-foot">
            <span className={cn('console-studio-live-dot', connected && !traceNotice && !livePaused && 'is-online')} />
            <span>{connected ? livePaused ? 'Trace 实时同步已暂停' : 'Trace 每 2 秒增量同步' : 'Console 连接已断开'}</span>
          </div>
        </aside>

        <main className="console-studio-canvas">
          {sessionKey && parsed ? (
            <>
              <header className="console-studio-session-head">
                <div className="console-studio-session-mark"><Bot /></div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate">{parsed.sceneId}</h2>
                    <Badge variant="outline">{SESSION_SCOPE_LABELS[parsed.scope]}</Badge>
                    <span className={cn('console-studio-endpoint-state', endpoint?.connected && 'is-online')}>
                      {endpoint?.connected ? 'Endpoint 在线' : 'Endpoint 状态未知'}
                    </span>
                    {trace?.activeTurnIds.length ? (
                      <span className="console-studio-trace-live"><i />Agent 正在执行</span>
                    ) : null}
                  </div>
                  <p>{parsed.platform} / {parsed.endpointId} · Agent conversation</p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to={endpointPath}>
                    返回渠道<ExternalLink />
                  </Link>
                </Button>
              </header>

              <section className="console-studio-trace-console" aria-label="Agent Trace 诊断控制台">
                <div className="console-studio-trace-metrics">
                  <article>
                    <span><Activity />Turns</span>
                    <strong>{traceTurns.length}</strong>
                    <small>{trace?.activeTurnIds.length ? `${trace.activeTurnIds.length} active` : '已记录轮次'}</small>
                  </article>
                  <article>
                    <span><Wrench />Tools</span>
                    <strong>{toolExecutions}</strong>
                    <small>工具与 MCP 调用</small>
                  </article>
                  <article>
                    <span><Coins />Tokens</span>
                    <strong>{tokenCount.toLocaleString()}</strong>
                    <small>模型累计用量</small>
                  </article>
                  <article className={cn(problemCount > 0 && 'has-problem')}>
                    <span><AlertTriangle />Issues</span>
                    <strong>{problemCount}</strong>
                    <small>{problemCount ? '需要检查' : '未发现异常'}</small>
                  </article>
                  <article>
                    <span><Clock3 />Avg time</span>
                    <strong>{averageDuration == null ? '—' : compactDuration(averageDuration)}</strong>
                    <small>已完成轮次均值</small>
                  </article>
                </div>

                {traceTurns.length ? (
                  <div className="console-studio-turn-strip" aria-label="选择 Agent Turn">
                    <button
                      type="button"
                      className={cn(!selectedTurnId && 'is-active')}
                      onClick={() => { setSelectedTurnId(null); setReplayStep(null) }}
                    >
                      <span>All turns</span><small>{traceEvents.length} events</small>
                    </button>
                    {traceTurns.map((turn) => (
                      <button
                        key={turn.turnId}
                        type="button"
                        className={cn(selectedTurnId === turn.turnId && 'is-active', `is-${turn.status}`)}
                        onClick={() => { setSelectedTurnId(turn.turnId); setReplayStep(null) }}
                        title={turn.turnId}
                      >
                        <i />
                        <span>{shortTurnId(turn.turnId)}</span>
                        <small>{turn.eventCount} events · {compactDuration(traceDuration(turn))}</small>
                      </button>
                    ))}
                  </div>
                ) : null}

                <div className="console-studio-trace-controls">
                  <div className="console-studio-trace-filters" role="group" aria-label="筛选 Trace 事件">
                    {TRACE_FILTERS.map((filter) => (
                      <button
                        key={filter.id}
                        type="button"
                        aria-pressed={traceFilter === filter.id}
                        className={cn(traceFilter === filter.id && 'is-active')}
                        onClick={() => { setTraceFilter(filter.id); setReplayStep(null) }}
                      >{filter.label}</button>
                    ))}
                  </div>
                  <div className="console-studio-trace-playback">
                    {replayStep != null ? (
                      <span>{Math.min(replayStep + 1, scopedTraceEvents.length)} / {scopedTraceEvents.length}</span>
                    ) : null}
                    {replayStep != null ? (
                      <>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="上一个事件"
                          disabled={replayStep <= 0}
                          onClick={() => setReplayStep((step) => Math.max(0, (step ?? 0) - 1))}
                        ><SkipBack /></Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title="下一个事件"
                          disabled={replayStep >= scopedTraceEvents.length - 1}
                          onClick={() => setReplayStep((step) => Math.min(scopedTraceEvents.length - 1, (step ?? 0) + 1))}
                        ><SkipForward /></Button>
                      </>
                    ) : null}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={!scopedTraceEvents.length}
                      onClick={() => {
                        if (replayStep == null) {
                          setReplayStep(0)
                          setLivePaused(true)
                        } else {
                          setReplayStep(null)
                        }
                      }}
                    >{replayStep == null ? <Play /> : <XCircle />}{replayStep == null ? '逐步回放' : '退出回放'}</Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={replayStep != null}
                      aria-pressed={livePaused}
                      onClick={() => {
                        if (livePaused) void loadTrace(sessionKey, true)
                        setLivePaused((paused) => !paused)
                      }}
                    >{livePaused ? <Play /> : <Pause />}{livePaused ? '继续实时' : '暂停实时'}</Button>
                  </div>
                </div>
              </section>

              <div className="console-studio-flow" aria-label="Agent 执行轨迹">
                <div className="console-studio-flow-line" aria-hidden="true" />
                <article className="console-studio-event is-ingress">
                  <span className="console-studio-event-node"><MessagesSquare /></span>
                  <div>
                    <span className="console-eyebrow">Channel ingress</span>
                    <h3>真实渠道上下文已接入</h3>
                    <p>每一轮用户消息都从这段 {SESSION_SCOPE_LABELS[parsed.scope]} 会话进入 Agent。</p>
                  </div>
                  <Badge variant={endpoint?.connected ? 'success' : 'outline'}>
                    {endpoint?.connected ? 'live' : parsed.platform}
                  </Badge>
                </article>

                {loading ? (
                  <div className="space-y-3 py-3">
                    <Skeleton className="ml-5 h-24 w-[calc(100%-1.25rem)] rounded-2xl" />
                    <Skeleton className="ml-5 h-20 w-[calc(100%-1.25rem)] rounded-2xl" />
                  </div>
                ) : (
                  <>
                    {tree?.points.map((point) => {
                      const active = tree.activeLeafMessageId === point.messageId
                      return (
                        <article key={point.messageId} className={cn('console-studio-event', active && 'is-active')}>
                          <span className="console-studio-event-node"><GitBranch /></span>
                          <div>
                            <span className="console-eyebrow">Branch {point.index}</span>
                            <h3>{point.preview || `消息 #${point.messageId}`}</h3>
                            <p>message {point.messageId}{active ? ' · 下一轮将沿此分支继续' : ' · 历史分支点'}</p>
                          </div>
                          <Badge variant={active ? 'success' : 'outline'}>{active ? 'active' : 'branch'}</Badge>
                        </article>
                      )
                    })}

                    {visibleTraceEvents.map((event, index) => {
                      const presentation = tracePresentation(event)
                      const Icon = presentation.icon
                      const detail = traceDetail(event.data)
                      return (
                        <article
                          key={`${event.turnId}:${event.sequence}`}
                          className={cn(
                            'console-studio-event is-trace',
                            `is-${presentation.tone}`,
                            replayStep != null && index === visibleTraceEvents.length - 1 && 'is-replay-current',
                          )}
                        >
                          <span className="console-studio-event-node"><Icon /></span>
                          <div className="console-studio-event-content">
                            <span className="console-eyebrow">{presentation.eyebrow} · {displayTime(event.recordedAt)}</span>
                            <h3>{presentation.title}</h3>
                            {presentation.summary ? <p>{presentation.summary}</p> : null}
                            {detail !== '{}' ? (
                              <details className="console-studio-trace-detail">
                                <summary>查看事件详情 <ChevronDown /></summary>
                                <pre>{detail}</pre>
                              </details>
                            ) : null}
                          </div>
                          <Badge variant={presentation.tone === 'error' ? 'destructive' : presentation.tone === 'success' ? 'success' : 'outline'}>
                            {presentation.badge}
                          </Badge>
                        </article>
                      )
                    })}

                    {traceEvents.length > 0 && !scopedTraceEvents.length ? (
                      <div className="console-studio-awaiting is-filtered">
                        <span><Route /></span>
                        <div>
                          <h3>当前筛选没有匹配事件</h3>
                          <p>切换事件类型或选择其他 Turn，继续检查这段轨迹。</p>
                        </div>
                      </div>
                    ) : null}

                    {!tree?.points.length && !trace?.events.length ? (
                      <div className="console-studio-awaiting">
                        <span><CircleDashed /></span>
                        <div>
                          <h3>等待下一轮 Agent 活动</h3>
                          <p>{traceNotice || treeNotice || '在真实渠道继续对话，推理、工具调用和最终结果会自动出现在这里。'}</p>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <footer className="console-studio-actions">
                <div>
                  <Sparkles />
                  <span>
                    <strong>{replayStep != null ? '正在逐步回放当前轨迹' : livePaused ? '实时同步已暂停' : trace?.activeTurnIds.length ? 'Agent 正在处理这段对话' : '下一步发生在真实渠道'}</strong>
                    <small>{trace?.latestSequence ? `已接收 ${trace.latestSequence} 个 Trace 事件${livePaused ? '，恢复后继续增量同步。' : '，页面将自动同步。'}` : '发送消息后，这里会自动呈现完整执行轨迹。'}</small>
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={agentSessionsPath(sessionKey)}><GitBranch />管理分支</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link to={endpointPath}>
                      继续对话<ArrowRight />
                    </Link>
                  </Button>
                </div>
              </footer>
            </>
          ) : (
            <div className="console-studio-welcome">
              <div className="console-studio-signal" aria-hidden="true">
                <span><MessagesSquare /></span><i /><span><Brain /></span><i /><span><Wrench /></span><i /><span><Route /></span>
              </div>
              <span className="console-eyebrow">Agent operations</span>
              <h2>选择一段对话，查看 Agent 如何工作</h2>
              <p>Studio 不制造演示数据。它从真实渠道会话读取分支、运行状态和当前能力上下文。</p>
              <Button asChild><Link to="/endpoints"><MessagesSquare />选择渠道会话</Link></Button>
            </div>
          )}
        </main>

        <aside className="console-studio-inspector" aria-label="Agent 能力上下文">
          <div className="console-studio-pane-head">
            <div><span>Inspector</span><h2>能力上下文</h2></div>
            <Button variant="ghost" size="icon" asChild title="打开能力目录">
              <Link to="/introspection"><ExternalLink /></Link>
            </Button>
          </div>

          {capabilityLoading ? (
            <div className="space-y-3 p-3"><Skeleton className="h-28 rounded-xl" /><Skeleton className="h-40 rounded-xl" /></div>
          ) : (
            <div className="console-studio-inspector-body">
              <section className="console-studio-agent-card">
                <div className="console-studio-agent-mark"><Brain /></div>
                <span className="console-eyebrow">Active binding</span>
                <h3>{primaryBinding?.name ?? '未绑定 Agent'}</h3>
                <p>{primaryBinding ? `${primaryBinding.provider} / ${primaryBinding.model}` : '配置模型后即可处理渠道消息。'}</p>
                {primaryBinding?.hasAgentFile ? <span className="console-studio-agent-file"><Check />agent.md loaded</span> : null}
              </section>

              <section className="console-studio-inspector-section">
                <div className="console-studio-inspector-title"><span><Wrench />可调用工具</span><strong>{tools.length}</strong></div>
                {tools.slice(0, 5).map((tool) => (
                  <Link key={tool.name} to="/introspection?tab=tools" className="console-studio-tool-row">
                    <span>{tool.name}</span><small>{tool.source || 'local'}</small>
                  </Link>
                ))}
                {!tools.length ? <p className="console-studio-inspector-empty">当前没有注册工具。</p> : null}
              </section>

              <section className="console-studio-inspector-section">
                <div className="console-studio-inspector-title"><span><Server />MCP services</span><strong>{connectedMcp.length}/{mcpServices.length}</strong></div>
                {mcpServices.slice(0, 4).map((service) => (
                  <Link key={service.name} to="/introspection?tab=mcp" className="console-studio-mcp-row">
                    <span className={cn('console-studio-live-dot', service.connected && 'is-online')} />
                    <span>{service.name}</span><small>{service.toolCount} tools</small>
                  </Link>
                ))}
                {!mcpServices.length ? <p className="console-studio-inspector-empty">没有配置 MCP 服务，Agent 仍可使用本地工具。</p> : null}
              </section>

              <section className="console-studio-inspector-section is-links">
                <Link to={sessionKey ? agentSessionsPath(sessionKey) : '/agent/sessions'}><GitBranch />对话分支<ArrowRight /></Link>
                {workroomRoute ? <Link to={workroomRoute.path}><Workflow />Project Workroom<ArrowRight /></Link> : null}
                <Link to="/agent/workbench"><PlugZap />Agent 概览<ArrowRight /></Link>
              </section>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
