import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Bot, CalendarClock, ClipboardList, History } from 'lucide-react'
import { useI18n } from '../i18n'
import { useSearchParams } from 'react-router-dom'
import { Alert, AlertDescription, PageHeader, PageShell, StatCard, StatGrid, Tabs, TabsContent, TabsList, TabsTrigger } from '@zhin.js/console-ui'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import TaskCenterPage from './task-center'
import CronPage from './cron'
import AssistantJobsPage from './assistant-jobs'
import { ScheduleExecutions } from './ScheduleExecutions'
import { TaskOverview } from './TaskOverview'
import { StatusState } from '../components/StatusState'
import { readableTaskTabs, resolveTaskTab, type TaskTabId } from './task-hub-model.mjs'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { apiFetch } from '../utils/auth'
import { executionQuery, readExecutionPage } from './schedule-executions-model.mjs'
import {
  summarizeAdminTasks,
  summarizeAssistantJobs,
  summarizeExecutions,
  summarizeOverviewSources,
  summarizeSchedules,
} from './task-hub-summary-model.mjs'
import type { TaskOverviewSources } from './task-overview-model.mjs'

const SUMMARY_TIMEOUT_MS = 8_000

interface TaskHubSummary {
  admin: ReturnType<typeof summarizeAdminTasks>
  schedule: ReturnType<typeof summarizeSchedules>
  assistant: ReturnType<typeof summarizeAssistantJobs>
  history: ReturnType<typeof summarizeExecutions>
}

/**
 * 近期执行 for its card: the one source the 全部任务 table does not read. The other cards come from
 * what the table read (`summarizeOverviewSources`), so 总览 reads each source once (#64
 * `task-hub-overview-double-read`). Re-read whenever 总览 is opened again (`refreshKey`), so the card
 * reflects what was just done in another tab; a failed read leaves the card at 「—」.
 */
function useRecentExecutions(scope: string | null | undefined, refreshKey: string): TaskHubSummary['history'] {
  const i18n = useI18n()
  const [history, setHistory] = useState<TaskHubSummary['history']>(null)
  useEffect(() => {
    if (!scope || !isInboxCacheScopeActive(scope)) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(SUMMARY_TIMEOUT_MS)])
    void apiFetch(executionQuery(), { signal, cache: 'no-store' })
      .then(response => { if (!response.ok) throw new Error(`HTTP ${response.status}`); return response.json() as Promise<unknown> })
      .then(body => summarizeExecutions(readExecutionPage(body, undefined, i18n.locale)))
      .catch(() => null)
      .then(next => { if (!controller.signal.aborted && isInboxCacheScopeActive(scope)) setHistory(next) })
    return () => controller.abort()
  }, [scope, refreshKey, i18n])
  return history
}

function HistoryPanel() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Alert><AlertDescription>{i18n.t("请连接 Host 后读取任务。")}</AlertDescription></Alert>
  return <ScheduleExecutions key={scope} connectionScope={scope} />
}

/**
 * 「全部任务」总览：上面是各来源的汇总（点卡片进对应页签做操作），下面是按状态筛选的统一列表。
 * 汇总只在总览里出现，不在每个页签上方重复一遍页签导航。
 */
