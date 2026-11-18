export interface ScheduleTargetView {
  readonly valid: boolean
  readonly display: string | null
  readonly reason: string | null
  readonly code: string | null
}
export function scheduleTargetView(target: unknown, locale?: 'zh-CN' | 'en'): ScheduleTargetView | null
export function scheduleTargetWarning(view: ScheduleTargetView | null | undefined, nextRunAt: number | null | undefined, locale?: 'zh-CN' | 'en'): string | null
