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
import { waitForPluginStatus } from './plugin-lifecycle-model.mjs'


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
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const query = searchParams.get('q')
  const listUrl = query ? `/plugins?q=${encodeURIComponent(query)}` : '/plugins'
  const lifecycleAbort = useRef<AbortController | null>(null)
  const detailSequence = useRef(0)
  const actionInFlight = useRef(false)
  const [plugin, setPlugin] = useState<PluginDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionUnconfirmed, setActionUnconfirmed] = useState(false)
  const [actionLoading, setActionLoading] = useState(false)
  const [actionMessage, setActionMessage] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [actionErrorDetail, setActionErrorDetail] = useState<string | null>(null)
  const [diagnostic, setDiagnostic] = useState<unknown>(null)
  const { confirm, ConfirmDialog: ConfirmDialogHost } = useConfirm()

  useEffect(() => {
    lifecycleAbort.current?.abort()
    setActionLoading(false)
    setActionMessage(null)
    setActionError(null)
    setActionErrorDetail(null)
    if (name) fetchPluginDetail(name)
    return () => { lifecycleAbort.current?.abort(); detailSequence.current += 1 }
  }, [name])

  const fetchPluginDetail = async (pluginName: string) => {
    const sequence = ++detailSequence.current
    setLoading(true)
    try {
      const res = await apiFetch(`/api/plugins/${encodeURIComponent(pluginName)}`)
      if (!res.ok) throw new Error(res.status === 404 ? '未找到该插件，可能已被移除。' : res.status === 403 ? '当前身份无权查看该插件。' : `插件读取失败（HTTP ${res.status}），请稍后重试。`)
      const data = await res.json()
      if (data.success) { validatePluginDetail(data.data); if (sequence === detailSequence.current) { setPlugin(data.data); setError(null); setActionUnconfirmed(false) } }
      else throw new Error('数据格式错误')
    } catch (err) {
      if (sequence === detailSequence.current) setError((err as Error).message)
    } finally {
      if (sequence === detailSequence.current) setLoading(false)
    }
  }

  const configRevision = async () => {
    const source = await requestConsole<{ revision?: string }>({ type: 'config:get-source' })
    return source.revision
  }

  const setEnabled = async (enabled: boolean) => {
    if (!plugin || actionInFlight.current || actionUnconfirmed) return
    const instanceKey = plugin.instanceKey
    const controller = new AbortController()
    lifecycleAbort.current?.abort()
    lifecycleAbort.current = controller
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    setActionErrorDetail(null)
    setActionMessage('正在提交操作并等待 Host 恢复，核对插件运行状态…')
    try {
      try {
        await requestConsole({ type: 'plugin:set-enabled', instanceKey, enabled })
      } catch {
        if (!controller.signal.aborted) setActionMessage('操作回执未确认，正在读取 Host 核对结果；请勿重复操作。')
      }
      const result = await waitForPluginStatus(async () => {
        const response = await apiFetch(`/api/plugins/${encodeURIComponent(instanceKey)}`, { signal: AbortSignal.any([controller.signal, AbortSignal.timeout(5000)]) })
        if (!response.ok) throw new Error('Host not ready')
        const body = await response.json()
        if (!body.success) throw new Error('Host not ready')
        validatePluginDetail(body.data)
        if (body.data.instanceKey !== instanceKey) throw new Error('Plugin identity mismatch')
        return body.data as PluginDetail
      }, enabled ? 'active' : 'inactive', controller.signal)
      if (controller.signal.aborted) return
      if (result) {
        detailSequence.current += 1
        setPlugin(result)
        setActionMessage(enabled ? '已核对：插件已启用并运行' : '已核对：插件已停用')
      } else {
        setActionMessage(null)
        setActionUnconfirmed(true)
        setActionError('等待 Host 恢复或状态变化超时，操作结果尚未确认。当前显示最后一次读取的状态，请刷新核对后再操作。')
      }
    } finally {
      actionInFlight.current = false
      if (!controller.signal.aborted) setActionLoading(false)
    }
  }

  const diagnose = async () => {
    if (!plugin || actionInFlight.current || actionUnconfirmed) return
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
    if (!plugin || actionInFlight.current || actionUnconfirmed) return
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    setActionErrorDetail(null)
    setActionMessage(null)
    try {
      const response = await apiFetch('/api/marketplace/updates')
      if (!response.ok) throw new Error(`检查更新失败（HTTP ${response.status}），请稍后重试。`)
      const update = requirePluginUpdate(await response.json(), plugin.packageName)
      if (update.latest === plugin.version) {
        setActionMessage('当前已是最新版本')
        return
      }
      const plan = await requestConsole<{ currentVersion: string | null; targetVersion: string }>({
        type: 'plugin:plan-update',
        packageName: plugin.packageName,
        targetVersion: update.latest,
      })
      const accepted = await confirm({
        title: `更新 ${plugin.name}？`,
        description: `${plan.currentVersion || '未知版本'} → ${plan.targetVersion}，更新后需要重启 Host。`,
        confirmLabel: '更新',
      })
      if (!accepted) return
      const revision = await configRevision()
      await requestConsole({
        type: 'plugin:update',
        packageName: plugin.packageName,
        targetVersion: plan.targetVersion,
        ...(revision ? { expectedRevision: revision } : {}),
      })
      setActionMessage(`已更新到 ${plan.targetVersion}，重启 Host 后生效`)
    } catch (err) {
      setActionError((err as Error).message)
    } finally {
      actionInFlight.current = false
      setActionLoading(false)
    }
  }

  const uninstallPlugin = async () => {
    if (!plugin || actionInFlight.current || actionUnconfirmed) return
    actionInFlight.current = true
    setActionLoading(true)
    setActionError(null)
    setActionErrorDetail(null)
    setActionMessage(null)
    try {
      const plan = await requestConsole<{
        installed: boolean; declared: boolean; hasConfig: boolean
      }>({ type: 'plugin:plan-uninstall', packageName: plugin.packageName })
      const accepted = await confirm({
        title: `卸载 ${plugin.name}？`,
        description: `将移除${plan.installed ? '依赖、' : ''}${plan.declared ? '插件挂载、' : ''}${plan.hasConfig ? '配置' : ''}，该操作需要重启 Host。`,
        confirmLabel: '卸载',
        variant: 'destructive',
      })
      if (!accepted) return
      const revision = await configRevision()
      await requestConsole({
        type: 'plugin:uninstall',
        packageName: plugin.packageName,
        confirmation: plugin.packageName,
        ...(revision ? { expectedRevision: revision } : {}),
      })
      navigate(listUrl)
    } catch (err) {
      setActionError('卸载失败，请查看错误详情后重试。')
      setActionErrorDetail((err as Error).message)
    } finally {
      actionInFlight.current = false
      setActionLoading(false)
    }
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
          <ArrowLeft className="w-4 h-4 mr-1" /> 返回
        </Button>
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>加载失败: {error || '插件不存在'}</AlertDescription>
        </Alert>
        {name && <Button variant="outline" size="sm" className="mt-3" onClick={() => void fetchPluginDetail(name)}>重试</Button>}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <Button variant="ghost" size="sm" onClick={() => navigate(listUrl)}>
        <ArrowLeft className="w-4 h-4 mr-1" /> 返回
      </Button>

      <div className="flex items-center gap-3 min-w-0">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-secondary shrink-0">
          <Package className="w-6 h-6" />
        </div>
        <div className="min-w-0">
          <div className="flex items-center gap-2 min-w-0 flex-wrap">
            <h1 className="text-xl font-bold truncate">{plugin.name}</h1>
            <Badge variant={plugin.status === 'active' ? 'success' : 'secondary'} className="shrink-0">
              {plugin.status === 'active' ? '运行中' : '已停止'}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground break-words">{plugin.description || '暂无描述'}</p>
        </div>
      </div>

      <Card className="border-border/80">
        <CardContent className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4">
          <div className="space-y-1">
            <p className="text-sm font-medium">插件配置</p>
            <p className="text-xs text-muted-foreground">
              {plugin.readOnly ? '当前连接仅允许查看插件信息。' : '在配置页编辑插件设置。'}
            </p>
          </div>
          {!plugin.readOnly && (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" asChild>
                <Link to={`/logs?q=${encodeURIComponent(plugin.name)}`}><Activity />相关日志</Link>
              </Button>
              <Button variant="outline" size="sm" asChild>
                <Link to={`/config?plugin=${encodeURIComponent(plugin.name)}`}>
                  <Settings className="w-4 h-4 mr-1" />编辑配置
                </Link>
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {plugin.manageable && (
        <Card className="border-border/80">
          <CardContent className="p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-medium">插件操作</p>
                <p className="text-xs text-muted-foreground">诊断、启停、更新或卸载此插件。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => void diagnose()} disabled={actionLoading || actionUnconfirmed}>
                  <Stethoscope className="w-4 h-4 mr-1" />诊断
                </Button>
                <Button variant="outline" size="sm" onClick={() => void updatePlugin()} disabled={actionLoading || actionUnconfirmed}>
                  <RefreshCw className={`w-4 h-4 mr-1 ${actionLoading ? 'animate-spin' : ''}`} />更新
                </Button>
                <Button variant="outline" size="sm" onClick={() => void setEnabled(plugin.status !== 'active')} disabled={actionLoading || actionUnconfirmed}>
                  <Power className="w-4 h-4 mr-1" />{plugin.status === 'active' ? '停用' : '启用'}
                </Button>
                <Button variant="destructive" size="sm" onClick={() => void uninstallPlugin()} disabled={actionLoading || actionUnconfirmed}>
                  <Trash2 className="w-4 h-4 mr-1" />卸载
                </Button>
              </div>
            </div>
            {actionMessage && <Alert><AlertDescription>{actionMessage}</AlertDescription></Alert>}
            {actionError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{actionError}{actionErrorDetail && <details className="mt-2 text-xs"><summary className="cursor-pointer">错误详情</summary><p className="mt-2 break-all">{actionErrorDetail}</p></details>}{actionUnconfirmed && <Button variant="outline" size="sm" onClick={() => void fetchPluginDetail(plugin.instanceKey)}>刷新核对状态</Button>}</AlertDescription>
              </Alert>
            )}
            {diagnostic != null && <PluginDiagnostic value={diagnostic} />}
          </CardContent>
        </Card>
      )}

      <p className="text-xs text-muted-foreground">{plugin.features.length ? '已加载能力' : '暂无已加载能力'}</p>
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
  const { status, errors, missingEnv, warnings } = pluginDiagnosticSummary(value)
  const title = status === 'valid' ? '配置检查通过' : status === 'missing-env' ? '需要补充环境变量' : status === 'invalid' ? '配置检查未通过' : '未提供配置检查结果'
  return <section aria-label="插件诊断结果" className="space-y-3 rounded-md bg-muted/40 p-3 text-sm">
    <Badge variant={status === 'valid' ? 'success' : status === 'unknown' ? 'secondary' : 'warning'}>{title}</Badge>
    {errors.length > 0 && <div><p className="mb-1 font-medium">配置错误</p><ul className="list-disc space-y-1 pl-5">{errors.map((error, index) => <li key={index} className="break-words">{error}</li>)}</ul></div>}
    {missingEnv.length > 0 && <div><p className="mb-1 font-medium">缺少环境变量</p><div className="flex flex-wrap gap-1">{missingEnv.map(name => <code key={name} className="break-all rounded bg-muted px-1.5 py-0.5 text-xs">{name}</code>)}</div></div>}
    {warnings.length > 0 && <div><p className="mb-1 font-medium">提示</p><ul className="list-disc space-y-1 pl-5">{warnings.map((warning, index) => <li key={index} className="break-words">{warning}</li>)}</ul></div>}
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">原始诊断数据</summary><div className="mt-2"><JsonViewer value={value} /></div></details>
  </section>
}
