import { assistantNavigation } from './bootstrap/assistant-navigation'
import { NAV_GROUPS } from './navigation-taxonomy'
import { hostRegistrations } from './bootstrap/loadConsoleEntries'
import AssistantJobsPage from './pages/assistant-jobs'

let assistantRegistered = false

export function resetOptionalConsoleRoutes(): void {
  assistantRegistered = false
  assistantNavigation.reset()
}

/**
 * 助手任务与定时提醒的持久任务是同一批记录：不进侧栏，入口在定时提醒的每个任务上；
 * 保留直接访问路由用于查看执行详情。
 */
export async function registerOptionalConsoleRoutes(): Promise<void> {
  if (assistantRegistered) return
  const session = hostRegistrations.capture()
  if (!session.active()) return

  assistantRegistered = true
  session.addRoute({
    path: '/assistant/jobs',
    name: '助手任务',
    parent: '/cron',
    icon: 'Activity',
    element: <AssistantJobsPage />,
    meta: { group: NAV_GROUPS.DAILY, order: 3, hideInMenu: true },
  })
}
