import { useI18n } from '../../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Bot,
  Boxes,
  Link2,
  Network,
  Package,
  RefreshCw,
  ScrollText,
  Search,
  Server,
  ShieldCheck,
  Terminal,
  Wrench,
} from 'lucide-react'
import { CONSOLE_REST, FEATURE_RPC } from '../../contracts/zhin-console'
import { apiFetch, getApiBase } from '../../utils/auth'
import { requestConsole } from '../../utils/console-rpc'
import { PageHeader } from '../../components/PageHeader'
import { PageShell } from '../../components/PageShell'
import { StatusState } from '../../components/StatusState'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { CONSOLE_PATHS, featureGlobalHref } from '../../console-routes.mjs'
import { readFeatureMatrix, type FeatureMatrix } from '../features/feature-model.mjs'
import { capabilityPlugins, pluginScopeSummary, scopeSummaryLine } from '../plugin-scope-model.mjs'
import { CapabilityExplorer } from './CapabilityExplorer'
import '../plugins.css'
import type { CapabilityItem, IntrospectionTab } from './capability-model'

export type { IntrospectionTab } from './capability-model'

const TAB_CONFIG: Record<
  IntrospectionTab,
  { label: string; pageSize: number; icon: typeof Terminal; description: string }
> = {
  commands: { label: '命令', pageSize: 25, icon: Terminal, description: '聊天里可以调用的命令：模式、参数、别名与权限规则。' },
  middlewares: { label: '中间件', pageSize: 30, icon: Network, description: '消息进出时依次经过的处理环节与顺序。' },
  components: { label: '组件', pageSize: 30, icon: Boxes, description: '插件提供的消息组件，可在这里预览输出。' },
  endpoints: { label: '聊天账号', pageSize: 30, icon: Bot, description: '当前运行代登记的聊天账号端点。' },
  bindings: { label: 'Agent 绑定', pageSize: 30, icon: Link2, description: 'Agent 绑定仅表示配置关系，不代表已启用。' },
  tools: { label: '工具', pageSize: 15, icon: Wrench, description: 'Agent 可以调用的工具及其来源。' },
  'prompt-sections': { label: '提示词片段', pageSize: 20, icon: ScrollText, description: '拼进系统提示词的片段：层级、顺序与保留策略。' },
  mcp: { label: 'MCP 服务', pageSize: 30, icon: Server, description: '请结合连接状态判断服务是否可用。' },
}

const VALID_TABS = new Set<string>(Object.keys(TAB_CONFIG))
/** Tabs whose rows name the plugin that provides them (owner / plugin / source). */
const PROVIDED_BY_PLUGINS = new Set<IntrospectionTab>(['commands', 'middlewares', 'components', 'tools', 'prompt-sections'])

interface IntrospectionEnvelope {
  items: CapabilityItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  filter?: string
  note?: string
}

function parseTab(value: string | null): IntrospectionTab {
  return value && VALID_TABS.has(value) ? value as IntrospectionTab : 'commands'
}

