/** Track which configuration owners currently hold an unsaved draft. Returns the same Set when nothing changed. */
export function setOwnerDirty(owners, key, dirty) {
  if (owners.has(key) === dirty) return owners
  const next = new Set(owners)
  dirty ? next.add(key) : next.delete(key)
  return next
}

/**
 * Whether a router navigation leaves the current page. Changes that keep the pathname
 * (only the query or hash differ, e.g. switching plugins inside Settings) keep the page
 * and its drafts, so they are not guarded.
 */
export function leavesCurrentPage(currentLocation, nextLocation) {
  if (!currentLocation || !nextLocation) return false
  return currentLocation.pathname !== nextLocation.pathname
}

/**
 * Settles a react-router blocker: while it is `blocked`, ask once whether to leave, then
 * `proceed()` or `reset()`. Covers link clicks, programmatic navigate() (command palette)
 * and browser back/forward alike. Repeated calls during a pending question are ignored.
 */
export function createBlockedNavigationHandler(confirmLeave) {
  let asking = null
  return blocker => {
    if (!blocker || blocker.state !== 'blocked' || asking === blocker) return
    asking = blocker
    const settle = leave => {
      if (asking !== blocker) return
      asking = null
      if (blocker.state !== 'blocked') return
      leave ? blocker.proceed() : blocker.reset()
    }
    Promise.resolve().then(confirmLeave).then(settle, () => settle(false))
  }
}

/** While installed, refresh/close triggers the browser's beforeunload prompt. Returns the uninstall function. */
export function installUnloadGuard(view) {
  const beforeUnload = event => { event.preventDefault(); event.returnValue = '' }
  view.addEventListener('beforeunload', beforeUnload)
  return () => view.removeEventListener('beforeunload', beforeUnload)
}
