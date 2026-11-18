/**
 * Save feedback on the button itself (console#125): 保存中… while the request runs, then a check and
 * 已保存 for SAVED_HOLD_MS, then the button's own label again. No toast for a plain save.
 */
export const SAVED_HOLD_MS = 1500

/** Phase of a save button: a running save wins over a recent success. */
export function saveButtonPhase({ saving, saved }) {
  if (saving) return 'saving'
  if (saved) return 'saved'
  return 'idle'
}
