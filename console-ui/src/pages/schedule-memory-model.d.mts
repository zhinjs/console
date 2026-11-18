export interface MemoryScheduleLike {
  id?: string
  kind?: string
  title?: string
  titleI18n?: Partial<Record<'zh-CN' | 'en', string>>
  description?: string
  displayName?: string
  plugin?: string
  expression?: string
  lastRunAt?: number
  lastExecutedAt?: number
  lastStatus?: string
  lastError?: string
  lastRun?: { at?: number; startedAt?: number; status?: string; error?: string }
}
export const PLUGIN_INTERNAL_KIND: 'plugin-internal'
export function isPluginInternalSchedule(item: MemoryScheduleLike | null | undefined): boolean
export function memoryScheduleTitle(item: MemoryScheduleLike | null | undefined, locale?: 'zh-CN' | 'en'): string
export function memoryScheduleLastRun(item: MemoryScheduleLike | null | undefined): { status: string; at: number | null; error: string | null } | null
