import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowUpRight,
  Bot,
  Brain,
  CheckCircle2,
  CircleDashed,
  GitBranch,
  MessagesSquare,
  PlugZap,
  RefreshCw,
  Server,
  Settings2,
  Sparkles,
  Workflow,
  Wrench,
} from 'lucide-react'
import { app, cn, useWebSocket } from '@zhin.js/client'
import { apiFetch } from '../utils/auth'
import { loadAgentSessionHistory } from '../utils/agent-session-history'
import {
  agentStudioPath,
  parseImSessionKey,
  SESSION_SCOPE_LABELS,
} from '../utils/agent-session'
import { PageHeader } from '../components/PageHeader'
import { Button, buttonVariants } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { ErrorAlert } from '../components/error-alert'

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
  total: number
}

async function fetchIntrospection<T>(kind: string): Promise<IntrospectionEnvelope<T>> {
  const response = await apiFetch(`/api/introspection/${kind}?page=1&pageSize=100`)
  const body = await response.json()
  if (!response.ok || body.success === false) {
    throw new Error(body.error ?? `无法读取 ${kind}`)
  }
  return body.data as IntrospectionEnvelope<T>
}

function SessionCard({ sessionKey }: { sessionKey: string }) {
  const parsed = parseImSessionKey(sessionKey)
  return (
    <Link to={agentStudioPath(sessionKey)} className="console-agent-session-card" title={sessionKey}>
      <span className="console-agent-session-icon"><GitBranch /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {parsed?.sceneId ?? '自定义会话'}
        </span>
        <span className="mt-1 block truncate text-[11px] text-muted-foreground">
          {parsed
            ? `${parsed.platform} · ${parsed.endpointId} · ${SESSION_SCOPE_LABELS[parsed.scope]}`
            : sessionKey}
        </span>
      </span>
      <ArrowUpRight />
    </Link>
  )
}

