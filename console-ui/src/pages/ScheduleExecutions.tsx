import { useEffect, useRef, useState } from 'react'
import { RefreshCw, ChevronRight, Clock, Trash2 } from 'lucide-react'
import { useI18n } from '../i18n'
import { apiFetch } from '../utils/auth'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { isDemoMode } from '../utils/demo-mode'
import { Button } from '../components/ui/button'
import { Badge } from '../components/ui/badge'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose } from '../components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { readTraceDetail, traceFailure, traceQuery, traceStatus, type TraceDetail } from './conversation-trace-model.mjs'
import {
  readExecutionPage, readExecutionDetail, readExecutionCleanup, executionQuery, executionDetailQuery,
  executionFailure, executionStatus, deliveryStatus, progressLabel,
  type ExecutionSummary, type ExecutionPage, type ExecutionRecord, type ExecutionResult, type ExecutionAttempt,
} from './schedule-executions-model.mjs'
import './schedule-executions.css'

/** Each read belongs to an exact Host/credential + resource, including callbacks retained by old trees. */
function useExecutionRead<T>(path: string, scope: string, parse: (body: unknown) => T, failure: (status: number) => string) {
  const identity = JSON.stringify([scope, path])
  const owner = useRef(identity); owner.current = identity
  const parser = useRef(parse); parser.current = parse
  const errorMessage = useRef(failure); errorMessage.current = failure
  const [revision, setRevision] = useState(0)
  const [state, setState] = useState<{ identity: string; data: T | null; error: string | null }>({ identity, data: null, error: null })
  useEffect(() => {
    if (!isInboxCacheScopeActive(scope)) return
    const controller = new AbortController()
    let alive = true
    const active = () => alive && owner.current === identity && isInboxCacheScopeActive(scope)
    setState({ identity, data: null, error: null })
    void apiFetch(path, { signal: controller.signal, cache: 'no-store' }).then(async response => {
      if (!active()) return
      if (!response.ok) throw new Error(errorMessage.current(response.status))
      const body: unknown = await response.json()
      if (active()) setState({ identity, data: parser.current(body), error: null })
    }).catch(error => { if (active()) setState({ identity, data: null, error: error instanceof Error ? error.message : errorMessage.current(0) }) })
    return () => { alive = false; controller.abort() }
  }, [identity, path, scope, revision])
  const active = state.identity === identity && isInboxCacheScopeActive(scope)
  return {
    data: active ? state.data : null, error: active ? state.error : null,
    refresh: () => { if (owner.current === identity && isInboxCacheScopeActive(scope)) setRevision(value => value + 1) },
  }
}

function ReadError({ error, retry }: { error: string; retry: () => void }) {
  const i18n = useI18n()
  return <Alert variant="destructive"><AlertDescription>{error}<Button variant="ghost" size="sm" onClick={retry}>{i18n.t('重新读取')}</Button></AlertDescription></Alert>
}

function ResultContent({ result }: { result?: ExecutionResult }) {
  const i18n = useI18n()
  if (!result) return <p className="text-muted-foreground">{i18n.t('尚未记录最终结果。')}</p>
  return <div className="schedule-execution-result">
    {result.error ? <Alert variant="destructive"><AlertDescription>{result.error}</AlertDescription></Alert> : null}
    {result.output ? <pre>{result.output}</pre> : <p className="text-muted-foreground">{i18n.t('未记录输出内容。')}</p>}
    <div className="schedule-execution-facts"><span>{i18n.t('最终尝试：输入 {0} / 输出 {1} tokens', [result.tokenUsage.input, result.tokenUsage.output])}</span><span>{i18n.t('最终尝试耗时：{0} 秒', [(result.durationMs / 1000).toLocaleString(i18n.locale, { maximumFractionDigits: 1 })])}</span></div>
    <section><h4>{i18n.t('通知投递')}</h4><p>{deliveryStatus(result.delivery?.status, i18n.locale, result.delivery?.deliveryUnknown)}</p>{result.delivery?.message ? <p className="text-muted-foreground">{result.delivery.message}</p> : null}</section>
  </div>
}

