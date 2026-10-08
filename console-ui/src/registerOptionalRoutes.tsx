import { assistantNavigation } from './bootstrap/assistant-navigation'
import { NAV_GROUPS } from './navigation-taxonomy'
import { hostRegistrations } from './bootstrap/loadConsoleEntries'
import AssistantJobsPage, { probeAssistantEnabled } from './pages/assistant-jobs'

let assistantRegistered = false

export function resetOptionalConsoleRoutes(): void {
  assistantRegistered = false
  assistantNavigation.reset()
}

/** 保留直接访问路由；助手未启用时只隐藏侧栏入口。 */
export async function registerOptionalConsoleRoutes(): Promise<void> {
  if (assistantRegistered) return
  const session = hostRegistrations.capture()
  const enabled = await probeAssistantEnabled()
  if (!session.active()) return

  assistantRegistered = true
  assistantNavigation.bind(session, {
    path: '/assistant/jobs',
    name: '助手任务',
    parent: null,
    icon: 'Activity',
    element: <AssistantJobsPage />,
    meta: { group: NAV_GROUPS.AUTOMATION, order: 1 },
  }, enabled)
}
