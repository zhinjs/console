import { app } from '@zhin.js/client'
import AssistantJobsPage, { probeAssistantEnabled } from './pages/assistant-jobs'

let assistantRegistered = false

/** 登录后探测 Assistant 可用性，非 404 时注册侧栏路由 */
export async function registerOptionalConsoleRoutes(): Promise<void> {
  if (assistantRegistered) return
  const enabled = await probeAssistantEnabled()
  if (!enabled) return

  assistantRegistered = true
  app.addRoute({
    path: '/assistant/jobs',
    name: '助手任务',
    parent: null,
    icon: 'Activity',
    element: <AssistantJobsPage />,
    meta: { group: '命令与 Agent', order: 2 },
  })
}
