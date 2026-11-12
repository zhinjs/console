export type TaskOverviewType = 'admin' | 'schedule' | 'assistant' | 'approval'
export type TaskOverviewTone = 'secondary' | 'info' | 'success' | 'warning' | 'destructive'
export interface TaskOverviewRow {
  key: string
  type: TaskOverviewType
  typeLabel: string
  title: string
  detail: string | null | undefined
  status: { code: string; label: string; tone: TaskOverviewTone }
  nextRunAt: number | null
  expiresAt?: number | null
  lastResult: { label: string; tone: TaskOverviewTone; at: number | null } | null
  target: string | null
  targetHref: string | null
  approval: string | null
  tab: 'admin' | 'schedule' | 'assistant'
}
export interface TaskOverviewSources {
  admin?: { providers: ReadonlyArray<{ owner: string; title: string; tasks: ReadonlyArray<Record<string, any>> }> } | null
  schedules?: { memory?: ReadonlyArray<Record<string, any>>; persistent?: ReadonlyArray<Record<string, any>> } | null
  assistant?: { jobs: ReadonlyArray<Record<string, any>> } | null
  approvals?: { pending: ReadonlyArray<Record<string, any>> } | null
}
export function taskOverviewRows(sources: TaskOverviewSources, locale?: 'zh-CN' | 'en'): { rows: TaskOverviewRow[]; unavailable: string[] }
export type TaskOverviewFilter = 'all' | 'attention' | 'paused'
export const TASK_OVERVIEW_FILTERS: ReadonlyArray<{ readonly id: TaskOverviewFilter; readonly label: string }>
export function needsAttention(row: TaskOverviewRow): boolean
export function filterTaskOverview(rows: TaskOverviewRow[], filter: string): TaskOverviewRow[]
