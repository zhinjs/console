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
  /**
   * What the write needs (request body, the change to check). Kept with the receipt, so a check after
   * the panel was unmounted and mounted again still knows what it is checking.
   */
  readonly payload?: unknown
}

export interface ReceiptItem { readonly label: string; readonly ok: boolean; readonly message?: string }

export interface ActionReceiptState {
  readonly phase: ReceiptPhase
  readonly plan?: ReceiptPlan
  readonly items?: readonly ReceiptItem[]
  readonly status?: Partial<StatusReading> & { readonly kind: StatusReading['kind']; readonly message: string; readonly reason?: string }
  readonly message?: string
  readonly unchanged?: boolean
  readonly verified?: boolean
  readonly startedAt?: number
  /** When the 「确认执行」 step appeared (danger plans). */
  readonly confirmingAt?: number
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
export const CONFIRM_GUARD_MS: number
export function receiptBlocksActions(receipt: ActionReceiptState | null | undefined): boolean
export function receiptConfirmGuarded(receipt: ActionReceiptState | null | undefined, now?: number): boolean
export const RECEIPT_COPY: Readonly<Record<Exclude<ReceiptPhase, 'idle'>, string>>
export function receiptSettled(receipt: ActionReceiptState | null | undefined): boolean
export function receiptCanSubmit(receipt: ActionReceiptState | null | undefined): boolean
export function readSubmitResult(value: unknown): ActionReceiptState
export function receiptReducer(receipt: ActionReceiptState | null | undefined, event: ReceiptEvent): ActionReceiptState
