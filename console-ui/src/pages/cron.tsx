import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { useEffect, useState, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Clock, Plus, Trash2, AlertCircle, Pause, Play, RefreshCw, Timer, Cpu, ChevronDown, ChevronUp, Copy, Check, Search } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Separator } from '../components/ui/separator'
import { SelectField } from '../components/ui/select'
import {
  Dialog, DialogContent, DialogHeader, DialogFooter,
  DialogTitle, DialogDescription, DialogClose,
} from '../components/ui/dialog'
import { useToast } from '../components/toast'
import { PageHeader } from '../components/PageHeader'
import { CONSOLE_RPC } from '../contracts/zhin-console'
import { requestConsole } from '../utils/console-rpc'
import { isDemoMode } from '../utils/demo-mode'
import { describeCron, relativeUntil } from './cron-schedule.mjs'
import { validateAssistantJobs, explainJobError, type AssistantJob } from './assistant-jobs-model.mjs'
import { apiFetch } from '../utils/auth'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import './cron.css'

function cronValidationMessage(error?: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  if (!error) return translate(locale, "请检查表达式。")
  const fields = /^Cron expression must have 6 fields, got (\d+)$/.exec(error)
  if (fields) return translate(locale, "需要 6 个字段（秒 分 时 日 月 周），当前为 {0} 个。", [fields[1]])
  const invalid = /^(Empty cron field|Invalid cron field|Invalid cron step|Invalid cron range|Invalid cron value): (.+)$/.exec(error)
  if (invalid) {
    const reason: Record<string, string> = {
      'Empty cron field': translate(locale, "字段没有有效取值，请检查范围"),
      'Invalid cron field': translate(locale, "字段格式无效"),
      'Invalid cron step': translate(locale, "步长无效"),
      'Invalid cron range': translate(locale, "范围格式无效"),
      'Invalid cron value': translate(locale, "字段取值无效"),
    }
    return `${reason[invalid[1]]}：${invalid[2]}`
  }
  return error
}

interface MemoryCron {
  type: 'memory'
  id?: string
  description?: string
  expression: string
  running: boolean
  nextExecution?: number | null
  plugin?: string
}

interface PersistentCron {
  type: 'persistent'
  id: string
  cronExpression: string
  prompt: string
  label?: string
  enabled: boolean
  createdAt?: number
  nextExecution?: number
  lastStatus?: string
  lastExecutedAt?: number
}

function PersistentRunStatus({ state, job, now }: { state?: AssistantJob['state']; job: PersistentCron; now: number }) {
  const i18n = useI18n()
  const lastStatus = state?.lastStatus ?? job.lastStatus
  const failed = lastStatus === 'error'
  const timestamp = state?.nextRunAtMs ?? job.nextExecution
  const next = relativeUntil(timestamp, now, i18n.locale)
  return <div className="console-cron-run-status">
    <div className="console-cron-run-facts">
      <span>{i18n.t("下次执行：")}{next ?? (timestamp != null ? new Date(timestamp).toLocaleString(i18n.locale) : '—')}</span>
      {lastStatus ? <Badge variant={failed ? 'destructive' : lastStatus === 'ok' ? 'success' : 'secondary'}>{failed ? i18n.t("上次执行失败") : lastStatus === 'ok' ? i18n.t("上次执行成功") : lastStatus === 'skipped' ? i18n.t("上次已跳过") : lastStatus}</Badge> : <span>{i18n.t("最近结果：")}{'—'}</span>}
      {state ? <Link className="font-medium text-foreground hover:underline" to={`/assistant/jobs?q=${encodeURIComponent(job.id)}`}>{i18n.t("执行详情 →")}</Link> : null}
    </div>
    {failed && state?.lastError ? <div className="console-job-error" role="note"><p>{explainJobError(state.lastError, i18n.locale) ?? state.lastError}</p>{explainJobError(state.lastError, i18n.locale) ? <code>{state.lastError}</code> : null}</div> : null}
  </div>
}

