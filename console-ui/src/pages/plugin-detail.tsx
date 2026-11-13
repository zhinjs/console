import { useI18n } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import {
  Activity, Package, Settings, Terminal, Box as IconBox, Layers, Clock, Database, Brain, Wrench, Shield, Plug, Server, RefreshCw,
  Stethoscope, Trash2, ArrowUpCircle, ToggleLeft, Blocks, ArrowLeft, type LucideIcon,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { useLogPanel } from '../components/log-panel/LogPanel'
import { apiFetch } from '../utils/auth'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { StatusState } from '../components/StatusState'
import { requestConsole } from '../utils/console-rpc'
import { useConfirm } from '../components/confirm-dialog'
import { validatePluginDetail, pluginDiagnosticSummary, pluginDetailView } from './plugin-detail-model.mjs'
import { JsonViewer } from './introspection/JsonViewer'
import { PluginManagementSummary } from './PluginManagementSummary'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { CONSOLE_PATHS, featureGlobalHref } from '../console-routes.mjs'
import { WelcomeFlowContext } from './WelcomeFlowContext'
import { welcomeConfigUrl } from './welcome-use-case-model.mjs'
import { ObjectSection } from '../scope/ObjectPageLayout'
import { FEATURE_RPC } from '../contracts/zhin-console'
import { readFeatureMatrix, type FeatureMatrix } from './features/feature-model.mjs'
import { IAM_RPC, readPluginPermissionCatalog, type PluginPermission } from './access/access-model.mjs'
import { GATEWAY_RPC, readPackageList, relativeConfigPath } from './ops/gateway-model.mjs'
import { DeclarePluginDialog } from './ops/plugin-declare'
import { gatewayRequest } from './ops/use-gateway'
import { PackageActionPanel, usePackageAction } from './PackageAction'
import { defaultInstanceKey, installedPackage, sourceLabel, type PackageListEntry } from './plugin-package-model.mjs'
import { pluginPermissionGroups, pluginScopeSummary, type PluginScopeSummary } from './plugin-scope-model.mjs'
import { classifyUpdateCheck } from './marketplace-view-model.mjs'
import { validateManagementState, managementLabel, canApplyPlugin, canVerifyPlugin, captureVerificationPlan, verifyApprovedPlugin, verificationSummary, verificationCheckDisplay, verificationResultDisplay, applyRequest, waitForManagementState, verificationIsCurrent, type PluginManagementState, type VerificationPlan, type VerificationResult } from './plugin-management-model.mjs'
import './plugins.css'

/** Feature 序列化格式（与后端 FeatureJSON 一致） */
interface FeatureJSON {
  name: string
  icon: string
  desc: string
  count: number
  items: { name: string; desc?: string }[]
}

interface PluginDetail {
  name: string
  packageRoot: string
  status: 'active' | 'inactive'
  description: string
  features: FeatureJSON[]
  packageName: string
  instanceKey: string
  manageable: boolean
  readOnly?: boolean
  version?: string
  management?: PluginManagementState
  managementError?: string
}

type Read<T> = { status: 'loading' } | { status: 'ready'; value: T } | { status: 'failed'; error: unknown } | { status: 'skipped' }

/** 根据后端返回的 icon 名称映射到 lucide-react 图标组件 */
const iconMap: Record<string, LucideIcon> = {
  Terminal,
  Box: IconBox,
  Layers,
  Clock,
  Brain,
  Wrench,
  Database,
  Shield,
  Settings,
  Plug,
  Server,
}

/** Introspection tab per capability kind (the raw view of the same items). */
const INTROSPECTION_TABS: Record<string, string> = {
  command: 'commands', middleware: 'middlewares', component: 'components', tool: 'tools', mcp: 'mcp', 'prompt-section': 'prompt-sections',
}

const LEVEL_LABELS = { read: '查看（read）', operate: '操作（operate）', manage: '管理（manage）' } as const

function getIcon(iconName: string): LucideIcon {
  return iconMap[iconName] || Package
}

function useOptionalRead<T>(enabled: boolean, load: () => Promise<T>, deps: readonly unknown[]): [Read<T>, () => void] {
  const [state, setState] = useState<Read<T>>(enabled ? { status: 'loading' } : { status: 'skipped' })
  const sequence = useRef(0)
  const loadRef = useRef(load)
  loadRef.current = load
  const run = useCallback(() => {
    if (!enabled) { setState({ status: 'skipped' }); return }
    const request = ++sequence.current
    setState(previous => previous.status === 'ready' ? previous : { status: 'loading' })
    loadRef.current().then(value => { if (request === sequence.current) setState({ status: 'ready', value }) },
      error => { if (request === sequence.current) setState({ status: 'failed', error }) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps])
  useEffect(() => { run(); return () => { sequence.current += 1 } }, [run])
  return [state, run]
}

export default function PluginDetailPage() {
  const i18n = useI18n()
  const logPanel = useLogPanel()
  const { name } = useParams<{ name: string }>()
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q')
  const listUrl = query ? `/plugins?q=${encodeURIComponent(query)}` : '/plugins'
  const welcome = searchParams.get('useCase') === 'group-welcome'
  const routeIdentity = useRef(name)
  routeIdentity.current = name
  const lifecycleAbort = useRef<AbortController | null>(null)
  const detailSequence = useRef(0)
  const actionInFlight = useRef(false)
  const [plugin, setPlugin] = useState<PluginDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [detailError, setDetailError] = useState<unknown>(null)
  const [actionUnconfirmed, setActionUnconfirmed] = useState(false)
  const [unconfirmedCheck, setUnconfirmedCheck] = useState<string | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionErrorDetail, setActionErrorDetail] = useState<string | null>(null)
  const [diagnostic, setDiagnostic] = useState<unknown>(null)
  const [verificationPlan, setVerificationPlan] = useState<VerificationPlan | null>(null)
  const [verificationResult, setVerificationResult] = useState<{ outcome: VerificationResult; plan: VerificationPlan } | null>(null)
  const [verificationInvalidated, setVerificationInvalidated] = useState(false)
  const [declaring, setDeclaring] = useState(false)
  const canManagePackages = hasConsolePermission('plugin.manage')
  const writable = !!plugin?.manageable && !plugin?.readOnly && canManagePackages
  const { confirm, ConfirmDialog: ConfirmDialogHost } = useConfirm()

  // Package name: from the instance once read; before that (or without the instance) the route name.
  const packageName = plugin?.packageName ?? name ?? ''
  const [packages, refreshPackages] = useOptionalRead(hasConsolePermission('feature.view'),
    async () => readPackageList(await gatewayRequest(GATEWAY_RPC.PACKAGES_LIST, {}, i18n.t)), [i18n])
  const [latest, refreshLatest] = useOptionalRead(Boolean(packageName), async () => {
    const response = await apiFetch('/api/marketplace/updates')
    const result = classifyUpdateCheck({ ok: response.ok, status: response.status, body: await response.json().catch(() => null) }, i18n.locale)
    if (result.kind === 'failed') throw new Error(result.reason)
    return result.updates.find(item => item.name === packageName) ?? null
  }, [packageName, i18n])
  const instanceKey = plugin?.instanceKey ?? name ?? ''
  const [matrix, refreshMatrix] = useOptionalRead<FeatureMatrix>(hasConsolePermission('feature.view') && Boolean(instanceKey),
    async () => readFeatureMatrix(await requestConsole<unknown>({ type: FEATURE_RPC.MATRIX })), [instanceKey])
  const [permissions] = useOptionalRead<PluginPermission[]>(hasConsolePermission('iam.view'),
    async () => readPluginPermissionCatalog(await gatewayRequest(IAM_RPC.ROLES_LIST, {}, i18n.t)), [i18n])

  const packageAction = usePackageAction({
    onSettled: (state, result) => {
      refreshPackages(); refreshLatest()
      if (result?.operation === 'uninstall' && state.phase === 'succeeded') return
      if (name) void fetchPluginDetail(name)
    },
  })

  useEffect(() => {
    lifecycleAbort.current?.abort()
    setActionLoading(false)
    setVerificationPlan(null)
    setVerificationResult(null)
    setVerificationInvalidated(false)
    setDiagnostic(null)
    setActionMessage(null)
    setActionError(null)
    setActionErrorDetail(null)
    // A different plugin starts from the skeleton; data from the previous route is never shown under it.
    setPlugin(null)
    setError(null)
    setDetailError(null)
    if (name) fetchPluginDetail(name)
    return () => { lifecycleAbort.current?.abort(); detailSequence.current += 1 }
  }, [name])

  useEffect(() => {
    if (verificationResult && !verificationIsCurrent(verificationResult.outcome, verificationResult.plan, plugin?.management, undefined, i18n.locale)) {
      setVerificationResult(null)
      setVerificationInvalidated(true)
    }
  }, [plugin?.management, verificationResult])

  // The Host has no generation-change push. While showing a result, read only its
  // current management evidence; never repeat the business check after HMR/outage.
  useEffect(() => {
    if (!verificationResult || !name) return
    let cancelled = false
    let timer: ReturnType<typeof setTimeout>
    const invalidate = () => { setVerificationResult(null); setVerificationInvalidated(true) }
    const check = async () => {
      try {
        const state = validateManagementState(await requestConsole({ type: 'plugin:inspect', instanceKey: verificationResult.plan.instanceKey }), verificationResult.plan.instanceKey, i18n.locale)
        if (cancelled) return
        if (!verificationIsCurrent(verificationResult.outcome, verificationResult.plan, state, undefined, i18n.locale)) { invalidate(); return }
        // The check revision includes Host incarnation, even when generation resets
        // to the same number. Planning is read-only and never invokes a check.
        const currentPlan = await requestConsole({ type: 'plugin:plan-verification', instanceKey: verificationResult.plan.instanceKey })
        if (cancelled) return
        if (!currentPlan || !verificationIsCurrent(verificationResult.outcome, verificationResult.plan, state, currentPlan, i18n.locale)) { invalidate(); return }
      } catch { if (!cancelled) { invalidate(); return } }
      if (!cancelled) timer = setTimeout(() => void check(), 5000)
    }
    timer = setTimeout(() => void check(), 5000)
    return () => { cancelled = true; clearTimeout(timer) }
  }, [name, verificationResult])

  const fetchPluginDetail = async (pluginName: string) => {
    const sequence = ++detailSequence.current
    setLoading(true)
    try {
      const res = await apiFetch(`/api/plugins/${encodeURIComponent(pluginName)}`)
      if (!res.ok) {
        const body = await res.json().catch(() => null) as { code?: string; error?: string } | null
        const failure = Object.assign(new Error(res.status === 404 ? i18n.t("未找到该插件，可能已被移除。") : res.status === 403 ? i18n.t("当前身份无权查看该插件。") : body?.error || i18n.t("插件读取失败（HTTP {0}），请稍后重试。", [res.status])),
          { status: res.status, ...(body?.code ? { details: { serverCode: body.code } } : {}) })
        throw failure
      }
      const data = await res.json()
      if (data.success) {
        validatePluginDetail(data.data, i18n.locale)
        if (data.data.management) validateManagementState(data.data.management, data.data.instanceKey, i18n.locale)
        if (sequence === detailSequence.current) {
          setPlugin(data.data)
          setError(null)
          setDetailError(null)
          if (actionUnconfirmed && !unconfirmedCheck) {
            setActionError(null)
            setActionErrorDetail(null)
            setActionMessage(i18n.t("已重新读取 Host 当前状态，请以安装与应用证据为准。"))
          }
          if (!unconfirmedCheck) setActionUnconfirmed(false)
          setVerificationPlan(null)
        }
      }
      else throw new Error(i18n.t("数据格式错误"))
    } catch (err) {
      if (sequence === detailSequence.current) { setError((err as Error).message); setDetailError(err) }
    } finally {
      if (sequence === detailSequence.current) setLoading(false)
    }
  }

  const diagnose = async () => {
    if (!plugin || !writable || actionInFlight.current || actionUnconfirmed) return
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    setActionErrorDetail(null)
    setActionMessage(null)
    setDiagnostic(null)
    try {
      setDiagnostic(await requestConsole({ type: 'plugin:diagnose', pluginName: plugin.instanceKey }))
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      actionInFlight.current = false
      setActionLoading(false)
    }
  }

  const applyPlugin = async () => {
    if (!plugin?.management || !writable || actionInFlight.current || actionUnconfirmed) return
    const previous = plugin.management
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    setVerificationPlan(null)
    const controller = new AbortController()
    lifecycleAbort.current?.abort()
    lifecycleAbort.current = controller
    try {
      const request = applyRequest(previous, i18n.locale)
      if (!await confirm({ title: i18n.t("应用插件变更？"), description: i18n.t("{0} 当前代 {1}。Host 将申请应用/重启；只有后续状态才能确认成功。", [plugin.instanceKey, previous.generation ?? i18n.t("未发布")]), confirmLabel: i18n.t("申请应用") })) return
      if (controller.signal.aborted) return
      try { await requestConsole(request) }
      catch { setActionMessage(i18n.t("应用回执未确认，正在只读核对当前代；请勿重复提交。")) }
      const result = await waitForManagementState(() => requestConsole({ type: 'plugin:inspect', instanceKey: previous.instanceKey }), previous, controller.signal, undefined, i18n.locale)
      if (controller.signal.aborted) return
      if (!result) { setActionUnconfirmed(true); setActionMessage(null); setActionError(i18n.t("应用结果未知。请恢复连接后刷新核对，不要重复申请。")); return }
      await fetchPluginDetail(previous.instanceKey)
      setActionMessage(result.disabled ? i18n.t("已核对：实例已停用") : i18n.t("已核对：第 {0} 代已应用；业务功能尚需独立验证。", [result.generation]))
    } catch (err) { if (!controller.signal.aborted) setActionError((err as Error).message) }
    finally { actionInFlight.current = false; if (!controller.signal.aborted) setActionLoading(false) }
  }

  const loadVerificationPlan = async () => {
    if (!plugin || !writable || actionInFlight.current || actionUnconfirmed) return
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    setVerificationPlan(null)
    try {
      const state = validateManagementState(await requestConsole({ type: 'plugin:inspect', instanceKey: plugin.instanceKey }), plugin.instanceKey, i18n.locale)
      if (routeIdentity.current !== name) return
      setPlugin(previous => previous ? { ...previous, management: state } : previous)
      const plan = await requestConsole({ type: 'plugin:plan-verification', instanceKey: plugin.instanceKey })
      if (routeIdentity.current === name) setVerificationPlan(captureVerificationPlan(plan, state, i18n.locale))
    } catch (err) { if (routeIdentity.current === name) setActionError((err as Error).message) }
    finally { actionInFlight.current = false; setActionLoading(false) }
  }

  const runVerification = async (checkId: string) => {
    if (!plugin?.management || !verificationPlan || !writable || actionInFlight.current || actionUnconfirmed) return
    const plan = verificationPlan
    let submitted = false
    const check = plan.checks.find(item => item.id === checkId)
    if (!check) return
    const display = verificationCheckDisplay(check, i18n.locale)
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    try {
      const accepted = await confirm({ title: i18n.t("执行「{0}」？", [display.title]), description: i18n.t("范围：{0}。副作用：{1}。批准仅绑定第 {2} 代和当前检查定义。", [check.scope === 'local' ? i18n.t("本地") : i18n.t("平台（可能产生外部操作）"), display.effects.join(i18n.locale === 'en' ? '; ' : '；') || i18n.t("插件未声明额外副作用"), plan.generation]), confirmLabel: i18n.t("批准执行一次") })
      if (!accepted || routeIdentity.current !== name) return
      setVerificationPlan(null)
      setVerificationResult(null)
      setVerificationInvalidated(false)
      submitted = true
      const result = await verifyApprovedPlugin(requestConsole, plan, checkId, plugin.management, i18n.locale)
      if (routeIdentity.current !== name) return
      setVerificationResult({ outcome: result, plan })
      if (!result.current) setActionUnconfirmed(true)
    } catch (err) {
      if (routeIdentity.current !== name) return
      if (submitted) {
        setActionUnconfirmed(true)
        setUnconfirmedCheck(display.title)
        setActionError(i18n.t("检查「{0}」的执行结果未知：{1}。刷新插件状态不能确认该检查是否执行；请核对日志及外部结果，勿重复执行。", [display.title, (err as Error).message]))
      } else setActionError((err as Error).message)
    }
    finally { actionInFlight.current = false; setActionLoading(false) }
  }

  const refreshAll = () => {
    if (name) void fetchPluginDetail(name)
    refreshPackages(); refreshLatest(); refreshMatrix()
  }

  const verificationDisplay = verificationResult ? verificationResultDisplay(verificationResult.outcome, i18n.locale) : null
  const detailView = pluginDetailView({ loading, plugin, error })
  const entry: PackageListEntry | null = packages.status === 'ready' ? installedPackage(packages.value, packageName) : null
  const installedVersion = entry?.installedVersion ?? plugin?.version ?? null
  const update = latest.status === 'ready' ? latest.value : null
  const scopeSummary = matrix.status === 'ready' ? pluginScopeSummary(matrix.value, instanceKey) : null
  const permissionGroups = permissions.status === 'ready' ? pluginPermissionGroups(permissions.value, [instanceKey, packageName.split('/').pop()?.replace(/^(adapter|plugin|service)-/u, '')]) : []
  // Installed (the gateway lists it) but no instance plugin uses it: waiting for its first configuration.
  const undeclaredPackage = !plugin && Boolean(entry) && (detailError as { status?: number } | null)?.status === 404
  const canDeclare = canManagePackages && (undeclaredPackage || plugin?.management?.declared === false)
  const declareNeed = plugin
    ? { name: plugin.packageName, instanceKey: plugin.instanceKey, missing: plugin.management?.validation?.errors.map(issue => relativeConfigPath(issue.path)) ?? [], missingEnv: plugin.management?.validation?.missingEnv ?? [] }
    : { name: packageName, instanceKey: defaultInstanceKey(packageName), missing: [], missingEnv: [] }
  const actionBusy = packageAction.busy || actionLoading || declaring
  const title = plugin?.name ?? name ?? ''

  if (detailView.view === 'skeleton' && packages.status === 'loading') {
    return (
      <PageShell>
        <StatusState kind="loading" placeholder={<div className="space-y-3">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <div className="grid gap-3 md:grid-cols-2">{[...Array(4)].map((_, i) => <Skeleton key={i} className="h-36" />)}</div>
        </div>} />
      </PageShell>
    )
  }

  // The instance cannot describe the plugin, but the gateway may still know the package: keep the
  // package section (and its uninstall / update) usable instead of a dead end.
  if ((detailView.view === 'error' || !plugin) && !entry) {
    return (
      <PageShell>
        <PageHeader title={title} actions={<Button variant="outline" size="sm" asChild><Link to={listUrl}><ArrowLeft />{i18n.t("返回插件")}</Link></Button>} />
        {detailView.view === 'skeleton' ? <Skeleton className="h-36" /> : (
          <StatusState error={detailError ?? error} kind={(detailError as { status?: number } | null)?.status === 404 ? 'not-installed' : undefined}
            title={(detailError as { status?: number } | null)?.status === 404 ? i18n.t("插件不存在") : undefined}
            description={(detailError as { status?: number } | null)?.status === 404 ? i18n.t("此 Host 上没有名为 {0} 的插件实例，也没有同名依赖。可以去插件市场安装。", [title]) : undefined}
            onRetry={name ? () => void fetchPluginDetail(name) : undefined}
            actions={<Button variant="outline" size="sm" asChild><Link to={CONSOLE_PATHS.marketplace}>{i18n.t("插件市场")}</Link></Button>} />
        )}
      </PageShell>
    )
  }

  const statusBadge = plugin?.management
    ? <Badge variant={plugin.management.status === 'enabled' ? 'success' : plugin.management.status === 'missing-config' || plugin.management.status === 'degraded' ? 'warning' : 'secondary'}>{managementLabel(plugin.management, i18n.locale)}</Badge>
    : plugin ? <Badge variant={plugin.status === 'active' ? 'success' : 'secondary'}>{plugin.status === 'active' ? i18n.t("代内已加载") : i18n.t("未加载")}</Badge>
      : <Badge variant="warning">{undeclaredPackage ? i18n.t("已安装，待配置") : i18n.t("实例未报告")}</Badge>

  return (
    <PageShell className="console-plugin-detail-page">
      <PageHeader
        title={title}
        description={plugin?.description || i18n.t("插件本身的信息：版本与依赖、声明与配置、权限和能力。在哪些范围开启，请到对象树的「功能」页签。")}
        actions={<>
          <Button variant="outline" size="sm" asChild><Link to={listUrl}><ArrowLeft />{i18n.t("返回插件")}</Link></Button>
          <Button variant="outline" size="sm" disabled={loading} aria-busy={loading || undefined} onClick={refreshAll}>
            <RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
          {plugin ? (
            <Button size="sm" asChild>
              <Link to={welcome ? welcomeConfigUrl(instanceKey) : featureGlobalHref(instanceKey)}><Settings />{i18n.t("功能配置")}</Link>
            </Button>
          ) : null}
        </>}
      />
      <div className="console-plugin-detail-identity">
        <code title={packageName}>{packageName}</code>
        {instanceKey && instanceKey !== packageName ? <code title={instanceKey}>{instanceKey}</code> : null}
        {statusBadge}
        {update ? <Badge variant="warning">{i18n.t("有更新 {0}", [update.latest])}</Badge> : null}
      </div>

      {detailView.staleError && (
        <StatusState compact error={detailError ?? detailView.staleError} description={i18n.t("刷新失败，以下是上次读取的内容。")} onRetry={() => void fetchPluginDetail(instanceKey)} />
      )}
      {undeclaredPackage ? (
        <StatusState kind="needs-configuration" title={i18n.t("已安装，待配置")}
          description={i18n.t("这个包已经安装，但还没有声明为插件实例。填写配置后网关会写入声明并重启实例，失败会恢复原配置。")}
          actions={canDeclare ? <Button size="sm" disabled={actionBusy} onClick={() => setDeclaring(true)}><Settings />{i18n.t("填写配置并启用")}</Button> : undefined} />
      ) : !plugin && detailView.view === 'error' ? (
        <StatusState compact error={detailError ?? error} description={i18n.t("实例没有报告这个插件，下面只显示网关知道的依赖信息。")} onRetry={name ? () => void fetchPluginDetail(name) : undefined} />
      ) : null}
      {welcome && plugin ? <WelcomeFlowContext instanceKey={plugin.instanceKey} kind="detail" /> : null}

      <div className="console-plugin-detail-grid">
        <ObjectSection title={i18n.t("版本与依赖")} description={i18n.t("依赖写在项目 package.json；安装、更新与卸载由管理网关作为事务执行，失败自动回滚。")}
          actions={canManagePackages ? <>
            <Button size="sm" variant="outline" disabled={actionBusy || !update || !entry}
              onClick={() => update && void packageAction.prepare('update', { name: packageName, version: update.latest, from: installedVersion })}>
              <ArrowUpCircle />{i18n.t("更新")}</Button>
            <Button size="sm" variant="outline" className="text-destructive" disabled={actionBusy || !entry}
              onClick={() => void packageAction.prepare('uninstall', { name: packageName })}>
              <Trash2 />{i18n.t("卸载")}</Button>
          </> : undefined}>
          <Card><CardContent className="space-y-3 p-4">
            <dl className="console-object-facts">
              <div><dt>{i18n.t("已安装版本")}</dt><dd className="font-mono">{installedVersion ?? i18n.t("未知")}</dd></div>
              <div><dt>{i18n.t("注册表 latest")}</dt><dd className="font-mono">{update?.latest ?? (latest.status === 'ready' ? installedVersion ?? '—' : latest.status === 'loading' ? '…' : i18n.t("未知"))}</dd></div>
              <div><dt>{i18n.t("声明范围")}</dt><dd className="font-mono">{entry?.range || '—'}</dd></div>
              <div><dt>{i18n.t("依赖类型")}</dt><dd>{entry ? entry.dependencyType : '—'}</dd></div>
              {entry?.catalog ? <div><dt>{i18n.t("目录")}</dt><dd>{sourceLabel(entry.catalog, i18n.t)}</dd></div> : null}
              {packages.status === 'ready' && packages.value.packageManager ? <div><dt>{i18n.t("包管理器")}</dt><dd>{packages.value.packageManager}</dd></div> : null}
            </dl>
            {packages.status === 'failed' ? <StatusState compact error={packages.error} description={i18n.t("网关依赖列表读取失败；版本以实例报告为准。")} onRetry={refreshPackages} /> : null}
            {packages.status === 'ready' && !entry ? <p className="text-sm text-muted-foreground">{i18n.t("项目 package.json 里没有 {0}：它可能随其他包一起安装，网关不能单独卸载它。", [packageName])}</p> : null}
            {!canManagePackages ? <p className="text-xs text-muted-foreground">{i18n.t("安装、更新与卸载需要 plugin.manage 权限。")}</p> : null}
            <PackageActionPanel action={packageAction} readOnly={!canManagePackages} onDeclared={() => name && void fetchPluginDetail(name)} />
            {packageAction.operation === 'uninstall' && packageAction.receipt.state.phase === 'succeeded' ? (
              <Button size="sm" variant="outline" asChild><Link to={listUrl}><ArrowLeft />{i18n.t("返回插件")}</Link></Button>
            ) : null}
          </CardContent></Card>
        </ObjectSection>

        <ObjectSection title={i18n.t("在哪开了")} description={i18n.t("开关与覆盖在对象树里设置；这里只汇总。")}
          actions={<Button size="sm" variant="outline" asChild><Link to={scopeSummary?.matrixHref ?? '/scope?tab=features'}><ToggleLeft />{i18n.t("功能矩阵")}</Link></Button>}>
          <Card><CardContent className="space-y-3 p-4">
            {matrix.status === 'loading' ? <Skeleton className="h-20" /> : matrix.status === 'skipped' ? (
              <StatusState compact kind="forbidden" permissions={['feature.view']} />
            ) : matrix.status === 'failed' ? (
              <StatusState compact error={matrix.error} onRetry={refreshMatrix} />
            ) : scopeSummary ? <ScopeSummary summary={scopeSummary} /> : (
              <StatusState compact kind="empty" title={i18n.t("没有开关记录")} description={i18n.t("功能矩阵里没有这个插件实例：它可能还没有声明，或不参与分层开关。")} />
            )}
          </CardContent></Card>
        </ObjectSection>

        <ObjectSection title={i18n.t("声明与配置")} description={i18n.t("插件在根配置中的声明、配置是否完整，以及当前运行代是否已应用。")}
          actions={<>
            {canDeclare ? <Button size="sm" disabled={actionBusy} onClick={() => setDeclaring(true)}><Settings />{i18n.t("填写配置并启用")}</Button> : null}
            {!plugin?.readOnly ? logPanel.available
              ? <Button size="sm" variant="outline" onClick={() => logPanel.open({ q: title })}><Activity />{i18n.t("相关日志")}</Button>
              : <Button size="sm" variant="outline" asChild><Link to={`/logs?q=${encodeURIComponent(title)}`}><Activity />{i18n.t("相关日志")}</Link></Button> : null}
          </>}>
          <Card><CardContent className="space-y-3 p-4">
            {plugin ? <PluginManagementSummary state={plugin.management} error={plugin.managementError} readOnly={!writable} showNavigation={false} />
              : undeclaredPackage ? <p className="text-sm text-muted-foreground">{i18n.t("还没有声明：根配置里没有使用这个包的插件实例。")}</p>
                : <StatusState compact error={detailError ?? error} onRetry={name ? () => void fetchPluginDetail(name) : undefined} />}
            {unconfirmedCheck && <Alert variant="destructive"><AlertDescription>
              {i18n.t("检查「")}{unconfirmedCheck}{i18n.t("」的结果仍未知。当前插件状态不代表之前的外部操作未发生。")}<Button variant="outline" size="sm" className="mt-2" onClick={async () => {
                if (!await confirm({ title: i18n.t("已核对未知检查的结果？"), description: i18n.t("请先确认日志和外部结果。继续只解除操作锁定，不会重试检查；如需再次执行，仍须读取新计划并单独批准。"), confirmLabel: i18n.t("已核对，解除锁定") })) return
                setUnconfirmedCheck(null)
                setActionUnconfirmed(false)
                setActionError(null)
                setActionErrorDetail(null)
                setVerificationPlan(null)
              }}>{i18n.t("已核对外部结果")}</Button>
            </AlertDescription></Alert>}
            {writable && (
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void applyPlugin()} disabled={actionBusy || actionUnconfirmed || !canApplyPlugin(plugin?.management)}>{i18n.t("应用变更")}</Button>
                <Button variant="outline" size="sm" onClick={() => void loadVerificationPlan()} disabled={actionBusy || actionUnconfirmed || !canVerifyPlugin(plugin?.management)}>{i18n.t("查看业务检查")}</Button>
                <Button variant="outline" size="sm" onClick={() => void diagnose()} disabled={actionBusy || actionUnconfirmed}><Stethoscope />{i18n.t("诊断")}</Button>
              </div>
            )}
            {actionMessage && <Alert><AlertDescription>{actionMessage}</AlertDescription></Alert>}
            {actionError && (
              <Alert variant="destructive">
                <AlertDescription>{actionError}{actionErrorDetail && <details className="mt-2 text-xs"><summary className="cursor-pointer">{i18n.t("错误详情")}</summary><p className="mt-2 break-all">{actionErrorDetail}</p></details>}{actionUnconfirmed && plugin && <Button variant="outline" size="sm" disabled={loading} aria-busy={loading} onClick={() => void fetchPluginDetail(plugin.instanceKey)}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新核对状态")}</Button>}</AlertDescription>
              </Alert>
            )}
            {verificationPlan && <section aria-label={i18n.t("业务验证计划")} className="space-y-3 rounded-md border p-3"><p className="font-medium">{i18n.t("第 ")}{verificationPlan.generation} {i18n.t(" 代业务检查 · 尚未执行")}</p>{verificationPlan.checks.length === 0 ? <p>{i18n.t("插件未提供可执行检查。")}</p> : verificationPlan.checks.map(check => { const display = verificationCheckDisplay(check, i18n.locale); return <div key={check.id} className="space-y-2"><p>{display.title} <Badge variant="secondary">{check.scope === 'local' ? i18n.t("本地") : i18n.t("平台")}</Badge></p><ul className="list-disc pl-5 text-xs text-muted-foreground">{display.effects.map((effect,index) => <li key={index}>{effect}</li>)}</ul><Button size="sm" disabled={actionLoading || actionUnconfirmed} onClick={() => void runVerification(check.id)}>{i18n.t("审阅并批准一次")}</Button></div> })}</section>}
            {verificationInvalidated && <p role="status" className="text-sm text-warning">{i18n.t("当前代、配置或连接证据已变化，旧检查结果已失效。请重新查看业务检查并验证。")}</p>}
            {verificationResult && verificationIsCurrent(verificationResult.outcome, verificationResult.plan, plugin?.management, undefined, i18n.locale) && <section aria-label={i18n.t("业务验证结果")} className="space-y-2"><p className="font-medium">{verificationSummary(verificationResult.outcome, i18n.locale)}</p><p className="text-sm">{verificationDisplay?.summary}</p><ul className="list-disc pl-5 text-xs">{verificationDisplay?.evidence.map((evidence,index) => <li key={index}>{evidence}</li>)}</ul></section>}
            {diagnostic != null && <PluginDiagnostic value={diagnostic} />}
          </CardContent></Card>
          {declaring ? (
            <DeclarePluginDialog need={declareNeed}
              onClose={() => setDeclaring(false)} onDeclared={need => { setDeclaring(false); void fetchPluginDetail(need.instanceKey); refreshMatrix() }} />
          ) : null}
        </ObjectSection>

        <ObjectSection title={i18n.t("权限")} description={i18n.t("插件为自己的页面和 RPC 声明的权限。角色按级别授予：查看 / 操作 / 管理。")}
          actions={hasConsolePermission('iam.view') ? <Button size="sm" variant="outline" asChild><Link to={CONSOLE_PATHS.accessRoles}><Shield />{i18n.t("角色")}</Link></Button> : undefined}>
          <Card><CardContent className="space-y-3 p-4">
            {permissions.status === 'skipped' ? <StatusState compact kind="forbidden" permissions={['iam.view']} description={i18n.t("插件权限目录随角色列表一起提供，需要访问控制的查看权限。")} />
              : permissions.status === 'loading' ? <Skeleton className="h-16" />
                : permissions.status === 'failed' ? <StatusState compact error={permissions.error} />
                  : permissionGroups.every(group => !group.permissions.length) ? <StatusState compact kind="empty" title={i18n.t("没有声明权限")} description={i18n.t("这个插件没有自己的页面或 RPC 权限；它的命令权限见「命令权限说明」。")} />
                    : (
                      <ul className="space-y-3">
                        {permissionGroups.filter(group => group.permissions.length).map(group => (
                          <li key={group.level} className="space-y-1">
                            <p className="text-sm font-medium">{i18n.t(LEVEL_LABELS[group.level])} <span className="text-xs font-normal text-muted-foreground">{i18n.t("由 {0} 统一授予", [group.catalogPermission])}</span></p>
                            <ul className="flex flex-wrap gap-1">
                              {group.permissions.map(item => (
                                <li key={item.permission}><Badge variant="outline" size="sm" className="font-mono" title={item.description}>{item.permission}</Badge></li>
                              ))}
                            </ul>
                          </li>
                        ))}
                      </ul>
                    )}
            <Link className="text-sm underline" to={`${CONSOLE_PATHS.permissions}?q=${encodeURIComponent(instanceKey)}`}>{i18n.t("命令权限说明")}</Link>
          </CardContent></Card>
        </ObjectSection>
      </div>

      <ObjectSection title={i18n.t("能力清单")} description={i18n.t("这个插件在当前运行代注册的命令、中间件、组件与工具。原始视图在「运行时能力」。")}
        actions={<Button size="sm" variant="outline" asChild><Link to={`${CONSOLE_PATHS.introspection}?filter=${encodeURIComponent(instanceKey)}`}><Blocks />{i18n.t("运行时能力")}</Link></Button>}>
        {!plugin ? <StatusState compact error={detailError ?? error} description={i18n.t("能力清单由实例报告；实例恢复后再查看。")} />
          : plugin.features.length === 0 ? <StatusState compact kind="empty" title={i18n.t("暂无已加载能力")} description={i18n.t("插件在当前运行代没有注册命令、中间件或工具；它可能只提供配置或后台任务。")} />
            : (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
                {plugin.features.map(feature => {
                  const Icon = getIcon(feature.icon)
                  const tab = INTROSPECTION_TABS[feature.name]
                  return (
                    <Card key={feature.name} className="min-w-0">
                      <CardContent className="space-y-2 p-4">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                          <h3 className="text-sm font-semibold">{feature.desc}</h3>
                          <Badge variant="secondary" size="sm">{feature.count}</Badge>
                          {tab ? <Link className="ml-auto text-xs underline" to={`${CONSOLE_PATHS.introspection}?tab=${tab}&filter=${encodeURIComponent(instanceKey)}`}>{i18n.t("原始视图")}</Link> : null}
                        </div>
                        {feature.items.length ? (
                          <ul className="max-h-48 space-y-1 overflow-y-auto pr-1">
                            {feature.items.map((item, index) => (
                              <li key={index} className="rounded-md bg-muted/50 px-2 py-1.5">
                                <code className="break-all text-xs font-semibold">{item.name}</code>
                                {item.desc ? <p className="text-xs text-muted-foreground">{item.desc}</p> : null}
                              </li>
                            ))}
                          </ul>
                        ) : null}
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
      </ObjectSection>
      {ConfirmDialogHost}
    </PageShell>
  )
}

/** 「在哪开了」: the global switch, adapters and conversation override counts, each linking to its object page. */
function ScopeSummary({ summary }: { summary: PluginScopeSummary }) {
  const i18n = useI18n()
  return (
    <div className="space-y-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-muted-foreground">{i18n.t("全局")}</span>
        <Badge variant={summary.global.enabled ? 'success' : 'secondary'}>{summary.global.enabled ? i18n.t("开启") : i18n.t("已停用")}</Badge>
        <Link className="text-xs underline" to={summary.global.href}>{i18n.t("全局配置")}</Link>
      </div>
      {summary.adapters.length ? (
        <div className="space-y-1">
          <p className="text-muted-foreground">{i18n.t("适配器")}</p>
          <ul className="flex flex-wrap gap-2">
            {summary.adapters.map(adapter => (
              <li key={adapter.alias}>
                <Link to={adapter.href} className="console-plugin-scope-chip" title={i18n.t("打开 {0} 的功能页签", [adapter.alias])}>
                  <code>{adapter.alias}</code>
                  <span className={adapter.enabled ? 'text-success' : 'text-muted-foreground'}>
                    {adapter.lockedBy ? i18n.t("已锁定") : adapter.enabled === null ? '—' : adapter.enabled ? i18n.t("开") : i18n.t("关")}
                  </span>
                  {adapter.overridden ? <Badge variant="outline" size="sm">{i18n.t("有覆盖")}</Badge> : null}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="space-y-1">
        <p className="text-muted-foreground">{i18n.t("会话覆盖")}</p>
        {summary.conversations.length ? (
          <ul className="flex flex-wrap gap-2">
            {summary.conversations.map(item => (
              <li key={`${item.alias}/${item.endpoint}`}>
                <Link to={item.href} className="console-plugin-scope-chip"><code>{item.alias} / {item.endpoint}</code><Badge variant="secondary" size="sm">{i18n.t("{0} 个会话", [item.count])}</Badge></Link>
              </li>
            ))}
          </ul>
        ) : <p className="text-xs text-muted-foreground">{i18n.t("没有会话单独覆盖这个插件。")}</p>}
      </div>
      <p className="text-xs text-muted-foreground">{i18n.t("账号层的开关在各账号的「功能」页签查看。")}</p>
    </div>
  )
}

function PluginDiagnostic({ value }: { value: unknown }) {
  const i18n = useI18n()
  const { status, errors, missingEnv, warnings } = pluginDiagnosticSummary(value)
  const title = status === 'valid' ? i18n.t("配置检查通过") : status === 'missing-env' ? i18n.t("需要补充环境变量") : status === 'invalid' ? i18n.t("配置检查未通过") : i18n.t("未提供配置检查结果")
  return <section aria-label={i18n.t("插件诊断结果")} className="space-y-3 rounded-md bg-muted/40 p-3 text-sm">
    <Badge variant={status === 'valid' ? 'success' : status === 'unknown' ? 'secondary' : 'warning'}>{title}</Badge>
    {errors.length > 0 && <div><p className="mb-1 font-medium">{i18n.t("配置错误")}</p><ul className="list-disc space-y-1 pl-5">{errors.map((error, index) => <li key={index} className="break-words">{error}</li>)}</ul></div>}
    {missingEnv.length > 0 && <div><p className="mb-1 font-medium">{i18n.t("缺少环境变量")}</p><div className="flex flex-wrap gap-1">{missingEnv.map(name => <code key={name} className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{name}</code>)}</div></div>}
    {warnings.length > 0 && <div><p className="mb-1 font-medium">{i18n.t("提示")}</p><ul className="list-disc space-y-1 pl-5">{warnings.map((warning, index) => <li key={index} className="break-words">{warning}</li>)}</ul></div>}
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t("原始诊断数据")}</summary><div className="mt-2"><JsonViewer value={value} /></div></details>
  </section>
}
