import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { summarizeOptional } from './dashboard-health'
import { useCallback, useEffect, useState } from 'react'
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
import { cn } from '@zhin.js/client'
import { CONSOLE_REST, ENDPOINT_RPC } from '../contracts/zhin-console'
import { apiFetch } from '../utils/auth'
import { requestConsole } from '../utils/console-rpc'
import { loadAgentSessionHistory } from '../utils/agent-session-history'
import {
  agentSessionsPath,
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
  note?: string
}

async function fetchIntrospection<T>(kind: string, locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<IntrospectionEnvelope<T>> {
  const response = await apiFetch(`${CONSOLE_REST.INTROSPECTION}/${kind}?page=1&pageSize=100`)
  const body = await response.json()
  if (!response.ok || body.success === false) {
    throw new Error(body.error ?? translate(locale, "无法读取 {0}", [kind]))
  }
  return body.data as IntrospectionEnvelope<T>
}

function SessionCard({ sessionKey }: { sessionKey: string }) {
  const i18n = useI18n()
  const parsed = parseImSessionKey(sessionKey)
  return (
    <Link to={agentSessionsPath(sessionKey)} className="console-agent-session-card" title={sessionKey}>
      <span className="console-agent-session-icon"><GitBranch /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">
          {parsed?.sceneId ?? i18n.t("自定义会话")}
        </span>
        <span className="mt-1 block truncate console-text-label text-muted-foreground">
          {parsed
            ? `${parsed.platform} · ${parsed.endpointId} · ${i18n.t(SESSION_SCOPE_LABELS[parsed.scope])}`
            : sessionKey}
        </span>
      </span>
      <ArrowUpRight />
    </Link>
  )
}

export default function AgentWorkbenchPage() {
  const i18n = useI18n()
  const [bindings, setBindings] = useState<BindingItem[]>([])
  const [tools, setTools] = useState<ToolItem[]>([])
  const [mcpServices, setMcpServices] = useState<McpItem[]>([])
  const [endpoints, setEndpoints] = useState<EndpointItem[]>([])
  const [agentStatus, setAgentStatus] = useState<'unknown' | 'unavailable' | 'available'>('unknown')
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history] = useState(() => loadAgentSessionHistory())

  const loadWorkbench = useCallback(async (background = false) => {
    if (background) setRefreshing(true)
    try {
      const [bindingData, toolData, mcpData] = await Promise.all([
        fetchIntrospection<BindingItem>('bindings', i18n.locale),
        fetchIntrospection<ToolItem>('tools', i18n.locale),
        fetchIntrospection<McpItem>('mcp', i18n.locale),
      ])
      setAgentStatus(summarizeOptional(null, bindingData).agentStatus)
      setBindings(bindingData.items ?? [])
      setTools(toolData.items ?? [])
      setMcpServices(mcpData.items ?? [])

      const endpointData = await requestConsole<{ endpoints: EndpointItem[] }>({ type: ENDPOINT_RPC.LIST })
      setEndpoints(endpointData.endpoints)
      setError(null)
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [i18n])

  useEffect(() => {
    void loadWorkbench()
  }, [loadWorkbench])

  const connectedMcp = mcpServices.filter((service) => service.connected).length
  const onlineEndpoints = endpoints.filter((endpoint) => endpoint.connected).length
  const ready = agentStatus !== 'unavailable' && bindings.length > 0 && onlineEndpoints > 0

  const readiness = [
    {
      label: i18n.t("渠道入口"),
      detail: i18n.t("{0} / {1} 个 Endpoint 在线", [onlineEndpoints, endpoints.length]),
      ready: onlineEndpoints > 0,
      path: '/endpoints',
    },
    {
      label: i18n.t("Agent 绑定"),
      detail: agentStatus === 'unavailable' ? i18n.t("未安装或装配 Agent") : bindings.length ? i18n.t("{0} 个 Agent 配置绑定", [bindings.length]) : i18n.t("尚未配置模型与 Agent"),
      ready: bindings.length > 0,
      path: bindings.length ? '/introspection?tab=bindings' : '/config',
    },
    {
      label: i18n.t("工具目录"),
      detail: tools.length ? i18n.t("{0} 个工具已注册", [tools.length]) : i18n.t("当前没有可调用工具"),
      ready: tools.length > 0,
      path: '/introspection?tab=tools',
    },
    {
      label: i18n.t("MCP 连接"),
      detail: mcpServices.length ? i18n.t("{0} / {1} 个服务已连接", [connectedMcp, mcpServices.length]) : i18n.t("未配置 MCP 服务"),
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
        title={i18n.t("机器人状态")}
        description={i18n.t("检查 Agent 配置与渠道状态，选择下一步操作。")}
        actions={
          <Button variant="outline" size="sm" onClick={() => void loadWorkbench(true)} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            {i18n.t("刷新")}</Button>
        }
      />

      <section className="console-agent-hero" aria-label={i18n.t("Agent 就绪状态")}>
        <div className="console-agent-summary-row">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              {!error && ready ? <CheckCircle2 /> : <CircleDashed />}
              {error ? i18n.t("当前状态未确认") : ready ? i18n.t("配置与渠道已齐备") : i18n.t("继续完成 Agent 配置")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {error ? i18n.t("本次读取未完成，下方可能保留上次数据。请先重试读取。")
                : ready ? i18n.t("可以打开会话验证模型连接与实际对话结果。")
                  : i18n.t("先处理下列缺项，再通过真实会话确认收发与模型连接。")}
            </p>
            {!error && !ready ? (
              <ul className="console-agent-missing" aria-label={i18n.t("待完成配置")}>
                {agentStatus === 'unavailable' ? <li><Link to="/config">{i18n.t("安装并装配可选 Agent 能力 →")}</Link></li>
                  : bindings.length === 0 ? <li><Link to="/config">{i18n.t("配置模型与 Agent 绑定 →")}</Link></li> : null}
                {onlineEndpoints === 0 ? <li><Link to="/endpoints">{i18n.t("连接一个机器人渠道 →")}</Link></li> : null}
              </ul>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {error ? <Button variant="outline" onClick={() => void loadWorkbench(true)} disabled={refreshing}><RefreshCw />{i18n.t("重试读取")}</Button>
              : ready ? <Button asChild><Link to="/agent/sessions"><GitBranch />{i18n.t("打开聊天记录")}</Link></Button>
                : <Button asChild><Link to={agentStatus === 'unavailable' || bindings.length === 0 ? '/config' : '/endpoints'}><Settings2 />{agentStatus === 'unavailable' || bindings.length === 0 ? i18n.t("配置 Agent") : i18n.t("连接渠道")}</Link></Button>}
          </div>
        </div>
        <details className="console-agent-state-explanation">
          <summary>{i18n.t("状态说明")}</summary>
          <p>{i18n.t("此处展示已发现的配置与渠道状态；模型连接及实际对话结果需在对应会话中验证。选择下方 Agent 查看模型与 MCP 服务，或从最近对话检查分支。")}</p>
        </details>

        <div className="console-agent-metrics">
          <div><Brain /><span>Agent</span><strong>{bindings.length}</strong></div>
          <div><Wrench /><span>{i18n.t("工具")}</span><strong>{tools.length}</strong></div>
          <div><Server /><span>MCP</span><strong>{connectedMcp}<small> / {mcpServices.length}</small></strong></div>
          <div><Bot /><span>{i18n.t("在线渠道")}</span><strong>{onlineEndpoints}<small> / {endpoints.length}</small></strong></div>
        </div>
      </section>

      {error ? <ErrorAlert error={error} onRetry={() => loadWorkbench()} /> : null}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.35fr)_minmax(18rem,0.65fr)]">
        <section className="console-dashboard-panel" aria-labelledby="agents-title">
          <div className="console-panel-heading">
            <div>
              <h2 id="agents-title">{i18n.t("Agent 配置绑定")}</h2>
              <p>{i18n.t("每个绑定展示已配置的 Provider、模型和已声明的 MCP 服务；声明不代表 Agent 已启用或 MCP 已连接。")}</p>
            </div>
            <Link
              to="/introspection?tab=bindings"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }))}
            >
              {i18n.t("能力目录")}<ArrowUpRight />
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
                    <p>{binding.provider || i18n.t("默认 Provider")} · {binding.model || i18n.t("默认模型")}</p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      {(binding.mcpServers ?? []).length ? binding.mcpServers.map((server) => (
                        <span key={server}><PlugZap />{server}</span>
                      )) : <span><Sparkles />{i18n.t("未声明 MCP 服务")}</span>}
                    </div>
                  </div>
                  <Link to="/introspection?tab=bindings" aria-label={i18n.t("查看 {0} 详情", [binding.name])}><ArrowUpRight /></Link>
                </article>
              ))}
            </div>
          ) : (
            <div className="console-agent-empty">
              <Brain />
              <div><h3>{agentStatus === 'unavailable' ? i18n.t("未安装或装配 Agent") : i18n.t("尚未发现 Agent 绑定")}</h3><p>{agentStatus === 'unavailable' ? i18n.t("IM 核心可独立使用；需要 AI 时先安装 @zhin.js/agent、zod、ai 和所选 Provider，再配置模型。") : i18n.t("Agent 是可选能力，IM 核心可独立使用。需要 AI 时安装 @zhin.js/agent、zod、ai 和所选 Provider，然后配置模型与 Agent。")}</p></div>
              <Button size="sm" asChild><Link to="/config">{i18n.t("打开配置")}</Link></Button>
            </div>
          )}
        </section>

        <aside className="console-dashboard-panel" aria-labelledby="readiness-title">
          <div className="console-panel-heading">
            <div>
              <h2 id="readiness-title">{i18n.t("能力链路")}</h2>
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
            <h2 id="recent-title">{i18n.t("最近的 Agent 对话")}</h2>
          </div>
          <Button variant="ghost" size="sm" asChild><Link to="/endpoints">{i18n.t("全部渠道")}<ArrowUpRight /></Link></Button>
        </div>

        {history.length ? (
          <div className="console-agent-session-grid">
            {history.slice(0, 6).map((key) => <SessionCard key={key} sessionKey={key} />)}
          </div>
        ) : (
          <div className="console-agent-empty is-compact">
            <MessagesSquare />
            <div><h3>{i18n.t("最近还没有打开过 Agent 对话")}</h3><p>{i18n.t("前往渠道会话，选择一个对话后点击分支图标即可开始。")}</p></div>
            <Button size="sm" asChild><Link to="/endpoints">{i18n.t("选择会话")}</Link></Button>
          </div>
        )}
      </section>

      <section className="console-agent-shortcuts" aria-label={i18n.t("Agent 快捷入口")}>
        <Link to="/introspection?tab=tools"><Wrench /><span><strong>{i18n.t("工具目录")}</strong><small>{i18n.t("查看输入与来源")}</small></span><ArrowUpRight /></Link>
        <Link to="/introspection?tab=mcp"><Server /><span><strong>{i18n.t("MCP 服务")}</strong><small>{i18n.t("检查连接健康度")}</small></span><ArrowUpRight /></Link>
        <Link to="/agent/sessions"><GitBranch /><span><strong>{i18n.t("聊天记录")}</strong><small>{i18n.t("继续最近上下文")}</small></span><ArrowUpRight /></Link>
        <Link to="/agent/workrooms"><Workflow /><span><strong>{i18n.t("Workroom 看板")}</strong><small>{i18n.t("按 Project 查看 Run、Task 与 Assignment")}</small></span><ArrowUpRight /></Link>
      </section>
    </div>
  )
}
