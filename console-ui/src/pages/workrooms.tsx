import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  FolderKanban,
  RefreshCw,
  Search,
  Settings2,
  UserRoundCog,
  Workflow,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { apiFetch, getApiBase } from '../utils/auth'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ErrorAlert } from '../components/error-alert'
import { EmptyState } from '../components/empty-state'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { isDemoMode } from '../utils/demo-mode'
import { PlanningDisclosurePanel } from './workroom-planning'
import { runTotals, retainRunDetail, validateRuns, validateDetail } from './workroom-runs-model.mjs'

type RunStatus = 'active' | 'blocked' | 'needs_replan' | 'cancelling' | 'completed' | 'cancelled'
interface WorkroomRunSummary {
  projectId: string
  runId: string
  status: RunStatus
  sequence: number
  cancelRequested: boolean
  counts: { tasks: number; assignments: number; reviewerAssignments: number; sponsorGates: number }
}
interface WorkroomRun extends WorkroomRunSummary {
  tasks: { ref: string; status: string; revision: number; attempt: number; required: boolean; blockerCount: number; hasCurrentAssignment: boolean }[]
  assignments: { ref: string; taskRef: string; status: string; role: string; revision: number; attempt: number; fence: number; outcome?: string }[]
  blockers: { taskRef: string; blockerRef: string; kind: string; deadline?: number; allowedActions: string[] }[]
}
interface RunsEnvelope { projectId: string; runs: WorkroomRunSummary[] }

function recentProjectsKey(): string {
  return `zhin.console.workroom.projects:${encodeURIComponent(getApiBase())}`
}
const ACTIVE_RUN_STATUSES = new Set<RunStatus>(['active', 'blocked', 'needs_replan', 'cancelling'])

function readRecentProjects(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(recentProjectsKey()) ?? '[]') as unknown
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).slice(0, 8)
      : []
  } catch {
    return []
  }
}

function rememberProject(projectId: string): string[] {
  const next = [projectId, ...readRecentProjects().filter((item) => item !== projectId)].slice(0, 8)
  try {
    localStorage.setItem(recentProjectsKey(), JSON.stringify(next))
  } catch {
    // URL remains the durable deep link when browser storage is unavailable.
  }
  return next
}

function statusVariant(status: string): 'success' | 'secondary' | 'destructive' | 'outline' | 'warning' {
  if (status === 'completed' || status === 'accepted' || status === 'execution_completed') return 'success'
  if (status === 'failed' || status === 'lost') return 'destructive'
  if (status === 'blocked' || status === 'needs_replan' || status === 'cancelling' || status === 'cancel_requested') return 'warning'
  if (status === 'active' || status === 'executing' || status === 'running' || status === 'leased') return 'secondary'
  return 'outline'
}

function formatTime(value: number | undefined): string {
  if (!value || !Number.isFinite(value)) return '—'
  return new Date(value).toLocaleString()
}

async function readStrictJson<T>(response: Response): Promise<T> {
  const raw = await response.text()
  let body: { success: boolean; data?: T; error?: string }
  try {
    body = JSON.parse(raw) as { success: boolean; data?: T; error?: string }
  } catch {
    throw new Error(response.ok ? '服务端返回了无效 JSON' : `HTTP ${response.status}`)
  }
  if (!response.ok || body.success !== true || body.data === undefined) {
    throw new Error(body.error ?? `HTTP ${response.status}`)
  }
  return body.data
}

function WorkroomBoardPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const projectFromUrl = searchParams.get('projectId')?.trim() ?? ''
  const runFromUrl = searchParams.get('runId')?.trim() ?? ''
  const [projectInput, setProjectInput] = useState(projectFromUrl)
  const [projectId, setProjectId] = useState(projectFromUrl)
  const [recentProjects, setRecentProjects] = useState(readRecentProjects)
  const [runs, setRuns] = useState<WorkroomRunSummary[]>([])
  const [runsAvailable, setRunsAvailable] = useState(false)
  const [selectedRun, setSelectedRun] = useState<WorkroomRun | null>(null)
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [detailLoading, setDetailLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const listAbortRef = useRef<AbortController | null>(null)
  const detailAbortRef = useRef<AbortController | null>(null)

  const loadRuns = useCallback(async (target: string, background = false) => {
    const normalized = target.trim()
    if (!normalized) {
      setError('请输入 Workroom Project ID')
      return
    }
    listAbortRef.current?.abort()
    const controller = new AbortController()
    listAbortRef.current = controller
    if (!background) {
      setProjectId(normalized)
      setProjectInput(normalized)
      setRunsAvailable(false)
    }
    background ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(
        `${CONSOLE_REST.WORKROOM_RUNS}?projectId=${encodeURIComponent(normalized)}`,
        { signal: controller.signal },
      )
      const data = await readStrictJson<RunsEnvelope>(response)
      validateRuns(data)
      if (controller.signal.aborted) return
      setProjectId(data.projectId)
      setProjectInput(data.projectId)
      setRuns(data.runs)
      setRunsAvailable(true)
      setRecentProjects(rememberProject(data.projectId))
      setSelectedRun((current) => {
        if (!current) return null
        return retainRunDetail(current, data.runs)
      })
    } catch (caught) {
      if (!controller.signal.aborted) {
        setRuns([])
        setSelectedRun(null)
        setRunsAvailable(false)
        setError(caught instanceof Error ? caught.message : String(caught))
      }
    } finally {
      if (!controller.signal.aborted) {
        setLoading(false)
        setRefreshing(false)
      }
    }
  }, [])

  const loadRunDetail = useCallback(async (targetProjectId: string, runId: string) => {
    if (!targetProjectId) return
    detailAbortRef.current?.abort()
    const controller = new AbortController()
    detailAbortRef.current = controller
    setDetailLoading(true)
    setError(null)
    try {
      const response = await apiFetch(
        `${CONSOLE_REST.WORKROOM_RUNS}/${encodeURIComponent(runId)}?projectId=${encodeURIComponent(targetProjectId)}`,
        { signal: controller.signal },
      )
      const detail = await readStrictJson<WorkroomRun>(response)
      validateDetail(detail)
      if (!controller.signal.aborted) setSelectedRun(detail)
    } catch (caught) {
      if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : String(caught))
    } finally {
      if (!controller.signal.aborted) setDetailLoading(false)
    }
  }, [])

  useEffect(() => {
    if (projectFromUrl) {
      void loadRuns(projectFromUrl)
    } else {
      setProjectId('')
      setProjectInput('')
      setRuns([])
      setRunsAvailable(false)
      setSelectedRun(null)
      setError(null)
    }
  }, [loadRuns, projectFromUrl])

  useEffect(() => {
    if (!projectFromUrl || !runFromUrl) {
      setSelectedRun(null)
      return
    }
    void loadRunDetail(projectFromUrl, runFromUrl)
  }, [loadRunDetail, projectFromUrl, runFromUrl])

  useEffect(() => {
    return () => {
      listAbortRef.current?.abort()
      detailAbortRef.current?.abort()
    }
  }, [])

  const selectProject = useCallback((target: string) => {
    const normalized = target.trim()
    if (!normalized) return
    if (normalized === projectFromUrl && !runFromUrl) {
      void loadRuns(normalized)
      return
    }
    setSearchParams({ projectId: normalized })
  }, [loadRuns, projectFromUrl, runFromUrl, setSearchParams])

  const selectRun = useCallback((runId: string) => {
    if (!projectId) return
    if (runId === runFromUrl) {
      void loadRunDetail(projectId, runId)
      return
    }
    setSearchParams({ projectId, runId })
  }, [loadRunDetail, projectId, runFromUrl, setSearchParams])

  const hasActiveRuns = runs.some((run) => ACTIVE_RUN_STATUSES.has(run.status))
  useEffect(() => {
    if (!projectId || !hasActiveRuns) return
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadRuns(projectId, true)
    }, 5_000)
    return () => window.clearInterval(timer)
  }, [hasActiveRuns, loadRuns, projectId])

  const totals = useMemo(() => runTotals(runs), [runs])

  return (
    <PageShell className="max-w-[1680px]">
      <PageHeader
        title="Workroom 任务看板"
        description="查看项目运行、任务分配与阻塞情况；规划和权限初始化需要显式确认。"
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link to="/agent/workrooms/catalog"><Settings2 />配置 Workrooms</Link></Button>
            <Button variant="outline" size="sm" disabled={!projectId || loading || refreshing} onClick={() => void loadRuns(projectId, true)}><RefreshCw className={refreshing ? 'animate-spin' : ''} />刷新</Button>
          </div>
        }
      />

      <section className="console-dashboard-panel p-4 sm:p-5" aria-labelledby="workroom-project-title">
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end">
          <label className="block">
            <span id="workroom-project-title" className="mb-2 block text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Project ID
            </span>
            <div className="flex gap-2">
              <Input
                value={projectInput}
                onChange={(event) => setProjectInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') selectProject(projectInput)
                }}
                placeholder="填写 Workroom 配置中的 Project ID"
                aria-label="Workroom Project ID"
              />
              <Button disabled={loading || !projectInput.trim()} onClick={() => selectProject(projectInput)}>
                {loading ? <RefreshCw className="animate-spin" /> : <Search />}
                查询
              </Button>
            </div>
          </label>
          {recentProjects.length ? (
            <div className="flex max-w-2xl flex-wrap gap-1.5" aria-label="最近查询的 Project">
              {recentProjects.map((item) => (
                <button
                  key={item}
                  type="button"
                  className={cn(
                    'rounded-md border px-2.5 py-1.5 text-xs transition-colors hover:bg-muted',
                    item === projectId && 'border-primary/35 bg-primary/[0.06] text-primary',
                  )}
                  onClick={() => selectProject(item)}
                >
                  {item}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      </section>

      {error ? <ErrorAlert error={error} onRetry={projectInput.trim() ? () => loadRuns(projectInput) : undefined} /> : null}

      {projectId ? <PlanningDisclosurePanel projectId={projectId} /> : null}

      {projectId && runsAvailable ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workroom 摘要">
          <Metric icon={Workflow} label="运行" value={runs.length} detail={`${totals.activeRuns} 个仍在运行`} />
          <Metric icon={FolderKanban} label="任务" value={totals.tasks} detail="总任务数" />
          <Metric icon={AlertTriangle} label="阻塞运行" value={totals.blocked} detail="打开运行记录查看原因" tone={totals.blocked ? 'warning' : 'success'} />
          <Metric icon={UserRoundCog} label="执行分配" value={totals.assignments} detail="执行、审核与集成" />
        </section>
      ) : null}

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
          <Skeleton className="h-[34rem] rounded-xl" />
          <Skeleton className="h-[34rem] rounded-xl" />
        </div>
      ) : projectId && !runsAvailable ? (
        <div className="console-dashboard-panel flex min-h-[20rem] items-center justify-center p-6">
          <EmptyState
            title="无法读取 Workroom Run"
            description="无法读取此项目的运行记录。请检查连接与项目授权。"
          />
        </div>
      ) : projectId ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(19rem,0.72fr)_minmax(0,1.28fr)]">
          <section className="console-dashboard-panel overflow-hidden" aria-labelledby="workroom-runs-title">
            <div className="console-panel-heading px-4 pt-4 sm:px-5 sm:pt-5">
              <div>
                <span className="console-eyebrow">{projectId}</span>
                <h2 id="workroom-runs-title">Run 时间线</h2>
                <p>选择一条运行，查看任务状态、执行分配与阻塞项。</p>
              </div>
              {hasActiveRuns ? <Badge variant="secondary"><Activity className="mr-1 h-3 w-3" />Live</Badge> : null}
            </div>
            <div className="space-y-2 p-3 sm:p-4">
              {runs.map((run) => (
                <button
                  key={run.runId}
                  type="button"
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/45',
                    selectedRun?.runId === run.runId && 'border-primary/35 bg-primary/[0.055]',
                  )}
                  onClick={() => selectRun(run.runId)}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{run.runId}</p>
                    </div>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{run.counts.tasks} tasks</span>
                    <span>{run.counts.assignments} assignments</span>
                    <span>{run.counts.reviewerAssignments + run.counts.sponsorGates} waits</span>
                  </div>
                </button>
              ))}
              {runs.length === 0 ? (
                <EmptyState compact title="这个 Project 还没有 Run" description="WorkroomKernel 创建首个 Run 后会出现在这里。" />
              ) : null}
            </div>
          </section>

          <section className="console-dashboard-panel min-h-[34rem]" aria-labelledby="workroom-detail-title">
            {detailLoading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-28 rounded-lg" />
                <Skeleton className="h-28 rounded-lg" />
              </div>
            ) : selectedRun ? (
              <RunDetail run={selectedRun} />
            ) : (
              <div className="flex min-h-[34rem] items-center justify-center p-6">
                <EmptyState title="选择一个 Run" description="右侧将展示 Kernel 的 Task、Assignment、Blocker 与交付引用。" />
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="console-dashboard-panel flex min-h-[28rem] items-center justify-center p-6">
          <EmptyState
            title="选择要查看的 Workroom"
            description="打开「配置 Workrooms」，在已配置项目上点击「查看任务」，或填写其 Project ID 查询。这里只展示你有权限访问的项目。"
          />
        </div>
      )}
    </PageShell>
  )
}

