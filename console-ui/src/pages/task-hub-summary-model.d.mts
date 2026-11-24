import type { TaskProviders } from './task-center-model.mjs'
import type { ExecutionPage } from './schedule-executions-model.mjs'
import type { AssistantJobsResponse } from './assistant-jobs-model.mjs'

export interface ScheduleListLike {
  memory?: Array<{ running?: boolean }>
  persistent?: Array<{ id?: string; enabled?: boolean }>
}

export function summarizeAdminTasks(catalog: TaskProviders | null): { total: number; paused: number; failed: number; providers: number } | null
export function summarizeSchedules(list: ScheduleListLike | null): { total: number; persistent: number; paused: number; internal: number } | null
export function summarizeAssistantJobs(data: AssistantJobsResponse | null, locale?: 'zh-CN' | 'en', reminderIds?: readonly string[]): { total: number; enabled: number; failing: number; reminders?: number; disabled?: string } | null
export function summarizeExecutions(page: ExecutionPage | null): { recent: number; hasMore: boolean; failed: number; running: number } | null
/** The source cards from what the 全部任务 table read (`TaskOverviewSources`); null sources stay null. */
export function summarizeOverviewSources(sources: { admin?: unknown; schedules?: unknown; assistant?: unknown } | null | undefined, locale?: 'zh-CN' | 'en'): {
  admin: ReturnType<typeof summarizeAdminTasks>
  schedule: ReturnType<typeof summarizeSchedules>
  assistant: ReturnType<typeof summarizeAssistantJobs>
}