export default function AgentWorkbenchPage() {
  const { connected, sendRequest } = useWebSocket()
  const [bindings, setBindings] = useState<BindingItem[]>([])
  const [tools, setTools] = useState<ToolItem[]>([])
  const [mcpServices, setMcpServices] = useState<McpItem[]>([])
  const [endpoints, setEndpoints] = useState<EndpointItem[]>([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history] = useState(() => loadAgentSessionHistory())

  const routes = useSyncExternalStore(app.subscribe, () => app._getRoutes())
  const workroomRoute = useMemo(
    () => routes.find((route) => route.path.toLowerCase().includes('workroom')),
    [routes],
  )

  const loadWorkbench = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    try {
      const [bindingData, toolData, mcpData] = await Promise.all([
        fetchIntrospection<BindingItem>('bindings'),
        fetchIntrospection<ToolItem>('tools'),
        fetchIntrospection<McpItem>('mcp'),
      ])
      setBindings(bindingData.items ?? [])
      setTools(toolData.items ?? [])
      setMcpServices(mcpData.items ?? [])

      if (connected) {
        const endpointData = await sendRequest<{ endpoints: EndpointItem[] }>({ type: 'endpoint:list' })
        setEndpoints(endpointData.endpoints ?? [])
      }
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [connected, sendRequest])

  useEffect(() => {
    void loadWorkbench()
  }, [loadWorkbench])

  const connectedMcp = mcpServices.filter((service) => service.connected).length
  const onlineEndpoints = endpoints.filter((endpoint) => endpoint.connected).length
  const ready = bindings.length > 0 && onlineEndpoints > 0

  const readiness = [
    {
      label: '渠道入口',
      detail: `${onlineEndpoints} / ${endpoints.length} 个 Endpoint 在线`,
      ready: onlineEndpoints > 0,
      path: '/endpoints',
    },
    {
      label: 'Agent 绑定',
      detail: bindings.length ? `${bindings.length} 个 Agent 可用` : '尚未配置模型与 Agent',
      ready: bindings.length > 0,
      path: bindings.length ? '/introspection?tab=bindings' : '/config',
    },
    {
      label: '工具目录',
      detail: tools.length ? `${tools.length} 个工具已注册` : '当前没有可调用工具',
      ready: tools.length > 0,
      path: '/introspection?tab=tools',
    },
    {
      label: 'MCP 连接',
      detail: mcpServices.length ? `${connectedMcp} / ${mcpServices.length} 个服务已连接` : '未配置 MCP 服务',
      ready: mcpServices.length === 0 || connectedMcp === mcpServices.length,
      path: '/introspection?tab=mcp',
    },
  ]

  if (loading) {
    return (
      <div className="space-y-5">
        <Skeleton className="h-56 rounded-[1.6rem]" />
        <div className="grid gap-5 lg:grid-cols-[1.4fr_0.7fr]">
          <Skeleton className="h-96 rounded-[1.4rem]" />
          <Skeleton className="h-96 rounded-[1.4rem]" />
        </div>
      </div>
    )
  }

  return (
    <div className="console-agent-workbench space-y-5">
      <PageHeader
        title="Agent 工作台"
        description="从模型绑定到真实渠道会话，在一个地方确认 Agent 能力并继续最近的工作。"
        actions={
          <Button variant="outline" size="sm" onClick={() => void loadWorkbench(true)} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            刷新
          </Button>
        }
      />

      <section className="console-agent-hero" aria-label="Agent 就绪状态">
        <div className="console-agent-hero-orbit" aria-hidden="true" />
        <div className="relative z-10 grid gap-6 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <div>
            <div className="mb-4 flex items-center gap-2 text-sm font-medium text-primary">
              {ready ? <CheckCircle2 /> : <CircleDashed />}
              {ready ? 'Agent 已连接到真实会话' : '还差几步即可开始对话'}
            </div>
            <h2 className="max-w-3xl text-balance text-2xl font-semibold tracking-[-0.04em] sm:text-3xl">
              模型负责思考，工具负责行动，<br className="hidden sm:block" />渠道把结果送到用户身边
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              选择下方 Agent 查看它使用的模型与 MCP 服务，或从最近对话继续检查分支和运行记录。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild>
              <Link to="/agent/studio"><Sparkles />打开 Agent Studio</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/config"><Settings2 />配置 Agent</Link>
            </Button>
          </div>
        </div>

        <div className="console-agent-metrics">
          <div><Brain /><span>Agent</span><strong>{bindings.length}</strong></div>
          <div><Wrench /><span>工具</span><strong>{tools.length}</strong></div>
          <div><Server /><span>MCP</span><strong>{connectedMcp}<small> / {mcpServices.length}</small></strong></div>
          <div><Bot /><span>在线渠道</span><strong>{onlineEndpoints}<small> / {endpoints.length}</small></strong></div>
        </div>
      </section>

      {error ? <ErrorAlert error={error} onRetry={() => loadWorkbench()} /> : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <section className="console-dashboard-panel" aria-labelledby="agents-title">
          <div className="console-panel-heading">
            <div>
              <span className="console-eyebrow">Agent bindings</span>
              <h2 id="agents-title">可用 Agent</h2>
              <p>每个绑定都明确展示 Provider、模型和所连接的 MCP 服务。</p>
            </div>
            <Link
              to="/introspection?tab=bindings"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              能力目录<ArrowUpRight />
            </Link>
          </div>

          {bindings.length ? (
            <div className="console-agent-binding-list">
              {bindings.map((binding, index) => (
                <article key={`${binding.name}-${index}`} className="console-agent-binding-card">
                  <span className="console-agent-binding-icon"><Brain /></span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3>{binding.name}</h3>
                      {binding.hasAgentFile ? <span className="console-agent-file-mark">agent.md</span> : null}
                    </div>
                    <p>{binding.provider || '默认 Provider'} · {binding.model || '默认模型'}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(binding.mcpServers ?? []).length ? binding.mcpServers.map((server) => (
                        <span key={server}><PlugZap />{server}</span>
                      )) : <span><Sparkles />使用本地工具目录</span>}
                    </div>
                  </div>
                  <Link to="/introspection?tab=bindings" aria-label={`查看 ${binding.name} 详情`}><ArrowUpRight /></Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="console-agent-empty">
              <Brain />
              <div><h3>尚未发现 Agent 绑定</h3><p>安装并配置 @zhin.js/agent 后，这里会显示模型与能力关系。</p></div>
              <Button size="sm" asChild><Link to="/config">打开配置</Link></Button>
            </div>
          )}
        </section>

        <aside className="console-dashboard-panel" aria-labelledby="readiness-title">
          <div className="console-panel-heading">
            <div>
              <span className="console-eyebrow">Readiness</span>
              <h2 id="readiness-title">能力链路</h2>
            </div>
          </div>
          <div className="console-readiness-list">
            {readiness.map((item) => (
              <Link key={item.label} to={item.path} className="console-readiness-row">
                <span className={item.ready ? 'is-ready' : ''}>{item.ready ? <CheckCircle2 /> : <CircleDashed />}</span>
                <span className="min-w-0 flex-1"><strong>{item.label}</strong><small>{item.detail}</small></span>
                <ArrowUpRight />
              </Link>
            ))}
          </div>
        </aside>
      </div>

      <section className="console-dashboard-panel" aria-labelledby="recent-title">
        <div className="console-panel-heading">
          <div>
            <span className="console-eyebrow">Recent conversations</span>
            <h2 id="recent-title">最近的 Agent 对话</h2>
            <p>无需复制内部标识，直接回到对话分支或从渠道列表选择新会话。</p>
          </div>
          <Button variant="ghost" size="sm" asChild><Link to="/endpoints">全部渠道<ArrowUpRight /></Link></Button>
        </div>

        {history.length ? (
          <div className="console-agent-session-grid">
            {history.slice(0, 6).map((key) => <SessionCard key={key} sessionKey={key} />)}
          </div>
        ) : (
          <div className="console-agent-empty is-compact">
            <MessagesSquare />
            <div><h3>最近还没有打开过 Agent 对话</h3><p>前往渠道会话，选择一个对话后点击分支图标即可开始。</p></div>
            <Button size="sm" asChild><Link to="/endpoints">选择会话</Link></Button>
          </div>
        )}
      </section>

      <section className="console-agent-shortcuts" aria-label="Agent 快捷入口">
        <Link to="/introspection?tab=tools"><Wrench /><span><strong>工具目录</strong><small>查看输入与来源</small></span><ArrowUpRight /></Link>
        <Link to="/introspection?tab=mcp"><Server /><span><strong>MCP 服务</strong><small>检查连接健康度</small></span><ArrowUpRight /></Link>
        <Link to="/agent/sessions"><GitBranch /><span><strong>对话分支</strong><small>继续最近上下文</small></span><ArrowUpRight /></Link>
        <Link to={workroomRoute?.path ?? '/agent/orchestration'}><Workflow /><span><strong>{workroomRoute ? 'Workroom 看板' : '运行追踪'}</strong><small>{workroomRoute ? '配置 Bot、Agent 与角色关系' : '查看任务与执行结果'}</small></span><ArrowUpRight /></Link>
      </section>
    </div>
  )
}
