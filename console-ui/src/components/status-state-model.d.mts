export type StatusKind =
  | 'unknown' | 'forbidden' | 'not-installed' | 'unsupported' | 'empty' | 'locked' | 'conflict' | 'database-busy'
  | 'instance-unavailable' | 'needs-configuration' | 'disconnected' | 'error'
export type StatusLockLevel = 'global' | 'adapter' | 'endpoint'
export type InstanceFailure = 'unavailable' | 'timeout' | 'error'

/**
 * Refused global plugin switch (gateway transaction, ADR 0054 §4): `rolled-back` (nothing
 * changed), `rollback-failed` (the instance may be stopped), `gateway-required` (no gateway).
 */
export type TransactionFailureOutcome = 'rolled-back' | 'rollback-failed' | 'gateway-required'
export interface TransactionFailure {
  readonly outcome: TransactionFailureOutcome
  readonly failedPhase?: string
  /** The transaction's original failure. */
  readonly cause?: string
  readonly rollbackError?: string
  /** Last instance log lines when starting the instance failed. */
  readonly logTail?: readonly string[]
}

export interface StatusReading {
  readonly kind: StatusKind
  readonly message: string
  readonly serverCode?: string
  readonly lockedBy?: StatusLockLevel
  readonly retryAfterSeconds?: number
  readonly instance?: InstanceFailure
  /** `not-dispatched`: the request never reached the instance and may be sent again. */
  readonly outcome?: 'not-dispatched' | 'unknown'
  readonly needsConfiguration?: readonly Record<string, unknown>[]
  readonly missingEnv?: readonly string[]
  readonly transaction?: TransactionFailure
}

export const STATUS_KINDS: readonly StatusKind[]
export const DEFAULT_INSTANCE_RETRY_SECONDS: number
export const STATUS_COPY: Readonly<Record<StatusKind, Readonly<{ title: string; description: string }>>>
export const LOCK_LEVEL_LABELS: Readonly<Record<StatusLockLevel, string>>
export function serverCodeOf(error: unknown): string | undefined
export function statusFromError(error: unknown): StatusReading
export function outcomeUnknown(status: StatusReading | null | undefined): boolean
export function statusTone(kind: StatusKind): 'destructive' | 'warning' | 'muted'
