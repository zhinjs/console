export type AmbientMode = 'off' | 'shadow' | 'active'
export type AmbientOutcome = 'spoke' | 'watched' | 'stayed_quiet' | 'skipped'
export type AmbientSkipReason = 'cooldown' | 'hourly_cap' | 'judge_interval' | 'no_context' | 'judge_failed'
export interface AmbientStatus {
  enabled: boolean
  mode: AmbientMode
  groups: number | 'all'
  judges: string[]
  last24h: Record<AmbientOutcome, number>
  decisionShadow: { agreed: number; disagreed: number }
  recent: Array<{ at: number; group: string; outcome: AmbientOutcome; skipReason?: AmbientSkipReason; confidence?: number; judge?: 'decision' | 'chat-model' }>
  updatedAt: number | null
}
export interface AmbientStatusView {
  behavior: string
  groupScope: string
  counts: Array<{ key: AmbientOutcome; label: string; value: number }>
  recent: Array<{ at: number; group: string; outcome: AmbientOutcome; text: string }>
  hasActivity: boolean
  updatedAt: number | null
}
export type AmbientBehavior = 'off' | 'watch' | 'join'
export interface AmbientSettings { behavior: AmbientBehavior; groupScope: 'all' | 'some'; groups: string[]; maxPerHour: number }
export type AmbientPatch = { op: 'set'; path: string[]; value: unknown }
export interface SaveFeedback { kind: 'saved' | 'conflict' | 'invalid' | 'error'; text: string; restartRequired?: boolean }
export const AMBIENT_STATUS_PERMISSION: 'ambient:read'
export const AMBIENT_CONFIG_PATH: readonly string[]
export const DEFAULT_MAX_PER_HOUR: number
export const MAX_PER_HOUR_LIMIT: number
export const BEHAVIOR_CHOICES: ReadonlyArray<{ value: AmbientBehavior; label: string; hint: string }>
export function validateAmbientStatus(data: unknown): AmbientStatus
export function describeAmbientStatus(status: AmbientStatus): AmbientStatusView
export function readAmbientSettings(configDocument: unknown): AmbientSettings
export function parseGroupList(text: string): string[]
export function validateAmbientSettings(settings: AmbientSettings): string[]
export function buildAmbientPatches(settings: AmbientSettings): AmbientPatch[]
export function describeSaveResult(result: unknown): SaveFeedback
export function isPermissionDenied(error: unknown): boolean