export default function IntrospectionPage() {
  const i18n = useI18n()
  const readOnly = !hasConsolePermission('feature.configure')
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = parseTab(searchParams.get('tab'))
  const filterFromUrl = searchParams.get('filter') ?? ''
  const [tab, setTab] = useState<IntrospectionTab>(tabFromUrl)
  const [query, setQuery] = useState(filterFromUrl)
  const [appliedFilter, setAppliedFilter] = useState(filterFromUrl)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<IntrospectionEnvelope | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<unknown>(null)
  const [matrix, setMatrix] = useState<FeatureMatrix | null>(null)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)

  const load = useCallback(async (
    targetTab: IntrospectionTab,
    targetPage: number,
    targetFilter: string,
  ) => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = ++requestRef.current
    setLoading(true)
    setError(null)
    try {
      const config = TAB_CONFIG[targetTab]
      const params = new URLSearchParams({
        page: String(targetPage),
        pageSize: String(config.pageSize),
      })
      if (targetFilter.trim()) params.set('filter', targetFilter.trim())
      const response = await apiFetch(
        `${CONSOLE_REST.INTROSPECTION}/${targetTab}?${params}`,
        { signal: controller.signal },
      )
      const body = await response.json().catch(() => null) as {
        success: boolean
        data?: IntrospectionEnvelope
        error?: string
        code?: string
      } | null
      if (!response.ok || body?.success !== true || !body.data) {
        throw Object.assign(new Error(body?.error ?? `HTTP ${response.status}`), body?.code ? { details: { serverCode: body.code } } : {})
      }
      const envelope = body.data
      // 加载更多: a later page appends to what is shown.
      if (requestId === requestRef.current) setData(previous => targetPage > 1 && previous ? { ...envelope, items: [...previous.items, ...envelope.items] } : envelope)
    } catch (caught) {
      if (!controller.signal.aborted && requestId === requestRef.current) {
        if (targetPage === 1) setData(null)
        setError(caught)
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(tab, page, appliedFilter)
    return () => abortRef.current?.abort()
  }, [appliedFilter, load, page, tab])

  useEffect(() => {
    setTab(tabFromUrl)
    setQuery(filterFromUrl)
    setAppliedFilter(filterFromUrl)
    setPage(1)
  }, [filterFromUrl, tabFromUrl])

  // The scope summary of the providing plugins (feature.matrix); optional, read once.
  useEffect(() => {
    if (!hasConsolePermission('feature.view')) return
    let cancelled = false
    requestConsole<unknown>({ type: FEATURE_RPC.MATRIX }).then(payload => { if (!cancelled) setMatrix(readFeatureMatrix(payload)) }, () => { if (!cancelled) setMatrix(null) })
    return () => { cancelled = true }
  }, [])

  const sourceUrl = useMemo(() => {
    const config = TAB_CONFIG[tab]
    const params = new URLSearchParams({ page: String(page), pageSize: String(config.pageSize) })
    if (appliedFilter) params.set('filter', appliedFilter)
    return `${getApiBase()}${CONSOLE_REST.INTROSPECTION}/${tab}?${params}`
  }, [appliedFilter, page, tab])

  const selectTab = (next: string) => {
    const parsed = parseTab(next)
    setTab(parsed)
    setPage(1)
    setData(null)
    const params = new URLSearchParams()
    params.set('tab', parsed)
    if (appliedFilter) params.set('filter', appliedFilter)
    setSearchParams(params, { replace: true })
  }

  const applyFilter = useCallback((value: string) => {
    const normalized = value.trim()
    if (normalized === appliedFilter) return
    setAppliedFilter(normalized)
    setPage(1)
    const params = new URLSearchParams({ tab })
    if (normalized) params.set('filter', normalized)
    setSearchParams(params, { replace: true })
  }, [appliedFilter, tab, setSearchParams])

  // Search pauses 300 ms before querying (Console 规范 §列表与详情).
  useEffect(() => {
    const timer = setTimeout(() => applyFilter(query), 300)
    return () => clearTimeout(timer)
  }, [query, applyFilter])

  const clearFilter = () => {
    setQuery('')
    setAppliedFilter('')
    setPage(1)
    setSearchParams(new URLSearchParams({ tab }), { replace: true })
  }

  const providers = PROVIDED_BY_PLUGINS.has(tab) ? capabilityPlugins(data?.items ?? []) : []
  const hasMore = Boolean(data && data.page < data.totalPages)

  return (
    <PageShell className="max-w-[1600px]">
      <PageHeader
        title={i18n.t("运行时能力")}
        description={i18n.t("高级原始视图：当前运行代注册的命令、中间件、组件、工具、提示词与 MCP。哪个插件提供、对哪些范围开放，看下方摘要并链到插件和对象树。")}
        actions={<>
          <Button variant="outline" size="sm" asChild><Link to={CONSOLE_PATHS.permissions}><ShieldCheck />{i18n.t("命令权限说明")}</Link></Button>
          <Button variant="outline" size="sm" disabled={loading} aria-busy={loading || undefined} onClick={() => { setPage(1); void load(tab, 1, appliedFilter) }}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
        </>}
      />

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto p-1" aria-label={i18n.t("运行时能力分类")}>
          {(Object.keys(TAB_CONFIG) as IntrospectionTab[]).map((key) => {
            const Icon = TAB_CONFIG[key].icon
            return <TabsTrigger key={key} value={key} className="shrink-0 gap-1.5"><Icon className="h-4 w-4" />{i18n.t(TAB_CONFIG[key].label)}</TabsTrigger>
          })}
        </TabsList>

        {(Object.keys(TAB_CONFIG) as IntrospectionTab[]).map((key) => (
          <TabsContent key={key} value={key} className="mt-4 space-y-4">
            <p className="text-sm text-muted-foreground">{i18n.t(TAB_CONFIG[key].description)}</p>
            {key === tab && providers.length ? <ProviderSummary plugins={providers} matrix={matrix} /> : null}
            <section className="console-dashboard-panel overflow-hidden">
              <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative min-w-0 flex-1 sm:max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => { if (event.key === 'Enter') applyFilter(query) }}
                    placeholder={i18n.t("筛选名称、来源或描述…")}
                    aria-label={i18n.t("筛选{0}", [i18n.t(TAB_CONFIG[key].label)])}
                    className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <span className="text-xs text-muted-foreground">
                  {data ? i18n.t("共 {0} 条，已显示 {1} 条", [data.total, data.items.length]) : '—'}
                </span>
              </div>

              {error && key === tab ? (
                <div className="p-4"><StatusState compact error={error} onRetry={() => void load(tab, page, appliedFilter)} /></div>
              ) : null}

              {data?.note ? (
                <p className="m-4 rounded-md bg-muted p-3 text-sm text-muted-foreground">{data.note}</p>
              ) : null}

              {loading && !data ? (
                <StatusState kind="loading" className="p-4" placeholder={<div className="space-y-2">
                  {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}
                </div>} />
              ) : error && !data ? null : (
                <CapabilityExplorer
                  kind={key}
                  items={data?.items ?? []}
                  readOnly={readOnly}
                  filter={appliedFilter}
                  total={data?.total ?? 0}
                  onClearFilter={clearFilter}
                />
              )}

              <footer className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center">
                <details className="min-w-0 flex-1 text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t("技术信息")}</summary><p className="mt-2 break-all">API：{sourceUrl}</p></details>
                {hasMore ? (
                  <Button variant="outline" size="sm" disabled={loading} aria-busy={loading || undefined} onClick={() => setPage(value => value + 1)}>
                    {loading ? i18n.t("加载中…") : i18n.t("加载更多")}
                  </Button>
                ) : null}
              </footer>
            </section>
          </TabsContent>
        ))}
      </Tabs>
    </PageShell>
  )
}

