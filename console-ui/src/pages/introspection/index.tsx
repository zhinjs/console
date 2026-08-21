import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, RefreshCw, Terminal, Bot, Link2, Wrench, Server, Layers3, Blocks, Play } from 'lucide-react'
import { apiFetch, getApiBase } from '../../utils/auth'
import { PageHeader } from '../../components/PageHeader'
import { PageShell } from '../../components/PageShell'
import { Card, CardContent } from '../../components/ui/card'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { ErrorAlert } from '../../components/error-alert'
import { EmptyState } from '../../components/empty-state'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import { cn, MarkdownContent, pickMediaRawUrl, resolveMediaSrc } from '@zhin.js/client'

export type IntrospectionTab = 'commands' | 'middlewares' | 'components' | 'endpoints' | 'bindings' | 'tools' | 'mcp'

const TAB_CONFIG: Record<
  IntrospectionTab,
  { label: string; path: string; defaultPageSize: number; icon: typeof Terminal }
> = {
  commands: { label: '命令', path: '/api/introspection/commands', defaultPageSize: 25, icon: Terminal },
  middlewares: { label: '中间件', path: '/api/introspection/middlewares', defaultPageSize: 30, icon: Layers3 },
  components: { label: '组件', path: '/api/introspection/components', defaultPageSize: 30, icon: Blocks },
  endpoints: { label: 'Endpoints', path: '/api/introspection/endpoints', defaultPageSize: 30, icon: Bot },
  bindings: { label: 'Agent 绑定', path: '/api/introspection/bindings', defaultPageSize: 30, icon: Link2 },
  tools: { label: '工具', path: '/api/introspection/tools', defaultPageSize: 15, icon: Wrench },
  mcp: { label: 'MCP 服务', path: '/api/introspection/mcp', defaultPageSize: 30, icon: Server },
}

const VALID_TABS = new Set<string>(Object.keys(TAB_CONFIG))

