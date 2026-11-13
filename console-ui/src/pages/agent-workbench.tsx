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
  History,
  MessagesSquare,
  PlugZap,
  RefreshCw,
  Server,
  Settings2,
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
import { PageShell } from '../components/PageShell'
import { StatusState } from '../components/StatusState'
import { CONSOLE_PATHS } from '../console-routes.mjs'
import { instanceSectionHref } from './ops/instance-sections.mjs'
import './insights/insights.css'
import { Button, buttonVariants } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { fetchAllIntrospection, type IntrospectionEnvelope } from './agent-workbench-model.mjs'

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

async function fetchIntrospectionPage<T>(kind: string, page: number, pageSize: number, locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<IntrospectionEnvelope<T>> {
  const response = await apiFetch(`${CONSOLE_REST.INTROSPECTION}/${kind}?page=${page}&pageSize=${pageSize}`)
  const body = await response.json()
  if (!response.ok || body.success === false) {
    throw new Error(body.error ?? translate(locale, "无法读取 {0}", [kind]))
  }
  return body.data as IntrospectionEnvelope<T>
}

/** The Host paginates introspection; read every page so counts and lists are never silently capped. */
function fetchIntrospection<T>(kind: string, locale: 'zh-CN' | 'en' = 'zh-CN') {
  return fetchAllIntrospection<T>((page, pageSize) => fetchIntrospectionPage<T>(kind, page, pageSize, locale))
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
  const [bindingTotal, setBindingTotal] = useState(0)
  const [toolTotal, setToolTotal] = useState(0)
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
      setBindings(bindingData.items)
      setBindingTotal(bindingData.total)
      setToolTotal(toolData.total)
      setMcpServices(mcpData.items)

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
  const disconnectedMcp = mcpServices.length - connectedMcp
  // 没装 Agent 是一种正常的部署（只用 IM），不是故障：不标红、不列「缺项」。
  const imOnly = !error && agentStatus === 'unavailable'

  const readiness = [
    {
      label: i18n.t("Agent 绑定"),
      detail: agentStatus === 'unavailable' ? i18n.t("未安装或装配 Agent") : bindings.length ? i18n.t("{0} 个 Agent 配置绑定", [bindingTotal]) : i18n.t("尚未配置模型与 Agent"),
      ready: bindings.length > 0,
      path: bindings.length ? '/introspection?tab=bindings' : '/ops/config',
    },
    {
      label: i18n.t("工具目录"),
      detail: toolTotal ? i18n.t("{0} 个工具已注册", [toolTotal]) : i18n.t("当前没有可调用工具"),
      ready: toolTotal > 0,
      path: '/introspection?tab=tools',
    },
    {
      label: i18n.t("MCP 连接"),
      detail: mcpServices.length ? i18n.t("{0} / {1} 个服务已连接", [connectedMcp, mcpServices.length]) : i18n.t("未配置 MCP 服务"),
      ready: mcpServices.length === 0 || connectedMcp === mcpServices.length,
      path: '/introspection?tab=mcp',
    },
    {
      label: i18n.t("可对话的聊天账号"),
      detail: i18n.t("{0} / {1} 个聊天账号在线", [onlineEndpoints, endpoints.length]),
      ready: onlineEndpoints > 0,
      path: '/scope',
    },
  ]

  if (loading) {
    return (
      <StatusState kind="loading" title={i18n.t("正在读取机器人状态")} placeholder={<div className="space-y-5">
        <Skeleton className="h-56 rounded-[1.6rem]" />
        <div className="grid gap-5 lg:grid-cols-[1.4fr_0.7fr]">
          <Skeleton className="h-96 rounded-[1.4rem]" />
          <Skeleton className="h-96 rounded-[1.4rem]" />
        </div>
      </div>} />
    )
  }

  return (
    <PageShell className="console-agent-workbench">
      <PageHeader
        title={i18n.t("机器人状态")}
        description={i18n.t("AI 是否就绪、Agent 绑定了哪些模型与服务、下一步做什么。进程与实例的运行状态在「实例」页。")}
        actions={<>
          <Button variant="ghost" size="sm" asChild><Link to={instanceSectionHref('status', CONSOLE_PATHS.opsInstance)}><Server />{i18n.t("实例运行状态")}<ArrowUpRight /></Link></Button>
          <Button variant="outline" size="sm" onClick={() => void loadWorkbench(true)} disabled={refreshing}>
            <RefreshCw className={refreshing ? 'animate-spin' : ''} />
            {i18n.t("刷新")}</Button>
        </>}
      />

      <section className="console-agent-hero" aria-label={i18n.t("Agent 就绪状态")}>
        <div className="console-agent-summary-row">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-base font-semibold">
              {!error && ready ? <CheckCircle2 /> : <CircleDashed />}
              {error ? i18n.t("当前状态未确认") : imOnly ? i18n.t("只用 IM：没有安装 Agent") : ready ? disconnectedMcp > 0 ? i18n.t("可以对话，但有服务未连接") : i18n.t("AI 配置与聊天账号已齐备") : i18n.t("继续完成 Agent 配置")}
            </h2>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              {error ? i18n.t("本次读取未完成，下方可能保留上次数据。请先重试读取。")
                : imOnly ? i18n.t("命令、插件和聊天账号照常工作；需要 AI 回复时再安装 Agent。")
                : ready ? i18n.t("可以打开会话验证模型连接与实际对话结果。")
                  : i18n.t("先处理下列缺项，再通过真实会话确认收发与模型连接。")}
            </p>
            {imOnly ? (
              <p className="mt-2 text-sm"><Link className="underline underline-offset-2" to="/ops/config">{i18n.t("安装并装配可选 Agent 能力 →")}</Link></p>
            ) : !error && (!ready || disconnectedMcp > 0) ? (
              <ul className="console-agent-missing" aria-label={i18n.t("待完成配置")}>
                {disconnectedMcp > 0 ? <li><Link to="/introspection?tab=mcp">{i18n.t("{0} 个 MCP 服务未连接，检查服务地址与凭据 →", [disconnectedMcp])}</Link></li> : null}
                {ready ? null : bindings.length === 0 ? <li><Link to={CONSOLE_PATHS.ai}>{i18n.t("配置模型与 Agent 绑定 →")}</Link></li> : null}
                {!ready && onlineEndpoints === 0 ? <li><Link to="/scope">{i18n.t("让一个聊天账号上线 →")}</Link></li> : null}
              </ul>
            ) : null}
          </div>
          <div className="flex shrink-0 flex-wrap gap-2">
            {error ? <Button variant="outline" onClick={() => void loadWorkbench(true)} disabled={refreshing}><RefreshCw />{i18n.t("重试读取")}</Button>
              : imOnly ? <Button variant="outline" asChild><Link to="/scope"><Bot />{i18n.t("查看聊天账号")}</Link></Button>
              : ready ? <Button asChild><Link to="/agent/sessions"><GitBranch />{i18n.t("打开聊天记录")}</Link></Button>
                : <Button asChild><Link to={bindings.length === 0 ? CONSOLE_PATHS.ai : '/scope'}><Settings2 />{bindings.length === 0 ? i18n.t("配置 Agent") : i18n.t("查看聊天账号")}</Link></Button>}
          </div>
        </div>
        <details className="console-agent-state-explanation">
          <summary>{i18n.t("状态说明")}</summary>
          <p>{i18n.t("此处展示已发现的 Agent 配置与聊天账号在线情况；模型连接及实际对话结果需在对应会话中验证。进程、内存与重启记录看「实例」页。")}</p>
        </details>

        <div className="console-agent-metrics">
          <div><Brain /><span>Agent</span><strong>{bindingTotal}</strong></div>
          <div><Wrench /><span>{i18n.t("工具")}</span><strong>{toolTotal}</strong></div>
          <div><Server /><span>MCP</span><strong>{connectedMcp}<small> / {mcpServices.length}</small></strong></div>
        </div>
      </section>

      {error ? <StatusState error={error} onRetry={() => void loadWorkbench()} /> : null}

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
                    <div className="mt-2 flex flex-wrap gap-1.5 empty:hidden">
                      {(binding.mcpServers ?? []).map((server) => (
                        <span key={server}><PlugZap />{server}</span>
                      ))}
                    </div>
                  </div>
                  <Link to="/introspection?tab=bindings" aria-label={i18n.t("查看 {0} 详情", [binding.name])}><ArrowUpRight /></Link>
                </article>
              ))}
              {bindingTotal > bindings.length ? (
                <p className="text-xs text-muted-foreground">
                  {i18n.t("仅显示前 {0} 个，共 {1} 个", [bindings.length, bindingTotal])}{' '}
                  <Link to="/introspection?tab=bindings" className="underline underline-offset-2">{i18n.t("在能力目录查看全部")}</Link>
                </p>
              ) : null}
            </div>
          ) : (
            <StatusState
              kind={agentStatus === 'unavailable' ? 'not-installed' : 'empty'}
              title={agentStatus === 'unavailable' ? i18n.t("未安装 Agent") : i18n.t("尚未发现 Agent 绑定")}
              description={agentStatus === 'unavailable' ? i18n.t("IM 核心可独立使用；需要 AI 时先安装 @zhin.js/agent、zod、ai 和所选 Provider，再配置模型。") : i18n.t("Agent 是可选能力，IM 核心可独立使用。需要 AI 时安装 @zhin.js/agent、zod、ai 和所选 Provider，然后配置模型与 Agent。")}
              actions={<Button size="sm" variant="outline" asChild><Link to={agentStatus === 'unavailable' ? '/ops/config' : CONSOLE_PATHS.ai}>{agentStatus === 'unavailable' ? i18n.t("打开配置") : i18n.t("AI 与模型")}</Link></Button>}
            />
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
                <span className="min-w-0 flex-1"><strong>{item.label}</strong><small>{imOnly && item.path !== '/scope' ? i18n.t("未安装 Agent，不适用") : item.detail}</small></span>
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
          <Button variant="ghost" size="sm" asChild><Link to="/scope">{i18n.t("全部会话")}<ArrowUpRight /></Link></Button>
        </div>

        {history.length ? (
          <div className="console-agent-session-grid">
            {history.slice(0, 6).map((key) => <SessionCard key={key} sessionKey={key} />)}
          </div>
        ) : (
          <div className="console-agent-empty is-compact">
            <MessagesSquare />
            <div><h3>{i18n.t("最近还没有打开过 Agent 对话")}</h3><p>{i18n.t("在账号与会话里选择一个对话，点击分支图标即可开始。")}</p></div>
            <Button size="sm" asChild><Link to="/scope">{i18n.t("选择会话")}</Link></Button>
          </div>
        )}
      </section>

      <section className="console-agent-shortcuts" aria-label={i18n.t("Agent 快捷入口")}>
        <Link to="/introspection?tab=tools"><Wrench /><span><strong>{i18n.t("工具目录")}</strong><small>{i18n.t("查看输入与来源")}</small></span><ArrowUpRight /></Link>
        <Link to="/introspection?tab=mcp"><Server /><span><strong>{i18n.t("MCP 服务")}</strong><small>{i18n.t("检查连接健康度")}</small></span><ArrowUpRight /></Link>
        <Link to="/agent/replay"><History /><span><strong>{i18n.t("决策回放")}</strong><small>{i18n.t("每次回或不回的原因")}</small></span><ArrowUpRight /></Link>
        <Link to="/agent/sessions"><GitBranch /><span><strong>{i18n.t("聊天记录")}</strong><small>{i18n.t("继续最近上下文")}</small></span><ArrowUpRight /></Link>
        <Link to="/features/ai/workrooms"><Workflow /><span><strong>{i18n.t("Workroom 看板")}</strong><small>{i18n.t("按 Project 查看 Run、Task 与 Assignment")}</small></span><ArrowUpRight /></Link>
      </section>
    </PageShell>
  )
}
