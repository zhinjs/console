import { useI18n } from '../i18n'
import { copyText } from './clipboard-copy.mjs'
import { useToast } from '../components/toast'
import { applyRegistryVersion, belongsToZhinScope } from './marketplace-version.mjs'
import {
  marketplaceListView, isCardActivationKey, classifyUpdateCheck, updateCheckFeedback, readInstalledPackages, installedFromPackageList,
  marketplacePluginStatus, pluginManageUrl, pluginConfigUrl, installFollowUps, type UpdateCheckOutcome, type InstalledPackages,
} from './marketplace-view-model.mjs'
import { useEffect, useState, useCallback, useRef } from 'react'
import {
  Search, Package, Download, ExternalLink, RefreshCw, Copy, Check, GitBranch, Settings, CheckCircle2, ToggleLeft,
} from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SelectField } from '../components/ui/select'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from '../components/ui/dialog'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { StatusState } from '../components/StatusState'
import { apiFetch } from '../utils/auth'
import { Link, useSearchParams } from 'react-router-dom'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { readWelcomeUseCase, welcomeReturnUrl } from './welcome-use-case-model.mjs'
import { GATEWAY_RPC, readPackageList } from './ops/gateway-model.mjs'
import { gatewayRequest } from './ops/use-gateway'
import { PackageActionPanel, usePackageAction } from './PackageAction'
import './plugins.css'

interface MarketPlugin {
  name: string
  displayName: string
  version: string
  versionSource?: 'index' | 'registry'
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

const CATEGORIES: { value: Category; label: string }[] = [
  { value: '', label: '全部' },
  { value: 'adapter', label: '适配器' },
  { value: 'service', label: '服务' },
  { value: 'util', label: '工具' },
  { value: 'game', label: '游戏' },
  { value: 'feature', label: '特性' },
]

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'relevance', label: '相关度' },
  { value: 'downloads', label: '下载量' },
  { value: 'newest', label: '最新' },
  { value: 'name', label: '名称' },
]

const FOLLOW_UP_LABELS = { configure: '去配置', features: '去功能页签', detail: '插件详情', welcome: '返回群欢迎流程' } as const

const PAGE_SIZE = 18

function formatDate(dateStr: string, locale: 'zh-CN' | 'en' = 'zh-CN') {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString(locale)
}

function formatDownloads(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}w`
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`
  return String(n)
}

export default function MarketplacePage() {
  const scope = useInboxCacheScope()
  return <MarketplaceSession key={scope ?? 'public-market'} scope={scope} />
}

