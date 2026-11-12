export const TASK_HUB_PATH: '/tasks'
export type TaskTabId = 'overview' | 'admin' | 'schedule' | 'assistant' | 'history'
export interface TaskHubTab { readonly id: TaskTabId; readonly label: string }
export const TASK_HUB_TABS: readonly TaskHubTab[]
export const DEFAULT_TASK_TAB: TaskTabId
export function resolveTaskTab(value: string | null | undefined, tabs?: readonly TaskHubTab[]): TaskTabId
export function taskTabHref(tab: TaskTabId, params?: Record<string, string | undefined>): string
export const LEGACY_TASK_ROUTES: Readonly<Record<string, TaskTabId>>
export function legacyTaskRedirect(pathname: string, search?: string): string | null
