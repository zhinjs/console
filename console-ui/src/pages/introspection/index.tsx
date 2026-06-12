import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Search, ChevronLeft, ChevronRight, AlertCircle, RefreshCw, Terminal, Bot, Link2, Wrench, Server } from 'lucide-react'
import { apiFetch, getApiBase } from '../../utils/auth'
import { PageHeader } from '../../components/PageHeader'
import { Card, CardContent } from '../../components/ui/card'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Skeleton } from '../../components/ui/skeleton'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import { cn } from '@zhin.js/client'

export type IntrospectionTab = 'commands' | 'endpoints' | 'bindings' | 'tools' | 'mcp'

const TAB_CONFIG: Record<
  IntrospectionTab,
  { label: string; path: string; defaultPageSize: number; icon: typeof Terminal }
> = {
  commands: { label: '命令', path: '/api/introspection/commands', defaultPageSize: 25, icon: Terminal },
  endpoints: { label: '机器人', path: '/api/introspection/endpoints', defaultPageSize: 30, icon: Bot },
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

interface CommandItem { pattern: string; desc: string; plugin?: string }
interface EndpointItem { adapter: string; name: string; online: boolean }
interface BindingItem { name: string; provider: string; model: string; mcpServers: string[]; hasAgentFile: boolean }
interface ToolItem { name: string; description: string; source?: string }
interface McpItem { name: string; connected: boolean; toolCount: number }

type AnyItem = CommandItem | EndpointItem | BindingItem | ToolItem | McpItem

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
    return value.length ? value.join(', ') : <span className="text-muted-foreground">—</span>
  }
  return String(value)
}

function getColumns(tab: IntrospectionTab): { key: string; label: string }[] {
  switch (tab) {
    case 'commands':
      return [
        { key: 'pattern', label: 'pattern' },
        { key: 'desc', label: 'desc' },
        { key: 'plugin', label: 'plugin' },
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
    <div className="space-y-6">
      <PageHeader
        title="命令与工具"
        description="查看 Host 已注册的命令、机器人、Agent 绑定、工具与 MCP 服务，与 IM 里 /cmd、/tools 等查询结果一致。"
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
            <Card className="border-border/80 shadow-sm">
              <CardContent className="flex flex-wrap items-center gap-3 p-3">
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

            {serviceUnavailable && error && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}

            {error && !serviceUnavailable && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{error}</AlertDescription>
              </Alert>
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

            {loading ? (
              <div className="space-y-2">
                <Skeleton className="h-10 w-full" />
                {[...Array(5)].map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : (
              <Card className="border-border/80 shadow-sm overflow-hidden">
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
                            暂无数据
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
    </div>
  )
}