interface IntrospectionEnvelope<T> {
  items: T[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  filter?: string
  note?: string
}

interface CommandItem {
  pattern: string
  desc: string
  plugin?: string
  parameters?: Array<{ name: string; type: string; required: boolean; default?: unknown }>
  aliases?: string[]
  permissions?: string[]
  shortcuts?: string[]
}
interface MiddlewareItem { name: string; owner: string; phase: string; target: string; order: number; source: string }
interface ComponentItem { name: string; owner: string; source: string }
interface EndpointItem { adapter: string; name: string; online: boolean }
interface BindingItem { name: string; provider: string; model: string; mcpServers: string[]; hasAgentFile: boolean }
interface ToolItem { name: string; description: string; source?: string }
interface McpItem { name: string; connected: boolean; toolCount: number }

type AnyItem = CommandItem | MiddlewareItem | ComponentItem | EndpointItem | BindingItem | ToolItem | McpItem

function parseTab(raw: string | null): IntrospectionTab {
  if (raw && VALID_TABS.has(raw)) return raw as IntrospectionTab
  return 'commands'
}

function renderCell(key: string, value: unknown): ReactNode {
  if (value == null || value === '') return <span className="text-muted-foreground">—</span>
  if (typeof value === 'boolean') {
    return (
      <Badge variant={value ? 'success' : 'secondary'} className="text-[10px]">
        {value ? '是' : '否'}
      </Badge>
    )
  }
  if (Array.isArray(value)) {
    return value.length
      ? value.map((item) => typeof item === 'object' ? JSON.stringify(item) : String(item)).join(', ')
      : <span className="text-muted-foreground">—</span>
  }
  return String(value)
}

function getColumns(tab: IntrospectionTab): { key: string; label: string }[] {
  switch (tab) {
    case 'commands':
      return [
        { key: 'pattern', label: '命令路由' },
        { key: 'desc', label: '说明' },
        { key: 'parameters', label: '参数契约' },
        { key: 'aliases', label: '别名' },
        { key: 'permissions', label: '权限' },
        { key: 'plugin', label: '来源' },
      ]
    case 'middlewares':
      return [
        { key: 'name', label: '名称' },
        { key: 'phase', label: '阶段' },
        { key: 'target', label: '方向' },
        { key: 'order', label: '顺序' },
        { key: 'owner', label: 'Owner' },
        { key: 'source', label: '来源' },
      ]
    case 'components':
      return [
        { key: 'name', label: '组件' },
        { key: 'owner', label: 'Owner / requester' },
        { key: 'source', label: '来源' },
      ]
    case 'endpoints':
      return [
        { key: 'adapter', label: 'adapter' },
        { key: 'name', label: 'name' },
        { key: 'online', label: 'online' },
      ]
    case 'bindings':
      return [
        { key: 'name', label: 'name' },
        { key: 'provider', label: 'provider' },
        { key: 'model', label: 'model' },
        { key: 'mcpServers', label: 'mcpServers' },
        { key: 'hasAgentFile', label: 'hasAgentFile' },
      ]
    case 'tools':
      return [
        { key: 'name', label: 'name' },
        { key: 'source', label: 'source' },
        { key: 'description', label: 'description' },
      ]
    case 'mcp':
      return [
        { key: 'name', label: 'name' },
        { key: 'connected', label: 'connected' },
        { key: 'toolCount', label: 'toolCount' },
      ]
  }
}

function ComponentLab({ components }: { components: ComponentItem[] }) {
  const [selectedKey, setSelectedKey] = useState('')
  const [propsText, setPropsText] = useState('{\n  \n}')
  const [output, setOutput] = useState<unknown>()
  const [rendering, setRendering] = useState(false)
  const [renderError, setRenderError] = useState<string | null>(null)
  const requestRef = useRef(0)
  const abortRef = useRef<AbortController | null>(null)
  const selected = components.find((component) => componentOptionKey(component) === selectedKey) ?? components[0]

  useEffect(() => {
    if (!selectedKey && components[0]) setSelectedKey(componentOptionKey(components[0]))
  }, [components, selectedKey])

  useEffect(() => () => abortRef.current?.abort(), [])

  const renderPreview = async () => {
    if (!selected) return
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    const requestId = ++requestRef.current
    setRendering(true)
    setRenderError(null)
    try {
      const props = JSON.parse(propsText) as unknown
      const response = await apiFetch('/api/introspection/components/render', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ requester: selected.owner, name: selected.name, props }),
        signal: controller.signal,
      })
      const body = await response.json() as { success?: boolean; error?: string; data?: { output?: unknown } }
      if (!response.ok || body.success === false) throw new Error(body.error ?? `HTTP ${response.status}`)
      if (requestId === requestRef.current) setOutput(body.data?.output)
    } catch (error) {
      if (requestId !== requestRef.current || controller.signal.aborted) return
      setOutput(undefined)
      setRenderError(error instanceof Error ? error.message : String(error))
    } finally {
      if (requestId === requestRef.current) setRendering(false)
    }
  }

  if (components.length === 0) return null
  return (
    <section className="console-component-lab" aria-label="组件渲染实验台">
      <header>
        <div><span>Component renderer</span><h2>组件渲染实验台</h2><p>选择当前 generation 的组件，以 Owner 作为 requester，输入 JSON Props 后查看真实 IM 渲染结果。</p></div>
        <Badge variant="secondary">full scope</Badge>
      </header>
      <div className="console-component-lab-controls">
        <label><span>组件</span><select value={selected ? componentOptionKey(selected) : ''} onChange={(event) => { abortRef.current?.abort(); requestRef.current += 1; setRendering(false); setSelectedKey(event.target.value); setOutput(undefined); setRenderError(null) }}>{components.map((component) => <option key={componentOptionKey(component)} value={componentOptionKey(component)}>{component.name} · {component.owner}</option>)}</select></label>
        <label><span>Props · JSON</span><textarea value={propsText} onChange={(event) => setPropsText(event.target.value)} spellCheck={false} /></label>
        <Button onClick={() => void renderPreview()} disabled={!selected || rendering}><Play className="w-4 h-4 mr-1" />{rendering ? '渲染中' : '运行渲染'}</Button>
      </div>
      {renderError && <ErrorAlert error={renderError} onRetry={renderPreview} />}
      <div className="console-component-lab-output">
        <div><span>视觉预览</span><div className="console-component-preview">{output === undefined ? <small>运行后在这里查看文本、Markdown、代码与媒体段。</small> : renderComponentOutput(output)}</div></div>
        <div><span>结构输出</span><pre>{output === undefined ? 'No output' : JSON.stringify(output, null, 2)}</pre></div>
      </div>
    </section>
  )
}