/** 用户层摘要: which plugins provide the rows shown, and where they are switched on. */
function ProviderSummary({ plugins, matrix }: { plugins: readonly string[]; matrix: FeatureMatrix | null }) {
  const i18n = useI18n()
  return (
    <section className="rounded-[var(--console-radius-lg)] border bg-card p-4" aria-label={i18n.t("能力由哪些插件提供")}>
      <p className="console-section-title">{i18n.t("这些能力由 {0} 个插件提供", [plugins.length])}</p>
      <p className="mt-1 text-sm text-muted-foreground">{i18n.t("开关不在这里改：点插件看详情，点「功能」去对象树设置范围。")}</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {plugins.map(plugin => {
          const summary = matrix ? pluginScopeSummary(matrix, plugin) : null
          return (
            <li key={plugin} className="console-plugin-scope-chip">
              <Package className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
              <Link to={`/plugins/${encodeURIComponent(plugin)}`} className="font-mono underline-offset-2 hover:underline" title={plugin}>{plugin}</Link>
              {matrix ? <Badge variant={summary?.global.enabled ? 'secondary' : 'outline'} size="sm">{scopeSummaryLine(summary, i18n.t)}</Badge> : null}
              <Link to={featureGlobalHref(plugin)} className="shrink-0 text-xs underline">{i18n.t("功能")}</Link>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
