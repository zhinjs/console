import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  FileCheck2,
  FolderKanban,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  TimerReset,
  UserRoundCog,
  Workflow,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { apiFetch } from '../utils/auth'
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

type RunStatus = 'active' | 'blocked' | 'needs_replan' | 'cancelling' | 'completed' | 'cancelled'
type TaskStatus = 'ready' | 'blocked' | 'executing' | 'awaiting_acceptance' | 'cancelling' | 'accepted' | 'failed' | 'cancelled'
type AssignmentStatus = 'leased' | 'running' | 'cancel_requested' | 'execution_completed' | 'lost' | 'cancelled'

interface WorkroomBlocker {
  id: string
  kind: string
  owner: string
  reason: string
  deadline: number
  allowedActions: string[]
}

interface WorkroomTask {
  key: string
  title: string
  status: TaskStatus
  revision: number
  attempt: number
  maxAttempts: number
  required: boolean
  blockers: WorkroomBlocker[]
  currentAssignmentId?: string
  reportRef?: string
  reportDigest?: string
  candidateRef?: string
  candidateHash?: string
  completionReceiptDigest?: string
  currentReviewerAssignmentId?: string
  currentSponsorGateId?: string
  acceptanceBlockReason?: string
  terminalReason?: string
}

interface WorkroomAssignment {
  id: string
  taskKey: string
  taskRevision: number
  revision: number
  attempt: number
  fence: number
  envelopeDigest: string
  role: 'executor' | 'reviewer' | 'integration'
  status: AssignmentStatus
  owner: string
  leaseExpiresAt: number
  controlDeadline?: number
  checkpointRef?: string
  reportRef?: string
  reportDigest?: string
  candidateRef?: string
  candidateHash?: string
  completionReceiptDigest?: string
  latestProgress?: { summary: string; completedUnits?: number; totalUnits?: number }
  observationDigests: Record<string, string>
  outcome?: 'interrupted' | 'committed' | 'outcome_unknown'
}

interface WorkroomAcceptanceWait {
  id: string
  taskKey: string
  taskRevision: number
  candidateHash: string
  riskTier: 'low' | 'medium' | 'high' | 'critical'
  route: 'reviewer_required' | 'sponsor_required' | 'reviewer_then_sponsor'
  contractId: string
  owner: string
  deadline: number
  allowedActions: string[]
  status: string
  evaluation: {
    disposition: 'accepted' | 'rework' | 'policy_blocked'
    route: string
    decidedBy: string
    reason?: string
    riskAssessment: { tier: 'low' | 'medium' | 'high' | 'critical' }
  }
  reviewerPrincipalId?: string
  sponsorPrincipalId?: string
  authorizationRef?: string
  verdict?: Record<string, unknown>
  decisionReason?: string
}

interface WorkroomRun {
  runId: string
  projectId: string
  title: string
  status: RunStatus
  sequence: number
  now: number
  cancelRequested: boolean
  tasks: Record<string, WorkroomTask>
  assignments: Record<string, WorkroomAssignment>
  reviewerAssignments: Record<string, WorkroomAcceptanceWait>
  sponsorGates: Record<string, WorkroomAcceptanceWait>
}

interface RunsEnvelope {
  projectId: string
  runs: WorkroomRun[]
}

const RECENT_PROJECTS_KEY = 'zhin.console.workroom.projects'
const ACTIVE_RUN_STATUSES = new Set<RunStatus>(['active', 'blocked', 'needs_replan', 'cancelling'])

