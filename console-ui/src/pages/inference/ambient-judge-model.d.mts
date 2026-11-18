import type { AmbientJudgePolicy, PurposeProfileChoice, View } from './model.mjs'

type Locale = 'zh-CN' | 'en'
export type AmbientJudgeKind = 'language' | 'decision'

export const AMBIENT_JUDGE_KEYS: readonly ['profile', 'fallbacks', 'compare', 'minConfidence', 'mode', 'timeoutMs']
export const DEFAULT_AMBIENT_MIN_CONFIDENCE: number
export const DEFAULT_AMBIENT_JUDGE_TIMEOUT_MS: number
export const AMBIENT_JUDGE_MIGRATION_ID: 'adr-0066-ambient-judge'
export const DECISION_TASKS: readonly string[]
export const AMBIENT_JUDGE_REVERT_COMMAND: string

export interface AmbientJudgeMigrationRow { field: string; value: string | number | string[]; from: string }
export interface AmbientJudgeMigrationNote { code: string; value?: string | number }
export interface AmbientJudgeMigration {
  id: 'adr-0066-ambient-judge'
  status: 'migrated' | 'failed' | 'reverted'
  at: number
  graphRevision?: number
  after?: AmbientJudgePolicy
  rows?: AmbientJudgeMigrationRow[]
  notes?: AmbientJudgeMigrationNote[]
  triggerKeys?: string[]
  noticedAt?: number
  revertedAt?: number
  failure?: { reason: string; path?: string }
}
/** `GET /agent/inference/ambient-judge`. */
export interface AmbientJudgeView {
  policy: AmbientJudgePolicy
  source: 'stored' | 'legacy' | 'default'
  chain: Array<{ profile: string; kind?: AmbientJudgeKind }>
  inheritedFrom?: 'chat'
  migration?: AmbientJudgeMigration
}
export interface AmbientJudgeDraft {
  profile: string
  fallbacks: string[]
  compare: string
  minConfidence: string
  mode: 'active' | 'shadow'
  timeoutMs: string
}
export interface AmbientJudgeProblem { field: keyof AmbientJudgeDraft; message: string }
export interface AmbientJudgeChoice extends PurposeProfileChoice { kind: AmbientJudgeKind }

export function ambientJudgeDocUrl(locale?: Locale): string
export function readAmbientJudgeView(data: unknown): AmbientJudgeView | null
export function isMissingRoute(error: unknown): boolean
export function ambientJudgeSupport(input?: { view?: View | null; judge?: AmbientJudgeView | null; judgeError?: unknown }): 'merged' | 'legacy' | 'unknown'
export function ambientJudgeDraft(policy: AmbientJudgePolicy | undefined | null): AmbientJudgeDraft
export function ambientJudgeKind(view: View | null | undefined, id: string): AmbientJudgeKind | undefined
export function ambientJudgePolicyFromDraft(draft: AmbientJudgeDraft): AmbientJudgePolicy
export function ambientJudgeFieldLabel(field: string, locale?: Locale): string
export function validateAmbientJudgeDraft(draft: AmbientJudgeDraft, view: View, locale?: Locale): AmbientJudgeProblem[]
export function ambientJudgeHints(draft: AmbientJudgeDraft, view: View, chatChain?: readonly string[], locale?: Locale): string[]
export function ambientJudgePlanEntry(draft: AmbientJudgeDraft, original: AmbientJudgePolicy | undefined | null): AmbientJudgePolicy | undefined
export function ambientJudgeChoices(view: View, locale?: Locale): AmbientJudgeChoice[]
export function ambientJudgeKindLabel(kind: string | undefined, locale?: Locale): string
export function profileName(view: View | null | undefined, id: string): string
export interface AmbientMigrationNotice { at: number; rows: Array<{ key: string; field: string; value: string; from: string }>; notes: string[] }
export function ambientMigrationNotice(judge: AmbientJudgeView | null | undefined, view: View | null | undefined, locale?: Locale): AmbientMigrationNotice | null
export function ambientMigrationFailure(judge: AmbientJudgeView | null | undefined, locale?: Locale): string | null
export function noticeAmbientJudgeMigration<T = { noticedAt?: number }>(request: (path: string, body?: unknown, method?: string) => Promise<T>): Promise<T>

export interface AmbientAgreement {
  source: 'compare' | 'decisionShadow'
  rate: number
  total: number
  agreed: number
  disagreed: number
  primaryOnly: number | null
  comparedOnly: number | null
  failed: number | null
  text: string
  detail: string
  byMember: Array<{ key: string; label: string; text: string; failed: number }>
}
export function ambientAgreement(status: unknown, locale?: Locale, names?: (id: string) => string): AmbientAgreement | null
export interface AmbientJudgeChainRow { key: string; roleCode: 'primary' | 'fallback' | 'compare'; role: string; label: string; kind: string; skipped: string }
export function ambientJudgeChainRows(status: unknown, locale?: Locale, now?: number): AmbientJudgeChainRow[]
export interface AmbientJudgeDailyRow {
  day: string
  label: string
  calls: number
  failed: number
  fallbacks: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  unreportedCalls: number
  tokens: number
}
export interface AmbientJudgeDaily {
  timeZone: string
  rows: AmbientJudgeDailyRow[]
  total: { calls: number; failed: number; fallbacks: number; inputTokens: number; outputTokens: number; unreportedCalls: number }
  unreported: boolean
}
export function ambientJudgeDaily(status: unknown, locale?: Locale, now?: number): AmbientJudgeDaily | null
export interface PlanWarning { path?: string; code?: string; message?: string }
export function writeAmbientJudgePolicy(fetch: typeof globalThis.fetch, policy: AmbientJudgePolicy, options?: { mutationId?: string }): Promise<{
  status: 'committed' | 'conflict' | 'not-committed' | 'commit-unknown'
  code?: string
  warnings: PlanWarning[]
}>
export function planWarningText(warning: unknown, locale?: Locale): string
