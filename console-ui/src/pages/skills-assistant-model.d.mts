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
  tasks: Array<{ task: string; label: string; mode: string; calls: number; helped: number; noSuggestion: number; failed: number; averageTime: string }>
  recent: Array<{ at: number; label: string; outcome: TaskOutcome; text: string; duration: string }>
  hasActivity: boolean
  updatedAt: number | null
}
export type TaskModes = Record<AssistantTask, TaskMode>
export interface SkillsSettings { instanceKey: string | undefined; provider: string | undefined; usesOtherService: boolean; modes: TaskModes }
export type SkillsPatch = { op: 'set'; path: string[]; value: unknown }
export interface SaveFeedback { kind: 'saved' | 'conflict' | 'invalid' | 'error'; text: string; restartRequired?: boolean }
export const SKILLS_STATUS_PERMISSION: 'skills:read'
export const SKILLS_ASSISTANT_PACKAGE: string
export const DECISIONS_CONFIG_PATH: readonly string[]
export const ASSISTANT_TASKS: ReadonlyArray<{ task: AssistantTask; label: string; hint: string }>
export const MODE_CHOICES: ReadonlyArray<{ value: TaskMode; label: string }>
export const MODE_EXPLANATION: string
export function validateSkillsStatus(data: unknown): SkillsStatus
export function describeSkillsStatus(status: SkillsStatus): SkillsStatusView
export function findAssistantInstanceKey(configDocument: unknown): string | undefined
export function readSkillsSettings(configDocument: unknown): SkillsSettings
export function buildSkillsPatches(initial: SkillsSettings, modes: TaskModes): SkillsPatch[]
export function hasSkillsChanges(initial: SkillsSettings, modes: TaskModes): boolean
export function describeSaveResult(result: unknown): SaveFeedback
export function isPermissionDenied(error: unknown): boolean
