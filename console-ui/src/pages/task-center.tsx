import { useI18n } from '../i18n'
import { PageHeader } from '../components/PageHeader'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SelectField } from '../components/ui/select'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog'
import { SchemaFieldEditor } from '../components/PluginConfigForm/SchemaFieldEditor'
import { apiFetch, getApiBase } from '../utils/auth'
import { isDemoMode } from '../utils/demo-mode'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../utils/inbox-cache'
import { requestConsole } from '../utils/console-rpc'
import { CONSOLE_REST, ENDPOINT_RPC } from '../contracts/zhin-console'
import { buildPreviewTarget, readPreviewEndpoints, type PreviewEndpoint } from './introspection/target-preview.mjs'
import { createDiagnosticRequestGate } from './endpoint-detail/message-diagnostics.mjs'
import type { DiagnosticConversation } from './endpoint-detail/types'
import { readTaskProviders, readTaskMutation, readTaskUseCases, readPendingTask, reconcileTaskMutation, taskBusinessError, taskParameterFields, taskDefaults, validateTaskParameters, taskMutationBody,
  availableTaskActions, taskTimeLabel, taskParameterSummary, taskActionDescription, TASK_STATE_LABELS, TASK_ACTION_LABELS, type AdminTask, type TaskAction,
  type TaskProvider, type TaskProviders, type TaskMutationBody, type PendingTask, type TaskUseCase } from './task-center-model.mjs'

type Review = { body: TaskMutationBody; target: DiagnosticConversation; effects: string[]; action: 'create' | TaskAction; parameters: Record<string, unknown>; schema: Record<string, unknown>; timezone?: string }
type TargetFields = { kind: string; id: string; parentKind: string; parentId: string; threadId: string }
const emptyTarget: TargetFields = { kind: 'private', id: '', parentKind: '', parentId: '', threadId: '' }
const pendingStorageKey = () => `zhin.admin-task.pending:${encodeURIComponent(getApiBase())}`
function savedPending() {
  try { return readPendingTask(JSON.parse(sessionStorage.getItem(pendingStorageKey()) ?? 'null')) ?? null } catch { return null }
}

export function TaskTargetSummary({ target, accountName }: { target: DiagnosticConversation; accountName?: string }) {
  const i18n = useI18n()
  const kind = (value: string) => ({ private: i18n.t("私聊"), group: i18n.t("群聊"), channel: i18n.t("频道") })[value] ?? value
  return <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-sm">
    <dt className="text-muted-foreground">{accountName ? i18n.t("投递账号") : i18n.t("账号")}</dt><dd className="break-all">{accountName || JSON.stringify(target.endpoint.id).slice(1, -1)}</dd>
    <dt className="text-muted-foreground">{i18n.t("会话")}</dt><dd className="break-all">{kind(target.kind)} · {target.id}</dd>
    {target.parent && <><dt className="text-muted-foreground">{i18n.t("父容器")}</dt><dd className="break-all">{kind(target.parent.kind)} · {target.parent.id}</dd></>}
    {target.threadId && <><dt className="text-muted-foreground">{i18n.t("话题")}</dt><dd className="break-all">{target.threadId}</dd></>}
  </dl>
}

export function TaskParameterSummary({ schema, parameters, timezone }: { schema: Record<string, unknown>; parameters: Record<string, unknown>; timezone?: string }) {
  const i18n = useI18n()
  const rows = taskParameterSummary(schema, parameters, timezone, i18n.locale)
  return rows.length ? <dl className="space-y-3">{rows.map(row => <div key={row.key}><dt className="text-sm font-medium">{row.title}</dt><dd className="mt-1 text-sm whitespace-pre-wrap break-words text-muted-foreground">{row.value}</dd></div>)}</dl> : <p className="text-sm text-muted-foreground">{i18n.t("此操作不修改任务参数。")}</p>
}

