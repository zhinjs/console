import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { useEffect, useState, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Activity, Clock, Plus, Trash2, AlertCircle, Pause, Play, RefreshCw, Timer, Cpu, ChevronDown, ChevronUp, Copy, Check } from 'lucide-react'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Skeleton } from '../components/ui/skeleton'
import { Input } from '../components/ui/input'
import { Textarea } from '../components/ui/textarea'
import { Separator } from '../components/ui/separator'
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
}

function PersistentRunStatus({ state, jobId, now }: { state?: AssistantJob['state']; jobId: string; now: number }) {
  const i18n = useI18n()
  if (!state || (!state.lastStatus && state.nextRunAtMs == null)) return null
  const failed = state.lastStatus === 'error'
  const next = relativeUntil(state.nextRunAtMs, now, i18n.locale)
  return <div className="ml-6 mt-2 space-y-2" onClick={(event) => event.stopPropagation()}>
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      {state.lastStatus ? <Badge variant={failed ? 'destructive' : state.lastStatus === 'ok' ? 'success' : 'secondary'}>{failed ? i18n.t("上次执行失败") : state.lastStatus === 'ok' ? i18n.t("上次执行成功") : state.lastStatus === 'skipped' ? i18n.t("上次已跳过") : state.lastStatus}</Badge> : null}
      {next ? <span>{i18n.t("下次执行：")}{next}</span> : null}
      <Link className="font-medium text-foreground hover:underline" to={`/assistant/jobs?q=${encodeURIComponent(jobId)}`}>{i18n.t("执行详情 →")}</Link>
    </div>
    {failed && state.lastError ? <div className="console-job-error" role="note"><p>{explainJobError(state.lastError, i18n.locale) ?? state.lastError}</p>{explainJobError(state.lastError, i18n.locale) ? <code>{state.lastError}</code> : null}</div> : null}
  </div>
}