function readRecentProjects(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RECENT_PROJECTS_KEY) ?? '[]') as unknown
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
    localStorage.setItem(RECENT_PROJECTS_KEY, JSON.stringify(next))
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
  const [runs, setRuns] = useState<WorkroomRun[]>([])
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
    }
    background ? setRefreshing(true) : setLoading(true)
    setError(null)
    try {
      const response = await apiFetch(
        `${CONSOLE_REST.WORKROOM_RUNS}?projectId=${encodeURIComponent(normalized)}`,
        { signal: controller.signal },
      )
      const data = await readStrictJson<RunsEnvelope>(response)
      if (controller.signal.aborted) return
      setProjectId(data.projectId)
      setProjectInput(data.projectId)
      setRuns(data.runs)
      setRecentProjects(rememberProject(data.projectId))
      setSelectedRun((current) => {
        if (!current) return null
        return data.runs.find((run) => run.runId === current.runId) ?? null
      })
    } catch (caught) {
      if (!controller.signal.aborted) {
        if (!background) {
          setRuns([])
          setSelectedRun(null)
        }
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

  const totals = useMemo(() => {
    const tasks = runs.flatMap((run) => Object.values(run.tasks))
    const assignments = runs.flatMap((run) => Object.values(run.assignments))
    return {
      activeRuns: runs.filter((run) => ACTIVE_RUN_STATUSES.has(run.status)).length,
      tasks: tasks.length,
      blocked: tasks.filter((task) => task.status === 'blocked').length,
      assignments: assignments.length,
    }
  }, [runs])

  return (
    <PageShell className="max-w-[1680px]">
      <PageHeader
        title="Workroom 任务看板"
        description="按 Project 读取 Workroom Journal 投影，观察 Run、Task、Assignment 与阻塞事实；规划与披露初始化通过显式治理动作发布。"
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
                placeholder="project-alpha"
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

      {projectId ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label="Workroom 摘要">
          <Metric icon={Workflow} label="Runs" value={runs.length} detail={`${totals.activeRuns} 个仍在运行`} />
          <Metric icon={FolderKanban} label="Tasks" value={totals.tasks} detail="Journal 中的任务事实" />
          <Metric icon={AlertTriangle} label="Blocked" value={totals.blocked} detail="等待依赖、审批或输入" tone={totals.blocked ? 'warning' : 'success'} />
          <Metric icon={UserRoundCog} label="Assignments" value={totals.assignments} detail="Executor / Reviewer / Integration" />
        </section>
      ) : null}

      {loading ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
          <Skeleton className="h-[34rem] rounded-xl" />
          <Skeleton className="h-[34rem] rounded-xl" />
        </div>
      ) : projectId ? (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(19rem,0.72fr)_minmax(0,1.28fr)]">
          <section className="console-dashboard-panel overflow-hidden" aria-labelledby="workroom-runs-title">
            <div className="console-panel-heading px-4 pt-4 sm:px-5 sm:pt-5">
              <div>
                <span className="console-eyebrow">{projectId}</span>
                <h2 id="workroom-runs-title">Run 时间线</h2>
                <p>选择一个 Run 查看任务、租约和交付证据。</p>
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
                      <p className="truncate text-sm font-semibold">{run.title || '未命名 Run'}</p>
                      <code className="mt-1 block truncate text-[10px] text-muted-foreground">{run.runId}</code>
                    </div>
                    <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
                  </div>
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{Object.keys(run.tasks).length} tasks</span>
                    <span>{Object.keys(run.assignments).length} assignments</span>
                    <span>{Object.keys(run.reviewerAssignments ?? {}).length + Object.keys(run.sponsorGates ?? {}).length} waits</span>
                    <span className="ml-auto">seq {run.sequence}</span>
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
            title="输入 Project ID 开始"
            description="Workroom 是 Project-scoped 的事件流；Console 不猜测项目，也不从会话标识反推归属。"
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
        description="Run Journal 包含 Project 交付、审批与执行租约事实，仅向已认证的 full principal 开放。"
        actions={<Button asChild variant="outline" size="sm"><Link to="/agent/workrooms/catalog"><Settings2 />查看公开目录</Link></Button>}
      />
      <div className="console-dashboard-panel flex min-h-[28rem] items-center justify-center p-6">
        <EmptyState title="任务投影仅限私有控制台" description="Demo 不请求 Run / Task / Assignment 详情；你仍可查看只读 Workroom Catalog，了解空间、Bot 与 Agent 的映射。" />
      </div>
    </PageShell>
  )
}

export default function WorkroomsPage() {
  return isDemoMode() ? <DemoWorkroomBoardPage /> : <WorkroomBoardPage />
}