export function AdminTaskCard({ task, disabled, onAction }: { task: AdminTask; disabled: boolean; onAction: (task: AdminTask, action: TaskAction) => void }) {
  const i18n = useI18n()
  return <Card className="console-task-row"><CardContent className="console-task-row-content space-y-3">
    <div className="flex flex-wrap justify-between gap-2"><h3 className="font-medium break-words">{task.title}</h3><span className="text-xs text-muted-foreground">{i18n.t("管理员任务 · ")}{i18n.t(TASK_STATE_LABELS[task.state])}</span></div>
    <p className="text-xs text-muted-foreground">{i18n.t("下次执行：")}{taskTimeLabel(task.nextRunAt, task.timezone, i18n.locale)}</p>
    {task.lastRunAt !== undefined && <p className="text-xs text-muted-foreground">{i18n.t("最近执行：")}{taskTimeLabel(task.lastRunAt, task.timezone, i18n.locale)}</p>}
    <p className="text-xs break-all">{task.target.endpoint.adapter} · {task.target.kind === 'private' ? i18n.t("私聊") : task.target.kind === 'group' ? i18n.t("群聊") : i18n.t("频道")} · {task.target.id}{task.target.parent && i18n.t(" · 父容器 {0}", [task.target.parent.id])}{task.target.threadId && i18n.t(" · 话题 {0}", [task.target.threadId])}</p>
    {task.detail && <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.detail}</p>}
    {task.state === 'unknown' && <Alert><AlertDescription>{i18n.t("投递结果不确定，请先到实际目标核实；此任务不能恢复或重试。取消也无法撤回可能已在途的发送。")}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2">{availableTaskActions(task).map(action => <Button key={action} size="sm" variant={action === 'cancel' ? 'destructive' : 'outline'} disabled={disabled} onClick={() => onAction(task, action)}>{i18n.t(TASK_ACTION_LABELS[action])}</Button>)}</div>
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t("任务详情")}</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify({ id: task.id, target: task.target, parameters: task.parameters }, null, 2)}</pre></details>
  </CardContent></Card>
}

