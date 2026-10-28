import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { copyText } from './clipboard-copy.mjs'
import { useToast } from '../components/toast'
import { reconcileInstall, canResumeInstall, planInstallRecovery } from './marketplace-install-model.mjs'
import { applyRegistryVersion, belongsToZhinScope } from './marketplace-version.mjs'
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
import { SelectField } from '../components/ui/select'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'
import { Tabs, TabsList, TabsTrigger } from '../components/ui/tabs'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from '../components/ui/dialog'
import { apiFetch } from '../utils/auth'
import { requestConsole, type ConsoleRpcRequest } from '../utils/console-rpc'
import { Link, useSearchParams } from 'react-router-dom'
import { isDemoMode } from '../utils/demo-mode'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { readWelcomeUseCase, welcomeReturnUrl } from './welcome-use-case-model.mjs'
import { validateManagementState, mutationRequest, type PluginManagementState } from './plugin-management-model.mjs'
import { PluginManagementSummary } from './PluginManagementSummary'

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

interface PluginInstallPlan {
  projectRevision?: string
  configurationRevision?: string | null
  requestedSpec?: string
  targetVersion?: string
  packageName: string
  instanceKey: string
  alreadyDeclared: boolean
  alreadyInstalled: boolean
  restartRequired: boolean
  changes: { packageManifest: string; config: string }
  warnings: string[]
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
  const readOnly = isDemoMode() || !isInboxCacheScopeActive(scope)
  const requestForScope = useCallback((request: ConsoleRpcRequest) => {
    if (!isInboxCacheScopeActive(scope)) return Promise.reject(new Error(messages.current.t("连接身份已变化，请在原 Host 核对；不会向新连接继续操作。")))
    return requestConsole(request)
  }, [scope])
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
  const registryDetails = useRef(new Map<string, PluginDetail>())
  const detailRequest = useRef(0)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detail, setDetail] = useState<PluginDetail | null>(null)
  const [detailTab, setDetailTab] = useState<DetailTab>('readme')
  const [copied, setCopied] = useState(false)
  const installInFlight = useRef(false)
  const pendingInstalls = useRef(new Map<string, { message: string; instanceKey: string; version: string }>())
  const [uncertainPackage, setUncertainPackage] = useState<string | null>(null)
  const [installPlan, setInstallPlan] = useState<PluginInstallPlan | null>(null)
  const [installLoading, setInstallLoading] = useState(false)
  const [installMessage, setInstallMessage] = useState<string | null>(null)
  const [installedState, setInstalledState] = useState<PluginManagementState | null>(null)
  const [installError, setInstallError] = useState<string | null>(null)

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
        setPlugins(data.data.map((plugin: MarketPlugin) => applyRegistryVersion(plugin, registryDetails.current.get(plugin.name))))
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
        if (data.success) setUpdates(data.data.filter((item: UpdateInfo) => item.current && item.latest && item.current !== item.latest))
      }
    } catch { /* ignore */ }
    finally { setUpdatesLoading(false) }
  }, [])

  const openDetail = useCallback(async (name: string) => {
    const request = ++detailRequest.current
    setDetailError(null)
    setDetailOpen(true)
    setDetailLoading(true)
    setDetail(null)
    setDetailTab('readme')
    setCopied(false)
    setInstallPlan(null)
    setInstalledState(null)
    setInstallMessage(null)
    setInstallError(pendingInstalls.current.get(name)?.message ?? null)
    setUncertainPackage(pendingInstalls.current.has(name) ? name : null)
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
  }, [i18n])

  useEffect(() => {
    if (!welcomeRequested || !scope || !isInboxCacheScopeActive(scope) || isDemoMode()) return
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

  const previewInstall = useCallback(async (packageName: string) => {
    if (readOnly || !isInboxCacheScopeActive(scope) || installInFlight.current || uncertainPackage || !detail || detail.name !== packageName || !detail.version) return
    const sequence = detailRequest.current
    installInFlight.current = true
    setInstallLoading(true)
    setInstallError(null)
    setInstallMessage(null)
    try {
      const requestedSpec = `${packageName}@${detail.version}`
      const plan = await requestForScope({
        type: 'plugin:plan-install',
        packageName: requestedSpec,
      }) as PluginInstallPlan
      if (sequence !== detailRequest.current) return
      if (plan.packageName !== packageName) throw new Error(i18n.t("安装计划返回了不同包，请重新核验"))
      mutationRequest('plugin:install', { ...plan, requestedSpec }, undefined, i18n.locale)
      setInstallPlan({ ...plan, requestedSpec, targetVersion: detail.version })
    } catch (err) {
      if (sequence === detailRequest.current) setInstallError((err as Error).message)
    } finally {
      installInFlight.current = false
      if (sequence === detailRequest.current) setInstallLoading(false)
    }
  }, [detail, readOnly, uncertainPackage, scope, requestForScope, i18n])

  const recheckInstall = useCallback(async (packageName: string) => {
    setInstallLoading(true)
    const request = detailRequest.current
    const target = pendingInstalls.current.get(packageName)
    if (!target) { setInstallLoading(false); return }
    if (!isInboxCacheScopeActive(scope)) return
    const state = await reconcileInstall(packageName, () => requestForScope({ type: 'plugin:inspect', instanceKey: target.instanceKey }), target, i18n.locale)
    if (state.confirmed) pendingInstalls.current.delete(packageName)
    else pendingInstalls.current.set(packageName, { ...target, message: state.message })
    if (request === detailRequest.current) {
      setInstallPlan(null)
      setInstalledState(state.state)
      setUncertainPackage(state.confirmed ? null : packageName)
      setInstallError(state.confirmed ? null : state.message)
      setInstallMessage(state.confirmed ? state.message : null)
    }
    setInstallLoading(false)
  }, [scope, requestForScope, i18n])

  const resumeInstall = useCallback(async () => {
    if (readOnly || !isInboxCacheScopeActive(scope) || !uncertainPackage || installInFlight.current) return
    const packageName = uncertainPackage
    const target = pendingInstalls.current.get(packageName)
    if (!target) return
    const sequence = detailRequest.current
    installInFlight.current = true
    setInstallLoading(true)
    try {
      const plan = await planInstallRecovery(requestForScope, packageName, target, i18n.locale)
      if (sequence !== detailRequest.current) return
      pendingInstalls.current.delete(packageName)
      setUncertainPackage(null)
      setInstallError(null)
      setInstallMessage(null)
      setInstallPlan(plan as PluginInstallPlan)
    } catch (error) {
      if (sequence === detailRequest.current) setInstallError((error as Error).message)
    } finally { installInFlight.current = false; if (sequence === detailRequest.current) setInstallLoading(false) }
  }, [readOnly, uncertainPackage, scope, requestForScope, i18n])

  const commitInstall = useCallback(async () => {
    if (readOnly || !isInboxCacheScopeActive(scope) || !installPlan || installInFlight.current || uncertainPackage) return
    const packageName = installPlan.packageName
    const request = detailRequest.current
    installInFlight.current = true
    setInstallLoading(true)
    setInstallError(null)
    let submitted = false
    try {
      const installRequest = mutationRequest('plugin:install', installPlan, undefined, i18n.locale)
      submitted = true
      setInstallPlan(null)
      const unknown = i18n.t("安装已提交，结果正在核对；请勿重复安装。")
      pendingInstalls.current.set(packageName, { message: unknown, instanceKey: installPlan.instanceKey, version: installPlan.targetVersion! })
      setUncertainPackage(packageName)
      await requestForScope(installRequest)
      if (!isInboxCacheScopeActive(scope)) return
      const reconciled = await reconcileInstall(packageName, () => requestForScope({ type: 'plugin:inspect', instanceKey: installPlan.instanceKey }), { instanceKey: installPlan.instanceKey, version: installPlan.targetVersion! }, i18n.locale)
      if (!reconciled.confirmed || !reconciled.state) { await recheckInstall(packageName); return }
      const state = reconciled.state
      pendingInstalls.current.delete(packageName)
      if (request === detailRequest.current) {
        setUncertainPackage(null)
        setInstalledState(state)
        setInstallMessage(i18n.t("安装步骤已完成。请按当前状态完善配置、申请应用并选择业务检查；尚未证明功能可用。"))
      }
      void checkUpdates()
    } catch (err) {
      if (submitted) await recheckInstall(packageName)
      else if (request === detailRequest.current) setInstallError((err as Error).message)
    } finally {
      installInFlight.current = false
      setInstallLoading(false)
    }
  }, [checkUpdates, installPlan, uncertainPackage, recheckInstall, readOnly, scope, requestForScope, i18n])

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

  const totalPages = Math.ceil(total / PAGE_SIZE)

  return (
    <div className="space-y-4">
      {welcomeRequested && <Alert><AlertDescription className="space-y-2"><p>{welcomePackage ? i18n.t("群欢迎用途 · Host 指定包 {0}。这里只打开详情；请自行审阅版本与原安装计划，尚未执行安装。", [welcomePackage]) : welcomeError ?? i18n.t("正在读取 Host 的群欢迎用途；不会按 URL 包名猜测插件。")}</p><Link className="underline" to={welcomeReturnUrl()}>{i18n.t("返回群欢迎流程并选择实例")}</Link></AlertDescription></Alert>}
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{i18n.t("插件市场")}</h1>
          <p className="text-sm text-muted-foreground mt-1">
            {i18n.t("探索 Zhin.js 生态中的插件。列表为发现索引，打开详情后核验注册表 latest。")}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={checkUpdates} disabled={updatesLoading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${updatesLoading ? 'animate-spin' : ''}`} />
            {i18n.t("检查更新")}</Button>
        </div>
      </div>

      {/* Updates banner */}
      {updates.length > 0 && !updatesDismissed && (
        <Alert>
          <div className="flex items-start justify-between w-full">
            <div className="flex items-start gap-2">
              <RefreshCw className="h-4 w-4 mt-0.5 shrink-0" />
              <AlertDescription>
                {i18n.t("有 ")}{updates.length} {i18n.t(" 个插件的本地版本与注册表 latest 不同：")}<div className="flex flex-wrap gap-1 mt-1">
                  {updates.slice(0, 5).map(u => (
                    <Badge key={u.name} variant="secondary" className="text-xs">
                      {u.name}：{u.current} → latest {u.latest}
                    </Badge>
                  ))}
                  {updates.length > 5 && (
                    <span className="text-xs text-muted-foreground">+{updates.length - 5} {i18n.t(" 更多")}</span>
                  )}
                </div>
              </AlertDescription>
            </div>
            <Button variant="ghost" size="sm" className="shrink-0 -mt-1" onClick={() => setUpdatesDismissed(true)}>
              {i18n.t("关闭")}</Button>
          </div>
        </Alert>
      )}

      {/* Search & Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder={i18n.t("搜索插件名称、描述...")}
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
            <Package className="w-4 h-4 mr-1" />
            {i18n.t("仅 @zhin.js")}</Button>
          <SelectField
            value={sortKey}
            onValueChange={value => setSortKey(value as SortKey)}
            className="w-auto"
            options={SORT_OPTIONS.map(opt => ({ value: opt.value, label: i18n.t(opt.label) }))}
          />
        </div>
      </div>

      {/* Category Tabs */}
      <Tabs value={category} onValueChange={v => setCategory(v as Category)}>
        <TabsList className="flex flex-wrap h-auto w-full justify-start gap-1">
          {CATEGORIES.map(c => (
            <TabsTrigger key={c.value} value={c.value}>{i18n.t(c.label)}</TabsTrigger>
          ))}
        </TabsList>
      </Tabs>

      {/* Results info */}
      {!loading && (
        <div className="text-xs text-muted-foreground">
          {i18n.t("共 ")}{total} {i18n.t(" 个插件")}{totalPages > 1 && i18n.t("，第 {0}/{1} 页", [page, totalPages])}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
          {[...Array(6)].map((_, i) => <Skeleton key={i} className="h-44" />)}
        </div>
      )}

      {/* Plugin Grid */}
      {!loading && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4 gap-3">
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
                    {belongsToZhinScope(plugin.name) && (
                      <Badge variant="default" className="text-[10px]" title={i18n.t("包属于 @zhin.js 命名空间，不表示安全审计或兼容性保证")}>@zhin.js</Badge>
                    )}
                    <Badge variant="secondary" className="text-[10px]">{plugin.versionSource === 'registry' ? 'latest' : i18n.t("索引")} v{plugin.version}</Badge>
                  </div>
                </div>

                <p className="text-xs text-muted-foreground line-clamp-2 min-h-[2rem]">
                  {plugin.description || i18n.t("暂无描述")}
                </p>

                <Separator />

                {/* Footer: author, date, downloads */}
                <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground min-w-0">
                  <span className="truncate min-w-0 flex-1">{plugin.author}</span>
                  <div className="flex items-center gap-3 shrink-0">
                    {plugin.downloads?.monthly > 0 && (
                      <span className="flex items-center gap-0.5">
                        <Download className="w-3 h-3" />
                        {formatDownloads(plugin.downloads.monthly)}{i18n.t("/月")}</span>
                    )}
                    <span>{formatDate(plugin.date, i18n.locale)}</span>
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
            <h3 className="text-lg font-semibold">{i18n.t("未找到插件")}</h3>
            <p className="text-sm text-muted-foreground">{i18n.t("尝试调整搜索条件或分类筛选")}</p>
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
            {i18n.t("上一页")}</Button>
          <span className="text-sm text-muted-foreground px-2">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setPage(p => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages || loading}
          >
            {i18n.t("下一页")}<ChevronRight className="w-4 h-4 ml-1" />
          </Button>
        </div>
      )}

      {/* Detail Dialog */}
      <Dialog open={detailOpen} onOpenChange={(open) => { if (!open) detailRequest.current++; setDetailOpen(open) }}>
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
                  <Badge variant="secondary">latest v{detail.version}</Badge>
                </DialogTitle>
                <DialogDescription>{detail.description}</DialogDescription>
              </DialogHeader>

              <div className="flex-1 overflow-y-auto space-y-4 min-h-0">
                {/* Stats */}
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div className="rounded-md bg-secondary p-2">
                    <div className="text-lg font-bold">{formatDownloads(detail.downloads?.weekly || 0)}</div>
                    <div className="text-[10px] text-muted-foreground">{i18n.t("周下载")}</div>
                  </div>
                  <div className="rounded-md bg-secondary p-2">
                    <div className="text-lg font-bold">{formatDownloads(detail.downloads?.monthly || 0)}</div>
                    <div className="text-[10px] text-muted-foreground">{i18n.t("月下载")}</div>
                  </div>
                  <div className="rounded-md bg-secondary p-2">
                    <div className="text-lg font-bold">{detail.versions?.length || 0}</div>
                    <div className="text-[10px] text-muted-foreground">{i18n.t("版本数")}</div>
                  </div>
                </div>

                <Separator />

                {/* Metadata */}
                <div className="space-y-2 text-sm">
                  {detail.author && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{i18n.t("作者")}</span>
                      <span>{detail.author}</span>
                    </div>
                  )}
                  {detail.license && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{i18n.t("许可证")}</span>
                      <span>{detail.license}</span>
                    </div>
                  )}
                  {detail.lastPublish && (
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">{i18n.t("最后发布")}</span>
                      <span>{formatDate(detail.lastPublish, i18n.locale)}</span>
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
                  {([['readme', 'README'], ['versions', i18n.t("版本")], ['deps', i18n.t("依赖")]] as [DetailTab, string][]).map(
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
                      <p className="text-sm text-muted-foreground text-center py-6">{i18n.t("暂无 README")}</p>
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
                      <p className="text-sm text-muted-foreground text-center py-6">{i18n.t("暂无版本信息")}</p>
                    )}
                    {detail.versions?.length > 20 && (
                      <p className="text-xs text-muted-foreground mt-2">
                        {i18n.t("最近 20 个版本（共 ")}{detail.versions.length} {i18n.t(" 个）")}</p>
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
                      <p className="text-sm text-muted-foreground text-center py-6">{i18n.t("无 peer dependencies")}</p>
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
                  <h4 className="text-sm font-medium mb-2">{i18n.t("安装命令")}</h4>
                  <div className="flex items-center gap-2 min-w-0">
                    <code className="flex-1 min-w-0 text-xs bg-secondary rounded-md p-2 overflow-x-auto break-all">
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
                </div>

                {installError && (
                  <Alert variant="destructive">
                    <AlertCircle className="h-4 w-4" />
                    <AlertDescription>{installError}</AlertDescription>
                  </Alert>
                )}
                {installMessage && (
                  <Alert>
                    <Check className="h-4 w-4" />
                    <AlertDescription>{installMessage}</AlertDescription>
                  </Alert>
                )}
                {uncertainPackage && <Button variant="outline" size="sm" disabled={installLoading} onClick={() => void recheckInstall(uncertainPackage)}>{installLoading ? i18n.t("核对中…") : i18n.t("重新核对安装状态")}</Button>}
                {!readOnly && uncertainPackage && canResumeInstall(installedState, uncertainPackage, pendingInstalls.current.get(uncertainPackage)) && <Button size="sm" disabled={installLoading} onClick={() => void resumeInstall()}>{i18n.t("生成补全挂载与配置的计划")}</Button>}
                {installedState && <div className="rounded-md border p-3 space-y-3"><PluginManagementSummary state={installedState} />{welcomePackage === installedState.packageName && installedState.declared && <Button asChild size="sm"><Link to={welcomeReturnUrl(installedState.instanceKey)}>{i18n.t("继续配置实际实例 ")}{installedState.instanceKey}</Link></Button>}</div>}
                {installPlan && (
                  <div className="rounded-md border p-3 space-y-2 text-sm">
                    <div className="font-medium">{i18n.t("安装计划")}</div>
                    <div className="text-xs text-muted-foreground space-y-1">
                      <div>{i18n.t("目标包：")}{installPlan.requestedSpec}</div>
                      <div>{i18n.t("实例名：")}{installPlan.instanceKey}</div>
                      <div>{i18n.t("插件清单：")}{installPlan.changes.packageManifest === 'unchanged' ? i18n.t("无需修改") : i18n.t("将新增挂载")}</div>
                      <div>{i18n.t("配置：")}{installPlan.changes.config === 'unchanged' ? i18n.t("无需修改") : i18n.t("将创建配置项")}</div>
                      <div>{i18n.t("重启：")}{installPlan.restartRequired ? i18n.t("需要") : i18n.t("不需要")}</div>
                    </div>
                    {installPlan.warnings.length > 0 && (
                      <ul className="list-disc pl-5 text-xs text-muted-foreground">
                        {installPlan.warnings.map(warning => <li key={warning}>{warning}</li>)}
                      </ul>
                    )}
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setInstallPlan(null)} disabled={installLoading}>
                        {i18n.t("取消")}</Button>
                      <Button size="sm" onClick={() => void commitInstall()} disabled={readOnly || installLoading || !!uncertainPackage}>
                        {installLoading ? i18n.t("安装中…") : i18n.t("确认安装")}
                      </Button>
                    </div>
                  </div>
                )}
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
                {!readOnly && !installPlan && !installMessage && !uncertainPackage && (
                  <Button size="sm" onClick={() => void previewInstall(detail.name)} disabled={installLoading}>
                    <Download className="w-3 h-3 mr-1" />
                    {installLoading ? i18n.t("检查中…") : i18n.t("安装")}
                  </Button>
                )}
                {readOnly && <span className="text-xs text-muted-foreground">{i18n.t("当前为 Demo，只能查看市场，安装需完整权限。")}</span>}
                <Button variant="outline" size="sm" asChild><Link to="/plugins">{i18n.t("查看本地插件状态")}</Link></Button>
                <DialogClose asChild>
                  <Button variant="secondary" size="sm">{i18n.t("关闭")}</Button>
                </DialogClose>
              </DialogFooter>
            </>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{detailError || i18n.t("加载插件详情失败")}</AlertDescription>
            </Alert>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}