function RunDetail({ run }: { run: WorkroomRun }) {
  const tasks = Object.values(run.tasks)
  const assignments = Object.values(run.assignments)
  const reviewerAssignments = Object.values(run.reviewerAssignments ?? {})
  const sponsorGates = Object.values(run.sponsorGates ?? {})
  return (
    <div className="space-y-5 p-4 sm:p-5">
      <header className="border-b pb-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <span className="console-eyebrow">Run detail</span>
            <h2 id="workroom-detail-title" className="mt-1 text-xl font-semibold">{run.title || '未命名 Run'}</h2>
            <code className="mt-1 block break-all text-[11px] text-muted-foreground">{run.runId}</code>
          </div>
          <Badge variant={statusVariant(run.status)}>{run.status}</Badge>
        </div>
        <div className="mt-4 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
          <span><Clock3 className="mr-1 inline h-3.5 w-3.5" />逻辑时钟 {formatTime(run.now)}</span>
          <span>Sequence {run.sequence}</span>
          <span>{run.cancelRequested ? '已请求取消' : '未请求取消'}</span>
        </div>
      </header>

      <section aria-labelledby="workroom-tasks-title">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="workroom-tasks-title" className="text-sm font-semibold">Tasks</h3>
          <Badge variant="outline">{tasks.length}</Badge>
        </div>
        <div className="space-y-2">
          {tasks.map((task) => (
            <article key={task.key} className="rounded-lg border p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{task.title}</p>
                  <code className="text-[10px] text-muted-foreground">{task.key} · rev {task.revision}</code>
                </div>
                <Badge variant={statusVariant(task.status)}>{task.status}</Badge>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>attempt {task.attempt}/{task.maxAttempts}</span>
                <span>{task.required ? 'required' : 'optional'}</span>
                {task.currentAssignmentId ? <span>assignment {task.currentAssignmentId}</span> : null}
              </div>
              {task.blockers.length ? (
                <div className="mt-3 space-y-1.5">
                  {task.blockers.map((blocker) => (
                    <div key={blocker.id} className="rounded-md border border-amber-500/25 bg-amber-500/[0.06] px-2.5 py-2 text-xs">
                      <div className="flex flex-wrap items-center gap-2"><AlertTriangle className="h-3.5 w-3.5 text-amber-600" /><strong>{blocker.kind}</strong><span className="text-muted-foreground">owner {blocker.owner}</span></div>
                      <p className="mt-1 text-muted-foreground">{blocker.reason}</p>
                      <p className="mt-1 text-[10px] text-muted-foreground">deadline {formatTime(blocker.deadline)}</p>
                    </div>
                  ))}
                </div>
              ) : null}
              {task.reportRef ? <EvidenceRef icon={FileCheck2} label="Report" value={task.reportRef} /> : null}
              {task.candidateRef ? <EvidenceRef icon={ShieldCheck} label="Candidate" value={task.candidateRef} /> : null}
              {task.acceptanceBlockReason ? <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Acceptance: {task.acceptanceBlockReason}</p> : null}
              {task.terminalReason ? <p className="mt-2 text-xs text-destructive">{task.terminalReason}</p> : null}
            </article>
          ))}
          {tasks.length === 0 ? <EmptyState compact title="尚未规划 Task" /> : null}
        </div>
      </section>

      <section aria-labelledby="workroom-assignments-title">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="workroom-assignments-title" className="text-sm font-semibold">Assignments</h3>
          <Badge variant="outline">{assignments.length}</Badge>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {assignments.map((assignment) => (
            <article key={assignment.id} className="rounded-lg border p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{assignment.owner}</p>
                  <p className="text-[11px] text-muted-foreground">{assignment.role} · {assignment.taskKey}</p>
                </div>
                <Badge variant={statusVariant(assignment.status)}>{assignment.status}</Badge>
              </div>
              <div className="mt-3 space-y-1 text-[11px] text-muted-foreground">
                <p><TimerReset className="mr-1 inline h-3.5 w-3.5" />lease {formatTime(assignment.leaseExpiresAt)}</p>
                <p>task rev {assignment.taskRevision} · attempt {assignment.attempt}</p>
                {assignment.outcome ? <p>outcome {assignment.outcome}</p> : null}
                <p>assignment rev {assignment.revision} · fence {assignment.fence}</p>
              </div>
              {assignment.latestProgress ? (
                <div className="mt-2 rounded-md bg-muted/35 px-2.5 py-2 text-xs">
                  <p>{assignment.latestProgress.summary}</p>
                  {assignment.latestProgress.totalUnits ? <p className="mt-1 text-[10px] text-muted-foreground">{assignment.latestProgress.completedUnits ?? 0} / {assignment.latestProgress.totalUnits}</p> : null}
                </div>
              ) : null}
              {assignment.checkpointRef ? <EvidenceRef icon={ShieldCheck} label="Checkpoint" value={assignment.checkpointRef} /> : null}
              {assignment.reportRef ? <EvidenceRef icon={CheckCircle2} label="Report" value={assignment.reportRef} /> : null}
            </article>
          ))}
          {assignments.length === 0 ? <EmptyState compact title="尚无 Assignment" /> : null}
        </div>
      </section>

      <section aria-labelledby="workroom-acceptance-title">
        <div className="mb-2 flex items-center justify-between">
          <h3 id="workroom-acceptance-title" className="text-sm font-semibold">Acceptance waits</h3>
          <Badge variant="outline">{reviewerAssignments.length + sponsorGates.length}</Badge>
        </div>
        <div className="grid gap-2 lg:grid-cols-2">
          {reviewerAssignments.map((wait) => <AcceptanceWait key={wait.id} kind="Reviewer" wait={wait} />)}
          {sponsorGates.map((wait) => <AcceptanceWait key={wait.id} kind="Sponsor" wait={wait} />)}
          {!reviewerAssignments.length && !sponsorGates.length ? <EmptyState compact title="当前没有 Reviewer / Sponsor 等待项" /> : null}
        </div>
      </section>
    </div>
  )
}

