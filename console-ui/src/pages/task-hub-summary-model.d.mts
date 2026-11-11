import type { TaskProviders } from './task-center-model.mjs'
import type { ExecutionPage } from './schedule-executions-model.mjs'
import type { AssistantJobsResponse } from './assistant-jobs-model.mjs'

export interface ScheduleListLike {
  memory?: Array<{ running?: boolean }>
  persistent?: Array<{ enabled?: boolean }>
}

export function summarizeAdminTasks(catalog: TaskProviders | null): { total: number; paused: number; failed: number; providers: number } | null
export function summarizeSchedules(list: ScheduleListLike | null): { total: number; persistent: number; paused: number } | null
export function summarizeAssistantJobs(data: AssistantJobsResponse | null): { total: number; enabled: number; failing: number } | null
export function summarizeExecutions(page: ExecutionPage | null): { recent: number; hasMore: boolean; failed: number; running: number } | null
