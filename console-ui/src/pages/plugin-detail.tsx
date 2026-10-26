import { useI18n } from '../i18n'
import { useEffect, useRef, useState } from 'react'
import { useParams, useNavigate, useSearchParams } from 'react-router-dom'
import { Activity, ArrowLeft, AlertCircle, Package, Settings, Terminal, Box as IconBox, Layers, Clock, Database, Brain, Wrench, Shield, Plug, Server, Power, RefreshCw, Stethoscope, Trash2, type LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../utils/auth'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'
import { requestConsole } from '../utils/console-rpc'
import { useConfirm } from '../components/confirm-dialog'
import { validatePluginDetail, requirePluginUpdate, pluginDiagnosticSummary } from './plugin-detail-model.mjs'
import { JsonViewer } from './introspection/JsonViewer'
import { PluginManagementSummary } from './PluginManagementSummary'
import { isDemoMode } from '../utils/demo-mode'
import { WelcomeFlowContext } from './WelcomeFlowContext'
import { welcomeConfigUrl } from './welcome-use-case-model.mjs'
import { validateManagementState, managementLabel, canApplyPlugin, canVerifyPlugin, captureVerificationPlan, verifyApprovedPlugin, verificationSummary, mutationRequest, applyRequest, waitForManagementState, waitForEnabledManagementState, verificationIsCurrent, type PluginManagementState, type VerificationPlan, type VerificationResult, type MutationPlan } from './plugin-management-model.mjs'


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

function getIcon(iconName: string): LucideIcon {
  return iconMap[iconName] || Package
}

export default function PluginDetailPage() {
  const i18n = useI18n()
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q')
  const listUrl = query ? `/plugins?q=${encodeURIComponent(query)}` : '/plugins'
  const routeIdentity = useRef(name)
  routeIdentity.current = name
  const lifecycleAbort = useRef<AbortController | null>(null)
  const detailSequence = useRef(0)
  const actionInFlight = useRef(false)
  const [plugin, setPlugin] = useState<PluginDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
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
  const writable = !!plugin?.manageable && !plugin?.readOnly && !isDemoMode()
  const { confirm, ConfirmDialog: ConfirmDialogHost } = useConfirm()

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
      if (!res.ok) throw new Error(res.status === 404 ? i18n.t("未找到该插件，可能已被移除。") : res.status === 403 ? i18n.t("当前身份无权查看该插件。") : i18n.t("插件读取失败（HTTP {0}），请稍后重试。", [res.status]))
      const data = await res.json()
      if (data.success) {
        validatePluginDetail(data.data, i18n.locale)
        if (data.data.management) validateManagementState(data.data.management, data.data.instanceKey, i18n.locale)
        if (sequence === detailSequence.current) {
          setPlugin(data.data)
          setError(null)
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
      if (sequence === detailSequence.current) setError((err as Error).message)
    } finally {
      if (sequence === detailSequence.current) setLoading(false)
    }
  }

  const setEnabled = async (enabled: boolean) => {
    if (!plugin?.management || !writable || actionInFlight.current || actionUnconfirmed) return
    const previous = plugin.management
    const instanceKey = plugin.instanceKey
    const controller = new AbortController()
    lifecycleAbort.current?.abort()
    lifecycleAbort.current = controller
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    setActionErrorDetail(null)
    setActionMessage(i18n.t("正在提交操作并等待 Host 恢复，核对插件运行状态…"))
    try {
      try {
        await requestConsole({ type: 'plugin:set-enabled', instanceKey, enabled })
      } catch {
        if (!controller.signal.aborted) setActionMessage(i18n.t("操作回执未确认，正在读取 Host 核对结果；请勿重复操作。"))
      }
      const result = await waitForEnabledManagementState(
        () => requestConsole({ type: 'plugin:inspect', instanceKey }),
        previous, enabled, controller.signal, undefined, i18n.locale)
      if (controller.signal.aborted) return
      if (result) {
        detailSequence.current += 1
        await fetchPluginDetail(instanceKey)
        if (controller.signal.aborted) return
        setActionMessage(enabled ? i18n.t("已核对：实例代内已加载；平台上线与业务功能尚未验证") : i18n.t("已核对：插件已停用"))
      } else {
        setActionMessage(null)
        setActionUnconfirmed(true)
        setActionError(i18n.t("等待 Host 恢复或状态变化超时，操作结果尚未确认。当前显示最后一次读取的状态，请刷新核对后再操作。"))
      }
    } finally {
      actionInFlight.current = false
      if (!controller.signal.aborted) setActionLoading(false)
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

  const updatePlugin = async () => {
    let submitted = false
    if (!plugin || !writable || actionInFlight.current || actionUnconfirmed) return
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    setActionErrorDetail(null)
    setActionMessage(null)
    try {
      const response = await apiFetch('/api/marketplace/updates')
      if (!response.ok) throw new Error(i18n.t("检查更新失败（HTTP {0}），请稍后重试。", [response.status]))
      const update = requirePluginUpdate(await response.json(), plugin.packageName, i18n.locale)
      if (update.latest === plugin.version) {
        setActionMessage(i18n.t("当前已是最新版本"))
        return
      }
      const plan = await requestConsole<MutationPlan & { currentVersion: string | null; targetVersion: string }>({
        type: 'plugin:plan-update',
        packageName: plugin.instanceKey,
        targetVersion: update.latest,
      })
      const accepted = await confirm({
        title: i18n.t("更新 {0}？", [plugin.name]),
        description: i18n.t("{0} → {1}，更新后需要重启 Host。", [plan.currentVersion || i18n.t("未知版本"), plan.targetVersion]),
        confirmLabel: i18n.t("更新"),
      })
      if (!accepted || routeIdentity.current !== name) return
      submitted = true
      await requestConsole(mutationRequest('plugin:update', plan, { targetVersion: plan.targetVersion }, i18n.locale))
      if (routeIdentity.current !== name) return
      await fetchPluginDetail(plugin.instanceKey)
      setActionMessage(i18n.t("已核验磁盘版本 {0}。请完善配置后应用，再核对当前代与业务检查。", [plan.targetVersion]))
    } catch (err) {
      if (routeIdentity.current !== name) return
      if (submitted) setActionUnconfirmed(true)
      setActionError(`${(err as Error).message}${submitted ? i18n.t("。更新结果未确认，请刷新核对，勿重复提交。") : ''}`)
    } finally {
      actionInFlight.current = false
      setActionLoading(false)
    }
  }

  const uninstallPlugin = async () => {
    if (!plugin || !writable || actionInFlight.current || actionUnconfirmed) return
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    setActionErrorDetail(null)
    setActionMessage(null)
    try {
      const plan = await requestConsole<MutationPlan & { installed: boolean; declared: boolean; hasConfig: boolean }>({ type: 'plugin:plan-uninstall', packageName: plugin.instanceKey })
      const accepted = await confirm({
        title: i18n.t("卸载 {0}？", [plugin.name]),
        description: i18n.t("将卸载实例 {0}{1}，其他实例保持不变。Host 会按其他实例占用决定是否移除依赖。需要应用后核对。", [plan.instanceKey, plan.hasConfig ? i18n.t("及其配置") : '']),
        confirmLabel: i18n.t("卸载"),
        variant: 'destructive',
      })
      if (!accepted || routeIdentity.current !== name) return
      await requestConsole(mutationRequest('plugin:uninstall', plan, { confirmation: plan.instanceKey }, i18n.locale))
      if (routeIdentity.current === name) navigate(listUrl)
    } catch (err) {
      if (routeIdentity.current !== name) return
      setActionUnconfirmed(true)
      setActionError(i18n.t("卸载结果未确认，请刷新核对；不要重复提交。"))
      setActionErrorDetail((err as Error).message)
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
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    try {
      const accepted = await confirm({ title: i18n.t("执行「{0}」？", [check.title]), description: i18n.t("范围：{0}。副作用：{1}。批准仅绑定第 {2} 代和当前检查定义。", [check.scope === 'local' ? i18n.t("本地") : i18n.t("平台（可能产生外部操作）"), check.effects.join('；') || i18n.t("插件未声明额外副作用"), plan.generation]), confirmLabel: i18n.t("批准执行一次") })
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
        setUnconfirmedCheck(check.title)
        setActionError(i18n.t("检查「{0}」的执行结果未知：{1}。刷新插件状态不能确认该检查是否执行；请核对日志及外部结果，勿重复执行。", [check.title, (err as Error).message]))
      } else setActionError((err as Error).message)
    }
    finally { actionInFlight.current = false; setActionLoading(false) }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-24" />
        <div className="flex items-center gap-3"><Skeleton className="h-12 w-12 rounded-xl" /><div><Skeleton className="h-6 w-48" /><Skeleton className="h-4 w-64 mt-1" /></div></div>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-20" />)}</div>
      </div>
    )
  }

  if (error || !plugin) {
    return (
      <div>
        <Button variant="ghost" onClick={() => navigate(listUrl)} className="mb-4">
          <ArrowLeft className="w-4 h-4 mr-1" /> {i18n.t(" 返回")}</Button>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{i18n.t("加载失败: ")}{error || i18n.t("插件不存在")}</AlertDescription>
        </Alert>
        {name && <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchPluginDetail(name)}>{i18n.t("重试")}</Button>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Button variant="ghost" size="sm" onClick={() => navigate(listUrl)}>
        <ArrowLeft className="w-4 h-4 mr-1" /> {i18n.t(" 返回")}</Button>

      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-secondary shrink-0">
          <Package className="w-6 h-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h1 className="text-xl font-bold truncate">{plugin.name}</h1>
            <Badge variant={plugin.management?.status === 'enabled' ? 'success' : plugin.management?.status === 'missing-config' || plugin.management?.status === 'degraded' ? 'warning' : 'secondary'} className="shrink-0">
              {plugin.management ? managementLabel(plugin.management, i18n.locale) : plugin.status === 'active' ? i18n.t("代内已加载") : i18n.t("未加载")}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground break-words">{plugin.description || i18n.t("暂无描述")}</p>
        </div>
      </div>

      <Card className="border-border/80">
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">{i18n.t("插件配置")}</p>
            <p className="text-xs text-muted-foreground">
              {plugin.readOnly ? i18n.t("当前连接仅允许查看插件信息。") : i18n.t("在配置页编辑插件设置。")}
            </p>
          </div>
          {!plugin.readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/logs?q=${encodeURIComponent(plugin.name)}`}><Activity />{i18n.t("相关日志")}</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to={searchParams.get('useCase') === 'group-welcome' ? welcomeConfigUrl(plugin.instanceKey) : `/config?plugin=${encodeURIComponent(plugin.instanceKey)}`}>
                  <Settings className="w-4 h-4 mr-1" />{i18n.t("编辑配置")}</Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

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
      <Card><CardHeader><CardTitle className="text-base">{i18n.t("安装与应用状态")}</CardTitle></CardHeader><CardContent><PluginManagementSummary state={plugin.management} error={plugin.managementError} readOnly={!writable} /><Button variant="outline" size="sm" className="mt-3" disabled={actionLoading} onClick={() => void fetchPluginDetail(plugin.instanceKey)}>{i18n.t("刷新状态证据")}</Button></CardContent></Card>
      {searchParams.get('useCase') === 'group-welcome' && <WelcomeFlowContext instanceKey={plugin.instanceKey} kind="detail" />}
      {writable && (
      <Card className="border-border/80">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">{i18n.t("插件操作")}</p>
                <p className="text-xs text-muted-foreground">{i18n.t("诊断、启停、更新或卸载此插件。")}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void applyPlugin()} disabled={actionLoading || actionUnconfirmed || !canApplyPlugin(plugin.management)}>{i18n.t("应用变更")}</Button>
                <Button variant="outline" size="sm" onClick={() => void loadVerificationPlan()} disabled={actionLoading || actionUnconfirmed || !canVerifyPlugin(plugin.management)}>{i18n.t("查看业务检查")}</Button>
                <Button variant="outline" size="sm" onClick={() => void diagnose()} disabled={actionLoading || actionUnconfirmed}>
                  <Stethoscope className="w-4 h-4 mr-1" />{i18n.t("诊断")}</Button>
                <Button variant="outline" size="sm" onClick={() => void updatePlugin()} disabled={actionLoading || actionUnconfirmed}>
                  <RefreshCw className={`w-4 h-4 mr-1 ${actionLoading ? 'animate-spin' : ''}`} />{i18n.t("更新")}</Button>
                <Button variant="outline" size="sm" onClick={() => void setEnabled(plugin.management?.disabled ?? (plugin.status !== 'active'))} disabled={actionLoading || actionUnconfirmed || !plugin.management}>
                  <Power className="w-4 h-4 mr-1" />{plugin.management ? plugin.management.disabled ? i18n.t("启用") : i18n.t("停用") : plugin.status === 'active' ? i18n.t("停用") : i18n.t("启用")}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void uninstallPlugin()} disabled={actionLoading || actionUnconfirmed}>
                  <Trash2 className="w-4 h-4 mr-1" />{i18n.t("卸载")}</Button>
              </div>
            </div>
            {actionMessage && <Alert><AlertDescription>{actionMessage}</AlertDescription></Alert>}
            {actionError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{actionError}{actionErrorDetail && <details className="mt-2 text-xs"><summary className="cursor-pointer">{i18n.t("错误详情")}</summary><p className="mt-2 break-all">{actionErrorDetail}</p></details>}{actionUnconfirmed && <Button variant="outline" size="sm" onClick={() => void fetchPluginDetail(plugin.instanceKey)}>{i18n.t("刷新核对状态")}</Button>}</AlertDescription>
              </Alert>
            )}
            {verificationPlan && <section aria-label={i18n.t("业务验证计划")} className="space-y-3 rounded-md border p-3"><p className="font-medium">{i18n.t("第 ")}{verificationPlan.generation} {i18n.t(" 代业务检查 · 尚未执行")}</p>{verificationPlan.checks.length === 0 ? <p>{i18n.t("插件未提供可执行检查。")}</p> : verificationPlan.checks.map(check => <div key={check.id} className="space-y-2"><p>{check.title} <Badge variant="secondary">{check.scope === 'local' ? i18n.t("本地") : i18n.t("平台")}</Badge></p><ul className="list-disc pl-5 text-xs text-muted-foreground">{check.effects.map((effect,index) => <li key={index}>{effect}</li>)}</ul><Button size="sm" disabled={actionLoading || actionUnconfirmed} onClick={() => void runVerification(check.id)}>{i18n.t("审阅并批准一次")}</Button></div>)}</section>}
            {verificationInvalidated && <p role="status" className="text-sm text-amber-700 dark:text-amber-300">{i18n.t("当前代、配置或连接证据已变化，旧检查结果已失效。请重新查看业务检查并验证。")}</p>}
            {verificationResult && verificationIsCurrent(verificationResult.outcome, verificationResult.plan, plugin.management, undefined, i18n.locale) && <section aria-label={i18n.t("业务验证结果")} className="space-y-2"><p className="font-medium">{verificationSummary(verificationResult.outcome, i18n.locale)}</p><p className="text-sm">{verificationResult.outcome.summary}</p><ul className="list-disc pl-5 text-xs">{verificationResult.outcome.evidence.map((evidence,index) => <li key={index}>{evidence}</li>)}</ul></section>}
            {diagnostic != null && <PluginDiagnostic value={diagnostic} />}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">{plugin.features.length ? i18n.t("已加载能力") : i18n.t("暂无已加载能力")}</p>
      <Separator />

      {/* Stats grid - 动态渲染 features 摘要 */}
      {plugin.features.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-6 gap-2">
          {plugin.features.map((feature) => {
            const Icon = getIcon(feature.icon)
            return (
              <Card key={feature.name}>
                <CardContent className="flex flex-col items-center gap-1 p-3">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <span className="text-2xl font-bold">{feature.count}</span>
                  <span className="text-xs text-muted-foreground">{feature.desc}</span>
                </CardContent>
              </Card>
            )
          })}

        </div>
      )}

      {/* Detail sections - 动态渲染每个 Feature 的 items */}
      <div className="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3">
        {plugin.features.map((feature) => {
          if (feature.items.length === 0) return null
          const Icon = getIcon(feature.icon)

          return (
            <Card key={feature.name}>
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-muted-foreground" />
                  <CardTitle className="text-base">{feature.desc}</CardTitle>
                  <Badge variant="secondary">{feature.count}</Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="max-h-60 overflow-y-auto pr-1 space-y-2">
                  {feature.items.map((item, index) => (
                    <FeatureItemCard key={index} featureName={feature.name} item={item} />
                  ))}
                </div>
              </CardContent>
            </Card>
          )
        })}


      </div>
      {ConfirmDialogHost}
    </div>
  )
}

/** The current Host exposes capability names and optional string descriptions. */
function FeatureItemCard({ item }: { featureName: string; item: { name: string; desc?: string } }) {
  return <div className="rounded-md bg-muted/50 p-3 space-y-1"><code className="break-all text-sm font-semibold">{item.name}</code>{item.desc && <p className="text-xs text-muted-foreground">{item.desc}</p>}</div>
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
