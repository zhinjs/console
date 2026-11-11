/** Track which configuration owners currently hold an unsaved draft. Returns the same Set when nothing changed. */
export function setOwnerDirty(owners, key, dirty) {
  if (owners.has(key) === dirty) return owners
  const next = new Set(owners)
  dirty ? next.add(key) : next.delete(key)
  return next
}

/**
 * The in-app path a plain left click on this anchor would open, or null when the click
 * must be left alone: modified or non-primary clicks, new windows, downloads, other
 * origins, and links that stay on the current page (only the query or hash changes).
 */
export function guardedNavigationTarget(anchor, click, current) {
  if (!anchor || click.defaultPrevented || click.button !== 0) return null
  if (click.metaKey || click.ctrlKey || click.shiftKey || click.altKey) return null
  if (anchor.download || (anchor.target && anchor.target !== '_self')) return null
  let url
  try { url = new URL(anchor.href, current.href) } catch { return null }
  const here = new URL(current.href)
  if (url.origin !== here.origin || url.pathname === here.pathname) return null
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * While installed: refresh/close triggers the browser's beforeunload prompt, and in-app
 * link clicks are held until the user confirms leaving. Returns the uninstall function.
 */
export function installUnsavedChangesGuard({ view, confirmLeave, navigate }) {
  let asking = false
  const beforeUnload = event => { event.preventDefault(); event.returnValue = '' }
  const click = event => {
    const anchor = event.target?.closest?.('a[href]')
    const path = guardedNavigationTarget(anchor && {
      href: anchor.getAttribute('href') ?? '', target: anchor.getAttribute('target'), download: anchor.hasAttribute('download'),
    }, event, { href: view.location.href })
    if (!path) return
    // Capture phase on window: runs before the router's Link handler and the browser default.
    event.preventDefault(); event.stopPropagation()
    if (asking) return
    asking = true
    Promise.resolve(confirmLeave()).then(leave => { asking = false; if (leave) navigate(path) }, () => { asking = false })
  }
  view.addEventListener('beforeunload', beforeUnload)
  view.addEventListener('click', click, true)
  return () => {
    view.removeEventListener('beforeunload', beforeUnload)
    view.removeEventListener('click', click, true)
  }
}
