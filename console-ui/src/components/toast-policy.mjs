/** Error/warning feedback needs explicit dismissal; routine feedback can expire. */
export function toastDuration(variant = 'default', duration) {
  if (typeof duration === 'number' && Number.isFinite(duration)) return Math.max(0, Math.min(duration, 30_000))
  return variant === 'error' || variant === 'warning' ? 0 : 5_000
}

export const MAX_TOASTS = 5

/** Keep the notification surface bounded and coalesce identical repeated feedback. */
export function appendToast(previous, next) {
  return [...previous.filter(toast => toast.description !== next.description || toast.title !== next.title || toast.variant !== next.variant), next].slice(-MAX_TOASTS)
}
