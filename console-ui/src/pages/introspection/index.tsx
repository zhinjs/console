import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  Bot,
  Boxes,
  ChevronLeft,
  ChevronRight,
  Eye,
  Link2,
  Loader2,
  Network,
  RefreshCw,
  Search,
  Server,
  Terminal,
  Wrench,
} from 'lucide-react'
import { CodeBlock, cn } from '@zhin.js/client'
import {
  CONSOLE_REST,
  type SupportedIntrospectionKind,
} from '../../contracts/zhin-console'
import { apiFetch, getApiBase } from '../../utils/auth'
import { PageHeader } from '../../components/PageHeader'
import { PageShell } from '../../components/PageShell'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../../components/ui/tabs'
import { Textarea } from '../../components/ui/textarea'
import { isDemoMode } from '../../utils/demo-mode'
import { MessageBody } from '../endpoint-detail/MessageBody'
import type { ReceivedMessage } from '../endpoint-detail/types'

export type IntrospectionTab = SupportedIntrospectionKind

const TAB_CONFIG: Record<
  IntrospectionTab,
  { label: string; pageSize: number; icon: typeof Terminal }
> = {
  commands: { label: '命令', pageSize: 25, icon: Terminal },
  middlewares: { label: '中间件', pageSize: 30, icon: Network },
  components: { label: '组件', pageSize: 30, icon: Boxes },
  endpoints: { label: 'Endpoints', pageSize: 30, icon: Bot },
  bindings: { label: 'Agent 绑定', pageSize: 30, icon: Link2 },
  tools: { label: '工具', pageSize: 15, icon: Wrench },
  mcp: { label: 'MCP 服务', pageSize: 30, icon: Server },
}

const VALID_TABS = new Set<string>(Object.keys(TAB_CONFIG))

interface IntrospectionEnvelope {
  items: Array<Record<string, unknown>>
  page: number
  pageSize: number
  total: number
  totalPages: number
  filter?: string
  note?: string
}

const COLUMNS: Record<IntrospectionTab, Array<{ key: string; label: string }>> = {
  commands: [
    { key: 'pattern', label: '命令路由' },
    { key: 'desc', label: '说明' },
    { key: 'parameters', label: '参数契约' },
    { key: 'aliases', label: '别名' },
    { key: 'permissions', label: '权限' },
    { key: 'plugin', label: '来源' },
  ],
  middlewares: [
    { key: 'name', label: 'Middleware' },
    { key: 'phase', label: 'Phase' },
    { key: 'target', label: 'Target' },
    { key: 'order', label: 'Order' },
    { key: 'owner', label: 'Owner' },
    { key: 'source', label: 'Source' },
  ],
  components: [
    { key: 'name', label: 'Component' },
    { key: 'owner', label: 'Owner' },
    { key: 'source', label: 'Source' },
  ],
  endpoints: [
    { key: 'adapter', label: 'Adapter' },
    { key: 'name', label: 'Name' },
    { key: 'online', label: 'Online' },
    { key: 'status', label: 'Status' },
  ],
  bindings: [
    { key: 'name', label: 'Agent' },
    { key: 'provider', label: 'Provider' },
    { key: 'model', label: 'Model' },
    { key: 'mcpServers', label: 'MCP Servers' },
    { key: 'hasAgentFile', label: 'Agent File' },
  ],
  tools: [
    { key: 'name', label: 'Tool' },
    { key: 'description', label: 'Description' },
    { key: 'source', label: 'Source' },
  ],
  mcp: [
    { key: 'name', label: 'MCP Server' },
    { key: 'connected', label: 'Connected' },
    { key: 'toolCount', label: 'Tools' },
    { key: 'error', label: 'Error' },
  ],
}

function parseTab(value: string | null): IntrospectionTab {
  return value && VALID_TABS.has(value) ? value as IntrospectionTab : 'commands'
}

function renderCell(value: unknown): ReactNode {
  if (value == null || value === '') return <span className="text-muted-foreground">—</span>
  if (typeof value === 'boolean') return <Badge variant={value ? 'success' : 'secondary'}>{value ? '是' : '否'}</Badge>
  if (Array.isArray(value)) {
    if (!value.length) return <span className="text-muted-foreground">—</span>
    return value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ')
  }
  if (typeof value === 'object') return <code className="text-xs">{JSON.stringify(value)}</code>
  return String(value)
}

