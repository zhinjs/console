import { useCallback, useEffect, useState } from 'react'
import { Brain, AlertCircle, RefreshCw, Loader2 } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { PageHeader } from '../components/PageHeader'
import { ErrorAlert } from '../components/error-alert'
import { Card, CardContent } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { cn } from '@zhin.js/client'

interface AssistantJob {
  id?: string
  name?: string
  status?: string
  createdAt?: number
  [key: string]: unknown
}

interface AssistantJobsResponse {
  jobs?: AssistantJob[]
  eventsActive?: boolean
  [key: string]: unknown
}

export default function AssistantJobsPage() {
  const [data, setData] = useState<AssistantJobsResponse | null>(null)
  const [jobs, setJobs] = useState<AssistantJob[]>([])
  const [loading, setLoading] = useState(true)
  const [notEnabled, setNotEnabled] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchJobs = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNotEnabled(false)
    try {
      const res = await apiFetch('/api/assistant/jobs')
      if (res.status === 404) {
        setNotEnabled(true)
        setData(null)
        setJobs([])
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }
      const body = await res.json()
      if (!body.success) throw new Error(body.error ?? '加载失败')
      const payload = (body.data ?? body) as AssistantJobsResponse
      setData(payload)
      const list = Array.isArray(payload.jobs)
        ? payload.jobs
        : Array.isArray(payload)
          ? (payload as unknown as AssistantJob[])
          : Array.isArray(body.data)
            ? body.data
            : []
      setJobs(list)
    } catch (err) {
      setError((err as Error).message)
      setJobs([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchJobs()
  }, [fetchJobs])

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
      </div>
    )
  }

  if (notEnabled) {
    return (
      <div className="space-y-6">
        <PageHeader title="助手任务" description="查看 Host 助手模块的任务列表（未启用时不显示此菜单）。" />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-16">
            <Brain className="w-12 h-12 text-muted-foreground/40" />
            <h3 className="text-lg font-semibold">助手未启用</h3>
            <p className="text-sm text-muted-foreground text-center max-w-md">
              当前 Host 未启用助手模块（<code>assistant.enabled=false</code> 或接口返回 404）。
            </p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="助手任务"
        description="查看助手任务列表与事件通道状态"
        actions={
          <Button variant="outline" size="sm" onClick={() => fetchJobs()} disabled={loading}>
            <RefreshCw className={cn('w-4 h-4 mr-1', loading && 'animate-spin')} />
            刷新
          </Button>
        }
      />

      {error && (
        <ErrorAlert error={error} onRetry={fetchJobs} />
      )}

      {data && typeof data.eventsActive === 'boolean' && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">eventsActive:</span>
          <Badge variant={data.eventsActive ? 'success' : 'secondary'}>
            {data.eventsActive ? '活跃' : '未活跃'}
          </Badge>
        </div>
      )}

      {jobs.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-2 py-12 text-muted-foreground">
            <Brain className="w-10 h-10 opacity-30" />
            <span className="text-sm">暂无任务</span>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {jobs.map((job, idx) => (
            <Card key={job.id ?? idx} className="border-border/80">
              <CardContent className="p-4">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{job.name ?? job.id ?? `任务 ${idx + 1}`}</span>
                  {job.status && <Badge variant="outline">{String(job.status)}</Badge>}
                </div>
                {job.createdAt != null && (
                  <p className="text-xs text-muted-foreground mt-1">
                    创建: {new Date(job.createdAt).toLocaleString()}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}

/** 探测 Assistant 是否可用（非 404） */
export async function probeAssistantEnabled(): Promise<boolean> {
  try {
    const res = await apiFetch('/api/assistant/jobs')
    return res.status !== 404
  } catch {
    return false
  }
}
