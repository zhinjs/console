import { translate } from '../i18n/locale.mjs'
import { useI18n } from '../i18n'
import { useState, useRef, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { assistantNavigation } from '../bootstrap/assistant-navigation'
import { Brain, RefreshCw } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { readErrorSummary } from '../utils/read-error.mjs'
import { useConsoleRead } from '../hooks/use-console-read'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ErrorAlert } from '../components/error-alert'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SelectField } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import { JsonViewer } from './introspection/JsonViewer'
import { validateAssistantJobs, filterAssistantJobs, probeAssistantJobs, explainJobError, type AssistantJobsResponse } from './assistant-jobs-model.mjs'

type JobRead = { unavailable: true } | { unavailable: false; data: AssistantJobsResponse }

export default function AssistantJobsPage() {
  const i18n = useI18n()
  const reportAvailability = useRef(assistantNavigation.capture())
  const [searchParams] = useSearchParams()
  const [query, setQuery] = useState(() => searchParams.get('q') ?? '')
  const [status, setStatus] = useState('all')
  const read = useConsoleRead<JobRead | null>(async () => {
    const response = await apiFetch('/api/assistant/jobs')
    if (response.status === 404) return { unavailable: true }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { unavailable: false, data: validateAssistantJobs(await response.json(), i18n.locale) }
  }, null)
  useEffect(() => {
    if (!read.loading && (read.loaded || read.error)) {
      reportAvailability.current(Boolean(read.loaded && !read.error && read.data && !read.data.unavailable))
    }
  }, [read.loading, read.loaded, read.error, read.data])
  const data = read.data && !read.data.unavailable ? read.data.data : null
  const jobs = data ? filterAssistantJobs(data.jobs, query, status) : []
  const refresh = () => { void read.refresh().catch(() => {}) }
  return <PageShell>
    <PageHeader title={i18n.t("助手任务")} description={i18n.t("这些任务在「定时提醒」里创建、暂停和删除；这里查看执行状态与原始数据。")} actions={<Button variant="outline" size="sm" onClick={refresh} disabled={read.loading}><RefreshCw className={read.loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>} />
    {read.error && <div><ErrorAlert error={readErrorSummary(read.error, i18n.t("助手任务"), i18n.locale)} onRetry={refresh} />{read.loaded && <p className="mt-2 text-xs text-muted-foreground">{i18n.t("以下为上次读取的任务。")}</p>}<details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t("错误详情")}</summary><p className="mt-2 break-all">{read.error}</p></details></div>}
    {read.loading && !read.loaded ? <Skeleton className="h-32 w-full" /> : read.data?.unavailable ? <Card><CardContent className="flex flex-col items-center gap-3 py-12"><Brain className="h-10 w-10 text-muted-foreground/40" /><h2 className="text-base font-medium">{i18n.t("助手未启用")}</h2><p className="text-sm text-muted-foreground">{i18n.t("启用助手后，可在这里查看任务。")}</p></CardContent></Card> : data ? <>
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label={i18n.t("搜索助手任务")} placeholder={i18n.t("搜索名称或编号…")} value={query} onChange={event => setQuery(event.target.value)} className="w-full sm:max-w-xs" />
        <SelectField aria-label={i18n.t("助手任务状态")} value={status} onValueChange={setStatus} className="w-auto" options={[{ value: 'all', label: i18n.t("全部状态") }, { value: 'enabled', label: i18n.t("已启用") }, { value: 'paused', label: i18n.t("已暂停") }, { value: 'error', label: i18n.t("执行失败") }]} />
        <span className="text-xs text-muted-foreground">{i18n.t("事件接收 ")}<Badge variant={data.eventsActive ? 'success' : 'secondary'}>{data.eventsActive ? i18n.t("已启用") : i18n.t("未启用")}</Badge></span>
      </div>
      {!jobs.length ? <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-muted-foreground"><Brain className="h-10 w-10 opacity-30" /><p className="text-sm">{data.jobs.length ? i18n.t("没有匹配的任务") : i18n.t("暂无任务")}</p>{data.jobs.length > 0 && <Button variant="outline" size="sm" onClick={() => {setQuery('');setStatus('all')}}>{i18n.t("清除筛选")}</Button>}</CardContent></Card> : <div className="space-y-3">{jobs.map(job => <Card key={job.id}><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 break-words text-sm font-medium">{job.label || job.id}</h2><Badge variant={job.enabled ? 'success' : 'secondary'}>{job.enabled ? i18n.t("已启用") : i18n.t("已暂停")}</Badge>{job.state.lastStatus && <Badge variant={job.state.lastStatus === 'error' ? 'destructive' : job.state.lastStatus === 'ok' ? 'success' : 'secondary'}>{job.state.lastStatus === 'error' ? i18n.t("执行失败") : job.state.lastStatus === 'ok' ? i18n.t("执行成功") : job.state.lastStatus === 'skipped' ? i18n.t("已跳过") : job.state.lastStatus}</Badge>}</div>
        {job.state.lastError && <div className="console-job-error" role="note"><p>{explainJobError(job.state.lastError, i18n.locale) ?? job.state.lastError}</p>{explainJobError(job.state.lastError, i18n.locale) ? <code>{job.state.lastError}</code> : null}{/endpoint/i.test(job.state.lastError) ? <Link to="/endpoints">{i18n.t("查看聊天账号 →")}</Link> : null}</div>}
        {job.state.nextRunAtMs != null && <p className="text-xs text-muted-foreground">{i18n.t("下次执行：")}{new Date(job.state.nextRunAtMs).toLocaleString(i18n.locale)}</p>}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t("任务详情")}</summary><div className="mt-3 space-y-3"><p>{i18n.t("编号：")}{job.id}</p>{job.createdAt != null && <p>{i18n.t("创建时间：")}{new Date(job.createdAt).toLocaleString(i18n.locale)}</p>}{job.state.nextRunAtMs != null && <p>{i18n.t("下次执行：")}{new Date(job.state.nextRunAtMs).toLocaleString(i18n.locale)}</p>}<details><summary className="cursor-pointer">{i18n.t("原始数据")}</summary><div className="mt-2"><JsonViewer value={job} /></div></details></div></details>
      </CardContent></Card>)}</div>}
    </> : null}
  </PageShell>
}

export async function probeAssistantEnabled(locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<boolean> {
  return probeAssistantJobs(() => apiFetch('/api/assistant/jobs'), locale)
}