export default function IntrospectionPage() {
  const readOnly = isDemoMode()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabFromUrl = parseTab(searchParams.get('tab'))
  const filterFromUrl = searchParams.get('filter') ?? ''
  const [tab, setTab] = useState<IntrospectionTab>(tabFromUrl)
  const [query, setQuery] = useState(filterFromUrl)
  const [appliedFilter, setAppliedFilter] = useState(filterFromUrl)
  const [page, setPage] = useState(1)
  const [data, setData] = useState<IntrospectionEnvelope | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const previewAbortRef = useRef<AbortController | null>(null)
  const [previewComponent, setPreviewComponent] = useState<{ name: string; owner: string } | null>(null)
  const [previewProps, setPreviewProps] = useState('{}')
  const [previewOutput, setPreviewOutput] = useState<unknown>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)

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
      const body = await response.json() as {
        success: boolean
        data?: IntrospectionEnvelope
        error?: string
      }
      if (!response.ok || body.success !== true || !body.data) {
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      if (requestId === requestRef.current) setData(body.data)
    } catch (caught) {
      if (!controller.signal.aborted && requestId === requestRef.current) {
        setData(null)
        setError(caught instanceof Error ? caught.message : String(caught))
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

  useEffect(() => {
    if (tab === 'components') return
    previewAbortRef.current?.abort()
    setPreviewComponent(null)
    setPreviewOutput(null)
    setPreviewError(null)
  }, [tab])

  useEffect(() => () => previewAbortRef.current?.abort(), [])

  const columns = COLUMNS[tab]
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

  const applyFilter = () => {
    const normalized = query.trim()
    setAppliedFilter(normalized)
    setPage(1)
    const params = new URLSearchParams({ tab })
    if (normalized) params.set('filter', normalized)
    setSearchParams(params, { replace: true })
  }

  const renderComponent = async () => {
    if (readOnly || !previewComponent) return
    let props: unknown
    try {
      props = JSON.parse(previewProps)
    } catch {
      setPreviewError('Props 必须是有效 JSON')
      return
    }
    previewAbortRef.current?.abort()
    const controller = new AbortController()
    previewAbortRef.current = controller
    setPreviewLoading(true)
    setPreviewError(null)
    setPreviewOutput(null)
    try {
      const response = await apiFetch(CONSOLE_REST.COMPONENT_PREVIEW, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requester: previewComponent.owner,
          name: previewComponent.name,
          props,
        }),
        signal: controller.signal,
      })
      const body = await response.json() as {
        success: boolean
        data?: { output?: unknown }
        error?: string
      }
      if (!response.ok || body.success !== true || !body.data || !('output' in body.data)) {
        throw new Error(body.error ?? `HTTP ${response.status}`)
      }
      if (!controller.signal.aborted) setPreviewOutput(body.data.output)
    } catch (caught) {
      if (!controller.signal.aborted) setPreviewError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (!controller.signal.aborted) setPreviewLoading(false)
    }
  }

  return (
    <PageShell className="max-w-[1600px]">
      <PageHeader
        title="运行时能力"
        description="读取当前 generation 的命令、中间件、组件、Endpoint、Agent 绑定、工具与 MCP 投影。列表来自 Zhin Runtime，不从配置文件推测。"
        actions={
          <Button variant="outline" size="sm" disabled={loading} onClick={() => void load(tab, page, appliedFilter)}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />刷新
          </Button>
        }
      />

      <Tabs value={tab} onValueChange={selectTab}>
        <TabsList className="h-auto w-full justify-start overflow-x-auto p-1" aria-label="运行时能力分类">
          {(Object.keys(TAB_CONFIG) as IntrospectionTab[]).map((key) => {
            const Icon = TAB_CONFIG[key].icon
            return <TabsTrigger key={key} value={key}><Icon className="h-4 w-4" />{TAB_CONFIG[key].label}</TabsTrigger>
          })}
        </TabsList>

        {(Object.keys(TAB_CONFIG) as IntrospectionTab[]).map((key) => (
          <TabsContent key={key} value={key} className="mt-4">
            <section className="console-dashboard-panel overflow-hidden">
              <div className="flex flex-col gap-3 border-b p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="relative min-w-0 flex-1 sm:max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <input
                    type="search"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') applyFilter()
                    }}
                    placeholder="筛选名称、来源或描述…"
                    aria-label={`筛选${TAB_CONFIG[key].label}`}
                    className="h-9 w-full rounded-md border bg-background pl-9 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="secondary" onClick={applyFilter}>筛选</Button>
                  <span className="text-xs text-muted-foreground">
                    {data ? `共 ${data.total} 条 · 第 ${data.page}/${Math.max(data.totalPages, 1)} 页` : '—'}
                  </span>
                </div>
              </div>

              {error ? (
                <Alert variant="destructive" className="m-4">
                  <AlertDescription className="flex items-center justify-between gap-3">
                    <span>{error}</span>
                    <Button variant="outline" size="sm" onClick={() => void load(tab, page, appliedFilter)}>重试</Button>
                  </AlertDescription>
                </Alert>
              ) : null}

              {data?.note ? (
                <Alert className="m-4"><AlertDescription>{data.note}</AlertDescription></Alert>
              ) : null}

              {loading ? (
                <div className="space-y-2 p-4">
                  {Array.from({ length: 5 }, (_, index) => <Skeleton key={index} className="h-11 w-full" />)}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[720px] text-left text-sm">
                    <thead className="border-b bg-muted/25 text-xs text-muted-foreground">
                      <tr>
                        {columns.map((column) => <th key={column.key} className="px-4 py-3 font-medium">{column.label}</th>)}
                        {key === 'components' ? <th className="px-4 py-3 text-right font-medium">Preview</th> : null}
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {(data?.items ?? []).map((item, rowIndex) => (
                        <tr key={`${String(item.name ?? item.pattern ?? rowIndex)}-${rowIndex}`} className="hover:bg-muted/20">
                          {columns.map((column) => (
                            <td key={column.key} className={cn('max-w-[26rem] px-4 py-3 align-top', column.key === 'name' || column.key === 'pattern' ? 'font-medium text-foreground' : 'text-muted-foreground')}>
                              {renderCell(item[column.key])}
                            </td>
                          ))}
                          {key === 'components' ? (
                            <td className="px-4 py-3 text-right align-top">
                              {readOnly ? (
                                <Badge variant="outline">Full only</Badge>
                              ) : (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => {
                                    previewAbortRef.current?.abort()
                                    setPreviewComponent({
                                      name: String(item.name ?? ''),
                                      owner: String(item.owner ?? ''),
                                    })
                                    setPreviewProps('{}')
                                    setPreviewOutput(null)
                                    setPreviewLoading(false)
                                    setPreviewError(null)
                                  }}
                                >
                                  <Eye className="h-3.5 w-3.5" />预览
                                </Button>
                              )}
                            </td>
                          ) : null}
                        </tr>
                      ))}
                      {!data?.items.length ? (
                        <tr><td colSpan={columns.length + (key === 'components' ? 1 : 0)} className="px-4 py-12 text-center text-sm text-muted-foreground">当前 generation 没有该类能力</td></tr>
                      ) : null}
                    </tbody>
                  </table>
                </div>
              )}

              {key === 'components' && previewComponent ? (
                <ComponentPreviewPanel
                  component={previewComponent}
                  propsText={previewProps}
                  output={previewOutput}
                  loading={previewLoading}
                  error={previewError}
                  onPropsChange={setPreviewProps}
                  onRender={() => void renderComponent()}
                  onClose={() => {
                    previewAbortRef.current?.abort()
                    setPreviewComponent(null)
                    setPreviewOutput(null)
                    setPreviewError(null)
                  }}
                />
              ) : null}

              <footer className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 truncate text-[11px] text-muted-foreground" title={sourceUrl}>Source: {sourceUrl}</p>
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" aria-label="上一页" disabled={loading || page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}><ChevronLeft /></Button>
                  <span className="min-w-16 text-center text-xs tabular-nums">{page} / {Math.max(data?.totalPages ?? 1, 1)}</span>
                  <Button variant="ghost" size="icon" aria-label="下一页" disabled={loading || page >= (data?.totalPages ?? 1)} onClick={() => setPage((value) => value + 1)}><ChevronRight /></Button>
                </div>
              </footer>
            </section>
          </TabsContent>
        ))}
      </Tabs>
    </PageShell>
  )
}

