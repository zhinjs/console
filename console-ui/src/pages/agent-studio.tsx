import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity,
  ArrowRight,
  Bot,
  Brain,
  Check,
  CircleDashed,
  ExternalLink,
  GitBranch,
  History,
  MessagesSquare,
  PlugZap,
  Radio,
  RefreshCw,
  Route,
  Server,
  Sparkles,
  Workflow,
  Wrench,
} from 'lucide-react'
import { app, cn, useWebSocket } from '@zhin.js/client'
import { apiFetch } from '../utils/auth'
import {
  agentOrchestrationPath,
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

interface OrchestrationRun {
  runId: string
  status: string
  createdAt: number
  tasks?: Array<{ taskId: string; name: string; status: string }>
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

function statusTone(status: string): 'success' | 'destructive' | 'secondary' | 'outline' {
  if (status === 'completed' || status === 'accepted') return 'success'
  if (status === 'failed' || status === 'cancelled') return 'destructive'
  if (status === 'running' || status === 'active' || status === 'executing') return 'secondary'
  return 'outline'
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
  const [runs, setRuns] = useState<OrchestrationRun[]>([])
  const [bindings, setBindings] = useState<BindingItem[]>([])
  const [tools, setTools] = useState<ToolItem[]>([])
  const [mcpServices, setMcpServices] = useState<McpItem[]>([])
  const [endpoints, setEndpoints] = useState<EndpointItem[]>([])
  const [loading, setLoading] = useState(false)
  const [capabilityLoading, setCapabilityLoading] = useState(true)
  const [treeNotice, setTreeNotice] = useState<string | null>(null)
  const [runNotice, setRunNotice] = useState<string | null>(null)
  const loadedKeyRef = useRef('')
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

  const loadSession = useCallback(async (key: string) => {
    const trimmed = key.trim()
    if (!trimmed) return
    loadedKeyRef.current = trimmed
    setLoading(true)
    setTree(null)
    setRuns([])
    setTreeNotice(null)
    setRunNotice(null)

    const encoded = encodeURIComponent(trimmed)
    const [treeResult, runResult] = await Promise.allSettled([
      apiFetch(`/api/agent/sessions/${encoded}/tree`),
      apiFetch(`/api/agent/orchestration/runs?${new URLSearchParams({ sessionKey: trimmed })}`),
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

    if (runResult.status === 'fulfilled') {
      const body = await readJson(runResult.value)
      if (runResult.value.ok && body.success !== false) {
        const data = (body.data ?? body) as { runs?: OrchestrationRun[] }
        setRuns(data.runs ?? [])
      } else {
        setRunNotice(runResult.value.status === 404
          ? '当前版本使用 Project Workroom，旧会话编排记录不可用。'
          : String(body.error ?? '运行记录暂不可用'))
      }
    } else {
      setRunNotice('运行记录服务未连接。')
    }

    setSessionKey(trimmed)
    setHistory(pushAgentSessionHistory(trimmed))
    setSearchParams({ sessionKey: trimmed }, { replace: true })
    setLoading(false)
  }, [setSearchParams])

  useEffect(() => {
    void loadCapabilities()
  }, [loadCapabilities])

  useEffect(() => {
    const initial = keyFromUrl || history[0]
    if (initial && initial !== loadedKeyRef.current) void loadSession(initial)
    // 首次进入或 URL 深链变化时读取；history 由 loadSession 更新，不作为依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyFromUrl, loadSession])

  const selectSession = (key: string) => {
    if (key === sessionKey && (tree || treeNotice)) return
    void loadSession(key)
  }

  const connectedMcp = mcpServices.filter((item) => item.connected)
  const primaryBinding = bindings[0]

  return (
    <div className="console-agent-studio">
      <PageHeader
        title="Agent Studio"
        description="沿着一段真实渠道会话，观察 Agent 如何形成上下文、分支和执行结果。"
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
              disabled={!sessionKey || loading}
              onClick={() => void loadSession(sessionKey)}
            >
              <RefreshCw className={loading ? 'animate-spin' : ''} />刷新轨迹
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
            <span className={cn('console-studio-live-dot', connected && 'is-online')} />
            <span>{connected ? 'Console 实时连接正常' : 'Console 连接已断开'}</span>
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
                  </div>
                  <p>{parsed.platform} / {parsed.endpointId} · Agent conversation</p>
                </div>
                <Button variant="ghost" size="sm" asChild>
                  <Link to={`/endpoints/${encodeURIComponent(parsed.platform)}/${encodeURIComponent(parsed.endpointId)}`}>
                    返回渠道<ExternalLink />
                  </Link>
                </Button>
              </header>

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

                    {runs.map((run) => (
                      <article key={run.runId} className="console-studio-event is-run">
                        <span className="console-studio-event-node"><Activity /></span>
                        <div>
                          <span className="console-eyebrow">Agent run · {displayTime(run.createdAt)}</span>
                          <h3>{run.runId}</h3>
                          <p>{run.tasks?.length ?? 0} 个任务 · {run.status}</p>
                        </div>
                        <Badge variant={statusTone(run.status)}>{run.status}</Badge>
                      </article>
                    ))}

                    {!tree?.points.length && !runs.length ? (
                      <div className="console-studio-awaiting">
                        <span><CircleDashed /></span>
                        <div>
                          <h3>等待下一轮 Agent 活动</h3>
                          <p>{treeNotice || runNotice || '在真实渠道继续对话，新的分支和运行会出现在这条轨迹上。'}</p>
                        </div>
                      </div>
                    ) : null}
                  </>
                )}
              </div>

              <footer className="console-studio-actions">
                <div>
                  <Sparkles />
                  <span><strong>下一步发生在真实渠道</strong><small>发送消息后刷新轨迹，检查 Agent 的上下文与执行。</small></span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" asChild>
                    <Link to={agentSessionsPath(sessionKey)}><GitBranch />管理分支</Link>
                  </Button>
                  <Button size="sm" asChild>
                    <Link to={`/endpoints/${encodeURIComponent(parsed.platform)}/${encodeURIComponent(parsed.endpointId)}`}>
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
                <Link to={sessionKey ? agentOrchestrationPath(sessionKey) : '/agent/orchestration'}><Activity />旧运行记录<ArrowRight /></Link>
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
