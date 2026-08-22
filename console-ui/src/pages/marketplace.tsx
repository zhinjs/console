import { useEffect, useState, useMemo, useCallback, useRef } from 'react'
import {
  Search, Package, Download, ExternalLink, AlertCircle,
  ArrowUpDown, RefreshCw, ShieldCheck, Globe, Copy, Check,
  ChevronLeft, ChevronRight, GitBranch, Calendar, Scale,
  type LucideIcon,
} from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from '../components/ui/dialog'
import { apiFetch } from '../utils/auth'

interface MarketPlugin {
  name: string
  displayName: string
  version: string
  description: string
  author: string
  isOfficial: boolean
  official: boolean
  category: string
  keywords: string[]
  npm: string
  date: string
  downloads: { weekly: number; monthly: number }
}

interface PluginDetail {
  name: string
  version: string
  description: string
  license: string
  author: string
  homepage: string
  repository: string
  keywords: string[]
  engines: Record<string, string>
  peerDependencies: Record<string, string>
  downloads: { weekly: number; monthly: number }
  readme: string
  versions: string[]
  lastPublish: string
  npm?: string
}

interface UpdateInfo {
  name: string
  current: string
  latest: string
}

type SortKey = 'relevance' | 'downloads' | 'newest' | 'name'
type Category = '' | 'adapter' | 'service' | 'util' | 'game' | 'feature'
type DetailTab = 'readme' | 'versions' | 'deps'

const CATEGORIES: { value: Category; label: string; icon: LucideIcon }[] = [
  { value: '', label: '全部', icon: Package },
  { value: 'adapter', label: '适配器', icon: Globe },
  { value: 'service', label: '服务', icon: ShieldCheck },
  { value: 'util', label: '工具', icon: Package },
  { value: 'game', label: '游戏', icon: Package },
  { value: 'feature', label: '特性', icon: Package },
]

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: '相关度' },
  { value: 'downloads', label: '下载量' },
  { value: 'newest', label: '最新' },
  { value: 'name', label: '名称' },
]

const PAGE_SIZE = 18

function formatDate(dateStr: string) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('zh-CN')
}

