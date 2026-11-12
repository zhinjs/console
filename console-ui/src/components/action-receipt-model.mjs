/**
 * The receipt every write goes through (Console 重构规范 §危险操作与回执):
 *
 *   idle → prepared (what will change) → confirming (danger only) → submitting
 *        → succeeded | partial | unknown | failed
 *
 * `unknown` means the request may have been applied: the receipt then only offers a read-only
 * check (`verify`), never a replay of the write, and cannot be closed, cancelled or replaced by a
 * new plan. Only a check leaves it: `succeeded` when the change is there, `failed` (verified) when
 * it certainly is not — from there the user explicitly 放弃并重新开始 (`reset`). `failed` was
 * certainly not applied (the Host refused it), so it may be prepared again.
 *
 * A danger plan's second confirmation ignores confirms for {@link CONFIRM_GUARD_MS} after it
 * appeared, so a double click or a repeated Enter on 「确认」 cannot run through 「确认执行」.
 * Pure reducer; the hook and component wrap it.
 */
import { outcomeUnknown, statusFromError } from './status-state-model.mjs'

export const RECEIPT_PHASES = Object.freeze(['idle', 'prepared', 'confirming', 'submitting', 'succeeded', 'partial', 'unknown', 'failed', 'verifying'])

export const IDLE_RECEIPT = Object.freeze({ phase: 'idle' })

/** How long the 「确认执行」 step ignores confirms after it appeared (keyboard and pointer alike). */
export const CONFIRM_GUARD_MS = 400

/** Phases that keep the control busy: no new plan, no second write (an unknown outcome included). */
const BLOCKING_PHASES = Object.freeze(['prepared', 'confirming', 'submitting', 'verifying', 'unknown'])

/**
 * Whether the page must not start another write through this receipt's controls: a plan is
 * waiting for confirmation, a request is in flight or being checked, or the outcome is unknown.
 * Every page gates its write buttons with this, so 结果未知 never reopens them.
 */
export function receiptBlocksActions(receipt) {
  return BLOCKING_PHASES.includes(receipt?.phase)
}

/** Whether 「确认执行」 is still inside its guard window. */
export function receiptConfirmGuarded(receipt, now = Date.now()) {
  return receipt?.phase === 'confirming' && typeof receipt.confirmingAt === 'number' && now - receipt.confirmingAt < CONFIRM_GUARD_MS
}

/** Phases with a final answer for the action (the receipt may still verify an `unknown`). */
export function receiptSettled(receipt) {
  return ['succeeded', 'partial', 'unknown', 'failed'].includes(receipt?.phase)
}

/** Whether the submit button may be pressed: never twice, never after an unknown outcome. */
export function receiptCanSubmit(receipt) {
  return receipt?.phase === 'prepared' || receipt?.phase === 'confirming'
}

/**
 * Normalises what `submit` resolved with:
 * - nothing / `{ status: 'saved' | 'succeeded' | 'unchanged' }` → succeeded
 * - `{ status: 'partial', items }` or items with a failure → partial
 * - `{ status: 'conflict' | 'invalid' | 'failed', message, reason? }` → failed (the Host did not apply it);
 *   `reason` is the page's own refusal tag (e.g. `environment-reference`) so it can react in place
 * `items` are `{ label, ok, message? }`.
 */
export function readSubmitResult(value) {
  const record = value && typeof value === 'object' ? value : {}
  const items = Array.isArray(record.items)
    ? record.items.filter(item => item && typeof item === 'object' && typeof item.label === 'string').map(item => ({ label: item.label, ok: item.ok === true, ...(typeof item.message === 'string' ? { message: item.message } : {}) }))
    : []
  const message = typeof record.message === 'string' ? record.message : undefined
  const status = typeof record.status === 'string' ? record.status : undefined
  if (status === 'conflict' || status === 'invalid' || status === 'failed') {
    const reason = typeof record.reason === 'string' && record.reason ? record.reason : undefined
    return { phase: 'failed', status: { kind: status === 'conflict' ? 'conflict' : 'error', message: message ?? status, ...(reason ? { reason } : {}) }, items }
  }
  if (status === 'unknown') return { phase: 'unknown', items, ...(message ? { message } : {}) }
  const failedItems = items.filter(item => !item.ok)
  if (status === 'partial' || (failedItems.length && failedItems.length < items.length)) return { phase: 'partial', items, ...(message ? { message } : {}) }
  if (items.length && failedItems.length === items.length) return { phase: 'failed', status: { kind: 'error', message: message ?? failedItems[0].message ?? '' }, items }
  return { phase: 'succeeded', items, ...(message ? { message } : {}), ...(status === 'unchanged' ? { unchanged: true } : {}) }
}

