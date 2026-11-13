export type ApplyOutcomeKind = 'applied' | 'next-message' | 'restart' | 'failed'
export type ApplyBasis = 'application' | 'restart-flag' | 'apply-table' | 'gateway-transaction' | 'unchanged' | 'env-file' | 'restart' | 'per-request' | 'scheduler' | 'chat-roles'

export interface ApplyOutcome {
  readonly kind: ApplyOutcomeKind
  readonly basis: ApplyBasis
  /** Authored reason for `failed` (translate at render). */
  readonly reason?: string
  /** `failed` because the Host could not confirm the outcome (not because it refused). */
  readonly unconfirmed?: boolean
  /** `restart`: part of the change already applied. */
  readonly partial?: boolean
  /** Groups that did not apply (`config` saves). */
  readonly groups?: readonly Readonly<{ id: string; status: string; reasonCode?: string }>[]
  /** An authored note (APPLY_NOTE_COPY), e.g. `secret`. */
  readonly note?: 'secret'
}

export interface ReadBackMismatch {
  /** Dotted path of the first difference ('' = the whole value). */
  readonly path: string
  /** Display text; null = absent. Secrets are masked, keeping only their length. */
  readonly submitted: string | null
  readonly readBack: string | null
  readonly masked?: boolean
}

export type RestartPhase = 'idle' | 'requesting' | 'waiting' | 'back' | 'timeout' | 'failed'
export interface RestartInstanceStatus { readonly state: string; readonly generation?: number; readonly pid?: number; readonly startedAt?: number }
export interface RestartState {
  readonly phase: RestartPhase
  readonly startedAt?: number
  readonly finishedAt?: number
  readonly before?: RestartInstanceStatus
  readonly sawDown?: boolean
  readonly reason?: string
}
export interface RestartObservation { readonly status?: RestartInstanceStatus | null; readonly probeOk?: boolean; readonly connected?: boolean; readonly now?: number }
export type RestartEvent =
  | { type: 'start'; now?: number }
  | { type: 'sent'; before?: RestartInstanceStatus | null }
  | { type: 'refused'; error: unknown }
  | ({ type: 'observe' } & RestartObservation)
  | { type: 'tick'; now?: number }
  | { type: 'keep-waiting'; now?: number }
  | { type: 'dismiss' }

export const APPLY_OUTCOME_KINDS: readonly ApplyOutcomeKind[]
export const APPLY_OUTCOME_COPY: Readonly<Record<ApplyOutcomeKind | 'unconfirmed' | 'restarted', Readonly<{ title: string; description: string }>>>
export const APPLY_BASIS_COPY: Readonly<Record<ApplyBasis, string>>
export const APPLY_BASIS_SOURCE: Readonly<Partial<Record<ApplyBasis, string>>>
export function outcomeFromConfigSave(result: unknown, revision?: string): ApplyOutcome
export function outcomeFromFeatureWrite(result: unknown, level: string): ApplyOutcome | null
export function outcomeFromPluginSwitch(result: unknown): ApplyOutcome | null
export function outcomeFromEnvSave(): ApplyOutcome
export function applyOutcomeCopy(value: ApplyOutcome | null | undefined): Readonly<{ title: string; description: string }> | null
export function applyOutcomeTone(value: ApplyOutcome | null | undefined): 'success' | 'warning' | 'destructive' | 'muted'
export function secretLikeKey(key: unknown): boolean
export function canonicalJson(value: unknown): string
export function firstDifference(left: unknown, right: unknown, path?: string[]): { path: string[]; submitted: unknown; readBack: unknown } | null
export const MASKED_VALUE: string
export function readBackMismatch(submitted: unknown, readBack: unknown, options?: { isSecret?: (path: readonly string[]) => boolean }): ReadBackMismatch | null
export const RESTART_TIMEOUT_MS: number
export const RESTART_POLL_MS: number
export const IDLE_RESTART: RestartState
export function restartObservedBack(state: RestartState | null | undefined, observation: RestartObservation | null | undefined): boolean
export function restartReducer(state: RestartState | null | undefined, event: RestartEvent): RestartState
export function restartElapsedSeconds(state: RestartState | null | undefined, now?: number): number
export function restartInProgress(state: RestartState | null | undefined): boolean
export function schemaSecretAt(schema: unknown, path: readonly string[] | null | undefined): boolean
export const APPLY_NOTE_COPY: Readonly<Record<'secret', string>>
export function outcomeFromAccessWrite(options?: { secret?: boolean }): ApplyOutcome
export function outcomeFromScheduleWrite(): ApplyOutcome
export function outcomeFromChatRoleWrite(): ApplyOutcome
export function recordReadBack(record: object | null | undefined, expected: Record<string, unknown> | null, options?: { isSecret?: (path: readonly string[]) => boolean }): ReadBackMismatch | null
export function runReadBack(check: () => Promise<ReadBackMismatch | null | undefined> | ReadBackMismatch | null | undefined): Promise<{ mismatch: ReadBackMismatch | null; unverified: boolean }>
