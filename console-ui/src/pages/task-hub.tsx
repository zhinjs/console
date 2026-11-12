import { useEffect, useState, type ReactNode } from 'react'
import { Bot, CalendarClock, ClipboardList, History } from 'lucide-react'
import { useI18n } from '../i18n'
import { useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import TaskCenterPage from './task-center'
import CronPage from './cron'
import AssistantJobsPage from './assistant-jobs'
import { ScheduleExecutions } from './ScheduleExecutions'
import { TaskOverview } from './TaskOverview'
import { StatusState } from '../components/StatusState'
import { PageShell } from '../components/PageShell'
import { resolveTaskTab, TASK_HUB_TABS, type TaskTabId } from './task-hub-model.mjs'
import { StatCard, StatGrid } from '../components/StatCard'
import { apiFetch } from '../utils/auth'
import { requestConsole } from '../utils/console-rpc'
import { CONSOLE_REST, CONSOLE_RPC } from '../contracts/zhin-console'
import { readTaskProviders } from './task-center-model.mjs'
import { validateAssistantJobs } from './assistant-jobs-model.mjs'
import { executionQuery, readExecutionPage } from './schedule-executions-model.mjs'
import {
  summarizeAdminTasks,
  summarizeAssistantJobs,
  summarizeExecutions,
  summarizeSchedules,
  type ScheduleListLike,
} from './task-hub-summary-model.mjs'

const SUMMARY_TIMEOUT_MS = 8_000

interface TaskHubSummary {
  admin: ReturnType<typeof summarizeAdminTasks>
  schedule: ReturnType<typeof summarizeSchedules>
  assistant: ReturnType<typeof summarizeAssistantJobs>
  history: ReturnType<typeof summarizeExecutions>
}

const EMPTY_SUMMARY: TaskHubSummary = { admin: null, schedule: null, assistant: null, history: null }

/**
 * 指标卡的汇总读取：四个来源互不依赖，任一失败只让对应卡片显示「—」。
 * 切换标签时重新读取，让卡片反映刚在标签页里做的修改。
 */
function useTaskHubSummary(scope: string | null | undefined, refreshKey: string): TaskHubSummary {
  const i18n = useI18n()
  const [summary, setSummary] = useState<TaskHubSummary>(EMPTY_SUMMARY)
  useEffect(() => {
    if (!scope || !isInboxCacheScopeActive(scope)) return
    const controller = new AbortController()
    const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(SUMMARY_TIMEOUT_MS)])
    const readJson = async (path: string) => {
      const response = await apiFetch(path, { signal, cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<unknown>
    }
    const settle = <T,>(promise: Promise<T>) => promise.catch(() => null)
    void Promise.all([
      settle(readJson(`${CONSOLE_REST.TASK_PROVIDERS}?locale=${i18n.locale}`).then(body => summarizeAdminTasks(readTaskProviders(body, i18n.locale)))),
      settle(requestConsole<ScheduleListLike>({ type: CONSOLE_RPC.SCHEDULE_LIST }).then(summarizeSchedules)),
      settle(readJson('/api/assistant/jobs').then(body => summarizeAssistantJobs(validateAssistantJobs(body, i18n.locale)))),
      settle(readJson(executionQuery()).then(body => summarizeExecutions(readExecutionPage(body, undefined, i18n.locale)))),
    ]).then(([admin, schedule, assistant, history]) => {
      if (!controller.signal.aborted && isInboxCacheScopeActive(scope)) setSummary({ admin, schedule, assistant, history })
    })
    return () => controller.abort()
  }, [scope, refreshKey, i18n])
  return summary
}

function HistoryPanel() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Alert><AlertDescription>{i18n.t("请连接 Host 后读取任务。")}</AlertDescription></Alert>
  return <ScheduleExecutions key={scope} connectionScope={scope} />
}

function OverviewPanel() {
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <StatusState kind="disconnected" />
  return <TaskOverview key={scope} connectionScope={scope} />
}

export default function TaskHubPage() {
  const i18n = useI18n()
  const [params, setParams] = useSearchParams()
  const tabs = TASK_HUB_TABS
  const active = resolveTaskTab(params.get('tab'), tabs)
  const select = (next: string) => setParams({ tab: next })
  const scope = useInboxCacheScope()
  const summary = useTaskHubSummary(scope, active)
  const unknown = '—'
  const panels: Record<TaskTabId, ReactNode> = {
    overview: <OverviewPanel />, admin: <TaskCenterPage />, schedule: <CronPage />, assistant: <AssistantJobsPage />, history: <HistoryPanel />,
  }
  return <PageShell className="console-resource-page console-tasks-hub">
    <PageHeader title={i18n.t("定时任务")} description={i18n.t("所有任务先在「全部任务」里看类型、状态、下次运行、最近结果、目标与审批；具体操作在各自页签。")} />
    <StatGrid label={i18n.t("任务概况")}>
      <StatCard
        icon={ClipboardList}
        label={i18n.t("管理员任务")}
        value={summary.admin?.total ?? unknown}
        sub={summary.admin
          ? summary.admin.failed > 0 ? i18n.t("{0} 个运行失败", [summary.admin.failed]) : i18n.t("{0} 个已暂停", [summary.admin.paused])
          : i18n.t("未启用或暂时无法读取")}
        tone={summary.admin && summary.admin.failed > 0 ? 'danger' : undefined}
        onOpen={() => select('admin')}
        pressed={active === 'admin'}
      />
      <StatCard
        icon={CalendarClock}
        label={i18n.t("定时提醒")}
        value={summary.schedule?.total ?? unknown}
        sub={summary.schedule ? i18n.t("{0} 个已暂停", [summary.schedule.paused]) : i18n.t("未启用或暂时无法读取")}
        onOpen={() => select('schedule')}
        pressed={active === 'schedule'}
      />
      <StatCard
        icon={Bot}
        label={i18n.t("助手任务")}
        value={summary.assistant?.total ?? unknown}
        sub={summary.assistant
          ? summary.assistant.failing > 0 ? i18n.t("{0} 个最近运行出错", [summary.assistant.failing]) : i18n.t("{0} 个已启用", [summary.assistant.enabled])
          : i18n.t("未启用或暂时无法读取")}
        tone={summary.assistant && summary.assistant.failing > 0 ? 'danger' : undefined}
        onOpen={() => select('assistant')}
        pressed={active === 'assistant'}
      />
      <StatCard
        icon={History}
        label={i18n.t("近期执行")}
        value={summary.history ? `${summary.history.recent}${summary.history.hasMore ? '+' : ''}` : unknown}
        sub={summary.history
          ? summary.history.failed > 0 ? i18n.t("其中 {0} 次失败", [summary.history.failed]) : i18n.t("没有失败的执行")
          : i18n.t("未启用或暂时无法读取")}
        tone={summary.history && summary.history.failed > 0 ? 'danger' : undefined}
        onOpen={() => select('history')}
        pressed={active === 'history'}
      />
    </StatGrid>
    <Tabs value={active} onValueChange={select}>
      <TabsList aria-label={i18n.t("任务视图")} className="h-auto max-w-full justify-start overflow-x-auto whitespace-nowrap">
        {tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{i18n.t(tab.label)}</TabsTrigger>)}
      </TabsList>
      {tabs.map(tab => <TabsContent key={tab.id} value={tab.id}>{tab.id === active ? panels[tab.id] : null}</TabsContent>)}
    </Tabs>
  </PageShell>
}
