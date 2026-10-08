import { useState, useRef, useEffect } from 'react'
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
import { Skeleton } from '../components/ui/skeleton'
import { JsonViewer } from './introspection/JsonViewer'
import { validateAssistantJobs, filterAssistantJobs, probeAssistantJobs, type AssistantJobsResponse } from './assistant-jobs-model.mjs'

type JobRead = { unavailable: true } | { unavailable: false; data: AssistantJobsResponse }

export default function AssistantJobsPage() {
  const reportAvailability = useRef(assistantNavigation.capture())
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('all')
  const read = useConsoleRead<JobRead | null>(async () => {
    const response = await apiFetch('/api/assistant/jobs')
    if (response.status === 404) return { unavailable: true }
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    return { unavailable: false, data: validateAssistantJobs(await response.json()) }
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
    <PageHeader title="助手任务" actions={<Button variant="outline" size="sm" onClick={refresh} disabled={read.loading}><RefreshCw className={read.loading ? 'animate-spin' : ''} />刷新</Button>} />
    {read.error && <div><ErrorAlert error={readErrorSummary(read.error, '助手任务')} onRetry={refresh} />{read.loaded && <p className="mt-2 text-xs text-muted-foreground">以下为上次读取的任务。</p>}<details className="mt-2 text-xs text-muted-foreground"><summary className="cursor-pointer">错误详情</summary><p className="mt-2 break-all">{read.error}</p></details></div>}
    {read.loading && !read.loaded ? <Skeleton className="h-32 w-full" /> : read.data?.unavailable ? <Card><CardContent className="flex flex-col items-center gap-3 py-12"><Brain className="h-10 w-10 text-muted-foreground/40" /><h2 className="text-base font-medium">助手未启用</h2><p className="text-sm text-muted-foreground">启用助手后，可在这里查看任务。</p></CardContent></Card> : data ? <>
      <div className="flex flex-wrap items-center gap-3">
        <Input aria-label="搜索助手任务" placeholder="搜索名称或编号…" value={query} onChange={event => setQuery(event.target.value)} className="w-full sm:max-w-xs" />
        <select aria-label="助手任务状态" value={status} onChange={event => setStatus(event.target.value)} className="h-9 rounded-md border bg-background px-3 text-sm"><option value="all">全部状态</option><option value="enabled">已启用</option><option value="paused">已暂停</option><option value="error">执行失败</option></select>
        <span className="text-xs text-muted-foreground">事件接收 <Badge variant={data.eventsActive ? 'success' : 'secondary'}>{data.eventsActive ? '已启用' : '未启用'}</Badge></span>
      </div>
      {!jobs.length ? <Card><CardContent className="flex flex-col items-center gap-3 py-12 text-muted-foreground"><Brain className="h-10 w-10 opacity-30" /><p className="text-sm">{data.jobs.length ? '没有匹配的任务' : '暂无任务'}</p>{data.jobs.length > 0 && <Button variant="outline" size="sm" onClick={() => {setQuery('');setStatus('all')}}>清除筛选</Button>}</CardContent></Card> : <div className="space-y-3">{jobs.map(job => <Card key={job.id}><CardContent className="space-y-3 p-4">
        <div className="flex flex-wrap items-center gap-2"><h2 className="min-w-0 break-words text-sm font-medium">{job.label || job.id}</h2><Badge variant={job.enabled ? 'success' : 'secondary'}>{job.enabled ? '已启用' : '已暂停'}</Badge>{job.state.lastStatus && <Badge variant={job.state.lastStatus === 'error' ? 'destructive' : job.state.lastStatus === 'ok' ? 'success' : 'secondary'}>{job.state.lastStatus === 'error' ? '执行失败' : job.state.lastStatus === 'ok' ? '执行成功' : job.state.lastStatus === 'skipped' ? '已跳过' : job.state.lastStatus}</Badge>}</div>
        {job.state.lastError && <p className="break-words text-sm text-destructive">{job.state.lastError}</p>}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">任务详情</summary><div className="mt-3 space-y-3"><p>编号：{job.id}</p>{job.createdAt != null && <p>创建时间：{new Date(job.createdAt).toLocaleString()}</p>}{job.state.nextRunAtMs != null && <p>下次执行：{new Date(job.state.nextRunAtMs).toLocaleString()}</p>}<details><summary className="cursor-pointer">原始数据</summary><div className="mt-2"><JsonViewer value={job} /></div></details></div></details>
      </CardContent></Card>)}</div>}
    </> : null}
  </PageShell>
}

export async function probeAssistantEnabled(): Promise<boolean> {
  return probeAssistantJobs(() => apiFetch('/api/assistant/jobs'))
}
