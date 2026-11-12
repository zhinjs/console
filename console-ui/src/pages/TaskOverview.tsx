import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { RefreshCw } from 'lucide-react'
import { useI18n } from '../i18n'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table'
import { StatusState } from '../components/StatusState'
import { apiFetch } from '../utils/auth'
import { requestConsole } from '../utils/console-rpc'
import { pluginRpc } from '../utils/plugin-rpc'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { CONSOLE_REST, CONSOLE_RPC } from '../contracts/zhin-console'
import { readTaskProviders } from './task-center-model.mjs'
import { validateAssistantJobs } from './assistant-jobs-model.mjs'
import { readToolApprovals } from './tool-approvals-model.mjs'
import { taskTabHref } from './task-hub-model.mjs'
import { filterTaskOverview, TASK_OVERVIEW_FILTERS, taskOverviewRows, type TaskOverviewFilter, type TaskOverviewRow, type TaskOverviewSources } from './task-overview-model.mjs'
import './insights/insights.css'

const READ_TIMEOUT_MS = 8_000
const SOURCE_LABELS: Record<string, string> = { admin: '管理员任务', schedule: '定时提醒', assistant: '助手任务', approvals: '工具审批' }

/**
 * 「全部任务」：四个来源各读一次，任一失败只在顶部列出，其余照常显示。
 * 按类型看由上方页签负责，这里只按状态筛（需要处理 / 已暂停），类型作为表格的一列。
 */
