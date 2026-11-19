export type AmbientMode = 'off' | 'shadow' | 'active'
export type AmbientOutcome = 'spoke' | 'watched' | 'stayed_quiet' | 'skipped'
export type AmbientSkipReason = 'cooldown' | 'hourly_cap' | 'judge_interval' | 'no_context' | 'judge_failed'
/** One interjection judge member (ADR 0066 D7). */
export interface AmbientJudgeMember {
  profile: string
  label: string
  kind?: 'language' | 'decision'
  role: 'primary' | 'fallback' | 'compare'
  skippedUntil?: number
  skipReason?: string
}
export interface AmbientCompareCounts { agreed: number; primaryOnly: number; comparedOnly: number; failed: number }
/** Agreement with the compared model over 24 hours (ADR 0066 D3). */
export interface AmbientCompareStatus extends AmbientCompareCounts {
  windowMs: number
  byMember: Array<AmbientCompareCounts & { member: number; profile?: string }>
  comparedProfiles: string[]
}
/** Judge calls and tokens of one day (#1250 batch 47). */
export interface AmbientJudgeDay {
  day: string
  calls: number
  failed: number
  fallbacks: number
  byKind: { language: number; decision: number }
  averageMs: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  unreportedCalls: number
}
/**
 * `plugin.root.ambient`. Fields marked optional are absent on older instances: `judgeChain`,
 * `minConfidence`, `compare` (ADR 0066), `judgeDaily` / `judgeTimeZone` (batch 47) and `judgeToday`
 * (batch 48); newer ones may drop the deprecated `decisionShadow` after its window.
 */
export interface AmbientStatus {
  enabled: boolean
  mode: AmbientMode
  groups: number | 'all'
  judges?: string[]
  judgeChain?: AmbientJudgeMember[]
  minConfidence?: number
  last24h: Record<AmbientOutcome, number>
  /** @deprecated ADR 0066 D3: read `compare`; kept for older instances. */
  decisionShadow?: { agreed: number; disagreed: number }
  compare?: AmbientCompareStatus
  recent: Array<{ at: number; group: string; outcome: AmbientOutcome; skipReason?: AmbientSkipReason; confidence?: number; judge?: 'decision' | 'chat-model' }>
  updatedAt: number | null
  judgeDaily?: AmbientJudgeDay[]
  judgeTimeZone?: string
  /** Today on the instance clock in `judgeTimeZone` (`YYYY-MM-DD`); kept: this day and the 6 before it. */
  judgeToday?: string
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
export interface SaveFeedback { kind: 'saved' | 'conflict' | 'invalid' | 'error'; text: string; restartRequired?: boolean; applicationKind?: import('../components/PluginConfigForm/config-live-status.mjs').ConfigurationRuntimeStatus['kind'] }
export const AMBIENT_STATUS_PERMISSION: 'ambient:read'
export const AMBIENT_CONFIG_PATH: readonly string[]
export const DEFAULT_MAX_PER_HOUR: number
export const MAX_PER_HOUR_LIMIT: number
export const BEHAVIOR_CHOICES: ReadonlyArray<{ value: AmbientBehavior; label: string; hint: string }>
export function validateAmbientStatus(data: unknown, locale?: 'zh-CN' | 'en'): AmbientStatus
export function describeAmbientStatus(status: AmbientStatus, locale?: 'zh-CN' | 'en'): AmbientStatusView
export function readAmbientSettings(configDocument: unknown, options?: { judgeMode?: 'active' | 'shadow' }): AmbientSettings
export function hasMergedJudge(status: AmbientStatus | null | undefined): boolean
export interface AmbientJudgeState {
  state: 'merged' | 'legacy' | 'unknown'
  policy?: import('./inference/model.mjs').AmbientJudgePolicy
  source?: 'stored' | 'legacy' | 'default'
  mode?: 'active' | 'shadow'
}
export function ambientJudgeState(input?: { judge?: { policy: import('./inference/model.mjs').AmbientJudgePolicy; source: 'stored' | 'legacy' | 'default' } | null; judgeMissing?: boolean; status?: AmbientStatus | null }): AmbientJudgeState
export function ambientScopeWidened(settings: AmbientSettings, initial: Partial<AmbientSettings> | null | undefined): boolean
export function ambientModePlan(settings: AmbientSettings, initial: AmbientSettings | AmbientBehavior, judge?: AmbientJudgeState): {
  writeYmlMode: boolean
  judgeMode: 'active' | 'shadow' | null
  blocked: null | 'unknown' | 'unknown-expand' | 'no-policy-shadow' | 'no-policy'
}
export function parseGroupList(text: string): string[]
export function validateAmbientSettings(settings: AmbientSettings, locale?: 'zh-CN' | 'en'): string[]
export function buildAmbientPatches(settings: AmbientSettings, options?: { mergedJudge?: boolean }): AmbientPatch[]
export function describeSaveResult(result: unknown, locale?: 'zh-CN' | 'en'): SaveFeedback
export function isPermissionDenied(error: unknown): boolean
export function describeReadFailure(error: unknown, resource: string, locale?: 'zh-CN' | 'en'): { denied: boolean; text: string; detail: string }
export interface AmbientGroupSummary { group: string; count: number; lastAt: number; lastText: string; outcomes: Array<{ outcome: AmbientOutcome; label: string; count: number }> }
export function summarizeRecentByGroup(recent: AmbientStatusView['recent'], locale?: 'zh-CN' | 'en'): AmbientGroupSummary[]
export function ambientGroupLabel(group: string, names: ReadonlyMap<string, string> | null | undefined): { name: string; id: string | null }
export function ambientWrittenValues(settings: AmbientSettings, options?: { mergedJudge?: boolean }): Record<string, unknown>
export function ambientSaveOutcome(result: unknown, submitted: AmbientSettings, reread: { settings: AmbientSettings } | null, options?: { mergedJudge?: boolean }): {
  outcome: import('../components/apply-outcome-model.mjs').ApplyOutcome
  mismatch: import('../components/apply-outcome-model.mjs').ReadBackMismatch | null
  unverified: boolean
}
export function ambientRestartOutcome(reread: { application?: unknown; revision?: string } | null): import('../components/apply-outcome-model.mjs').ApplyOutcome | null