function DemoWorkroomBoardPage() {
  return (
    <PageShell className="max-w-[1200px]">
      <PageHeader
        title="Workroom 任务看板"
        description="查看项目任务、审批与执行记录。"
        actions={<Button asChild variant="outline" size="sm"><Link to="/agent/workrooms/catalog"><Settings2 />查看公开目录</Link></Button>}
      />
      <div className="console-dashboard-panel flex min-h-[28rem] items-center justify-center p-6">
        <EmptyState title="任务详情需要项目授权" description="演示模式不提供任务详情。可查看项目目录。" />
      </div>
    </PageShell>
  )
}

export default function WorkroomsPage() {
  return isDemoMode() ? <DemoWorkroomBoardPage /> : <WorkroomBoardPage />
}

function RunDetail({ run }: { run: WorkroomRun }) {
  return <div className="space-y-5 p-4 sm:p-5">
    <header><h2 id="workroom-detail-title" className="text-lg font-semibold">运行详情</h2><Badge variant={statusVariant(run.status)}>{run.status}</Badge><p className="text-sm text-muted-foreground">{run.cancelRequested ? '已请求取消' : '未请求取消'}</p></header>
    <p className="text-sm text-muted-foreground">当前账号仅可查看任务状态，无法查看任务内容与证据。</p>
    <details className="rounded-lg border p-3 text-sm"><summary className="cursor-pointer font-medium">运行标识与版本</summary><p className="mt-2 break-all">Run ID：<code>{run.runId}</code> · Sequence {run.sequence}</p></details>
    <section><h3 className="text-sm font-semibold">任务 · {run.counts.tasks}</h3>{run.tasks.map((task,index) => <article key={task.ref} className="my-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2"><strong className="text-sm">任务 {index + 1}</strong><Badge variant={statusVariant(task.status)}>{task.status}</Badge></div>
      <p className="mt-2 text-sm text-muted-foreground">{task.required ? '必需' : '可选'} · {task.blockerCount} 个阻塞项 · {task.hasCurrentAssignment ? '已有执行分配' : '未分配执行'}</p>
      <details className="mt-2 text-sm"><summary className="cursor-pointer">任务技术标识</summary><p className="mt-2 break-all"><code>{task.ref}</code> · revision {task.revision} · attempt {task.attempt}</p></details>
    </article>)}{!run.tasks.length && <EmptyState compact title="尚无任务" />}</section>
    <section><h3 className="text-sm font-semibold">执行分配 · {run.counts.assignments}</h3>{run.assignments.map((item,index) => <article key={item.ref} className="my-2 rounded-lg border p-3">
      <div className="flex items-center justify-between gap-2"><strong className="text-sm">执行分配 {index + 1} · {item.role}</strong><Badge variant={statusVariant(item.status)}>{item.status}</Badge></div>
      {item.outcome ? <p className="mt-2 text-sm">{item.outcome}</p> : null}
      <details className="mt-2 text-sm"><summary className="cursor-pointer">执行分配技术标识</summary><p className="mt-2 break-all"><code>{item.ref}</code> · task <code>{item.taskRef}</code> · revision {item.revision} · attempt {item.attempt} · fence {item.fence}</p></details>
    </article>)}{!run.assignments.length && <EmptyState compact title="尚无执行分配" />}</section>
    <section><h3 className="text-sm font-semibold">阻塞项</h3>{run.blockers.map(item => <article key={item.blockerRef} className="my-2 rounded-lg border p-3"><strong className="text-sm">{item.kind}</strong><p className="text-sm">截止时间 {formatTime(item.deadline)}</p><p className="text-sm text-muted-foreground">允许动作：{item.allowedActions.join(' / ') || '无'}</p><details className="mt-2 text-sm"><summary className="cursor-pointer">阻塞项技术标识</summary><p className="mt-2 break-all">Task：<code>{item.taskRef}</code> · Blocker：<code>{item.blockerRef}</code></p></details></article>)}{!run.blockers.length && <EmptyState compact title="当前没有阻塞项" />}</section>
    <p className="text-sm text-muted-foreground">Reviewer 等待：{run.counts.reviewerAssignments} · Sponsor 等待：{run.counts.sponsorGates}（此接口仅提供计数）</p>
  </div>
}

function Metric(props: {
  icon: typeof Workflow
  label: string
  value: number
  detail: string
  tone?: 'warning' | 'success'
}) {
  const Icon = props.icon
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{props.label}</div>
        <strong className={cn('mt-2 block text-2xl', props.tone === 'warning' && 'text-amber-600', props.tone === 'success' && 'text-emerald-600')}>{props.value}</strong>
        <p className="mt-1 text-xs text-muted-foreground">{props.detail}</p>
      </CardContent>
    </Card>
  )
}