function formatDownloads(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export default function MarketplacePage() {
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [category, setCategory] = useState<Category>('')
  const [officialOnly, setOfficialOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('relevance')
  const [updates, setUpdates] = useState<UpdateInfo[]>([])
  const [updatesLoading, setUpdatesLoading] = useState(false)
  const [updatesDismissed, setUpdatesDismissed] = useState(false)

  // Detail dialog
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<PluginDetail | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('readme')
  const [copied, setCopied] = useState(false)

  const fetchPlugins = useCallback(async (p: number) => {
    setLoading(true)
    setError(null)
    try {
      const params = new URLSearchParams()
      if (debouncedSearch) params.set('q', debouncedSearch)
      if (category) params.set('category', category)
      if (officialOnly) params.set('official', 'true')
      if (sortKey !== 'relevance') params.set('sort', sortKey)
      params.set('page', String(p))
      params.set('size', String(PAGE_SIZE))

      const res = await apiFetch(`/pub/marketplace/search?${params}`)
      if (!res.ok) throw new Error('搜索失败')
      const data = await res.json()
      if (data.success) {
        setPlugins(data.data)
        setTotal(data.total || 0)
      } else {
        throw new Error(data.error || '数据格式错误')
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, category, officialOnly, sortKey])

  // Debounce search input (350ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 350)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  useEffect(() => {
    fetchPlugins(page)
  }, [fetchPlugins, page])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [category, officialOnly, sortKey])

  const checkUpdates = useCallback(async () => {
    setUpdatesLoading(true)
    try {
      const res = await apiFetch('/api/marketplace/updates')
      if (res.ok) {
        const data = await res.json()
        if (data.success) setUpdates(data.data)
      }
    } catch { /* ignore */ }
    finally { setUpdatesLoading(false) }
  }, [])

  const openDetail = useCallback(async (name: string) => {
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    setDetailTab('readme')
    setCopied(false)
    try {
      const res = await apiFetch(`/pub/marketplace/detail/${name}`)
      if (res.ok) {
        const data = await res.json()
        if (data.success) setDetail(data.data)
      }
    } catch { /* ignore */ }
    finally { setDetailLoading(false) }
  }, [])

  const handleCopyInstall = useCallback(async (name: string) => {
    const cmd = `pnpm add ${name}`
    try {
      await navigator.clipboard.writeText(cmd)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      const el = document.createElement('textarea')
      el.value = cmd
      document.body.appendChild(el)
      el.select()
      document.execCommand('copy')
      document.body.removeChild(el)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }, [])

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">插件市场</h1>
          <p className="text-sm text-muted-foreground mt-1">
            探索 Zhin.js 生态中的插件
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={checkUpdates} disabled={updatesLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${updatesLoading ? 'animate-spin' : ''}`} />
            检查更新
          </Button>
        </div>
      </div>

      {/* Updates banner */}
      {updates.length > 0 && !updatesDismissed && (
        <Alert>
          <div className="flex items-start justify-between w-full">
            <div className="flex items-start gap-2">
              <RefreshCw className="h-4 w-4 mt-0.5 shrink-0" />
              <AlertDescription>
                有 {updates.length} 个插件可更新：
                <div className="flex flex-wrap gap-1 mt-1">
                  {updates.slice(0, 5).map(u => (
                    <Badge key={u.name} variant="secondary" className="text-xs">
                      {u.name} → {u.latest}
                    </Badge>
                  ))}
                  {updates.length > 5 && (
                    <span className="text-xs text-muted-foreground">+{updates.length - 5} 更多</span>
                  )}
                </div>
              </AlertDescription>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 -mt-1" onClick={() => setUpdatesDismissed(true)}>
              关闭
            </Button>
          </div>
        </Alert>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="搜索插件名称、描述..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Button
            variant={officialOnly ? 'default' : 'outline'}
            size="sm"
            onClick={() => setOfficialOnly(!officialOnly)}
          >
            <ShieldCheck className="w-4 h-4 mr-1" />
            仅官方
          </Button>
          <select
            value={sortKey}
            onChange={e => setSortKey(e.target.value as SortKey)}
            className="h-9 px-3 rounded-md border bg-transparent text-sm cursor-pointer hover:bg-accent transition-colors"
          >
            {SORT_OPTIONS.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs value={category} onValueChange={v => setCategory(v as Category)}>
        <TabsList className="flex flex-wrap h-auto w-full justify-start gap-1">
          {CATEGORIES.map(c => (
            <TabsTrigger key={c.value} value={c.value}>{c.label}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Results info */}
      {!loading && (
        <div className="text-xs text-muted-foreground">
          共 {total} 个插件{totalPages > 1 && `，第 ${page}/${totalPages} 页`}
        </div>
      )}

      {/* Error */}
      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {/* Loading */}
      {loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      )}

      {/* Plugin Grid */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {plugins.map(plugin => (
            <Card
              key={plugin.name}
              className="cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5"
              onClick={() => openDetail(plugin.name)}
            >
              <CardContent className="p-4 space-y-2.5">
                {/* Name & Badge */}
                <div className="flex justify-between items-start gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="font-semibold text-sm truncate">
                      {plugin.displayName || plugin.name}
                    </span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    {plugin.isOfficial && (
                      <Badge variant="default" className="text-[10px]">官方</Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">v{plugin.version}</Badge>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                  {plugin.description || '暂无描述'}
                </p>

                <Separator />

                {/* Footer: author, date, downloads */}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground min-w-0">
                  <span className="truncate min-w-0 flex-1">{plugin.author}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    {plugin.downloads?.monthly > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Download className="w-3 h-3" />
                        {formatDownloads(plugin.downloads.monthly)}/月
                      </span>
                    )}
                    <span>{formatDate(plugin.date)}</span>
                  </div>
                </div>

                {/* Keywords */}
                {plugin.keywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {plugin.keywords.slice(0, 3).map(kw => (
                      <Badge key={kw} variant="outline" className="text-[10px] px-1.5 py-0">{kw}</Badge>
                    ))}
                    {plugin.keywords.length > 3 && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        +{plugin.keywords.length - 3}
                      </Badge>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Empty */}
      {!loading && plugins.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12">
            <Package className="w-12 h-12 text-muted-foreground" />
            <h3 className="text-lg font-semibold">未找到插件</h3>
            <p className="text-sm text-muted-foreground">尝试调整搜索条件或分类筛选</p>
          </CardContent>
        </Card>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1 || loading}
          >
            <ChevronLeft className="w-4 h-4 mr-1" />
            上一页
          </Button>
          <span className="text-sm text-muted-foreground px-2">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            下一页
            <ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
          {detailLoading ? (
            <div className="space-y-3 p-1">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Package className="w-5 h-5" />
                  {detail.name}
                  <Badge variant="secondary">v{detail.version}</Badge>
                </DialogTitle>
                <DialogDescription>{detail.description}</DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-secondary p-2">
                    <div className="text-lg font-bold">{formatDownloads(detail.downloads?.weekly || 0)}</div>
                    <div className="text-[10px] text-muted-foreground">周下载</div>
                  </div>
                  <div className="rounded-md bg-secondary p-2">
                    <div className="text-lg font-bold">{formatDownloads(detail.downloads?.monthly || 0)}</div>
                    <div className="text-[10px] text-muted-foreground">月下载</div>
                  </div>
                  <div className="rounded-md bg-secondary p-2">
                    <div className="text-lg font-bold">{detail.versions?.length || 0}</div>
                    <div className="text-[10px] text-muted-foreground">版本数</div>
                  </div>
                </div>

                <Separator />

                {/* Metadata */}
                <div className="space-y-2 text-sm">
                  {detail.author && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">作者</span>
                      <span>{detail.author}</span>
                    </div>
                  )}
                  {detail.license && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">许可证</span>
                      <span>{detail.license}</span>
                    </div>
                  )}
                  {detail.lastPublish && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">最后发布</span>
                      <span>{formatDate(detail.lastPublish)}</span>
                    </div>
                  )}
                  {detail.engines?.node && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Node.js</span>
                      <span>{detail.engines.node}</span>
                    </div>
                  )}
                </div>

                {/* Tabs: readme / versions / deps */}
                <div className="flex border-b gap-0">
                  {([['readme', 'README'], ['versions', '版本'], ['deps', '依赖']] as [DetailTab, string][]).map(
                    ([key, label]) => (
                      <button
                        key={key}
                        className={`px-3 py-2 text-sm font-medium border-b-2 transition-colors ${
                          detailTab === key
                            ? 'border-primary text-foreground'
                            : 'border-transparent text-muted-foreground hover:text-foreground'
                        }`}
                        onClick={() => setDetailTab(key)}
                      >
                        {label}
                      </button>
                    ),
                  )}
                </div>

                {/* Tab content */}
                {detailTab === 'readme' && (
                  <div>
                    {detail.readme ? (
                      <pre className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed bg-secondary/50 rounded-md p-3 overflow-x-auto max-h-64 overflow-y-auto">
                        {detail.readme}
                      </pre>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">暂无 README</p>
                    )}
                  </div>
                )}

                {detailTab === 'versions' && (
                  <div>
                    {detail.versions?.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        {detail.versions.slice(-20).reverse().map(v => (
                          <span key={v} className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-mono bg-secondary/30 min-w-0 truncate" title={v}>
                            <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{v}</span>
                          </span>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">暂无版本信息</p>
                    )}
                    {detail.versions?.length > 20 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        最近 20 个版本（共 {detail.versions.length} 个）
                      </p>
                    )}
                  </div>
                )}

                {detailTab === 'deps' && (
                  <div className="space-y-3">
                    {detail.peerDependencies && Object.keys(detail.peerDependencies).length > 0 ? (
                      <div>
                        <h4 className="text-xs font-medium mb-1.5 text-muted-foreground">Peer Dependencies</h4>
                        <div className="space-y-1">
                          {Object.entries(detail.peerDependencies).map(([name, ver]) => (
                            <div key={name} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded border text-xs bg-secondary/30 min-w-0">
                              <span className="font-mono truncate min-w-0">{name}</span>
                              <span className="text-muted-foreground shrink-0 truncate max-w-[40%]" title={String(ver)}>{String(ver)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="text-sm text-muted-foreground text-center py-6">无 peer dependencies</p>
                    )}
                    {detail.engines && Object.keys(detail.engines).length > 0 && (
                      <div>
                        <h4 className="text-xs font-medium mb-1.5 text-muted-foreground">Engines</h4>
                        <div className="space-y-1">
                          {Object.entries(detail.engines).map(([eng, ver]) => (
                            <div key={eng} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded border text-xs bg-secondary/30 min-w-0">
                              <span className="font-mono truncate min-w-0">{eng}</span>
                              <span className="text-muted-foreground shrink-0 truncate max-w-[40%]" title={String(ver)}>{String(ver)}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Install command */}
                <div>
                  <h4 className="text-sm font-medium mb-2">安装命令</h4>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="flex-1 min-w-0 text-xs bg-secondary rounded-md p-2 overflow-x-auto break-all">
                      pnpm add {detail.name}
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyInstall(detail.name)}
                      className="shrink-0"
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2 flex-wrap shrink-0 pt-2">
                {detail.homepage && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={detail.homepage} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3 mr-1" /> 主页
                    </a>
                  </Button>
                )}
                {detail.repository && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={detail.repository.replace(/^git\+/, '').replace(/\.git$/, '')}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3 h-3 mr-1" /> 源码
                    </a>
                  </Button>
                )}
                <Button variant="outline" size="sm" asChild>
                  <a
                    href={detail.npm || `https://www.npmjs.com/package/${detail.name}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <Download className="w-3 h-3 mr-1" /> npm
                  </a>
                </Button>
                <DialogClose asChild>
                  <Button variant="secondary" size="sm">关闭</Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>加载插件详情失败</AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
