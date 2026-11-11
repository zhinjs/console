/**
 * Runs `poll` every `intervalMs` while the tab is visible, and once when a hidden tab
 * becomes visible again. Returns the function that stops it. `env` exists for tests.
 */
export function startVisiblePolling(poll, intervalMs, env = globalThis) {
  const page = env.document
  const visible = () => page?.visibilityState !== 'hidden'
  const timer = env.setInterval(() => { if (visible()) poll() }, intervalMs)
  const onVisibilityChange = () => { if (visible()) poll() }
  page?.addEventListener?.('visibilitychange', onVisibilityChange)
  return () => {
    env.clearInterval(timer)
    page?.removeEventListener?.('visibilitychange', onVisibilityChange)
  }
}