export function TaskOverview({ connectionScope }: { connectionScope: string }) {
  const i18n = useI18n()
  const [sources, setSources] = useState<TaskOverviewSources | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<TaskOverviewFilter>('all')
  const approvalsReadable = hasConsolePermission('agent.configure')

  const load = useCallback(async () => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    setLoading(true)
    const signal = AbortSignal.timeout(READ_TIMEOUT_MS)
    const readJson = async (path: string) => {
      const response = await apiFetch(path, { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<unknown>
    }
    const settle = <T,>(promise: Promise<T>) => promise.catch(() => null)
    const [admin, schedules, assistant, approvals] = await Promise.all([
      settle(readJson(`${CONSOLE_REST.TASK_PROVIDERS}?locale=${i18n.locale}`).then(body => readTaskProviders(body, i18n.locale))),
      settle(requestConsole<NonNullable<TaskOverviewSources['schedules']>>({ type: CONSOLE_RPC.SCHEDULE_LIST })),
      settle(readJson('/api/assistant/jobs').then(body => validateAssistantJobs(body, i18n.locale))),
      approvalsReadable ? settle(pluginRpc('root', 'tool-approvals', undefined, { signal }).then(readToolApprovals)) : Promise.resolve(undefined),
    ])
    if (!isInboxCacheScopeActive(connectionScope)) return
    setSources({ admin, schedules, assistant, ...(approvals === undefined ? {} : { approvals }) } as TaskOverviewSources)
    setLoading(false)
  }, [connectionScope, i18n, approvalsReadable])

  useEffect(() => { void load() }, [load])

  if (loading && !sources) return <div className="space-y-2" aria-label={i18n.t("正在读取任务")}><Skeleton className="h-10" /><Skeleton className="h-40" /></div>
  const { rows, unavailable } = taskOverviewRows(sources ?? {}, i18n.locale)
  const shown = filterTaskOverview(rows, filter)
  const time = (value: number | null | undefined) => value ? new Date(value).toLocaleString(i18n.locale) : '—'
  const allFailed = unavailable.length >= 3 && rows.length === 0

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label={i18n.t("按状态筛选")}>
          {TASK_OVERVIEW_FILTERS.map(option => {
            const count = filterTaskOverview(rows, option.id).length
            return (
              <Button key={option.id} size="sm" variant={filter === option.id ? 'secondary' : 'ghost'} aria-pressed={filter === option.id} onClick={() => setFilter(option.id)}>
                {i18n.t(option.label)} <span className="tabular-nums text-muted-foreground">{count}</span>
              </Button>
            )
          })}
        </div>
        <span className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
      </div>
      {unavailable.length && !allFailed ? (
        <p className="text-xs text-[hsl(var(--warning))]" role="status">
          {i18n.t("未能读取：{0}。这些来源的任务没有列出，不代表没有任务。", [unavailable.map(id => i18n.t(SOURCE_LABELS[id] ?? id)).join(' · ')])}
        </p>
      ) : null}
      {allFailed ? (
        <StatusState kind="error" title={i18n.t("任务暂时读不到")} description={i18n.t("管理员任务、定时提醒和助手任务都没有读到；连接恢复后刷新。")} onRetry={() => void load()} />
      ) : !shown.length ? (
        filter === 'all' ? (
          <StatusState kind="empty" title={i18n.t("还没有任务")}
            description={i18n.t("管理员任务在「管理员任务」页签创建；定时提醒由插件或 AI 助手创建。")}
            actions={<Button asChild size="sm" variant="outline"><Link to={taskTabHref('admin')}>{i18n.t("创建管理员任务")}</Link></Button>} />
        ) : (
          <StatusState kind="empty" title={filter === 'attention' ? i18n.t("没有需要处理的任务") : i18n.t("没有已暂停的任务")}
            description={filter === 'attention'
              ? i18n.t("运行失败、结果不确定的任务和等待审批的工具调用会列在这里。")
              : i18n.t("暂停的任务会列在这里，到它所在的页签恢复。")}
            actions={<Button size="sm" variant="outline" onClick={() => setFilter('all')}>{i18n.t("查看全部任务")}</Button>} />
        )
      ) : (
        <>
          <Card className="console-task-overview-table overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{i18n.t("任务")}</TableHead>
                  <TableHead>{i18n.t("类型")}</TableHead>
                  <TableHead>{i18n.t("状态")}</TableHead>
                  <TableHead>{i18n.t("下次运行")}</TableHead>
                  <TableHead>{i18n.t("最近结果")}</TableHead>
                  <TableHead>{i18n.t("目标")}</TableHead>
                  <TableHead>{i18n.t("审批")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {shown.map(row => (
                  <TableRow key={row.key}>
                    <TableCell className="max-w-[18rem]">
                      <Link className="font-medium underline-offset-2 hover:underline" to={taskTabHref(row.tab)}>{row.title}</Link>
                      {row.detail ? <span className="console-task-overview-sub">{row.detail}</span> : null}
                    </TableCell>
                    <TableCell>{row.typeLabel}</TableCell>
                    <TableCell><Badge variant={row.status.tone}>{row.status.label}</Badge></TableCell>
                    <TableCell className="whitespace-nowrap text-sm">{row.type === 'approval' ? '—' : time(row.nextRunAt)}</TableCell>
                    <TableCell><LastResult row={row} time={time} /></TableCell>
                    <TableCell className="max-w-[16rem]"><TargetCell row={row} /></TableCell>
                    <TableCell className="max-w-[14rem] text-xs text-muted-foreground">{row.approval ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
          <div className="console-task-overview-cards">
            {shown.map(row => (
              <dl key={row.key} className="console-task-overview-card">
                <h3><Link to={taskTabHref(row.tab)}>{row.title}</Link></h3>
                <dt>{i18n.t("类型")}</dt><dd>{row.typeLabel}</dd>
                <dt>{i18n.t("状态")}</dt><dd><Badge variant={row.status.tone}>{row.status.label}</Badge></dd>
                {row.type !== 'approval' ? <><dt>{i18n.t("下次运行")}</dt><dd>{time(row.nextRunAt)}</dd></> : null}
                <dt>{i18n.t("最近结果")}</dt><dd><LastResult row={row} time={time} /></dd>
                <dt>{i18n.t("目标")}</dt><dd><TargetCell row={row} /></dd>
                {row.approval ? <><dt>{i18n.t("审批")}</dt><dd>{row.approval}</dd></> : null}
              </dl>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function LastResult({ row, time }: { row: TaskOverviewRow; time: (value: number | null | undefined) => string }) {
  if (!row.lastResult) return <span className="text-muted-foreground">—</span>
  return <span><Badge variant={row.lastResult.tone}>{row.lastResult.label}</Badge>{row.lastResult.at ? <span className="console-task-overview-sub">{time(row.lastResult.at)}</span> : null}</span>
}

function TargetCell({ row }: { row: TaskOverviewRow }) {
  if (!row.target) return <span className="text-muted-foreground">—</span>
  const code = <code className="break-all text-xs" title={row.target}>{row.target}</code>
  return row.targetHref ? <Link className="underline-offset-2 hover:underline" to={row.targetHref}>{code}</Link> : code
}