export default function TaskCenterPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope(), scopeRef = useRef(scope); scopeRef.current = scope
  const reads = useRef(createDiagnosticRequestGate(getInboxCacheScope)), useCaseReads = useRef(createDiagnosticRequestGate(getInboxCacheScope)), mutationEpoch = useRef(0), writing = useRef(false)
  const [catalog, setCatalog] = useState<TaskProviders | null>(null)
  const [catalogReadable, setCatalogReadable] = useState(false)
  const [selectedOwner, setSelectedOwner] = useState('')
  const [base, setBase] = useState<{ generation: number; provider: TaskProvider } | null>(null)
  const [parameters, setParameters] = useState<Record<string, unknown>>({})
  const [endpoints, setEndpoints] = useState<PreviewEndpoint[]>([]), [endpointKey, setEndpointKey] = useState('')
  const [targetFields, setTargetFields] = useState<TargetFields>(emptyTarget)
  const [editTask, setEditTask] = useState<AdminTask | null>(null)
  const [review, setReview] = useState<Review | null>(null)
  const [pending, setPending] = useState<PendingTask | null>(null), pendingRef = useRef<PendingTask | null>(null); pendingRef.current = pending
  const [useCases, setUseCases] = useState<TaskUseCase[]>([]), [useCaseError, setUseCaseError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false), [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null), [notice, setNotice] = useState<string | null>(null)
  const [endpointError, setEndpointError] = useState<string | null>(null)
  const demo = isDemoMode(), provider = catalog?.providers.find(item => item.owner === selectedOwner)
  const selectedEndpoint = endpoints.find(item => JSON.stringify(item.endpoint) === endpointKey)
  const accountName = (target: DiagnosticConversation) => endpoints.find(item => item.endpoint.id === target.endpoint.id && item.endpoint.adapter === target.endpoint.adapter)?.name
  const current = isInboxCacheScopeActive(scope)
  const disabled = demo || !current || busy || pending !== null || loading || !catalogReadable
  const stale = !!base && (catalog?.generation !== base.generation || provider?.revision !== base.provider.revision)

  const refresh = useCallback(async () => {
    if (!isInboxCacheScopeActive(scope) || writing.current) return
    const request = reads.current.begin(); setLoading(true); setError(null)
    try {
      const response = await apiFetch(`${CONSOLE_REST.TASK_PROVIDERS}?locale=${i18n.locale}`, { signal: request.signal, cache: 'no-store' })
      if (!request.current() || !isInboxCacheScopeActive(scope)) return
      if (!response.ok) throw new Error(response.status === 404 ? i18n.t("当前 Host 尚不支持管理员任务中心，请更新 Host。") : response.status === 403 ? i18n.t("需要 full scope 才能查看和管理管理员任务。") : i18n.t("任务读取失败（HTTP {0}），请检查 Host 后刷新。", [response.status]))
      const next = readTaskProviders(await response.json(), i18n.locale)
      if (request.current() && isInboxCacheScopeActive(scope)) {
        setCatalog(next); setCatalogReadable(true)
        const operation = pendingRef.current
        if (operation && operation.scope === scope && operation.host === getApiBase()) {
          const confirmed = reconcileTaskMutation(next, operation)
          if (confirmed) {
            sessionStorage.removeItem(pendingStorageKey()); pendingRef.current = null; setPending(null)
            setNotice(i18n.t("原操作已由持久确认记录核实，任务 ID：{0}。这是任务变更确认，不是平台消息投递确认。", [confirmed.receipt.taskId]))
          }
        }
      }
    } catch (caught) { if (request.current() && isInboxCacheScopeActive(scope)) { setCatalogReadable(false); setError((caught as Error).message) } }
    finally { if (request.current()) setLoading(false) }
  }, [scope, i18n])

  useEffect(() => {
    mutationEpoch.current++; writing.current = false; reads.current.cancel()
    setCatalog(null); setCatalogReadable(false); setSelectedOwner(''); setBase(null); setParameters({}); setEditTask(null)
    const restored = savedPending(); pendingRef.current = restored
    setEndpoints([]); setEndpointKey(''); setTargetFields(emptyTarget); setReview(null); setPending(restored); setBusy(false); setNotice(null); setError(null); setEndpointError(null); setUseCases([]); setUseCaseError(null)
    return () => { mutationEpoch.current++; reads.current.cancel() }
  }, [scope])
  // Display-language refresh must not reset the selected target, draft or pending operation.
  useEffect(() => { void refresh(); return () => reads.current.cancel() }, [refresh])

  const loadUseCases = useCallback(async () => {
    if (!isInboxCacheScopeActive(scope)) return
    const request = useCaseReads.current.begin(); setUseCaseError(null)
    try {
      const response = await apiFetch(`${CONSOLE_REST.TASK_USE_CASES}?locale=${i18n.locale}`, { signal: request.signal, cache: 'no-store' })
      if (!response.ok) throw new Error(i18n.t("用途目录暂不可用；可直接选择当前已加载的任务提供方，或到插件市场查看。"))
      const next = readTaskUseCases(await response.json(), i18n.locale)
      if (request.current() && isInboxCacheScopeActive(scope)) setUseCases(next)
    } catch (caught) { if (request.current() && isInboxCacheScopeActive(scope)) setUseCaseError((caught as Error).message) }
  }, [scope, i18n])
  useEffect(() => { void loadUseCases(); return () => useCaseReads.current.cancel() }, [loadUseCases])
  useEffect(() => {
    if (!pending) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [pending])

  const chooseProvider = (owner: string) => {
    if (pending || busy) return
    if (!isInboxCacheScopeActive(scope)) return
    const next = catalog?.providers.find(item => item.owner === owner)
    setSelectedOwner(owner); setEditTask(null); setReview(null); setParameters(next ? taskDefaults(next.schema, i18n.locale) : {})
    setBase(next && catalog ? { generation: catalog.generation, provider: next } : null); setError(null); setNotice(null)
  }
  const loadEndpoints = async () => {
    const requestedScope = scope; setEndpointError(null)
    try {
      const next = readPreviewEndpoints(await requestConsole({ type: ENDPOINT_RPC.LIST }), i18n.locale)
      if (isInboxCacheScopeActive(requestedScope) && scopeRef.current === requestedScope) setEndpoints(next)
    } catch { if (isInboxCacheScopeActive(requestedScope)) setEndpointError(i18n.t("账号目录读取失败。只能选择 Host 返回的完整 Endpoint，不能用本地账号名猜测。")) }
  }
  const resolveTarget = () => editTask?.target ?? buildPreviewTarget(selectedEndpoint?.endpoint, targetFields, i18n.locale)
  let targetPreview: DiagnosticConversation | undefined, targetIssue: string | undefined
  try { targetPreview = resolveTarget() } catch (caught) { targetIssue = (caught as Error).message }
  const form = taskParameterFields(base?.provider.schema, i18n.locale)
  const issues = base ? validateTaskParameters(base.provider.schema, parameters, i18n.locale) : []

  const prepareCreateOrUpdate = () => {
    if (!base || !provider || !targetPreview || disabled || stale || issues.length || form.unsupported) return
    try {
      const body = taskMutationBody({ generation: base.generation, provider: base.provider, requestId: crypto.randomUUID(), target: targetPreview, parameters,
        ...(editTask ? { id: editTask.id, action: 'update' as const } : {}) }, i18n.locale)
      setReview({ body, target: targetPreview, effects: provider.effects, action: editTask ? 'update' : 'create', parameters: structuredClone(parameters), schema: base.provider.schema, timezone: editTask?.timezone })
    } catch (caught) { setError((caught as Error).message) }
  }
  const act = (task: AdminTask, action: TaskAction) => {
    if (!catalog || !provider || disabled) return
    if (action === 'update') {
      setEditTask(task); setBase({ generation: catalog.generation, provider }); setParameters(structuredClone(task.parameters)); setNotice(i18n.t("正在编辑该管理员任务；修改不会改变原始投递目标。")); return
    }
    try {
      const body = taskMutationBody({ generation: catalog.generation, provider, requestId: crypto.randomUUID(), id: task.id, action }, i18n.locale)
      setReview({ body, target: task.target, effects: provider.effects, action, parameters: structuredClone(task.parameters), schema: provider.schema, timezone: task.timezone })
    } catch (caught) { setError((caught as Error).message) }
  }
  const submit = async () => {
    if (!review || disabled || writing.current || pendingRef.current || !isInboxCacheScopeActive(scope)) return
    const operation = review, epoch = mutationEpoch.current, requestedScope = scope
    const preserved: PendingTask = { owner: operation.body.owner, requestId: operation.body.requestId, generation: operation.body.generation,
      operation: operation.action, host: getApiBase(), scope: requestedScope! }
    try { sessionStorage.setItem(pendingStorageKey(), JSON.stringify(preserved)) }
    catch { setError(i18n.t("浏览器无法保留操作身份，本次没有提交。请允许会话存储后再试。")); return }
    writing.current = true; pendingRef.current = preserved; reads.current.cancel(); setLoading(false); setBusy(true); setPending(preserved); setReview(null); setError(null); setNotice(i18n.t("操作已提交，正在等待 Host 回执。请勿重复操作。"))
    const owned = () => epoch === mutationEpoch.current && isInboxCacheScopeActive(requestedScope) && scopeRef.current === requestedScope
    try {
      const response = await apiFetch(operation.action === 'create' ? CONSOLE_REST.TASK_CREATE : CONSOLE_REST.TASK_CHANGE, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...operation.body, locale: i18n.locale }), signal: AbortSignal.timeout(30_000),
      })
      if (!owned()) return
      if (!response.ok) {
        if ([400, 403, 404, 409].includes(response.status)) {
          const businessError = taskBusinessError(await response.json().catch(() => null))
          if (!owned()) return
          if (response.status === 409 || response.status === 404) setCatalogReadable(false)
          sessionStorage.removeItem(pendingStorageKey()); pendingRef.current = null; setPending(null); setNotice(null)
          throw new Error(response.status === 409 ? i18n.t("运行代或任务修订已变化，草稿已保留。请先刷新核对，再明确采用最新版本；未自动重发。{0}", [businessError ?? '']) : businessError ?? (response.status === 403 ? i18n.t("当前身份没有任务管理权限，操作未获准。") : i18n.t("Host 拒绝此任务操作，请检查提供方、参数和当前状态。")))
        }
        throw new Error(i18n.t("操作回执不确定，请先只读刷新核对，勿再次提交。"))
      }
      const body = await response.json()
      if (!owned()) return
      if (body?.success !== true) throw new Error(i18n.t("Host 回执不完整，操作结果不确定，请只读核对。"))
      const result = readTaskMutation(body, i18n.locale)
      if (result.provider.owner !== operation.body.owner || !result.provider.receipts.some(receipt => receipt.requestId === operation.body.requestId && receipt.operation === operation.action)) throw new Error(i18n.t("回执没有匹配本操作的确认，结果仍不确定，请只读核对。"))
      setCatalog(previous => previous ? { generation: result.generation, providers: previous.providers.map(item => item.owner === result.provider.owner ? result.provider : item) } : previous); setCatalogReadable(true)
      sessionStorage.removeItem(pendingStorageKey())
      pendingRef.current = null; setPending(null); setNotice(i18n.t("管理员任务操作已确认。列表反映任务事实，不代表未来消息已成功投递。"))
      setBase(null); setEditTask(null); setParameters({})
    } catch (caught) { if (owned()) { setError((caught as Error).message); setNotice(null) } }
    finally { if (owned()) { writing.current = false; setBusy(false) } }
  }

  // Display metadata may refresh without replacing the approved mutation snapshot or draft.
  const reviewTitle = !review ? '' : review.action === 'create' ? i18n.t("确认创建管理员任务")
    : review.action === 'update' ? i18n.t("确认修改管理员任务") : i18n.t("确认{0}管理员任务", [i18n.t(TASK_ACTION_LABELS[review.action])])
  const reviewEffects = review && catalog?.generation === review.body.generation
    && provider?.owner === review.body.owner && provider.revision === review.body.expectedRevision
    ? provider.effects : review?.effects ?? []

  return <div className="console-page console-resource-page console-tasks-page">
    <PageHeader title={i18n.t("任务中心")} actions={<Button variant="outline" size="sm" disabled={loading || busy || !current} onClick={() => { void refresh(); void loadUseCases() }}><RefreshCw className={`h-4 w-4 mr-1 ${loading ? 'animate-spin' : ''}`} />{i18n.t("刷新核对")}</Button>} />
    {demo && <Alert><AlertDescription>{i18n.t("Demo 仅展示；创建、修改、暂停、恢复和取消均已禁用。")}</AlertDescription></Alert>}
    {error && current && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {notice && current && <Alert><AlertDescription>{notice}</AlertDescription></Alert>}
    {pending && current && <Alert><AlertDescription>{i18n.t("保留操作 ID：")}<code className="break-all">{pending.requestId}</code>。{busy ? i18n.t("等待当前操作回执。") : i18n.t("结果尚未确认，写操作已锁定。请只读核对任务与目标会话；没有匹配的持久确认不能视为未执行。")}
      {pending.scope !== scope && <div className="mt-2 space-y-2"><p>{i18n.t("连接身份已变化，请确认当前 Host 与账号确实有权核对原操作。不会用其他 Host 的结果冒认。")}</p><Button size="sm" variant="outline" disabled={demo || pending.host !== getApiBase() || !catalog} onClick={() => {
        if (!scope || pending.host !== getApiBase()) return
        const acknowledged = { ...pending, scope }; sessionStorage.setItem(pendingStorageKey(), JSON.stringify(acknowledged)); pendingRef.current = acknowledged; setPending(acknowledged); void refresh()
      }}>{i18n.t("确认以当前身份只读核对原操作")}</Button></div>}
    </AlertDescription></Alert>}
    {!current ? <p className="text-sm text-muted-foreground">{i18n.t("请连接 Host 后读取任务。")}</p> : <>
      {loading && !catalog && <p role="status">{i18n.t("正在读取任务提供方…")}</p>}
      <Card className="console-task-use-cases"><CardHeader><CardTitle>{i18n.t("按用途开始")}</CardTitle></CardHeader><CardContent className="space-y-3">
        {useCaseError && <p className="text-xs text-muted-foreground">{useCaseError}</p>}
        {useCases.map(item => <details key={item.id} className="console-disclosure-card"><summary className="font-medium">{item.title}</summary><div className="space-y-3 pt-3 text-sm"><p>{item.summary}</p><ol className="list-decimal pl-5 space-y-1">{item.steps.map(step => <li key={step}>{step}</li>)}</ol><ul className="list-disc pl-5 text-xs text-muted-foreground space-y-1">{item.limitations.map(limitation => <li key={limitation}>{limitation}</li>)}</ul>
          <p className="text-xs break-all">{i18n.t("插件包：")}<code>{item.packageName}</code>{i18n.t("（可选中复制）")}</p><div className="flex flex-wrap gap-2"><Button asChild size="sm" variant="outline"><Link to="/marketplace">{i18n.t("到市场查看安装计划")}</Link></Button><Button asChild size="sm" variant="outline"><Link to="/plugins">{i18n.t("管理插件实例")}</Link></Button>
            {item.id === 'group-welcome' && item.mode === 'plugin-configuration' && <Button asChild size="sm"><Link to="/use-cases/group-welcome">{i18n.t("开始群欢迎配置流程")}</Link></Button>}
            {item.mode === 'administrator-task' && catalog?.providers.filter(candidate => candidate.packageName === item.packageName).map(candidate => <Button key={candidate.owner} size="sm" disabled={disabled} onClick={() => chooseProvider(candidate.owner)}>{i18n.t("配置 ")}{candidate.title} · {candidate.owner}</Button>)}
          </div>{item.mode === 'administrator-task' && !catalog?.providers.some(candidate => candidate.packageName === item.packageName) && <p className="text-xs text-muted-foreground">{i18n.t("尚无该软件包已加载的任务提供方；安装后还需配置、应用并回到此页刷新。")}</p>}</div></details>)}
      </CardContent></Card>
      {catalog && !catalog.providers.length && <Card><CardContent className="p-5 space-y-3"><p>{i18n.t("尚无可用的管理员任务提供方。请安装并启用相应用途插件，再返回刷新。")}</p><Button asChild variant="outline"><Link to="/marketplace">{i18n.t("前往插件市场")}</Link></Button></CardContent></Card>}
      {!!catalog?.providers.length && <div className="console-task-workspace grid gap-5 lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1.05fr)]">
        <div className="space-y-4"><Card className="console-task-setup"><CardHeader><CardTitle>{i18n.t("选择用途")}</CardTitle></CardHeader><CardContent className="space-y-3">
          <SelectField aria-label={i18n.t("任务用途")} value={selectedOwner} disabled={busy || !!pending} onValueChange={chooseProvider} options={[{ value: '', label: i18n.t("请选择用途提供方") }, ...catalog.providers.map(item => ({ value: item.owner, label: <>{item.title} · {item.owner}</> }))]} />
          {provider && <p className="text-sm text-muted-foreground">{provider.description}</p>}
        </CardContent></Card>
        {base && <Card className="console-task-form"><CardHeader><CardTitle>{editTask ? i18n.t("修改任务参数") : i18n.t("配置管理员任务")}</CardTitle></CardHeader><CardContent className="space-y-4">
          {stale && <Alert><AlertDescription>{i18n.t("草稿基于旧运行代或旧修订，不能直接提交；刷新不会为旧草稿背书。")}</AlertDescription></Alert>}
          {!editTask ? <fieldset className="space-y-3"><legend className="font-medium text-sm">{i18n.t("投递目标")}</legend><Button variant="outline" size="sm" disabled={disabled} onClick={() => void loadEndpoints()}>{i18n.t("读取账号列表")}</Button>
            {endpointError && <p className="text-xs text-destructive">{endpointError}</p>}
            <SelectField aria-label={i18n.t("投递账号")} value={endpointKey} disabled={disabled} onValueChange={value => { setEndpointKey(value); setTargetFields(emptyTarget) }} options={[{ value: '', label: i18n.t("请选择账号") }, ...endpoints.map(item => ({ value: JSON.stringify(item.endpoint), label: <>{item.name} · {item.endpoint.adapter} · {item.connected ? i18n.t("已连接") : i18n.t("未连接")}</> }))]} />
            <label className="text-xs block">{i18n.t("会话类型")}<SelectField aria-label={i18n.t("会话类型")} value={targetFields.kind} disabled={disabled} onValueChange={value => setTargetFields(current => ({ ...current, kind: value }))} options={[{ value: 'private', label: i18n.t("私聊") }, { value: 'group', label: i18n.t("群聊") }, { value: 'channel', label: i18n.t("频道") }]} /></label>
            <Input aria-label={i18n.t("会话 ID")} placeholder={i18n.t("会话 ID")} value={targetFields.id} disabled={disabled} onChange={event => setTargetFields(current => ({ ...current, id: event.target.value }))} />
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t("父容器与话题（可选）")}</summary><div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2"><SelectField aria-label={i18n.t("父容器类型")} value={targetFields.parentKind} disabled={disabled} onValueChange={value => setTargetFields(current => ({ ...current, parentKind: value }))} options={[{ value: '', label: i18n.t("无父容器") }, { value: 'private', label: 'private' }, { value: 'group', label: 'group' }, { value: 'channel', label: i18n.t("channel（服务器/工作区）") }]} />
                <Input aria-label={i18n.t("父容器 ID")} placeholder={i18n.t("父容器 ID")} value={targetFields.parentId} disabled={disabled} onChange={event => setTargetFields(current => ({ ...current, parentId: event.target.value }))} /></div>
              <Input aria-label={i18n.t("话题 ID")} placeholder={i18n.t("话题 ID")} value={targetFields.threadId} disabled={disabled} onChange={event => setTargetFields(current => ({ ...current, threadId: event.target.value }))} />
            </div></details>
          </fieldset> : <p className="text-xs text-muted-foreground">{i18n.t("投递目标保持不变。")}</p>}
          {targetIssue && <p className="text-xs text-muted-foreground">{targetIssue}</p>}
          {targetPreview && <div className="space-y-2 rounded-md bg-muted/40 p-3"><p className="text-sm font-medium">{i18n.t("投递目标预览")}</p><TaskTargetSummary target={targetPreview} accountName={accountName(targetPreview)} /><details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t("目标详情")}</summary><pre className="whitespace-pre-wrap break-all pt-2">{JSON.stringify(targetPreview, null, 2)}</pre></details></div>}
          {form.unsupported ? <Alert><AlertDescription>{form.unsupported}</AlertDescription></Alert> : <fieldset disabled={disabled} className="space-y-3">{Object.entries(form.fields).map(([key, field]) => <SchemaFieldEditor key={key} name={key} field={field} value={parameters[key]} allowEnvironmentReferences={false} onChange={value => setParameters(previous => { const next = { ...previous }; if (value ===undefined) delete next[key]; else Object.defineProperty(next, key, { value, enumerable: true, writable: true, configurable: true }); return next })} />)}</fieldset>}
          {!!issues.length && <ul className="text-xs text-muted-foreground list-disc pl-4">{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
          <div className="flex flex-wrap gap-2"><Button disabled={disabled || stale || !targetPreview || !!issues.length || !!form.unsupported} onClick={prepareCreateOrUpdate}>{editTask ? i18n.t("核对修改") : i18n.t("核对并创建")}</Button>
            {stale && provider && <Button variant="outline" disabled={disabled} onClick={() => { setBase({ generation: catalog.generation, provider }); setNotice(i18n.t("已明确采用当前版本，请重新核对全部参数、目标与副作用后提交。")) }}>{i18n.t("采用当前版本，保留草稿")}</Button>}
            <Button variant="ghost" disabled={busy || !!pending} onClick={() => chooseProvider(selectedOwner)}>{i18n.t("清空并重新配置")}</Button></div>
        </CardContent></Card>}
        {!base && provider && <Button variant="outline" disabled={disabled} onClick={() => chooseProvider(selectedOwner)}>{i18n.t("为此用途创建新任务")}</Button>}
        </div>
        <div className="console-task-list space-y-3"><h2 className="font-medium">{provider ? i18n.t("{0} · 管理员任务", [provider.title]) : i18n.t("请选择用途查看任务")}</h2>{provider && !provider.tasks.length && <p className="text-sm text-muted-foreground">{i18n.t("当前没有管理员任务。")}</p>}{provider?.tasks.map(task => <AdminTaskCard key={task.id} task={task} disabled={disabled} onAction={act} />)}</div>
      </div>}
    </>}
    <Dialog open={review !== null && current} onOpenChange={value => { if (!value) setReview(null) }}><DialogContent className="max-w-xl max-h-[85vh] overflow-y-auto"><DialogHeader><DialogTitle>{reviewTitle}</DialogTitle><DialogDescription>{review && taskActionDescription(review.action, i18n.locale)}</DialogDescription></DialogHeader>
      {review && <div className="space-y-3 text-sm"><p>{i18n.t("操作：")}{review.action === 'create' ? i18n.t("创建") : i18n.t(TASK_ACTION_LABELS[review.action])} · {provider?.title}</p>
        {review.action === 'cancel' && <Alert><AlertDescription>{i18n.t("取消无法撤回已经在途或结果不确定的发送，请先核对目标会话。")}</AlertDescription></Alert>}
        <div><p className="font-medium">{i18n.t("未来外部影响")}</p>{reviewEffects.length ? <ul className="list-disc pl-5">{reviewEffects.map(effect => <li key={effect}>{effect}</li>)}</ul> : <p>{i18n.t("提供方未声明影响说明；这不等于没有外部副作用。")}</p>}</div>
        <div className="rounded-md bg-muted/40 p-3"><TaskTargetSummary target={review.target} accountName={accountName(review.target)} /></div>
        <TaskParameterSummary schema={review.schema} parameters={review.parameters} timezone={review.timezone} />
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t("完整身份与参数")}</summary><pre className="whitespace-pre-wrap break-all pt-2">{JSON.stringify({ target: review.target, parameters: review.parameters }, null, 2)}</pre></details>
      </div>}
      <DialogFooter className="gap-2 sm:space-x-0"><Button variant="outline" onClick={() => setReview(null)}>{i18n.t("返回检查")}</Button><Button disabled={disabled} onClick={() => void submit()}>{i18n.t("确认一次提交")}</Button></DialogFooter></DialogContent></Dialog>
  </div>
}