/**
 * Reducer. Events:
 * `prepare { plan }`  `{ plan: { title, summary?, changes?: string[], danger?: boolean, confirmLabel? } }`
 * `confirm` (danger → confirming, else submitting) · `submit` · `resolve { value }` · `reject { error }`
 * `verify` · `verified { value }` (`{ applied: true | false | undefined, message? }`) · `cancel` · `reset`.
 */
export function receiptReducer(receipt, event) {
  const current = receipt ?? IDLE_RECEIPT
  switch (event?.type) {
    case 'prepare':
      // An unknown outcome is never replaced by a new plan: that would be a replay.
      if (current.phase === 'submitting' || current.phase === 'verifying' || current.phase === 'unknown') return current
      return { phase: 'prepared', plan: event.plan }
    case 'confirm': {
      if (current.phase !== 'prepared') return current
      const now = event.now ?? Date.now()
      return current.plan?.danger ? { ...current, phase: 'confirming', confirmingAt: now } : { ...current, phase: 'submitting', startedAt: now }
    }
    case 'submit': {
      if (!receiptCanSubmit(current)) return current
      const now = event.now ?? Date.now()
      if (receiptConfirmGuarded(current, now)) return current
      const { confirmingAt: _confirmingAt, ...rest } = current
      return { ...rest, phase: 'submitting', startedAt: now }
    }
    case 'resolve': {
      if (current.phase !== 'submitting') return current
      const result = readSubmitResult(event.value)
      return { plan: current.plan, ...result, finishedAt: event.now ?? Date.now() }
    }
    case 'reject': {
      if (current.phase !== 'submitting') return current
      const status = statusFromError(event.error)
      return { plan: current.plan, phase: outcomeUnknown(status) ? 'unknown' : 'failed', status, finishedAt: event.now ?? Date.now() }
    }
    case 'verify':
      if (current.phase !== 'unknown') return current
      return { ...current, phase: 'verifying' }
    case 'verified': {
      if (current.phase !== 'verifying') return current
      const applied = event.value?.applied
      const message = typeof event.value?.message === 'string' ? event.value.message : undefined
      if (applied === true) return { plan: current.plan, phase: 'succeeded', verified: true, ...(message ? { message } : {}) }
      if (applied === false) return { plan: current.plan, phase: 'failed', verified: true, status: { kind: 'error', message: message ?? '' } }
      return { ...current, phase: 'unknown', ...(message ? { message } : {}) }
    }
    case 'verify-failed':
      if (current.phase !== 'verifying') return current
      return { ...current, phase: 'unknown', status: statusFromError(event.error) }
    case 'cancel':
      // Cancel withdraws a plan that was not sent; anything sent has its own outcome.
      if (current.phase !== 'prepared' && current.phase !== 'confirming') return current
      return IDLE_RECEIPT
    case 'reset':
      // Closing a settled receipt; an unknown outcome stays until a check settles it.
      if (current.phase === 'submitting' || current.phase === 'verifying' || current.phase === 'unknown') return current
      return IDLE_RECEIPT
    default:
      return current
  }
}

/** Authored copy per phase (displayed through i18n). */
export const RECEIPT_COPY = Object.freeze({
  prepared: '确认要执行的修改',
  confirming: '这是危险操作，请再次确认',
  submitting: '正在提交…',
  succeeded: '已完成',
  partial: '部分完成',
  unknown: '结果未知',
  failed: '未执行',
  verifying: '正在核对当前状态…',
})