export default function CronPage() {
  const i18n = useI18n()
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
  const { error: toastError } = useToast()
  const readOnly = isDemoMode()

  const fetchCrons = useCallback(async () => {
    try {
      type ScheduleListResponse = {
        memory?: MemoryCron[]
        persistent?: PersistentCron[]
        capabilities?: { persistent?: boolean }
      }
      const data = await requestConsole<ScheduleListResponse>({ type: CONSOLE_RPC.SCHEDULE_LIST })
      setPersistentAvailable(data.capabilities?.persistent === true)
      setMemoryCrons(data.memory ?? [])
      setPersistentCrons(data.persistent ?? [])
      setError(null)
      // Run status lives in the assistant job API; without the assistant the list simply shows no status.
      void apiFetch('/api/assistant/jobs')
        .then(async (res) => (res.ok ? validateAssistantJobs(await res.json(), i18n.locale).jobs : []))
        .catch(() => [] as AssistantJob[])
        .then((jobs) => setJobStates(new Map(jobs.map((job) => [job.id, job.state]))))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    setLoading(true)
    void fetchCrons()
  }, [fetchCrons])

  useEffect(() => {
    setCronValidation(null)
    if (!addDialogOpen || !newCron.cronExpression.trim()) return
    let active = true
    const expression = newCron.cronExpression.trim()
    const timer = setTimeout(() => {
      void requestConsole<{ valid: boolean; error?: string }>({ type: CONSOLE_RPC.CRON_VALIDATE, cronExpression: expression })
        .then((result) => { if (active) setCronValidation({ expression, ...result }) })
        .catch(() => { if (active) setCronValidation({ expression, valid: false, error: i18n.t("无法校验表达式，请检查连接后重试。") }) })
    }, 250)
    return () => { active = false; clearTimeout(timer) }
  }, [addDialogOpen, newCron.cronExpression])

  const validCron = cronValidation?.valid === true && cronValidation.expression === newCron.cronExpression.trim()

  const handleAdd = async () => {
    if (!persistentAvailable || readOnly || submitting || !validCron || !newCron.prompt.trim()) return
    setSubmitting(true)
    try {
      await requestConsole({
        type: CONSOLE_RPC.CRON_ADD,
        cronExpression: newCron.cronExpression.trim(),
        prompt: newCron.prompt.trim(),
        label: newCron.label,
      })
      setAddDialogOpen(false)
      setNewCron({ cronExpression: '', prompt: '', label: '' })
      await fetchCrons()
    } catch (err) {
      toastError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!deleteTarget || !persistentAvailable || readOnly || submitting) return
    setSubmitting(true)
    try {
      await requestConsole({ type: CONSOLE_RPC.CRON_REMOVE, id: deleteTarget.id })
      setDeleteTarget(null)
      await fetchCrons()
    } catch (err) {
      toastError((err as Error).message)
    } finally {
      setSubmitting(false)
    }
  }

  const handleToggle = async (job: PersistentCron) => {
    if (!persistentAvailable || readOnly || togglePending) return
    setTogglePending(job.id)
    try {
      if (job.enabled) {
        await requestConsole({ type: CONSOLE_RPC.CRON_PAUSE, id: job.id })
      } else {
        await requestConsole({ type: CONSOLE_RPC.CRON_RESUME, id: job.id })
      }
      await fetchCrons()
    } catch (err) {
      toastError((err as Error).message)
    } finally {
      setTogglePending(null)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-1 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="space-y-4">
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
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title={i18n.t("定时提醒")}
        description={i18n.t("管理持久化和内存定时任务")}
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

      {/* Persistent Cron Jobs */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Timer className="w-5 h-5 text-primary" />
          <h3 className="text-lg font-semibold">{i18n.t("持久化任务")}</h3>
          <Badge variant="secondary">{persistentCrons.length}</Badge>
        </div>
        {persistentCrons.length === 0 ? (
          <Card>
            <CardContent className="py-8 text-center text-muted-foreground">
              <Clock className="w-10 h-10 mx-auto mb-3 opacity-40" />
              <p>{i18n.t("暂无持久化定时任务")}</p>
              <p className="text-xs mt-1">
                {readOnly ? i18n.t("Demo 仅展示实例中已存在的任务") : persistentAvailable ? i18n.t("点击「新建任务」添加一个定时 AI 任务") : i18n.t("启用持久化 AI 调度后可在这里管理任务")}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 gap-3">
            {persistentCrons.map((job) => {
              const isExpanded = expandedId === job.id
              return (
              <Card key={job.id} className={!job.enabled ? 'opacity-60' : ''}>
                <CardContent className="py-4">
                  <div
                    className="flex items-start justify-between gap-4 cursor-pointer"
                    onClick={() => setExpandedId(isExpanded ? null : job.id)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        {isExpanded ? <ChevronUp className="w-4 h-4 shrink-0 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 shrink-0 text-muted-foreground" />}
                        <span className="font-medium truncate">
                          {job.label || job.id}
                        </span>
                        <Badge variant={job.enabled ? 'default' : 'outline'} className="text-xs shrink-0">
                          {job.enabled ? i18n.t("已启用") : i18n.t("已暂停")}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground mb-2 ml-6">
                        {describeCron(job.cronExpression, i18n.locale) ? <span className="font-medium text-foreground">{describeCron(job.cronExpression, i18n.locale)}</span> : null}
                        <code className="bg-muted px-1.5 py-0.5 rounded break-all">{job.cronExpression}</code>
                        <span className="shrink-0">{i18n.t("创建于 ")}{job.createdAt ? new Date(job.createdAt).toLocaleString(i18n.locale) : '—'}</span>
                      </div>
                      {!isExpanded && (
                        <p className="text-sm text-muted-foreground line-clamp-1 ml-6">{job.prompt}</p>
                      )}
                      <PersistentRunStatus state={jobStates.get(job.id)} jobId={job.id} now={now} />
                    </div>
                    {!readOnly && persistentAvailable && <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8"
                        title={job.enabled ? i18n.t("暂停") : i18n.t("恢复")}
                        disabled={togglePending !== null}
                        onClick={() => handleToggle(job)}
                      >
                        {job.enabled ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive"
                        title={i18n.t("删除")}
                        disabled={togglePending !== null}
                        onClick={() => setDeleteTarget(job)}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>}
                  </div>
                  {isExpanded && (
                    <div className="mt-3 ml-6 space-y-3 border-t pt-3">
                      <div>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-xs font-medium text-muted-foreground">{i18n.t("任务 ID")}</span>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-6 w-6"
                            title={i18n.t("复制 ID")}
                            onClick={async () => {
                              try {
                                await navigator.clipboard.writeText(job.id)
                                setCopiedId(job.id)
                                setTimeout(() => setCopiedId(null), 1500)
                              } catch {
                                toastError(i18n.t("复制失败，请手动选择任务 ID 复制。"))
                              }
                            }}
                          >
                            {copiedId === job.id ? <Check className="w-3 h-3 text-green-500" /> : <Copy className="w-3 h-3" />}
                          </Button>
                        </div>
                        <code className="text-xs bg-muted px-2 py-1 rounded block break-all">{job.id}</code>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">{i18n.t("Cron 表达式")}</span>
                        <code className="text-sm bg-muted px-2 py-1 rounded block break-all">{job.cronExpression}</code>
                      </div>
                      <div>
                        <span className="text-xs font-medium text-muted-foreground block mb-1">Prompt</span>
                        <pre className="text-sm bg-muted px-3 py-2 rounded whitespace-pre-wrap break-words max-h-60 overflow-y-auto">{job.prompt}</pre>
                      </div>
                      <div className="flex items-center gap-4 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1">{i18n.t("状态: ")}{job.enabled ? <Badge variant="default" className="text-xs">{i18n.t("运行中")}</Badge> : <Badge variant="secondary" className="text-xs">{i18n.t("已暂停")}</Badge>}</span>
                        <span>{i18n.t("创建于: ")}{job.createdAt ? new Date(job.createdAt).toLocaleString(i18n.locale) : '—'}</span>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
              )
            })}
          </div>
        )}
      </div>

      <Separator />

      {/* Memory Cron Jobs (read-only) */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Cpu className="w-5 h-5 text-muted-foreground" />
          <h3 className="text-lg font-semibold">{i18n.t("内存任务（插件注册）")}</h3>
          <Badge variant="outline">{memoryCrons.length}</Badge>
        </div>
        {memoryCrons.length === 0 ? (
          <Card>
            <CardContent className="py-6 text-center text-muted-foreground text-sm">
              {i18n.t("暂无插件注册的内存定时任务")}</CardContent>
          </Card>
        ) : (
          <div className="console-table-card">
            <table className="console-table">
              <thead>
                <tr>
                  <th scope="col">{i18n.t("插件")}</th>
                  <th scope="col">{i18n.t("频率")}</th>
                  <th scope="col">{i18n.t("下次执行")}</th>
                  <th scope="col" className="text-right">{i18n.t("状态")}</th>
                </tr>
              </thead>
              <tbody>
                {[...memoryCrons].sort((x, y) => (x.plugin ?? '').localeCompare(y.plugin ?? '') || (x.nextExecution ?? 0) - (y.nextExecution ?? 0)).map((cron, idx) => {
                  const schedule = describeCron(cron.expression, i18n.locale)
                  const until = relativeUntil(cron.nextExecution, now, i18n.locale)
                  return (
                    <tr key={`${cron.plugin}-${cron.expression}-${idx}`} className={!cron.running ? 'opacity-60' : undefined}>
                      <td className="font-medium">{cron.plugin?.replace(/^root\//, '') ?? '—'}</td>
                      <td>
                        <span className="block">{schedule ?? <code className="console-inline-code">{cron.expression}</code>}</span>
                        {schedule ? <code className="console-table-sub">{cron.expression}</code> : null}
                      </td>
                      <td>
                        {cron.nextExecution ? <>
                          <span className="block">{until ?? new Date(cron.nextExecution).toLocaleTimeString(i18n.locale)}</span>
                          <span className="console-table-sub">{new Date(cron.nextExecution).toLocaleString(i18n.locale)}</span>
                        </> : '—'}
                      </td>
                      <td className="text-right">
                        <Badge variant={cron.running ? 'success' : 'outline'}>{cron.running ? i18n.t("运行中") : i18n.t("已停止")}</Badge>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

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