function MarketplaceSession({ scope }: { scope?: string }) {
  const i18n = useI18n()
  const messages = useRef(i18n)
  messages.current = i18n
  const toast = useToast()
  const [searchParams] = useSearchParams()
  const welcomeRequested = searchParams.get('useCase') === 'group-welcome'
  const [welcomePackage, setWelcomePackage] = useState<string | null>(null)
  const [welcomeError, setWelcomeError] = useState<string | null>(null)
  const readOnly = !hasConsolePermission('plugin.manage') || !isInboxCacheScopeActive(scope)
  const [plugins, setPlugins] = useState<MarketPlugin[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // `?q=` / `?category=` prefill the catalog (e.g. 「接入新平台账号」 for an adapter that is not installed).
  const [search, setSearch] = useState(() => searchParams.get('q')?.trim() ?? '')
  const [debouncedSearch, setDebouncedSearch] = useState(() => searchParams.get('q')?.trim() ?? '')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [category, setCategory] = useState<Category>(() => {
    const requested = searchParams.get('category')
    return CATEGORIES.find(item => item.value === requested)?.value ?? ''
  })
  const [officialOnly, setOfficialOnly] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('relevance')
  const [updates, setUpdates] = useState<UpdateInfo[]>([])
  const [updatesLoading, setUpdatesLoading] = useState(false)
  const [updatesDismissed, setUpdatesDismissed] = useState(false)
  // Installed packages on this Host (instance list, else the gateway's dependency list); null when unreadable.
  const [installed, setInstalled] = useState<InstalledPackages | null>(null)

  // Detail dialog
  const registryDetails = useRef(new Map<string, PluginDetail>())
  const detailRequest = useRef(0)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<PluginDetail | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('readme')
  const [copied, setCopied] = useState(false)
  const [declaredKey, setDeclaredKey] = useState<string | null>(null)

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
      if (!res.ok) throw new Error(i18n.t("搜索失败"))
      const data = await res.json()
      if (data.success) {
        const items = data.data.map((plugin: MarketPlugin) => applyRegistryVersion(plugin, registryDetails.current.get(plugin.name)))
        // 加载更多: later pages append, the first page replaces.
        setPlugins(previous => p > 1 ? [...previous, ...items.filter((item: MarketPlugin) => !previous.some(seen => seen.name === item.name))] : items)
        setTotal(data.total || 0)
      } else {
        throw new Error(data.error || i18n.t("数据格式错误"))
      }
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, category, officialOnly, sortKey, i18n])

  // Debounce search input (300ms)
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setDebouncedSearch(search)
      setPage(1)
    }, 300)
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [search])

  useEffect(() => {
    fetchPlugins(page)
  }, [fetchPlugins, page])

  // Reset page when filters change
  useEffect(() => { setPage(1) }, [category, officialOnly, sortKey])

  /**
   * Which marketplace packages this Host already has. The instance list knows instance keys; when
   * the instance cannot answer, the gateway's dependency list still tells what is installed.
   */
  const loadInstalled = useCallback(async () => {
    if (!isInboxCacheScopeActive(scope)) return
    let next: InstalledPackages | null = null
    try {
      const res = await apiFetch('/api/plugins')
      const body = res.ok ? await res.json().catch(() => null) : null
      next = readInstalledPackages(body)
    } catch { next = null }
    // Installed but undeclared packages (waiting for configuration) are only in the gateway's list.
    if (hasConsolePermission('feature.view')) {
      try {
        const fromGateway = installedFromPackageList(readPackageList(await gatewayRequest(GATEWAY_RPC.PACKAGES_LIST, {}, messages.current.t)))
        if (fromGateway) next = next ? new Map([...fromGateway, ...next]) : fromGateway
      } catch { /* the instance list alone */ }
    }
    if (isInboxCacheScopeActive(scope)) setInstalled(next)
  }, [scope])

  useEffect(() => { void loadInstalled() }, [loadInstalled])

  /** `silent` refreshes the banner after an install without announcing the result. */
  const checkUpdates = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    setUpdatesLoading(true)
    let outcome: UpdateCheckOutcome
    try {
      const res = await apiFetch('/api/marketplace/updates')
      const body = await res.json().catch(() => null)
      outcome = { ok: res.ok, status: res.status, body }
    } catch (error) {
      outcome = { error }
    }
    const result = classifyUpdateCheck(outcome, messages.current.locale)
    if (result.kind !== 'failed') {
      setUpdates(result.updates as UpdateInfo[])
      if (!silent) setUpdatesDismissed(false)
    }
    setUpdatesLoading(false)
    if (silent) return
    const feedback = updateCheckFeedback(result, messages.current.locale)
    toast[feedback.variant](feedback.description)
  }, [toast])

  const packageAction = usePackageAction({
    onSettled: () => { void loadInstalled(); void checkUpdates({ silent: true }) },
  })
  const resetAction = packageAction.reset

  const openDetail = useCallback(async (name: string) => {
    const request = ++detailRequest.current
    setDetailError(null)
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    setDetailTab('readme')
    setCopied(false)
    setDeclaredKey(null)
    resetAction()
    try {
      const res = await apiFetch(`/pub/marketplace/detail/${name}`)
      const data = await res.json()
      if (!res.ok || !data.success) throw new Error(data.error || i18n.t("加载插件详情失败"))
      if (request !== detailRequest.current) return
      const resolved = data.data as PluginDetail
      if (resolved.name !== name || !resolved.version) throw new Error(i18n.t("注册表返回的包身份或 latest 版本无效"))
      registryDetails.current.set(name, resolved)
      setDetail(resolved)
      setPlugins(items => items.map(plugin => applyRegistryVersion(plugin, registryDetails.current.get(plugin.name))))
    } catch (error) {
      if (request === detailRequest.current) setDetailError((error as Error).message)
    } finally {
      if (request === detailRequest.current) setDetailLoading(false)
    }
  }, [i18n, resetAction])

  useEffect(() => {
    if (!welcomeRequested || !scope || !isInboxCacheScopeActive(scope) || !hasConsolePermission('plugin.manage')) return
    let cancelled = false
    setWelcomePackage(null); setWelcomeError(null)
    void (async () => {
      try {
        const response = await apiFetch(CONSOLE_REST.TASK_USE_CASES, { cache: 'no-store' })
        if (!response.ok) throw Error(i18n.t("无法读取 Host 用途目录，未自动选择任何插件。"))
        const useCase = readWelcomeUseCase(await response.json(), i18n.locale)
        if (cancelled || !isInboxCacheScopeActive(scope)) return
        setWelcomePackage(useCase.packageName)
        await openDetail(useCase.packageName)
      } catch (cause) { if (!cancelled && isInboxCacheScopeActive(scope)) setWelcomeError(cause instanceof Error ? cause.message : i18n.t("用途读取失败")) }
    })()
    return () => { cancelled = true; detailRequest.current++ }
  }, [welcomeRequested, scope, openDetail])

  /** 准备: the gateway plans the install (`gateway.packages.plan`); the receipt shows it before anything runs. */
  const prepareInstall = useCallback(() => {
    if (readOnly || !isInboxCacheScopeActive(scope) || !detail?.version) return
    void packageAction.prepare('install', { name: detail.name, version: detail.version })
  }, [readOnly, scope, detail, packageAction])

  const handleCopyInstall = useCallback(async (name: string) => {
    const request = detailRequest.current
    setCopied(false)
    const success = await copyText(`pnpm add ${name}@latest`, navigator.clipboard, document)
    if (!success) {
      toast.error(i18n.t("复制失败，请选中安装命令手动复制。"))
      return
    }
    if (request !== detailRequest.current) return
    setCopied(true)
    setTimeout(() => { if (request === detailRequest.current) setCopied(false) }, 2000)
  }, [toast, i18n])

  const hasMore = plugins.length < total
  const listView = marketplaceListView({ loading: loading && page === 1, error, count: plugins.length })
  const detailStatus = detail ? marketplacePluginStatus(detail.name, installed, updates) : null
  const receiptPhase = packageAction.receipt.state.phase
  const followUps = detail ? installFollowUps({
    phase: declaredKey ? 'succeeded' : receiptPhase, operation: packageAction.operation, packageName: detail.name,
    instanceKey: declaredKey, welcomePackage,
  }) : []
  const actionIdle = receiptPhase === 'idle' && !packageAction.planning && !packageAction.needs.length

  return (
    <PageShell className="console-marketplace-page">
      {welcomeRequested && <Alert><AlertDescription className="space-y-2"><p>{welcomePackage ? i18n.t("群欢迎用途 · Host 指定包 {0}。这里只打开详情；请自行审阅版本与安装计划，尚未执行安装。", [welcomePackage]) : welcomeError ?? i18n.t("正在读取 Host 的群欢迎用途；不会按 URL 包名猜测插件。")}</p><Link className="underline" to={welcomeReturnUrl()}>{i18n.t("返回群欢迎流程并选择实例")}</Link></AlertDescription></Alert>}
      <PageHeader
        title={i18n.t("插件市场")}
        description={i18n.t("探索 Zhin.js 生态中的插件。列表为发现索引，打开详情后核验注册表 latest；安装由管理网关作为依赖事务执行。")}
        actions={<>
          <Button variant="outline" size="sm" asChild><Link to="/plugins"><Package />{i18n.t("插件")}</Link></Button>
          <Button variant="outline" size="sm" onClick={() => checkUpdates()} disabled={updatesLoading} aria-busy={updatesLoading || undefined}>
            <RefreshCw className={updatesLoading ? 'animate-spin' : ''} />
            {updatesLoading ? i18n.t("检查中…") : i18n.t("检查更新")}</Button>
        </>}
      />

      {/* Updates banner */}
      {updates.length > 0 && !updatesDismissed && (
        <Alert>
          <div className="flex items-start justify-between gap-2 w-full">
            <div className="flex items-start gap-2 min-w-0">
              <RefreshCw className="h-4 w-4 mt-0.5 shrink-0" />
              <AlertDescription className="space-y-2 min-w-0">
                <p>{i18n.t("有 ")}{updates.length} {i18n.t(" 个插件的本地版本与注册表 latest 不同：")}</p>
                <ul className="space-y-1.5" aria-label={i18n.t("可更新插件")}>
                  {updates.slice(0, 5).map(u => {
                    const status = marketplacePluginStatus(u.name, installed, updates)
                    return (
                      <li key={u.name} className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="max-w-full truncate font-mono" title={u.name}>
                          {u.name}：{u.current} → latest {u.latest}
                        </Badge>
                        <Button variant="outline" size="sm" asChild>
                          <Link to={pluginManageUrl(u.name, status.instanceKey)} aria-label={i18n.t("前往 {0} 的插件详情更新", [u.name])}>
                            {i18n.t("去更新")}
                          </Link>
                        </Button>
                        <Button variant="ghost" size="sm" onClick={() => void openDetail(u.name)} aria-label={i18n.t("在市场查看 {0} 的详情", [u.name])}>
                          {i18n.t("市场详情")}
                        </Button>
                      </li>
                    )
                  })}
                </ul>
                <p className="text-xs text-muted-foreground">
                  {i18n.t("更新在插件详情页执行：网关先生成计划，确认后停止实例、安装新版本、校验并重新启动，失败自动回滚。")}
                  {updates.length > 5 && <> <Link className="underline" to="/plugins">{i18n.t("另有 {0} 个，在「插件」页查看", [updates.length - 5])}</Link></>}
                </p>
              </AlertDescription>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 -mt-1" onClick={() => setUpdatesDismissed(true)}>
              {i18n.t("关闭")}</Button>
          </div>
        </Alert>
      )}

      {/* Search & Filters */}
      <div className="console-plugin-catalog-toolbar">
        <div className="console-plugin-catalog-search">
          <Search aria-hidden="true" />
          <Input
            placeholder={i18n.t("搜索插件名称、描述...")}
            aria-label={i18n.t("搜索插件名称、描述...")}
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant={officialOnly ? 'default' : 'outline'} size="sm" aria-pressed={officialOnly} onClick={() => setOfficialOnly(!officialOnly)}>
            <Package />{i18n.t("仅 @zhin.js")}</Button>
          <SelectField
            value={sortKey}
            onValueChange={value => setSortKey(value as SortKey)}
            className="w-auto"
            aria-label={i18n.t("排序")}
            options={SORT_OPTIONS.map(opt => ({ value: opt.value, label: i18n.t(opt.label) }))}
          />
        </div>
      </div>
      <div className="console-plugin-catalog-filters console-marketplace-categories" role="group" aria-label={i18n.t("分类")}>
        {CATEGORIES.map(c => (
          <button key={c.value || 'all'} type="button" aria-pressed={category === c.value}
            className={category === c.value ? 'console-plugin-filter-pill is-active' : 'console-plugin-filter-pill'}
            onClick={() => setCategory(c.value)}>{i18n.t(c.label)}</button>
        ))}
      </div>

      {/* Results info */}
      {(listView === 'results' || listView === 'empty') && (
        <p className="console-plugin-catalog-count">
          {i18n.t("共 ")}{total} {i18n.t(" 个插件")}{plugins.length < total ? i18n.t("，已显示 {0} 个", [plugins.length]) : ''}
        </p>
      )}

      {listView === 'error' && (
        <StatusState error={error} title={i18n.t("搜索失败")} description={i18n.t("插件索引没有返回结果。检查网络后重试；已安装的插件不受影响。")}
          onRetry={() => void fetchPlugins(page)} />
      )}

      {listView === 'loading' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      )}

      {listView === 'results' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          {plugins.map(plugin => (
            <Card
              key={plugin.name}
              role="button"
              tabIndex={0}
              aria-haspopup="dialog"
              className="cursor-pointer transition-all hover:shadow-md hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 min-w-0"
              onClick={() => openDetail(plugin.name)}
              onKeyDown={event => {
                if (event.target !== event.currentTarget || !isCardActivationKey(event.key)) return
                event.preventDefault()
                void openDetail(plugin.name)
              }}
            >
              <CardContent className="p-4 space-y-3">
                <div className="flex justify-between items-start gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <Package className="w-4 h-4 shrink-0 text-muted-foreground" />
                    <span className="font-semibold text-sm truncate" title={plugin.name}>
                      {plugin.displayName || plugin.name}
                    </span>
                  </div>
                  <div className="flex flex-wrap justify-end gap-1 shrink-0">
                    {(() => {
                      const status = marketplacePluginStatus(plugin.name, installed, updates)
                      if (status.kind === 'update') return <Badge variant="warning" size="sm" title={i18n.t("本地 {0}，latest {1}", [status.current, status.latest])}>{i18n.t("有更新")}</Badge>
                      if (status.kind === 'installed') return <Badge variant="success" size="sm" title={status.version ? i18n.t("本地版本 {0}", [status.version]) : undefined}>{i18n.t("已安装")}</Badge>
                      return null
                    })()}
                    {belongsToZhinScope(plugin.name) && (
                      <Badge variant="outline" size="sm" title={i18n.t("包属于 @zhin.js 命名空间，不表示安全审计或兼容性保证")}>@zhin.js</Badge>
                    )}
                  </div>
                </div>

                <p className="text-sm text-muted-foreground line-clamp-2 min-h-[2.5rem]">
                  {plugin.description || i18n.t("暂无描述")}
                </p>

                <Separator />

                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground min-w-0">
                  <span className="truncate min-w-0 flex-1">{plugin.author}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    <span className="font-mono">{plugin.versionSource === 'registry' ? 'latest' : i18n.t("索引")} v{plugin.version}</span>
                    {plugin.downloads?.monthly > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Download className="w-3 h-3" />
                        {formatDownloads(plugin.downloads.monthly)}{i18n.t("/月")}</span>
                    )}
                  </div>
                </div>

                {plugin.keywords?.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {plugin.keywords.slice(0, 3).map(kw => (
                      <Badge key={kw} variant="outline" size="sm">{kw}</Badge>
                    ))}
                    {plugin.keywords.length > 3 && (
                      <Badge variant="outline" size="sm">
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

      {listView === 'empty' && (
        <StatusState kind="empty" title={i18n.t("未找到插件")} description={i18n.t("尝试调整搜索条件或分类筛选")} />
      )}

      {listView === 'results' && hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" disabled={loading} aria-busy={loading || undefined} onClick={() => setPage(p => p + 1)}>
            {loading ? i18n.t("加载中…") : i18n.t("加载更多")}
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={(open) => { if (!open && packageAction.busy) return; if (!open) detailRequest.current++; setDetailOpen(open) }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
          {detailLoading ? (
            <div className="space-y-3 p-1">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : detail ? (
            <>
              <DialogHeader>
                <DialogTitle className="flex flex-wrap items-center gap-2 min-w-0">
                  <Package className="w-5 h-5 shrink-0" />
                  <span className="truncate" title={detail.name}>{detail.name}</span>
                  <Badge variant="secondary">latest v{detail.version}</Badge>
                </DialogTitle>
                <DialogDescription>{detail.description}</DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
                <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
                  <div><dt className="text-xs text-muted-foreground">{i18n.t("周下载")}</dt><dd className="font-semibold">{formatDownloads(detail.downloads?.weekly || 0)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{i18n.t("月下载")}</dt><dd className="font-semibold">{formatDownloads(detail.downloads?.monthly || 0)}</dd></div>
                  <div><dt className="text-xs text-muted-foreground">{i18n.t("版本数")}</dt><dd className="font-semibold">{detail.versions?.length || 0}</dd></div>
                  {detail.author && <div><dt className="text-xs text-muted-foreground">{i18n.t("作者")}</dt><dd className="truncate">{detail.author}</dd></div>}
                  {detail.license && <div><dt className="text-xs text-muted-foreground">{i18n.t("许可证")}</dt><dd>{detail.license}</dd></div>}
                  {detail.lastPublish && <div><dt className="text-xs text-muted-foreground">{i18n.t("最后发布")}</dt><dd>{formatDate(detail.lastPublish, i18n.locale)}</dd></div>}
                  {detail.engines?.node && <div><dt className="text-xs text-muted-foreground">Node.js</dt><dd className="font-mono">{detail.engines.node}</dd></div>}
                </dl>

                {detailStatus && (detailStatus.kind === 'installed' || detailStatus.kind === 'update') && actionIdle && (
                  <Alert>
                    <CheckCircle2 className="h-4 w-4" />
                    <AlertDescription className="space-y-2">
                      <p>
                        {detailStatus.kind === 'update'
                          ? i18n.t("此 Host 已安装 {0}，latest 为 {1}。更新在插件详情页执行。", [detailStatus.current, detailStatus.latest])
                          : detailStatus.version ? i18n.t("此 Host 已安装 {0}。", [detailStatus.version]) : i18n.t("此 Host 已安装该插件。")}
                        {detailStatus.instanceCount > 1 && i18n.t("共 {0} 个实例，以下入口打开 {1}。", [detailStatus.instanceCount, detailStatus.instanceKey ?? ''])}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {detailStatus.instanceKey && (
                          <Button size="sm" asChild>
                            <Link to={pluginConfigUrl(detailStatus.instanceKey)}><Settings />{readOnly ? i18n.t("查看配置") : i18n.t("去配置")}</Link>
                          </Button>
                        )}
                        <Button variant="outline" size="sm" asChild>
                          <Link to={pluginManageUrl(detail.name, detailStatus.instanceKey)}>{detailStatus.kind === 'update' ? i18n.t("去更新") : i18n.t("插件详情")}</Link>
                        </Button>
                      </div>
                    </AlertDescription>
                  </Alert>
                )}

                <PackageActionPanel action={packageAction} readOnly={readOnly}
                  onDeclared={need => { setDeclaredKey(need.instanceKey); void loadInstalled() }} />
                {followUps.length > 0 && (
                  <nav className="flex flex-wrap gap-2" aria-label={i18n.t("安装后的下一步")}>
                    {followUps.map(link => (
                      <Button key={link.kind} size="sm" variant={link.kind === 'configure' || link.kind === 'welcome' ? 'default' : 'outline'} asChild>
                        <Link to={link.to}>
                          {link.kind === 'configure' ? <Settings /> : link.kind === 'features' ? <ToggleLeft /> : null}
                          {i18n.t(FOLLOW_UP_LABELS[link.kind])}
                        </Link>
                      </Button>
                    ))}
                  </nav>
                )}

                <Tabs value={detailTab} onValueChange={(value) => setDetailTab(value as DetailTab)}>
                  <TabsList className="h-auto w-full justify-start gap-0 rounded-none border-b bg-transparent p-0 overflow-x-auto">
                    {([['readme', 'README'], ['versions', i18n.t("版本")], ['deps', i18n.t("依赖")]] as [DetailTab, string][]).map(
                      ([key, label]) => (
                        <TabsTrigger
                          key={key}
                          value={key}
                          className="rounded-none border-b-2 border-transparent px-3 py-2 data-[state=active]:border-primary data-[state=active]:bg-transparent max-md:min-h-11"
                        >
                          {label}
                        </TabsTrigger>
                      ),
                    )}
                  </TabsList>
                </Tabs>

                {detailTab === 'readme' && (
                  detail.readme ? (
                    <pre className="whitespace-pre-wrap text-xs text-muted-foreground leading-relaxed bg-muted rounded-md p-3 overflow-x-auto max-h-64 overflow-y-auto">
                      {detail.readme}
                    </pre>
                  ) : <StatusState compact kind="empty" title={i18n.t("暂无 README")} description={i18n.t("包没有发布 README，可在 npm 或源码页查看说明。")} />
                )}

                {detailTab === 'versions' && (
                  <div>
                    {detail.versions?.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
                        {detail.versions.slice(-20).reverse().map(v => (
                          <span key={v} className="inline-flex items-center gap-1 px-2 py-1 rounded border text-xs font-mono bg-muted/40 min-w-0 truncate" title={v}>
                            <GitBranch className="w-3 h-3 text-muted-foreground shrink-0" />
                            <span className="truncate">{v}</span>
                          </span>
                        ))}
                      </div>
                    ) : <StatusState compact kind="empty" title={i18n.t("暂无版本信息")} description={i18n.t("注册表没有返回版本列表。")} />}
                    {detail.versions?.length > 20 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {i18n.t("最近 20 个版本（共 ")}{detail.versions.length} {i18n.t(" 个）")}</p>
                    )}
                  </div>
                )}

                {detailTab === 'deps' && (
                  <div className="space-y-3">
                    {detail.peerDependencies && Object.keys(detail.peerDependencies).length > 0 ? (
                      <DependencyList title="Peer Dependencies" entries={detail.peerDependencies} />
                    ) : <StatusState compact kind="empty" title={i18n.t("无 peer dependencies")} description={i18n.t("这个包不要求宿主额外安装其他包。")} />}
                    {detail.engines && Object.keys(detail.engines).length > 0 && <DependencyList title="Engines" entries={detail.engines} />}
                  </div>
                )}

                <div>
                  <h4 className="console-section-title mb-2">{i18n.t("安装命令")}</h4>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="flex-1 min-w-0 text-xs bg-muted rounded-md p-2 overflow-x-auto break-all">
                      pnpm add {detail.name}@latest
                    </code>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopyInstall(detail.name)}
                      aria-label={copied ? i18n.t("已复制安装命令") : i18n.t("复制安装命令")}
                      className="shrink-0"
                    >
                      {copied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    </Button>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">{i18n.t("手动安装不经过网关事务，需要自行停启实例；推荐使用「安装」。")}</p>
                </div>
              </div>

              <DialogFooter className="gap-2 flex-wrap shrink-0 pt-2">
                {detail.homepage && (
                  <Button variant="outline" size="sm" asChild>
                    <a href={detail.homepage} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="w-3 h-3 mr-1" /> {i18n.t(" 主页")}</a>
                  </Button>
                )}
                {detail.repository && (
                  <Button variant="outline" size="sm" asChild>
                    <a
                      href={detail.repository.replace(/^git\+/, '').replace(/\.git$/, '')}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-3 h-3 mr-1" /> {i18n.t(" 源码")}</a>
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
                {!readOnly && actionIdle && (
                  <Button size="sm" onClick={prepareInstall} disabled={packageAction.busy}>
                    <Download className="w-3 h-3 mr-1" />{i18n.t("安装")}
                  </Button>
                )}
                {!readOnly && packageAction.planning && <Button size="sm" disabled aria-busy><RefreshCw className="animate-spin" />{i18n.t("生成计划中…")}</Button>}
                {readOnly && <span className="text-xs text-muted-foreground">{i18n.t("当前身份只能查看市场，安装需要 plugin.manage 权限。")}</span>}
                <DialogClose asChild>
                  <Button variant="secondary" size="sm" disabled={packageAction.busy}>{i18n.t("关闭")}</Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <StatusState error={detailError} title={i18n.t("加载插件详情失败")} description={i18n.t("注册表没有返回这个包的详情。稍后重试，或在 npm 上查看。")} />
          )}
        </DialogContent>
      </Dialog>
    </PageShell>
  )
}

function DependencyList({ title, entries }: { title: string; entries: Record<string, string> }) {
  return (
    <div>
      <h4 className="text-xs font-medium mb-1.5 text-muted-foreground">{title}</h4>
      <div className="space-y-1">
        {Object.entries(entries).map(([name, ver]) => (
          <div key={name} className="flex items-center justify-between gap-2 px-3 py-1.5 rounded border text-xs bg-muted/40 min-w-0">
            <span className="font-mono truncate min-w-0" title={name}>{name}</span>
            <span className="text-muted-foreground shrink-0 truncate max-w-[40%] font-mono" title={String(ver)}>{String(ver)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