function AttemptTrace({ attempt, scope }: { attempt: ExecutionAttempt; scope: string }) {
  const i18n = useI18n()
  const sessionKey = `schedule:${attempt.jobId}`
  const read = useExecutionRead<TraceDetail>(traceQuery('turn', sessionKey, attempt.attemptId), scope,
    body => readTraceDetail(body, sessionKey, attempt.attemptId, i18n.locale), status => traceFailure(status, i18n.locale))
  if (read.error) return <ReadError error={read.error} retry={read.refresh} />
  if (!read.data) return <p role="status">{i18n.t('正在读取诊断轨迹…')}</p>
  return <div className="schedule-execution-trace">
    <p>{i18n.t('终止状态：{0}', [traceStatus(read.data.termination.status, i18n.locale)])}</p>
    {read.data.termination.reason ? <p className="text-muted-foreground">{read.data.termination.reason}</p> : null}
    {read.data.model_calls.map((call, index) => <div key={index} className="schedule-execution-facts"><span>{[call.provider, call.model].filter(Boolean).join(' / ') || i18n.t('模型未记录')}</span><span>{call.duration_ms === undefined ? '—' : `${(call.duration_ms / 1000).toFixed(1)} s`}</span></div>)}
    {read.data.tool_calls.map((call, index) => <div key={`${call.tool_use_id}:${index}`}><p>{call.tool_name} · {traceStatus(call.status, i18n.locale)}</p>{call.error ? <p className="text-destructive">{call.error}</p> : null}</div>)}
    {!read.data.model_calls.length && !read.data.tool_calls.length ? <p className="text-muted-foreground">{i18n.t('此轨迹没有保留模型或工具明细。')}</p> : null}
  </div>
}

