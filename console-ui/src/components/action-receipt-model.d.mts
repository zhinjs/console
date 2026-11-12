import type { StatusReading } from './status-state-model.mjs'

export type ReceiptPhase = 'idle' | 'prepared' | 'confirming' | 'submitting' | 'succeeded' | 'partial' | 'unknown' | 'failed' | 'verifying'

export interface ReceiptPlan {
  /** What the action is, already translated (e.g. 「授予 admin」). */
  readonly title: string
  readonly summary?: string
  /** One line per change, already translated. */
  readonly changes?: readonly string[]
  /** Danger: a second confirmation step before submitting. */
  readonly danger?: boolean
  readonly confirmLabel?: string
}

export interface ReceiptItem { readonly label: string; readonly ok: boolean; readonly message?: string }

export interface ActionReceiptState {
  readonly phase: ReceiptPhase
  readonly plan?: ReceiptPlan
  readonly items?: readonly ReceiptItem[]
  readonly status?: Partial<StatusReading> & { readonly kind: StatusReading['kind']; readonly message: string }
  readonly message?: string
  readonly unchanged?: boolean
  readonly verified?: boolean
  readonly startedAt?: number
  readonly finishedAt?: number
}

export type ReceiptEvent =
  | { type: 'prepare'; plan: ReceiptPlan }
  | { type: 'confirm'; now?: number }
  | { type: 'submit'; now?: number }
  | { type: 'resolve'; value: unknown; now?: number }
  | { type: 'reject'; error: unknown; now?: number }
  | { type: 'verify' }
  | { type: 'verified'; value: { applied?: boolean; message?: string } | undefined }
  | { type: 'verify-failed'; error: unknown }
  | { type: 'cancel' }
  | { type: 'reset' }

export const RECEIPT_PHASES: readonly ReceiptPhase[]
export const IDLE_RECEIPT: ActionReceiptState
export const RECEIPT_COPY: Readonly<Record<Exclude<ReceiptPhase, 'idle'>, string>>
export function receiptSettled(receipt: ActionReceiptState | null | undefined): boolean
export function receiptCanSubmit(receipt: ActionReceiptState | null | undefined): boolean
export function readSubmitResult(value: unknown): ActionReceiptState
export function receiptReducer(receipt: ActionReceiptState | null | undefined, event: ReceiptEvent): ActionReceiptState
