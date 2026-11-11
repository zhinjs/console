/**
 * Runs `poll` every `intervalMs` while the tab is visible, and once when a hidden tab
 * becomes visible again. Returns the function that stops it.
 */
export function startVisiblePolling(poll, intervalMs) {
  const page = typeof document === 'undefined' ? undefined : document
  const visible = () => page?.visibilityState !== 'hidden'
  const timer = setInterval(() => { if (visible()) poll() }, intervalMs)
  const onVisibilityChange = () => { if (visible()) poll() }
  page?.addEventListener?.('visibilitychange', onVisibilityChange)
  return () => {
    clearInterval(timer)
    page?.removeEventListener?.('visibilitychange', onVisibilityChange)
  }
}
