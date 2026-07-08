import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Workflow, Loader2, History, ChevronDown, ChevronUp, RefreshCw } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import {
  agentSessionsPath,
  isLikelySessionKey,
  parseSessionKeyFromQuery,
} from '../utils/agent-session'
import {
  loadAgentSessionHistory,
  pushAgentSessionHistory,
} from '../utils/agent-session-history'
import { PageHeader } from '../components/PageHeader'
import { ErrorAlert } from '../components/error-alert'
import { EmptyState } from '../components/empty-state'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { cn } from '@zhin.js/client'

interface OrchestrationTask {
  taskId: string
  name: string
  status: string
  assignedTo?: string
  result?: string
}

interface OrchestrationRunSummary {
  runId: string
  status: 'running' | 'completed' | 'failed' | string
  source: { kind: string; sceneId?: string }
  tasks?: OrchestrationTask[]
  createdAt: number
}

interface OrchestrationRunDetail extends OrchestrationRunSummary {
  tasks: OrchestrationTask[]
  events?: unknown[]
}

function statusBadgeVariant(status: string): 'success' | 'secondary' | 'destructive' | 'outline' {
  switch (status) {
    case 'completed':
      return 'success'
    case 'running':
      return 'secondary'
    case 'failed':
      return 'destructive'
    default:
      return 'outline'
  }
}

function formatTimestamp(ts: number): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString()
}

