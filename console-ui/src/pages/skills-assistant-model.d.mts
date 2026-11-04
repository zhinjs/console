import type { Locale } from '../i18n/locale.mjs'
export type TaskMode = 'off' | 'shadow' | 'active'
export type AssistantTask = 'skills' | 'tools' | 'memory' | 'agents' | 'approval' | 'ambient'
export type TaskOutcome = 'selected' | 'abstained' | 'failed' | 'shadow'
export interface SkillsStatus {
  tasks: Array<{ task: string; mode: TaskMode; calls: number; selected: number; abstained: number; shadow: number; failed: number; averageMs: number; inputTokens: number; outputTokens: number; lastModel?: string; lastAt: number }>
  totals: { calls: number; inputTokens: number; outputTokens: number }
  recent: Array<{ at: number; task: string; mode: string; outcome: TaskOutcome; durationMs: number; model?: string; reason?: string }>
  updatedAt: number | null
}
export interface SkillsStatusView {
  totalCalls: number
  failedCalls: number
  tasks: Array<{ task: string; label: string; mode: string; modeVariant: 'success' | 'info' | 'secondary'; calls: number; helped: number; noSuggestion: number; failed: number; averageTime: string }>
  recent: Array<{ at: number; label: string; outcome: TaskOutcome; text: string; duration: string }>
  hasActivity: boolean
  updatedAt: number | null
}
export const SKILLS_STATUS_PERMISSION: 'skills:read'
export const ASSISTANT_TASKS: ReadonlyArray<{ task: AssistantTask; label: string; hint: string }>
export function validateSkillsStatus(data: unknown, locale?: Locale): SkillsStatus
export function describeSkillsStatus(status: SkillsStatus, locale?: Locale): SkillsStatusView
export function isPermissionDenied(error: unknown): boolean