function ComponentPreviewPanel(props: {
  component: { name: string; owner: string }
  propsText: string
  output: unknown
  loading: boolean
  error: string | null
  onPropsChange(value: string): void
  onRender(): void
  onClose(): void
}) {
  return (
    <section className="border-t bg-muted/[0.12] p-4" aria-labelledby="component-preview-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <span className="console-eyebrow">Component preview</span>
          <h3 id="component-preview-title" className="mt-1 font-semibold">{props.component.name}</h3>
          <p className="text-xs text-muted-foreground">requester {props.component.owner}</p>
        </div>
        <Button size="sm" variant="ghost" onClick={props.onClose}>关闭</Button>
      </div>
      <div className="mt-4 grid gap-4 xl:grid-cols-[minmax(16rem,0.7fr)_minmax(0,1.3fr)]">
        <div className="space-y-2">
          <label className="text-xs font-medium text-muted-foreground" htmlFor="component-preview-props">Props JSON</label>
          <Textarea
            id="component-preview-props"
            value={props.propsText}
            onChange={(event) => props.onPropsChange(event.target.value)}
            className="min-h-40 font-mono text-xs"
            spellCheck={false}
          />
          <Button size="sm" onClick={props.onRender} disabled={props.loading}>
            {props.loading ? <Loader2 className="animate-spin" /> : <Eye />}
            {props.loading ? '渲染中' : '渲染组件'}
          </Button>
          {props.error ? <Alert variant="destructive"><AlertDescription>{props.error}</AlertDescription></Alert> : null}
        </div>
        <div className="min-h-52 overflow-auto rounded-lg border bg-background p-3">
          {props.loading ? (
            <div className="flex min-h-44 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 animate-spin" />Component 正在运行</div>
          ) : props.output == null ? (
            <div className="flex min-h-44 items-center justify-center text-center text-sm text-muted-foreground">填写 Props 后渲染，输出会使用真实消息组件展示。</div>
          ) : (
            <ComponentPreviewOutput output={props.output} />
          )}
        </div>
      </div>
    </section>
  )
}

