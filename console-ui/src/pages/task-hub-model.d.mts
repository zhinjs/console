export const TASK_HUB_PATH: '/tasks'
export type TaskTabId = 'overview' | 'admin' | 'schedule' | 'assistant' | 'history'
export interface TaskHubTab { readonly id: TaskTabId; readonly label: string }
export const TASK_HUB_TABS: readonly TaskHubTab[]
export const DEFAULT_TASK_TAB: TaskTabId
export function resolveTaskTab(value: string | null | undefined, tabs?: readonly TaskHubTab[]): TaskTabId
export function taskTabHref(tab: TaskTabId, params?: Record<string, string | undefined>): string
export const LEGACY_TASK_ROUTES: Readonly<Record<string, TaskTabId>>
export function legacyTaskRedirect(pathname: string, search?: string): string | null
/** Permissions that let an identity read at least one 定时任务 tab (from the protocol table). */
export const TASK_HUB_READ_PERMISSIONS: readonly string[]
/** The tabs the identity can read; 全部任务 when at least two source tabs are. */
export function readableTaskTabs(has: (permission: string) => boolean, tabs?: readonly TaskHubTab[]): TaskHubTab[]
export function taskTabPermission(tab: string): string | null
export function unreadableTaskTab(value: string | null | undefined, tabs: readonly TaskHubTab[], all?: readonly TaskHubTab[]): { tab: TaskTabId; label: string; permission: string | null } | null