export default function CronPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <div className="console-page console-resource-page console-schedule-page">
    <PageHeader title={i18n.t("定时提醒")} />
    <Alert><AlertDescription>{i18n.t("请连接 Host 后读取任务。")}</AlertDescription></Alert>
  </div>
  return <CronPageSession key={scope} connectionScope={scope} />
}

function CronPageSession({ connectionScope }: { connectionScope: string }) {
  const i18n = useI18n()
  const readSequence = useRef(0)
  const jobRead = useRef<AbortController | null>(null)
  useEffect(() => () => { readSequence.current++; jobRead.current?.abort() }, [])
  const [memoryCrons, setMemoryCrons] = useState<MemoryCron[]>([])
  const [persistentCrons, setPersistentCrons] = useState<PersistentCron[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addDialogOpen, setAddDialogOpen] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<PersistentCron | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [newCron, setNewCron] = useState({ cronExpression: '', prompt: '', label: '' })
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15000)
    return () => window.clearInterval(timer)
  }, [])
  const [persistentAvailable, setPersistentAvailable] = useState(false)
  const [jobStates, setJobStates] = useState<Map<string, AssistantJob['state']>>(() => new Map())
  const [cronValidation, setCronValidation] = useState<{ expression: string; valid: boolean; error?: string } | null>(null)
  const [togglePending, setTogglePending] = useState<string | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const { error: toastError } = useToast()
  const readOnly = isDemoMode()

  const fetchCrons = useCallback(async () => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    const sequence = ++readSequence.current
    jobRead.current?.abort()
    const controller = new AbortController()
    jobRead.current = controller
    const current = () => sequence === readSequence.current && isInboxCacheScopeActive(connectionScope)
    try {
      type ScheduleListResponse = {
        memory?: MemoryCron[]
        persistent?: PersistentCron[]
        capabilities?: { persistent?: boolean }
      }
      const data = await requestConsole<ScheduleListResponse>({ type: CONSOLE_RPC.SCHEDULE_LIST })
      if (!current()) return
      setPersistentAvailable(data.capabilities?.persistent === true)
      setMemoryCrons(data.memory ?? [])
      setPersistentCrons(data.persistent ?? [])
      setJobStates(new Map())
      setError(null)
      // Run status lives in the assistant job API; without the assistant the list simply shows no status.
      void apiFetch('/api/assistant/jobs', { signal: controller.signal, cache: 'no-store' })
        .then(async (res) => (res.ok ? validateAssistantJobs(await res.json(), i18n.locale).jobs : []))
        .catch(() => [] as AssistantJob[])
        .then((jobs) => { if (current()) setJobStates(new Map(jobs.map((job) => [job.id, job.state]))) })
    } catch (err) {
      if (current()) setError((err as Error).message)
    } finally {
      if (current()) setLoading(false)
    }
  }, [connectionScope])

  useEffect(() => {
    setLoading(true)
    void fetchCrons()
  }, [fetchCrons])

  useEffect(() => {
    setCronValidation(null)
    if (!isInboxCacheScopeActive(connectionScope) || !addDialogOpen || !newCron.cronExpression.trim()) return
    let active = true
    const expression = newCron.cronExpression.trim()
    const timer = setTimeout(() => {
      if (!active || !isInboxCacheScopeActive(connectionScope)) return
      void requestConsole<{ valid: boolean; error?: string }>({ type: CONSOLE_RPC.CRON_VALIDATE, cronExpression: expression })
        .then((result) => { if (active && isInboxCacheScopeActive(connectionScope)) setCronValidation({ expression, ...result }) })
        .catch(() => { if (active && isInboxCacheScopeActive(connectionScope)) setCronValidation({ expression, valid: false, error: i18n.t("无法校验表达式，请检查连接后重试。") }) })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [addDialogOpen, newCron.cronExpression, connectionScope])

  const validCron = cronValidation?.valid === true && cronValidation.expression === newCron.cronExpression.trim()

  const handleAdd = async () => {
    if (!isInboxCacheScopeActive(connectionScope) || !persistentAvailable || readOnly || submitting || !validCron || !newCron.prompt.trim()) return
    setSubmitting(true)
    try {
      await requestConsole({
        type: CONSOLE_RPC.CRON_ADD,
        cronExpression: newCron.cronExpression.trim(),
        prompt: newCron.prompt.trim(),
        label: newCron.label,
      })
      if (!isInboxCacheScopeActive(connectionScope)) return
      setAddDialogOpen(false)
      setNewCron({ cronExpression: '', prompt: '', label: '' })
      await fetchCrons()
    } catch (err) {
      if (isInboxCacheScopeActive(connectionScope)) toastError((err as Error).message)
    } finally {
      if (isInboxCacheScopeActive(connectionScope)) setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!isInboxCacheScopeActive(connectionScope) || !deleteTarget || !persistentAvailable || readOnly || submitting) return
    setSubmitting(true)
    try {
      await requestConsole({ type: CONSOLE_RPC.CRON_REMOVE, id: deleteTarget.id })
      if (!isInboxCacheScopeActive(connectionScope)) return
      setDeleteTarget(null)
      await fetchCrons()
    } catch (err) {
      if (isInboxCacheScopeActive(connectionScope)) toastError((err as Error).message)
    } finally {
      if (isInboxCacheScopeActive(connectionScope)) setSubmitting(false)
    }
  }

  const handleToggle = async (job: PersistentCron) => {
    if (!isInboxCacheScopeActive(connectionScope) || !persistentAvailable || readOnly || togglePending) return
    setTogglePending(job.id)
    try {
      if (job.enabled) {
        await requestConsole({ type: CONSOLE_RPC.CRON_PAUSE, id: job.id })
      } else {
        await requestConsole({ type: CONSOLE_RPC.CRON_RESUME, id: job.id })
      }
      if (!isInboxCacheScopeActive(connectionScope)) return
      await fetchCrons()
    } catch (err) {
      if (isInboxCacheScopeActive(connectionScope)) toastError((err as Error).message)
    } finally {
      if (isInboxCacheScopeActive(connectionScope)) setTogglePending(null)
    }
  }

  const query = search.trim().toLocaleLowerCase()
  const visiblePersistentCrons = persistentCrons.filter(job =>
    (!query || [job.label, job.prompt, job.id, job.cronExpression].some(value => value?.toLocaleLowerCase().includes(query)))
    && (statusFilter === 'all' || statusFilter === 'enabled' && job.enabled
      || statusFilter === 'paused' && !job.enabled || statusFilter === 'error' && (jobStates.get(job.id)?.lastStatus ?? job.lastStatus) === 'error'))
  const visibleMemoryCrons = memoryCrons.filter(cron =>
    (!query || [cron.description, cron.plugin, cron.id, cron.expression].some(value => value?.toLocaleLowerCase().includes(query)))
    && (statusFilter === 'all' || statusFilter === 'enabled' && cron.running || statusFilter === 'paused' && !cron.running))

  if (!isInboxCacheScopeActive(connectionScope)) return null

  if (loading) {
    return (
      <div className="console-page console-resource-page console-schedule-page">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="console-page console-resource-page console-schedule-page">
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
        <Button variant="outline" size="sm" onClick={() => { setError(null); setLoading(true); fetchCrons() }}>
          <RefreshCw className="w-4 h-4 mr-1" /> {i18n.t(" 重试")}</Button>
      </div>
    )
  }

  return (
    <div className="console-page console-resource-page console-schedule-page">
      {/* Header */}
      <PageHeader
        title={i18n.t("定时提醒")}
        actions={
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/logs?q=schedule"><Activity />{i18n.t("调度日志")}</Link>
            </Button>
            <Button variant="outline" size="sm" onClick={() => { setLoading(true); fetchCrons() }}>
              <RefreshCw className="w-4 h-4 mr-1" /> {i18n.t(" 刷新")}</Button>
            {!readOnly && persistentAvailable && (
              <Button size="sm" onClick={() => setAddDialogOpen(true)}>
                <Plus className="w-4 h-4 mr-1" /> {i18n.t(" 新建任务")}</Button>
            )}
          </div>
        }
      />

      {!readOnly && !persistentAvailable && <Alert>
        <AlertDescription>
          {i18n.t("当前实例尚未启用持久化 AI 调度，暂不能创建、暂停或删除任务。已有插件注册的任务仍可在下方查看。 如需定时 AI 任务，请在运行实例中安装并配置 Agent 及持久化调度引擎，再刷新本页。")}</AlertDescription>
      </Alert>}

      {(persistentCrons.length > 0 || memoryCrons.length > 0) && <div className="console-cron-toolbar">
        <div className="console-cron-search">
          <Search aria-hidden="true" />
          <Input type="search" aria-label={i18n.t("搜索定时任务")} placeholder={i18n.t("搜索任务内容或名称…")} value={search} onChange={event => setSearch(event.target.value)} className="pl-9" />
        </div>
        <SelectField aria-label={i18n.t("任务状态")} className="w-full sm:w-auto" value={statusFilter} onValueChange={setStatusFilter} options={[
          { value: 'all', label: i18n.t("全部状态") },
          { value: 'enabled', label: i18n.t("已启用") },
          { value: 'paused', label: i18n.t("已暂停或停止") },
          { value: 'error', label: i18n.t("执行失败") },
        ]} />
      </div>}

      <section aria-labelledby="persistent-crons-title">
        <div className="console-resource-section-heading flex items-center gap-2 mb-3">
          <Timer className="w-5 h-5 text-primary" aria-hidden="true" />
          <h2 id="persistent-crons-title" className="font-semibold">{i18n.t("AI 定时任务")}</h2>
          <Badge variant="secondary">{visiblePersistentCrons.length}</Badge>
        </div>
        {persistentCrons.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-muted-foreground">
            <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" aria-hidden="true" />
            <p>{i18n.t("暂无持久化定时任务")}</p>
            <p className="text-xs mt-1">{readOnly ? i18n.t("Demo 仅展示实例中已存在的任务") : persistentAvailable ? i18n.t("点击「新建任务」添加一个定时 AI 任务") : i18n.t("启用持久化 AI 调度后可在这里管理任务")}</p>
          </CardContent></Card>
        ) : visiblePersistentCrons.length === 0 ? <p className="console-cron-filter-empty">{i18n.t("没有匹配的任务")}</p> : (
          <div className="console-resource-list console-schedule-list">
            {visiblePersistentCrons.map((job) => {
              const isExpanded = expandedId === job.id
              const detailsId = `cron-details-${encodeURIComponent(job.id)}`
              const label = job.label && job.label !== job.id ? job.label : null
              return <Card key={job.id} className="console-schedule-row">
                <CardContent className="console-cron-item">
                  <div className="console-cron-item-heading">
                    <button type="button" className="console-cron-toggle" aria-expanded={isExpanded} aria-controls={detailsId} onClick={() => setExpandedId(isExpanded ? null : job.id)}>
                      <span className="console-cron-title-row">
                        <span className="console-cron-title">{label || job.prompt || i18n.t("定时任务")}</span>
                        <Badge variant={job.enabled ? 'secondary' : 'outline'}>{job.enabled ? i18n.t("已启用") : i18n.t("已暂停")}</Badge>
                        {isExpanded ? <ChevronUp aria-hidden="true" /> : <ChevronDown aria-hidden="true" />}
                      </span>
                      {label && <span className="console-cron-prompt">{job.prompt}</span>}
                      <span className="console-cron-schedule">{describeCron(job.cronExpression, i18n.locale) ?? i18n.t("自定义执行时间")}</span>
                    </button>
                    {!readOnly && persistentAvailable && <div className="console-cron-actions">
                      <Button variant="ghost" size="icon" title={job.enabled ? i18n.t("暂停") : i18n.t("恢复")} disabled={togglePending !== null} onClick={() => handleToggle(job)}>
                        {job.enabled ? <Pause /> : <Play />}
                      </Button>
                      <Button variant="ghost" size="icon" className="text-destructive hover:text-destructive" title={i18n.t("删除")} disabled={togglePending !== null} onClick={() => setDeleteTarget(job)}><Trash2 /></Button>
                    </div>}
                  </div>
                  <PersistentRunStatus state={jobStates.get(job.id)} job={job} now={now} />
                  <div id={detailsId} hidden={!isExpanded}>
                    {isExpanded && <div className="console-cron-details">
                      <div><p className="console-cron-detail-label">{i18n.t("任务内容")}</p><pre className="whitespace-pre-wrap [overflow-wrap:anywhere] text-sm">{job.prompt}</pre></div>
                      <dl className="console-cron-metadata">
                        <div><dt>{i18n.t("Cron 表达式")}</dt><dd><code>{job.cronExpression}</code></dd></div>
                        <div><dt>{i18n.t("任务 ID")}</dt><dd className="flex items-start gap-2"><code className="min-w-0 flex-1">{job.id}</code><Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title={i18n.t("复制 ID")} onClick={async () => {
                          if (!isInboxCacheScopeActive(connectionScope)) return
                          try {
                            await navigator.clipboard.writeText(job.id)
                            if (!isInboxCacheScopeActive(connectionScope)) return
                            setCopiedId(job.id)
                            setTimeout(() => { if (isInboxCacheScopeActive(connectionScope)) setCopiedId(null) }, 1500)
                          } catch { if (isInboxCacheScopeActive(connectionScope)) toastError(i18n.t("复制失败，请手动选择任务 ID 复制。")) }
                        }}>{copiedId === job.id ? <Check /> : <Copy />}</Button></dd></div>
                        <div><dt>{i18n.t("创建时间")}</dt><dd>{job.createdAt ? new Date(job.createdAt).toLocaleString(i18n.locale) : '—'}</dd></div>
                        {job.lastExecutedAt != null && <div><dt>{i18n.t("最近执行")}</dt><dd>{new Date(job.lastExecutedAt).toLocaleString(i18n.locale)}</dd></div>}
                      </dl>
                    </div>}
                  </div>
                </CardContent>
              </Card>
            })}
          </div>
        )}
      </section>

      <Separator />

      <section aria-labelledby="memory-crons-title">
        <div className="console-resource-section-heading flex items-center gap-2 mb-3">
          <Cpu className="w-5 h-5 text-muted-foreground" aria-hidden="true" />
          <h2 id="memory-crons-title" className="font-semibold">{i18n.t("插件定时任务")}</h2>
          <Badge variant="outline">{visibleMemoryCrons.length}</Badge>
        </div>
        {memoryCrons.length === 0 ? <Card><CardContent className="py-6 text-center text-muted-foreground text-sm">{i18n.t("暂无插件注册的内存定时任务")}</CardContent></Card>
          : visibleMemoryCrons.length === 0 ? <p className="console-cron-filter-empty">{i18n.t("没有匹配的任务")}</p> : (
          <div className="console-resource-list console-schedule-list">
            {[...visibleMemoryCrons].sort((x, y) => (x.plugin ?? '').localeCompare(y.plugin ?? '') || (x.nextExecution ?? 0) - (y.nextExecution ?? 0)).map((cron, idx) => {
              const schedule = describeCron(cron.expression, i18n.locale)
              const until = relativeUntil(cron.nextExecution, now, i18n.locale)
              return <article key={cron.id ?? `${cron.plugin}-${cron.expression}-${idx}`} className="console-cron-memory-item">
                <div className="console-cron-title-row">
                  <h3 className="console-cron-title">{cron.description || cron.plugin?.replace(/^root\//, '') || i18n.t("插件定时任务")}</h3>
                  <Badge variant={cron.running ? 'secondary' : 'outline'}>{cron.running ? i18n.t("运行中") : i18n.t("已停止")}</Badge>
                </div>
                {cron.description && cron.plugin && <p className="console-cron-schedule">{cron.plugin.replace(/^root\//, '')}</p>}
                <div className="console-cron-run-facts"><span>{schedule ?? i18n.t("自定义执行时间")}</span><span>{i18n.t("下次执行：")}{cron.nextExecution ? until ?? new Date(cron.nextExecution).toLocaleString(i18n.locale) : '—'}</span></div>
                <details className="console-cron-memory-details"><summary>{i18n.t("任务详情")}</summary><dl className="console-cron-metadata">
                  <div><dt>{i18n.t("Cron 表达式")}</dt><dd><code>{cron.expression}</code></dd></div>
                  {cron.plugin && <div><dt>{i18n.t("插件")}</dt><dd><code>{cron.plugin}</code></dd></div>}
                  {cron.id && <div><dt>{i18n.t("任务 ID")}</dt><dd><code>{cron.id}</code></dd></div>}
                </dl></details>
              </article>
            })}
          </div>
        )}
      </section>

      {/* Add Dialog */}
      {!readOnly && persistentAvailable && <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18n.t("新建定时任务")}</DialogTitle>
            <DialogDescription>
              {i18n.t("创建一个持久化定时任务，到点时会将 Prompt 发送给 AI 执行。")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <label className="text-sm font-medium mb-1.5 block">{i18n.t("标签（可选）")}</label>
              <Input
                placeholder={i18n.t("例如：每日摘要")}
                value={newCron.label}
                onChange={(e) => setNewCron((p) => ({ ...p, label: e.target.value }))}
              />
            </div>
            <div>
              <label className="text-sm font-medium mb-1.5 block">{i18n.t("Cron 表达式")}</label>
              <Input
                placeholder={i18n.t("秒 分 时 日 月 周，例如：0 0 9 * * *")}
                value={newCron.cronExpression}
                onChange={(e) => setNewCron((p) => ({ ...p, cronExpression: e.target.value }))}
              />
              <p className="text-xs text-muted-foreground mt-1">
                {i18n.t("6 字段格式：秒(0-59) 分(0-59) 时(0-23) 日(1-31) 月(1-12) 周(0-7)")}</p>
            </div>
            {newCron.cronExpression.trim() && <p role="status" className={cronValidation?.valid ? 'text-xs text-muted-foreground' : 'text-xs text-destructive'}>
              {cronValidation ? cronValidation.valid ? i18n.t("表达式校验通过") : i18n.t("表达式无效：{0}", [cronValidationMessage(cronValidation.error, i18n.locale)]) : i18n.t("正在校验表达式…")}
            </p>}
            <div>
              <label className="text-sm font-medium mb-1.5 block">Prompt</label>
              <Textarea
                placeholder={i18n.t("触发时发送给 AI 的指令...")}
                rows={4}
                value={newCron.prompt}
                onChange={(e) => setNewCron((p) => ({ ...p, prompt: e.target.value }))}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={submitting}>{i18n.t("取消")}</Button>
            </DialogClose>
            <Button
              onClick={handleAdd}
              disabled={submitting || !validCron || !newCron.prompt.trim()}
            >
              {submitting ? i18n.t("创建中...") : i18n.t("创建")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}

      {/* Delete Confirm Dialog */}
      {!readOnly && persistentAvailable && <Dialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18n.t("确认删除")}</DialogTitle>
            <DialogDescription>
              {i18n.t("确定要删除任务「")}{deleteTarget?.label || deleteTarget?.id}{i18n.t("」吗？此操作不可撤销。")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={submitting}>{i18n.t("取消")}</Button>
            </DialogClose>
            <Button variant="destructive" onClick={handleDelete} disabled={submitting}>
              {submitting ? i18n.t("删除中...") : i18n.t("删除")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  )
}
