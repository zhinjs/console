export type StatusKind =
  | 'unknown' | 'forbidden' | 'not-installed' | 'unsupported' | 'empty' | 'locked' | 'conflict' | 'database-busy'
  | 'instance-unavailable' | 'needs-configuration' | 'disconnected' | 'error'
export type StatusLockLevel = 'global' | 'adapter' | 'endpoint'
export type InstanceFailure = 'unavailable' | 'timeout' | 'error'

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
}

export const STATUS_KINDS: readonly StatusKind[]
export const DEFAULT_INSTANCE_RETRY_SECONDS: number
export const STATUS_COPY: Readonly<Record<StatusKind, Readonly<{ title: string; description: string }>>>
export const LOCK_LEVEL_LABELS: Readonly<Record<StatusLockLevel, string>>
export function serverCodeOf(error: unknown): string | undefined
export function statusFromError(error: unknown): StatusReading
export function outcomeUnknown(status: StatusReading | null | undefined): boolean
export function statusTone(kind: StatusKind): 'destructive' | 'warning' | 'muted'
