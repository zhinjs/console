/** Message shown inside ConfirmDialog when onConfirm rejects; null means "use the generic fallback". */
export function confirmErrorMessage(error) {
  if (error instanceof Error) return error.message.trim() || null
  if (typeof error === 'string') return error.trim() || null
  if (error && typeof error === 'object' && typeof error.message === 'string') return error.message.trim() || null
  return null
}

/** Typed confirmation for irreversible actions: exact, case-sensitive match; surrounding whitespace is ignored. */
export function confirmTextMatches(typed, expected) {
  if (expected == null || expected === '') return true
  return typeof typed === 'string' && typed.trim() === expected
}

export function canSubmitConfirm({ loading, typed, confirmText }) {
  return !loading && confirmTextMatches(typed, confirmText)
}