function ComponentPreviewOutput({ output }: { output: unknown }) {
  const values = Array.isArray(output) ? output : [output]
  const segments = values.filter((value): value is ReceivedMessage['content'][number] => (
    Boolean(value) && typeof value === 'object' && typeof (value as { type?: unknown }).type === 'string'
  ))
  if (segments.length === values.length && segments.length > 0) {
    if (segments.length === 1 && segments[0].type === 'html') {
      const data = segments[0].data ?? {}
      const html = typeof data.html === 'string' ? data.html : ''
      const height = clampPreviewDimension(data.height, 320, 160, 640)
      if (html) {
        const srcDoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; font-src data:; style-src 'unsafe-inline'"></head><body>${html}</body></html>`
        return (
          <iframe
            title="Component HTML preview"
            sandbox=""
            srcDoc={srcDoc}
            className="w-full rounded-md border-0 bg-white"
            style={{ height }}
          />
        )
      }
    }
    if (segments.length === 1 && segments[0].type === 'code') {
      const data = segments[0].data ?? {}
      return <CodeBlock code={String(data.code ?? data.text ?? '')} language={String(data.language ?? '')} />
    }
    return <MessageBody content={segments} />
  }
  if (typeof output === 'string') return <MessageBody content={[{ type: 'text', data: { text: output } }]} />
  return <CodeBlock code={JSON.stringify(output, null, 2) ?? String(output)} language="json" />
}

function clampPreviewDimension(value: unknown, fallback: number, minimum: number, maximum: number): number {
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback
}