export default function AgentOrchestrationPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const sessionKeyFromUrl = parseSessionKeyFromQuery(searchParams.get('sessionKey'))
  const [sessionKey, setSessionKey] = useState(sessionKeyFromUrl)
  const [history, setHistory] = useState<string[]>(() => loadAgentSessionHistory())
  const [runs, setRuns] = useState<OrchestrationRunSummary[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [runDetail, setRunDetail] = useState<OrchestrationRunDetail | null>(null)
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'none' | '404' | '503' | 'other'>('none')
  const [eventsExpanded, setEventsExpanded] = useState(false)

  const syncSessionKeyToUrl = useCallback(
    (key: string) => {
      const trimmed = key.trim()
      if (!trimmed) {
        setSearchParams({}, { replace: true })
        return
      }
      setSearchParams({ sessionKey: trimmed }, { replace: true })
    },
    [setSearchParams],
  )

  const fetchRuns = useCallback(async (key: string) => {
    const trimmed = key.trim()
    if (!trimmed) return
    setLoadingRuns(true)
    setError(null)
    setErrorKind('none')
    setRuns([])
    setSelectedRunId(null)
    setRunDetail(null)
    try {
      const params = new URLSearchParams({ sessionKey: trimmed })
      const res = await apiFetch(`/api/agent/orchestration/runs?${params}`)
      const body = await res.json()

      if (res.status === 404) {
        setErrorKind('404')
        setError(body.error ?? `未找到 session：${trimmed}`)
        return
      }
      if (res.status === 503) {
        setErrorKind('503')
        setError(body.error ?? 'Agent 未就绪')
        return
      }
      if (!res.ok || body.success === false) {
        setErrorKind('other')
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const payload = (body.data ?? body) as { runs?: OrchestrationRunSummary[] }
      setRuns(payload.runs ?? [])
      setHistory(pushAgentSessionHistory(trimmed))
      syncSessionKeyToUrl(trimmed)
    } catch (err) {
      setErrorKind('other')
      setError((err as Error).message)
    } finally {
      setLoadingRuns(false)
    }
  }, [syncSessionKeyToUrl])

  const fetchRunDetail = useCallback(async (runId: string, key: string) => {
    const trimmed = key.trim()
    if (!trimmed || !runId) return
    setLoadingDetail(true)
    setSelectedRunId(runId)
    setRunDetail(null)
    setEventsExpanded(false)
    try {
      const res = await apiFetch(`/api/agent/orchestration/runs/${encodeURIComponent(runId)}`)
      const body = await res.json()

      if (res.status === 404) {
        setErrorKind('404')
        setError(body.error ?? `未找到 run：${runId}`)
        return
      }
      if (res.status === 503) {
        setErrorKind('503')
        setError(body.error ?? 'Agent 未就绪')
        return
      }
      if (!res.ok || body.success === false) {
        setErrorKind('other')
        throw new Error(body.error ?? `HTTP ${res.status}`)
      }

      const detail = (body.data ?? body) as OrchestrationRunDetail
      setRunDetail(detail)
    } catch (err) {
      setErrorKind('other')
      setError((err as Error).message)
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  const handleLoad = () => {
    const trimmed = sessionKey.trim()
    if (!trimmed) return
    if (!isLikelySessionKey(trimmed)) {
      setErrorKind('other')
      setError(
        `sessionKey 格式不正确：「${trimmed}」。应为 platform:endpointId:scope:sceneId（如 icqq:75318:private:userA）`,
      )
      return
    }
    void fetchRuns(trimmed)
  }

  useEffect(() => {
    if (!sessionKeyFromUrl) return
    setSessionKey(sessionKeyFromUrl)
    if (isLikelySessionKey(sessionKeyFromUrl)) {
      void fetchRuns(sessionKeyFromUrl)
    } else {
      setErrorKind('other')
      setError(
        `sessionKey 格式不正确：「${sessionKeyFromUrl}」。应为 platform:endpointId:scope:sceneId（如 icqq:75318:private:userA）`,
      )
    }
  }, [sessionKeyFromUrl, fetchRuns])

  return (
    <div className="space-y-6">
      <PageHeader
        title="编排运行"
        description="查看多 Agent 编排运行状态与任务结果。sessionKey 格式为 platform:endpointId:scope:sceneId。"
        actions={
          sessionKey.trim() ? (
            <Link
              to={agentSessionsPath(sessionKey.trim())}
              className="inline-flex items-center justify-center h-8 rounded-md px-3 text-xs font-medium border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground"
            >
              对话分支
            </Link>
          ) : undefined
        }
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-[240px]">
              <Input
                placeholder="sessionKey（如 icqq:75318:private:userA）"
                value={sessionKey}
                onChange={(e) => setSessionKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
                list="agent-orchestration-history"
              />
              <datalist id="agent-orchestration-history">
                {history.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <Button onClick={handleLoad} disabled={loadingRuns || !sessionKey.trim()}>
              {loadingRuns ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <Workflow className="w-4 h-4 mr-1" />
              )}
              加载
            </Button>
          </div>

          {history.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">最近:</span>
              {history.slice(0, 5).map((k) => (
                <Button
                  key={k}
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2"
                  onClick={() => {
                    setSessionKey(k)
                    void fetchRuns(k)
                  }}
                >
                  {k}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {error && (
        <ErrorAlert
          error={error}
          kind={errorKind}
          onRetry={() => fetchRuns(sessionKey)}
        />
      )}

      {loadingRuns && (
        <div className="space-y-2">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full" />
          ))}
        </div>
      )}

      {!loadingRuns && runs.length === 0 && sessionKey.trim() && !error && (
        <EmptyState compact title="暂无编排运行" description="该 session 下尚未有编排 run 记录。" />
      )}

      {!loadingRuns && runs.length > 0 && (
        <Card>
          <CardContent className="p-4 space-y-2">
            <div className="flex items-center justify-between gap-2 mb-2">
              <h2 className="text-sm font-semibold">运行列表</h2>
              <span className="text-xs text-muted-foreground">{runs.length} 条</span>
            </div>
            {runs.map((run) => {
              const isSelected = selectedRunId === run.runId
              const taskCount = run.tasks?.length ?? 0
              return (
                <button
                  key={run.runId}
                  type="button"
                  onClick={() => void fetchRunDetail(run.runId, sessionKey)}
                  className={cn(
                    'w-full text-left p-3 rounded-lg border transition-colors',
                    isSelected
                      ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                      : 'border-border/60 hover:bg-muted/40 cursor-pointer',
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <code className="text-xs font-mono">{run.runId}</code>
                    <Badge variant={statusBadgeVariant(run.status)} className="text-[10px]">
                      {run.status}
                    </Badge>
                    {run.source?.kind && (
                      <Badge variant="outline" className="text-[10px]">
                        {run.source.kind}
                        {run.source.sceneId ? ` · ${run.source.sceneId}` : ''}
                      </Badge>
                    )}
                    <span className="text-xs text-muted-foreground ml-auto tabular-nums">
                      {formatTimestamp(run.createdAt)}
                    </span>
                  </div>
                  {taskCount > 0 && (
                    <p className="text-xs text-muted-foreground mt-1">{taskCount} 个任务</p>
                  )}
                </button>
              )
            })}
          </CardContent>
        </Card>
      )}

      {selectedRunId && (
        <Card>
          <CardContent className="p-4 space-y-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">
                Run 详情 · <code className="text-xs font-mono">{selectedRunId}</code>
              </h2>
              <Button
                variant="ghost"
                size="sm"
                disabled={loadingDetail}
                onClick={() => void fetchRunDetail(selectedRunId, sessionKey)}
              >
                <RefreshCw className={cn('w-4 h-4', loadingDetail && 'animate-spin')} />
              </Button>
            </div>

            {loadingDetail && (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            )}

            {runDetail && !loadingDetail && (
              <>
                <div className="flex flex-wrap gap-2 text-sm">
                  <Badge variant={statusBadgeVariant(runDetail.status)}>{runDetail.status}</Badge>
                  <span className="text-muted-foreground">
                    创建于 {formatTimestamp(runDetail.createdAt)}
                  </span>
                </div>

                {(runDetail.tasks ?? []).length === 0 ? (
                  <EmptyState compact title="暂无任务" />
                ) : (
                  <div className="space-y-2">
                    {(runDetail.tasks ?? []).map((task) => (
                      <div
                        key={task.taskId}
                        className="rounded-lg border border-border/60 p-3 space-y-1.5"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-sm font-medium">{task.name || task.taskId}</span>
                          <Badge variant={statusBadgeVariant(task.status)} className="text-[10px]">
                            {task.status}
                          </Badge>
                          {task.assignedTo && (
                            <Badge variant="outline" className="text-[10px]">
                              {task.assignedTo}
                            </Badge>
                          )}
                        </div>
                        {task.result && (
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap break-words line-clamp-4">
                            {task.result}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {runDetail.events && runDetail.events.length > 0 && (
                  <div className="border rounded-lg">
                    <button
                      type="button"
                      className="w-full flex items-center justify-between p-3 text-sm font-medium hover:bg-muted/40"
                      onClick={() => setEventsExpanded((v) => !v)}
                    >
                      <span>Events ({runDetail.events.length})</span>
                      {eventsExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    {eventsExpanded && (
                      <pre className="text-xs p-3 overflow-x-auto border-t bg-muted/20 max-h-64">
                        {JSON.stringify(runDetail.events, null, 2)}
                      </pre>
                    )}
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      )}

      {sessionKey.trim() && (
        <p className="text-xs text-muted-foreground">
          查看对话分支：
          <Link
            to={agentSessionsPath(sessionKey.trim())}
            className="text-primary underline-offset-4 hover:underline ml-1"
          >
            前往对话分支页
          </Link>
        </p>
      )}
    </div>
  )
}
