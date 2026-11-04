import type { ReactNode } from 'react'
import { useI18n } from '../i18n'
import { Navigate, useLocation, useSearchParams } from 'react-router-dom'
import { PageHeader } from '../components/PageHeader'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import TaskCenterPage from './task-center'
import CronPage from './cron'
import AssistantJobsPage from './assistant-jobs'
import { ScheduleExecutions } from './ScheduleExecutions'
import { legacyTaskRedirect, resolveTaskTab, TASK_HUB_TABS, type TaskTabId } from './task-hub-model.mjs'

/** Old /cron and /assistant/jobs bookmarks land on the matching hub tab. */
export function LegacyTaskRoute() {
  const { pathname, search } = useLocation()
  return <Navigate to={legacyTaskRedirect(pathname, search) ?? '/tasks'} replace />
}

function HistoryPanel() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Alert><AlertDescription>{i18n.t("请连接 Host 后读取任务。")}</AlertDescription></Alert>
  return <ScheduleExecutions key={scope} connectionScope={scope} />
}

export default function TaskHubPage() {
  const i18n = useI18n()
  const [params, setParams] = useSearchParams()
  const tabs = TASK_HUB_TABS
  const active = resolveTaskTab(params.get('tab'), tabs)
  const select = (next: string) => setParams({ tab: next })
  const panels: Record<TaskTabId, ReactNode> = {
    admin: <TaskCenterPage />, schedule: <CronPage />, assistant: <AssistantJobsPage />, history: <HistoryPanel />,
  }
  return <div className="console-page console-resource-page console-tasks-hub">
    <PageHeader title={i18n.t("任务")} description={i18n.t("管理员任务、定时提醒、助手任务和执行记录集中在这里。")} />
    <Tabs value={active} onValueChange={select}>
      <TabsList aria-label={i18n.t("任务视图")} className="h-auto max-w-full flex-wrap justify-start">
        {tabs.map(tab => <TabsTrigger key={tab.id} value={tab.id}>{i18n.t(tab.label)}</TabsTrigger>)}
      </TabsList>
      {tabs.map(tab => <TabsContent key={tab.id} value={tab.id}>{tab.id === active ? panels[tab.id] : null}</TabsContent>)}
    </Tabs>
  </div>
}