function componentOptionKey(component: ComponentItem): string {
  return `${encodeURIComponent(component.owner)}:${encodeURIComponent(component.name)}`
}

function renderComponentOutput(output: unknown, depth = 0, budget = { nodes: 0 }): ReactNode {
  budget.nodes += 1
  if (depth > 12 || budget.nodes > 300) return <small>预览内容过深，已截断</small>
  if (typeof output === 'string') return <MarkdownContent text={output} />
  if (Array.isArray(output)) return output.slice(0, 100).map((item, index) => <div key={index}>{renderComponentOutput(item, depth + 1, budget)}</div>)
  if (!output || typeof output !== 'object') return <span>{String(output ?? 'null')}</span>
  const segment = output as { type?: unknown; data?: Record<string, unknown> }
  const type = typeof segment.type === 'string' ? segment.type : ''
  const data = segment.data ?? {}
  if (type === 'text' || type === 'markdown' || type === 'md') return <MarkdownContent text={String(data.text ?? data.content ?? '')} />
  if (type === 'code') return <pre><code>{String(data.code ?? data.text ?? '')}</code></pre>
  if (type === 'image' || type === 'video' || type === 'audio' || type === 'voice' || type === 'record') {
    const mediaKind = type === 'image' ? 'image' : type === 'video' ? 'video' : 'audio'
    const resolved = resolveMediaSrc(pickMediaRawUrl(data), mediaKind)
    const source = safePreviewMediaSource(resolved)
    if (!source) return <span>[{type}：外部媒体已阻止自动加载]</span>
    if (mediaKind === 'image') return <img src={source} loading="lazy" alt="组件渲染结果" />
    if (mediaKind === 'video') return <video src={source} controls preload="metadata" />
    return <audio src={source} controls preload="metadata" />
  }
  if (type === 'file' || type === 'link') {
    const href = safePreviewMediaSource(String(data.url ?? data.href ?? data.file ?? ''))
    const label = String(data.name ?? data.title ?? data.filename ?? type)
    return href ? <a href={href} target="_blank" rel="noreferrer">{label}</a> : <span>[{label}]</span>
  }
  if (type === 'keyboard') return renderKeyboard(data)
  if (type === 'forward') return <div className="rounded border p-2 text-sm">合并转发 · {String(data.forward_id ?? data.id ?? '未解析引用')}</div>
  if (type === 'mention' || type === 'at') return <Badge variant="secondary">@{String(data.name ?? data.target ?? data.user_id ?? '')}</Badge>
  return <pre>{JSON.stringify(output, null, 2)}</pre>
}

function renderKeyboard(data: Record<string, unknown>): ReactNode {
  const rows = Array.isArray(data.rows) ? data.rows.slice(0, 12) : []
  return <div className="grid gap-1">{rows.map((rawRow, rowIndex) => {
    const row = Array.isArray(rawRow) ? rawRow.slice(0, 8) : []
    return <div key={rowIndex} className="flex flex-wrap gap-1">{row.map((rawButton, buttonIndex) => {
      const button = rawButton && typeof rawButton === 'object' ? rawButton as Record<string, unknown> : {}
      return <button key={buttonIndex} type="button" disabled className="rounded border px-2 py-1 text-xs">{String(button.label ?? button.text ?? button.id ?? 'button')}</button>
    })}</div>
  })}</div>
}