function AcceptanceWait(props: { kind: 'Reviewer' | 'Sponsor'; wait: WorkroomAcceptanceWait }) {
  const { wait } = props
  return (
    <article className="rounded-lg border p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0"><p className="text-sm font-medium">{props.kind} · {wait.taskKey}</p><code className="text-[10px] text-muted-foreground">{wait.id}</code></div>
        <Badge variant={statusVariant(wait.status)}>{wait.status}</Badge>
      </div>
      <div className="mt-3 grid gap-1 text-[11px] text-muted-foreground sm:grid-cols-2">
        <span>risk {wait.riskTier}</span><span>route {wait.route}</span>
        <span>owner {wait.owner}</span><span>deadline {formatTime(wait.deadline)}</span>
        <span>decision {wait.evaluation.disposition}</span><span>by {wait.evaluation.decidedBy}</span>
      </div>
      {(wait.decisionReason || wait.evaluation.reason) ? <p className="mt-2 text-xs">{wait.decisionReason ?? wait.evaluation.reason}</p> : null}
      {wait.allowedActions.length ? <div className="mt-2 flex flex-wrap gap-1">{wait.allowedActions.map((action) => <Badge key={action} variant="outline">{action}</Badge>)}</div> : null}
      {wait.verdict ? <pre className="mt-2 max-h-32 overflow-auto rounded-md bg-muted/35 p-2 text-[10px]">{JSON.stringify(wait.verdict, null, 2)}</pre> : null}
    </article>
  )
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

function EvidenceRef(props: { icon: typeof FileCheck2; label: string; value: string }) {
  const Icon = props.icon
  return (
    <div className="mt-2 flex min-w-0 items-center gap-1.5 rounded-md bg-muted/35 px-2 py-1.5 text-[11px] text-muted-foreground">
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span>{props.label}</span>
      <code className="min-w-0 flex-1 truncate text-foreground" title={props.value}>{props.value}</code>
      <ArrowRight className="h-3.5 w-3.5 shrink-0" />
    </div>
  )
}