export function ExecutionRecordContent({ record, scope }: { record: ExecutionRecord; scope: string }) {
  const i18n = useI18n()
  const [traceAttempt, setTraceAttempt] = useState('')
  const time = (value: number) => new Date(value).toLocaleString(i18n.locale)
  return <>
    <div className="schedule-execution-facts"><Badge variant={record.status === 'failed' ? 'destructive' : record.status === 'succeeded' ? 'success' : 'secondary'}>{executionStatus(record.status, i18n.locale)}</Badge><span>{time(record.queuedAt)}</span><span>{i18n.t('{0} 次尝试', [record.attemptCount])}</span></div>
    {record.recordingIssue ? <Alert><AlertDescription>{i18n.t('部分执行记录未能持久保存，以下记录可能不完整。')}</AlertDescription></Alert> : null}
    {record.status === 'interrupted' ? <Alert><AlertDescription>{i18n.t('进程中断前未记录最终结果，不能据此判断操作是否完成。')}</AlertDescription></Alert> : null}
    <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">{i18n.t('运行信息')}</summary><dl className="console-cron-metadata mt-3">
      <div><dt>{i18n.t('任务 ID')}</dt><dd><code>{record.jobId}</code></dd></div><div><dt>{i18n.t('运行 ID')}</dt><dd><code>{record.runId}</code></dd></div>
      <div><dt>{i18n.t('触发来源')}</dt><dd>{i18n.t(({ scheduled: '定时触发', manual: '手动触发', event: '事件触发', preview: '预演' })[record.source])}</dd></div>
      {record.scheduledAt === undefined ? null : <div><dt>{i18n.t('计划执行时间')}</dt><dd>{time(record.scheduledAt)}</dd></div>}
      {record.finishedAt === undefined ? null : <div><dt>{i18n.t('结束时间')}</dt><dd>{time(record.finishedAt)}</dd></div>}
      {record.job.createdBy ? <div><dt>{i18n.t('创建者')}</dt><dd>{record.job.createdBy.name ? `${record.job.createdBy.name} · ` : ''}{record.job.createdBy.userId}</dd></div> : null}
      {record.job.notify?.channel === 'im' && record.job.notify.target ? <>
        <div><dt>{i18n.t('投递账号')}</dt><dd>{record.job.notify.target.scene.platform} · <code>{record.job.notify.target.scene.endpointKey}</code></dd></div>
        <div><dt>{i18n.t('投递会话')}</dt><dd>{record.job.notify.target.scene.kind} · {record.job.notify.target.scene.parent ? `${record.job.notify.target.scene.parent.kind}:${record.job.notify.target.scene.parent.sceneId} / ` : ''}{record.job.notify.target.scene.sceneId}{record.job.notify.target.threadId ? ` / ${record.job.notify.target.threadId}` : ''}</dd></div>
      </> : null}
    </dl></details>
    <Tabs defaultValue="result">
      <TabsList aria-label={i18n.t('执行详情')}><TabsTrigger value="result">{i18n.t('最终结果')}</TabsTrigger><TabsTrigger value="process">{i18n.t('执行过程')}</TabsTrigger></TabsList>
      <TabsContent value="result"><ResultContent result={record.result} /></TabsContent>
      <TabsContent value="process"><ol className="schedule-execution-attempts">
        <li className="schedule-execution-queued"><Clock aria-hidden="true" /><span>{i18n.t('已入队')}</span><time dateTime={new Date(record.queuedAt).toISOString()}>{time(record.queuedAt)}</time></li>
        {record.attempts.map(attempt => <li key={attempt.attemptId} className="schedule-execution-attempt">
          <div className="schedule-execution-attempt-heading"><h4>{i18n.t('尝试 {0}', [attempt.number])}</h4><span>{time(attempt.startedAt)}{attempt.finishedAt === undefined ? '' : ` – ${time(attempt.finishedAt)}`}</span></div>
          <ol className="schedule-execution-events">{attempt.progress.map((event, index) => <li key={index}><time dateTime={new Date(event.at).toISOString()}>{new Date(event.at).toLocaleTimeString(i18n.locale)}</time><span>{progressLabel(event, i18n.locale)}</span>{event.code ? <code>{event.code}</code> : null}</li>)}</ol>
          {attempt.result ? <><p>{attempt.result.status === 'budget_partial' ? i18n.t('部分完成（预算耗尽）') : attempt.result.success ? i18n.t('本次尝试已完成') : attempt.result.status === 'cancelled' ? i18n.t('本次尝试已取消') : i18n.t('本次尝试未完成')}{attempt.result.delivery ? ` · ${deliveryStatus(attempt.result.delivery.status, i18n.locale, attempt.result.delivery.deliveryUnknown)}` : ''}</p>{attempt.result.error ? <p className="text-destructive">{attempt.result.error}</p> : null}</> : <p className="text-muted-foreground">{i18n.t('尚未记录本次尝试结果。')}</p>}
          {attempt.retry ? <p className="text-muted-foreground">{i18n.t(attempt.retry.decision === 'retry' ? '继续重试：{0}' : '停止重试：{0}', [i18n.t(retryReasons[attempt.retry.reason] ?? attempt.retry.reason)])}</p> : null}
          <Button variant="ghost" size="sm" onClick={() => setTraceAttempt(traceAttempt === attempt.attemptId ? '' : attempt.attemptId)} aria-expanded={traceAttempt === attempt.attemptId}>{i18n.t(traceAttempt === attempt.attemptId ? '收起诊断轨迹' : '查看诊断轨迹')}</Button>
          {traceAttempt === attempt.attemptId ? <AttemptTrace key={attempt.attemptId} attempt={attempt} scope={scope} /> : null}
        </li>)}
      </ol></TabsContent>
    </Tabs>
  </>
}

const retryReasons: Record<string, string> = { cancelled: '任务已取消', timeout: '执行超时', attempt_budget_exhausted: '已达到尝试次数上限', committed: '操作已提交，避免重复执行', unknown: '操作结果未知，不能自动重放', not_retryable: '错误不支持重试', read_only: '仅执行了只读操作', not_submitted: '操作尚未提交' }

