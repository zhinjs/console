// Task hub: one /tasks entry that hosts the administrator task catalog, scheduled reminders,
// assistant job status and execution history. Tab state lives in the URL (?tab=...).
export const TASK_HUB_PATH = '/tasks'

export const TASK_HUB_TABS = Object.freeze([
  Object.freeze({ id: 'admin', label: '管理员任务' }),
  Object.freeze({ id: 'schedule', label: '定时提醒' }),
  Object.freeze({ id: 'assistant', label: '助手任务' }),
  Object.freeze({ id: 'history', label: '执行记录' }),
])
export const DEFAULT_TASK_TAB = 'admin'

/** Unknown or missing tab ids fall back to the first tab. */
export function resolveTaskTab(value, tabs = TASK_HUB_TABS) {
  return tabs.find(tab => tab.id === value)?.id ?? tabs[0]?.id ?? DEFAULT_TASK_TAB
}

export function taskTabHref(tab, params = {}) {
  const search = new URLSearchParams({ tab })
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value)
  return `${TASK_HUB_PATH}?${search}`
}

/** Old route -> hub tab; the query string (e.g. ?q=) travels with the redirect. */
export const LEGACY_TASK_ROUTES = Object.freeze({ '/cron': 'schedule', '/assistant/jobs': 'assistant' })

export function legacyTaskRedirect(pathname, search = '') {
  const tab = LEGACY_TASK_ROUTES[pathname]
  if (!tab) return null
  const params = new URLSearchParams(search)
  params.delete('tab')
  return taskTabHref(tab, Object.fromEntries(params))
}
