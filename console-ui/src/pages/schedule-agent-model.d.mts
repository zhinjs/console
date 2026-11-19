export declare const DEFAULT_SCHEDULE_AGENT: 'zhin'
export interface ScheduleAgentOption {
  readonly value: string
  readonly label: string
  readonly disabled?: boolean
}
export interface ScheduleAgentView {
  readonly name: string
  readonly isDefault: boolean
  readonly missing: boolean
  readonly label: string
}
export interface ScheduleAgentEditBlock {
  readonly code: 'heartbeat' | 'profile'
  readonly reason: string
}
export function scheduleAgentNames(agents: unknown): string[] | null
export function scheduleAgentOptions(agents: unknown, locale?: 'zh-CN' | 'en', current?: string | null | readonly (string | null | undefined)[]): ScheduleAgentOption[] | null
export function scheduleAgentMissing(agents: unknown, value: unknown): boolean
export function scheduleAgentValue(job: unknown): string
export function scheduleAgentParam(value: unknown): string | null
export function scheduleAgentView(job: unknown, locale?: 'zh-CN' | 'en'): ScheduleAgentView
export function isHeartbeatSchedule(job: unknown): boolean
export function scheduleAgentEditBlock(job: unknown, locale?: 'zh-CN' | 'en'): ScheduleAgentEditBlock | null
export function scheduleRpcErrorCode(error: unknown): string | null
export function scheduleAgentErrorMessage(error: unknown, locale?: 'zh-CN' | 'en'): string | null
export interface ScheduleAgentNotFound {
  readonly agent: string | null
  readonly available: string[] | null
}
export function scheduleAgentNotFound(error: unknown): ScheduleAgentNotFound | null
export function scheduleResumeErrorMessage(error: unknown, locale?: 'zh-CN' | 'en'): string | null