function ExecutionDetail({ jobId, runId, scope }: { jobId: string; runId: string; scope: string }) {
  const i18n = useI18n()
  const read = useExecutionRead(executionDetailQuery(jobId, runId), scope, body => readExecutionDetail(body, jobId, runId, i18n.locale), status => executionFailure(status, i18n.locale))
  return <>{read.error ? <ReadError error={read.error} retry={read.refresh} /> : read.data ? <><Button variant="ghost" size="sm" className="justify-self-start" onClick={read.refresh}><RefreshCw />{i18n.t('刷新记录')}</Button><ExecutionRecordContent key={runId} record={read.data} scope={scope} /></> : <p role="status">{i18n.t('正在读取执行记录…')}</p>}</>
}

export function ScheduleExecutions({ jobId, label, connectionScope }: { jobId?: string; label?: string; connectionScope: string }) {
  const i18n = useI18n()
  const sequence = useRef(0)
  const pending = useRef<AbortController | null>(null)
  const [page, setPage] = useState<ExecutionPage | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<ExecutionSummary | null>(null)
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleaning, setCleaning] = useState(false)
  const [cleanupResult, setCleanupResult] = useState<string | null>(null)
  const cleanupRequest = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const active = () => mounted.current && isInboxCacheScopeActive(connectionScope)
  const load = async (cursor?: string) => {
    if (!active()) return
    const revision = ++sequence.current
    pending.current?.abort()
    const controller = new AbortController(); pending.current = controller
    const current = () => active() && revision === sequence.current
    setLoading(true); setError(null)
    if (!cursor) setPage(null)
    try {
      const response = await apiFetch(executionQuery(jobId, cursor), { signal: controller.signal, cache: 'no-store' })
      if (!current()) return
      if (!response.ok) throw new Error(executionFailure(response.status, i18n.locale))
      const data = readExecutionPage(await response.json(), jobId, i18n.locale)
      if (current()) setPage(previous => ({ ...data, runs: cursor && previous ? [...previous.runs, ...data.runs.filter(run => !previous.runs.some(row => row.runId === run.runId))] : data.runs }))
    } catch (failure) { if (current()) setError(failure instanceof Error ? failure.message : executionFailure(0, i18n.locale)) }
    finally { if (current()) setLoading(false) }
  }
  useEffect(() => { mounted.current = true; void load(); return () => { mounted.current = false; sequence.current++; pending.current?.abort(); cleanupRequest.current?.abort() } }, [jobId, connectionScope])
  const cleanup = async () => {
    if (!active() || cleaning || cleanupRequest.current || !page || isDemoMode()) return
    const controller = new AbortController(); cleanupRequest.current = controller
    setCleaning(true); setCleanupResult(null)
    try {
      const response = await apiFetch('/api/assistant/executions/cleanup', { method: 'POST', signal: controller.signal, cache: 'no-store' })
      if (!active() || controller.signal.aborted) return
      if (!response.ok) { setCleanupResult(executionFailure(response.status, i18n.locale)); return }
      const result = readExecutionCleanup(await response.json(), i18n.locale)
      if (!active() || controller.signal.aborted) return
      setCleanupOpen(false); setSelected(null); setCleanupResult(i18n.t('已清理 {0} 条过期执行记录。', [result.deleted])); void load()
    } catch { if (active() && !controller.signal.aborted) setCleanupResult(i18n.t('清理结果尚未确认，请重新读取记录核实。')) }
    finally {
      if (cleanupRequest.current === controller) cleanupRequest.current = null
      if (active() && !controller.signal.aborted) setCleaning(false)
    }
  }
  if (!active()) return null
  return <section className="schedule-executions" aria-label={i18n.t('执行记录')}>
    <div className="schedule-executions-heading"><h3>{i18n.t('执行记录')}</h3><div><Button variant="ghost" size="sm" disabled={loading} onClick={() => { void load() }}><RefreshCw />{i18n.t('刷新记录')}</Button>{page && !isDemoMode() ? <Button variant="ghost" size="sm" disabled={cleaning} onClick={() => { if (cleanupRequest.current) return; setCleanupResult(null); setCleanupOpen(true) }}><Trash2 />{i18n.t('清理过期记录')}</Button> : null}</div></div>
    {cleanupResult ? <p role="status" className="text-sm text-muted-foreground">{cleanupResult}</p> : null}
    {page && (page.recordingHealth.activeWriteFailures > 0 || page.recordingHealth.incompleteCompletedRuns > 0) ? <Alert><AlertDescription>{i18n.t('部分执行记录未完整保存。')}</AlertDescription></Alert> : null}
    {error ? <ReadError error={error} retry={() => { void load(page?.nextCursor ?? undefined) }} /> : null}
    {loading && !page ? <p role="status">{i18n.t('正在读取执行记录…')}</p> : page && !page.runs.length ? <p className="schedule-executions-empty">{i18n.t('暂无可用执行记录。较早的执行可能未保存或已过期。')}</p> : null}
    {page?.runs.length ? <ul className="schedule-executions-list">{page.runs.map(run => <li key={run.runId}><button type="button" onClick={() => { if (active()) setSelected(run) }} className="schedule-execution-row">
      <span>{jobId === undefined ? <strong>{run.label || run.jobId}</strong> : null}<time dateTime={new Date(run.queuedAt).toISOString()}>{new Date(run.queuedAt).toLocaleString(i18n.locale)}</time><span className="schedule-execution-facts">{executionStatus(run.status, i18n.locale)} · {i18n.t('{0} 次尝试', [run.attemptCount])}{run.startedAt !== undefined && run.finishedAt !== undefined ? ` · ${((run.finishedAt - run.startedAt) / 1000).toLocaleString(i18n.locale, { maximumFractionDigits: 1 })} s` : ''}</span></span>
      <span className="schedule-execution-row-end">{run.deliveryStatus ? <Badge variant={run.deliveryStatus === 'failed' ? 'destructive' : 'outline'}>{deliveryStatus(run.deliveryStatus, i18n.locale)}</Badge> : null}{run.recordingIssue ? <span>{i18n.t('记录不完整')}</span> : null}<ChevronRight aria-hidden="true" /></span>
    </button></li>)}</ul> : null}
    {page?.nextCursor ? <Button variant="outline" size="sm" disabled={loading} onClick={() => { void load(page.nextCursor ?? undefined) }}>{i18n.t(loading ? '读取中…' : '加载更早记录')}</Button> : null}
    <Dialog open={Boolean(selected)} onOpenChange={open => { if (!open) setSelected(null) }}><DialogContent variant="drawer" className="schedule-execution-dialog"><DialogHeader className="border-b border-[color:var(--console-border-subtle)] pb-3"><DialogTitle>{selected?.label || label || i18n.t('定时任务')} · {i18n.t('执行记录')}</DialogTitle><DialogDescription className="sr-only">{i18n.t('查看单次运行的结果与各次尝试过程。')}</DialogDescription></DialogHeader>{selected ? <ExecutionDetail key={selected.runId} jobId={selected.jobId} runId={selected.runId} scope={connectionScope} /> : null}</DialogContent></Dialog>
    <Dialog open={cleanupOpen} onOpenChange={setCleanupOpen}><DialogContent><DialogHeader><DialogTitle>{i18n.t('清理过期记录')}</DialogTitle><DialogDescription>{i18n.t('清理当前 Host 所有任务中超过一个自然月的非活动执行记录，正在运行的任务不受影响。')}</DialogDescription></DialogHeader>{cleanupResult ? <p role="alert">{cleanupResult}</p> : null}<DialogFooter><DialogClose asChild><Button variant="outline">{i18n.t(cleaning ? '关闭' : '取消')}</Button></DialogClose><Button variant="destructive" disabled={cleaning} onClick={() => { void cleanup() }}>{i18n.t(cleaning ? '清理中…' : '清理过期记录')}</Button></DialogFooter></DialogContent></Dialog>
  </section>
}
