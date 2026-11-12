/**
 * Where a receipt's state lives. Object pages mount only the current tab (Console 重构规范 §5), so a
 * receipt kept in component state would be lost with its tab — and with it the knowledge that a
 * write is in flight or its outcome is unknown, reopening the buttons that sent it. A receipt with a
 * `persistKey` (scope + action, e.g. `feature:adapter:qq:ai`) lives in the shared module store
 * instead: the submit still settles into it while the tab is gone, and the remounted panel shows it
 * again. Kept in memory for this page load only, like the chat drafts (`chat-draft-store.mjs`).
 */
import { IDLE_RECEIPT, receiptReducer } from './action-receipt-model.mjs'

/** A store of receipts by key: `get(key)`, `dispatch(key, event)` → next state, `subscribe(key, listener)`. */
export function createReceiptStore() {
  const entries = new Map()
  const listeners = new Map()
  return Object.freeze({
    get(key) {
      return entries.get(key) ?? IDLE_RECEIPT
    },
    dispatch(key, event) {
      const previous = entries.get(key) ?? IDLE_RECEIPT
      const next = receiptReducer(previous, event)
      if (next === previous) return next
      // Idle receipts are not kept: nothing to restore.
      if (next.phase === 'idle') entries.delete(key); else entries.set(key, next)
      for (const listener of [...(listeners.get(key) ?? [])]) listener()
      return next
    },
    subscribe(key, listener) {
      let set = listeners.get(key)
      if (!set) { set = new Set(); listeners.set(key, set) }
      set.add(listener)
      return () => {
        set.delete(listener)
        if (!set.size) listeners.delete(key)
      }
    },
    /** Keys with a receipt that is not idle (tests, diagnostics). */
    keys() {
      return [...entries.keys()]
    },
  })
}

/** The page-wide store of receipts with a `persistKey`. */
export const sharedReceipts = createReceiptStore()