function OverviewPanel({ history, sources, onSources, open }: {
  history: TaskHubSummary['history']
  /** What the 全部任务 table last read for this connection (null until it has); the cards are built from it. */
  sources: TaskOverviewSources | null
  onSources: (sources: TaskOverviewSources) => void
  open: (tab: TaskTabId) => void
}) {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  const summary: TaskHubSummary = { ...summarizeOverviewSources(sources, i18n.locale), history }
  if (!scope || !isInboxCacheScopeActive(scope)) return <StatusState kind="disconnected" />
  const unknown = '—'
  return <div className="space-y-4">
    <StatGrid label={i18n.t("任务概况")}>
      <StatCard
        icon={ClipboardList}
        label={i18n.t("管理员任务")}
        value={summary.admin?.total ?? unknown}
        sub={summary.admin
          ? summary.admin.failed > 0 ? i18n.t("{0} 个运行失败", [summary.admin.failed]) : i18n.t("{0} 个已暂停", [summary.admin.paused])
          : i18n.t("未启用或暂时无法读取")}
        tone={summary.admin && summary.admin.failed > 0 ? 'danger' : undefined}
        onOpen={() => open('admin')}
      />
      <StatCard
        icon={CalendarClock}
        label={i18n.t("定时提醒")}
        value={summary.schedule?.total ?? unknown}
        sub={summary.schedule
          ? summary.schedule.internal ? i18n.t("{0} 个已暂停 · 另有 {1} 个插件内部任务", [summary.schedule.paused, summary.schedule.internal]) : i18n.t("{0} 个已暂停", [summary.schedule.paused])
          : i18n.t("未启用或暂时无法读取")}
        onOpen={() => open('schedule')}
      />
      <StatCard
        icon={Bot}
        label={i18n.t("助手任务")}
        value={summary.assistant?.disabled ? unknown : summary.assistant?.total ?? unknown}
        sub={summary.assistant?.disabled ? i18n.t("未启用：{0}", [summary.assistant.disabled])
          : summary.assistant
          ? summary.assistant.failing > 0 ? i18n.t("{0} 个最近运行出错", [summary.assistant.failing])
            : summary.assistant.reminders ? i18n.t("另有 {0} 个来自定时提醒，已算在「定时提醒」里", [summary.assistant.reminders])
            : i18n.t("{0} 个已启用", [summary.assistant.enabled])
          : i18n.t("未启用或暂时无法读取")}
        tone={summary.assistant && summary.assistant.failing > 0 ? 'danger' : undefined}
        onOpen={() => open('assistant')}
      />
      <StatCard
        icon={History}
        label={i18n.t("近期执行")}
        value={summary.history ? `${summary.history.recent}${summary.history.hasMore ? '+' : ''}` : unknown}
        sub={summary.history
          ? summary.history.failed > 0 ? i18n.t("其中 {0} 次失败", [summary.history.failed]) : i18n.t("没有失败的执行")
          : i18n.t("未启用或暂时无法读取")}
        tone={summary.history && summary.history.failed > 0 ? 'danger' : undefined}
        onOpen={() => open('history')}
      />
    </StatGrid>
    <TaskOverview key={scope} connectionScope={scope} onSources={onSources} />
  </div>
}

export default function TaskHubPage() {
  const i18n = useI18n()
  const [params, setParams] = useSearchParams()
  // Only the tabs this identity can read; an unreadable ?tab= opens the first readable one.
  const tabs = readableTaskTabs(name => hasConsolePermission(name))
  const active = resolveTaskTab(params.get('tab'), tabs)
  const select = (next: string) => setParams({ tab: next })
  const scope = useInboxCacheScope()
  const history = useRecentExecutions(active === 'overview' ? scope : null, active)
  // Kept on the page, so returning to 总览 shows the last numbers while the table reads again; tagged
  // with its connection, so another connection never shows them.
  const [overviewRead, setOverviewRead] = useState<{ scope: string; sources: TaskOverviewSources } | null>(null)
  const onSources = useCallback((sources: TaskOverviewSources) => { if (scope) setOverviewRead({ scope, sources }) }, [scope])
  const overviewSources = overviewRead && overviewRead.scope === scope ? overviewRead.sources : null
  const panels: Record<TaskTabId, ReactNode> = {
    overview: <OverviewPanel history={history} sources={overviewSources} onSources={onSources} open={select} />, admin: <TaskCenterPage />, schedule: <CronPage />, assistant: <AssistantJobsPage />, history: <HistoryPanel />,
  }
  return <PageShell className="console-resource-page console-tasks-hub">
    <PageHeader title={i18n.t("定时任务")} description={i18n.t("「全部任务」汇总每个任务的状态、下次运行、最近结果、目标与审批；创建、暂停和查看记录在各自页签。")} />
    <Tabs value={active} onValueChange={select}>
      <TabsList aria-label={i18n.t("任务视图")} className="h-auto max-w-full justify-start overflow-x-auto whitespace-nowrap">
        {tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{i18n.t(tab.label)}</TabsTrigger>)}
      </TabsList>
      {tabs.map(tab => <TabsContent key={tab.id} value={tab.id}>{tab.id === active ? panels[tab.id] : null}</TabsContent>)}
    </Tabs>
  </PageShell>
}