function safePreviewMediaSource(source: string | undefined): string | undefined {
  if (!source) return undefined
  if (source.startsWith('data:') || source.startsWith('blob:')) return source
  try {
    const url = new URL(source, window.location.origin)
    const allowedOrigins = new Set([window.location.origin, new URL(getApiBase(), window.location.origin).origin])
    return (url.protocol === 'http:' || url.protocol === 'https:') && allowedOrigins.has(url.origin)
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

export default function IntrospectionPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const tab = parseTab(searchParams.get('tab'))
  const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
  const filterParam = searchParams.get('filter') ?? ''

  const [search, setSearch] = useState(filterParam)
  const [debouncedFilter, setDebouncedFilter] = useState(filterParam)
  const debounceRef = useRef<ReturnType<typeof setTimeout>>()

  const [items, setItems] = useState<AnyItem[]>([])
  const [envelope, setEnvelope] = useState<IntrospectionEnvelope<AnyItem> | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [serviceUnavailable, setServiceUnavailable] = useState(false)

  const pageSize = TAB_CONFIG[tab].defaultPageSize
  const columns = useMemo(() => getColumns(tab), [tab])

  useEffect(() => {
    clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setDebouncedFilter(search), 350)
    return () => clearTimeout(debounceRef.current)
  }, [search])

  const updateParams = useCallback(
    (patch: { tab?: IntrospectionTab; page?: number; filter?: string }) => {
      const next = new URLSearchParams(searchParams)
      const newTab = patch.tab ?? tab
      next.set('tab', newTab)
      const newPage = patch.page ?? (patch.filter !== undefined ? 1 : page)
      next.set('page', String(newPage))
      const newFilter = patch.filter ?? debouncedFilter
      if (newFilter) next.set('filter', newFilter)
      else next.delete('filter')
      setSearchParams(next, { replace: true })
    },
    [searchParams, setSearchParams, tab, page, debouncedFilter],
  )

  useEffect(() => {
    if (debouncedFilter !== filterParam) {
      updateParams({ filter: debouncedFilter, page: 1 })
    }
  }, [debouncedFilter, filterParam, updateParams])

  const fetchData = useCallback(async () => {
    setLoading(true)
    setError(null)
    setServiceUnavailable(false)
    try {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', String(pageSize))
      if (filterParam) params.set('filter', filterParam)

      const res = await apiFetch(`${TAB_CONFIG[tab].path}?${params}`)
      const data = await res.json()

      if (res.status === 503 || (data.success === false && res.status === 503)) {
        setServiceUnavailable(true)
        setError(data.error ?? '依赖未就绪')
        setItems([])
        setEnvelope(data.data ?? { items: [], page, pageSize, total: 0, totalPages: 0 })
        return
      }

      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`)
      if (!data.success) throw new Error(data.error ?? '请求失败')

      const env = data.data as IntrospectionEnvelope<AnyItem>
      setEnvelope(env)
      setItems(env.items ?? [])
    } catch (err) {
      setError((err as Error).message)
      setItems([])
      setEnvelope(null)
    } finally {
      setLoading(false)
    }
  }, [tab, page, pageSize, filterParam])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const restLink = useMemo(() => {
    const base = getApiBase()
    const params = new URLSearchParams()
    params.set('page', String(page))
    params.set('pageSize', String(pageSize))
    if (filterParam) params.set('filter', filterParam)
    return `${base}${TAB_CONFIG[tab].path}?${params}`
  }, [tab, page, pageSize, filterParam])

  return (
    <PageShell>
      <PageHeader
        title="运行时能力"
        description="检查当前 generation 的命令契约、中间件链、组件渲染、Endpoints 与 Agent 工具面；这里展示的是 Zhin 完整 Runtime，而不只是 Agent。"
        actions={
          <Button variant="outline" size="sm" onClick={() => fetchData()} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-1', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      <Tabs
        value={tab}
        onValueChange={(v) => {
          setSearch('')
          setDebouncedFilter('')
          updateParams({ tab: v as IntrospectionTab, page: 1, filter: '' })
        }}
      >
        <TabsList className="flex flex-wrap h-auto gap-1">
          {(Object.keys(TAB_CONFIG) as IntrospectionTab[]).map((key) => {
            const cfg = TAB_CONFIG[key]
            const Icon = cfg.icon
            return (
              <TabsTrigger key={key} value={key} className="gap-1.5">
                <Icon className="w-4 h-4" />
                {cfg.label}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {(Object.keys(TAB_CONFIG) as IntrospectionTab[]).map((key) => (
          <TabsContent key={key} value={key} className="space-y-4 mt-4">
            <Card>
              <CardContent className="flex flex-wrap items-center gap-3 p-[var(--console-space-card-sm)]">
                <div className="relative flex-1 min-w-[200px] max-w-sm">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
                  <input
                    type="search"
                    placeholder="筛选（pattern、name、source…）"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                </div>
                {envelope && (
                  <span className="text-sm text-muted-foreground">
                    共 {envelope.total} 条 · 第 {envelope.page}/{envelope.totalPages || 1} 页
                  </span>
                )}
              </CardContent>
            </Card>

            {error && (
              <ErrorAlert error={error} onRetry={fetchData} />
            )}

            {envelope?.note && (
              <Alert>
                <AlertDescription>{envelope.note}</AlertDescription>
              </Alert>
            )}

            {key === 'bindings' && (
              <Alert>
                <AlertDescription>
                  「绑定名称」是 Agent 配置名（如 default），不是对话 sessionKey。查看对话分支请从
                  <strong className="mx-1">机器人 → 私聊/群聊</strong>
                  进入，sessionKey 格式为
                  <code className="mx-1 text-xs">platform:endpointId:scope:sceneId</code>
                  （例：<code className="text-xs">icqq:75318:private:userA</code>）。
                </AlertDescription>
              </Alert>
            )}

            {key === 'middlewares' && (
              <Alert><AlertDescription>执行顺序由阶段、order 与插件拓扑共同决定；这里展示的是当前 generation 的真实链路，而非配置文件猜测。</AlertDescription></Alert>
            )}

            {key === 'components' && !loading && (
              <ComponentLab components={items as ComponentItem[]} />
            )}

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <Card className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-muted/40">
                        {columns.map((col) => (
                          <th
                            key={col.key}
                            className="text-left font-medium text-muted-foreground px-4 py-2.5 whitespace-nowrap"
                          >
                            {col.label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {items.length === 0 ? (
                        <tr>
                          <td
                            colSpan={columns.length}
                            className="text-center text-muted-foreground py-12"
                          >
                            <EmptyState compact />
                          </td>
                        </tr>
                      ) : (
                        items.map((row, idx) => (
                          <tr
                            key={idx}
                            className="border-b border-border/50 hover:bg-muted/30 transition-colors"
                          >
                            {columns.map((col) => (
                              <td key={col.key} className="px-4 py-2.5 align-top max-w-xs break-words">
                                {renderCell(col.key, (row as Record<string, unknown>)[col.key])}
                              </td>
                            ))}
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </Card>
            )}

            {envelope && envelope.totalPages > 1 && (
              <div className="flex items-center justify-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => updateParams({ page: page - 1 })}
                >
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <span className="text-sm text-muted-foreground tabular-nums">
                  {page} / {envelope.totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= envelope.totalPages || loading}
                  onClick={() => updateParams({ page: page + 1 })}
                >
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            )}

            <p className="text-xs text-muted-foreground font-mono break-all">
              完整列表: {restLink}
            </p>
          </TabsContent>
        ))}
      </Tabs>
    </PageShell>
  )
}
