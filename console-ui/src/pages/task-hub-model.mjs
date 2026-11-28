import { httpRoutePermission } from '../utils/http-permission.mjs'
import { consoleRpcPermission } from '@zhin.js/console-protocol'
// Task hub: one /tasks entry that opens on a unified list of every task, then hosts the administrator task catalog, scheduled reminders,
// assistant job status and execution history. Tab state lives in the URL (?tab=...).
export const TASK_HUB_PATH = '/ops/schedules'

export const TASK_HUB_TABS = Object.freeze([
  Object.freeze({ id: 'overview', label: '全部任务' }),
  Object.freeze({ id: 'admin', label: '管理员任务' }),
  Object.freeze({ id: 'schedule', label: '定时提醒' }),
  Object.freeze({ id: 'assistant', label: '助手任务' }),
  Object.freeze({ id: 'history', label: '执行记录' }),
])
export const DEFAULT_TASK_TAB = 'overview'

/**
 * What each tab reads, as the Host checks it (#64 `schedules-nav-task-center-permission`): 管理员任务
 * GET /tasks/providers, 定时提醒 the `schedule:list` RPC, 助手任务 GET /assistant/jobs, 执行记录
 * GET /assistant/executions. 全部任务 combines them and shows what it can read.
 */
const TAB_READS = Object.freeze({
  admin: () => httpRoutePermission('GET', '/tasks/providers'),
  schedule: () => consoleRpcPermission('schedule:list'),
  assistant: () => httpRoutePermission('GET', '/assistant/jobs'),
  history: () => httpRoutePermission('GET', '/assistant/executions'),
})
/** The permission each source tab needs to read (null: the Host denies it for everyone). */
const TAB_PERMISSIONS = Object.freeze(Object.fromEntries(Object.entries(TAB_READS).map(([id, read]) => [id, read() || null])))

/** Every permission that lets an identity read at least one tab: who may open 定时任务. */
export const TASK_HUB_READ_PERMISSIONS = Object.freeze([...new Set(Object.values(TAB_PERMISSIONS).filter(Boolean))])

/**
 * The tabs an identity can read (`has` checks one permission), in order: each source tab by what it
 * reads, and 全部任务 when it combines at least two of them (with one source it would only repeat that tab
 * and report the others as unreadable). An unreadable `?tab=` then falls back to the first of these.
 */
export function readableTaskTabs(has, tabs = TASK_HUB_TABS) {
  const readable = id => TAB_PERMISSIONS[id] ? has(TAB_PERMISSIONS[id]) : false
  const sources = Object.keys(TAB_PERMISSIONS).filter(readable).length
  return tabs.filter(tab => tab.id === 'overview' ? sources >= 2 : readable(tab.id))
}

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
