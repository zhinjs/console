/**
 * What the signed-in principal may do, as reported by the Host (ADR 0049 permission names).
 *
 * Until the Host reports permissions (`/auth/*`, phase B) the Console treats the session as
 * unrestricted and leaves enforcement to the Host, which is how every existing token behaves.
 * Navigation and read-only affordances read this store; it never grants anything the Host denies.
 */

/** `{ unrestricted: true }` or `{ unrestricted: false, permissions: ReadonlySet<string> }`. */
export const UNRESTRICTED_ACCESS = Object.freeze({ unrestricted: true, permissions: Object.freeze(new Set()) })

let current = UNRESTRICTED_ACCESS
const listeners = new Set()

/** Normalises a Host report: a missing or non-array permission list means "not reported". */
export function createConsoleAccess(report) {
  const list = report && Array.isArray(report.permissions) ? report.permissions : null
  if (!list) return UNRESTRICTED_ACCESS
  return Object.freeze({
    unrestricted: false,
    permissions: Object.freeze(new Set(list.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))),
  })
}

export function getConsoleAccess() {
  return current
}

export function setConsoleAccess(report) {
  current = createConsoleAccess(report)
  for (const listener of listeners) listener()
}

export function resetConsoleAccess() {
  setConsoleAccess(null)
}

export function subscribeConsoleAccess(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Exact names, plus `*` and `<prefix>.*` grants (e.g. `ops.*`). */
export function hasConsolePermission(name, access = current) {
  if (!access || access.unrestricted) return true
  if (access.permissions.has(name) || access.permissions.has('*')) return true
  const parts = String(name).split('.')
  for (let i = parts.length - 1; i > 0; i--) {
    if (access.permissions.has(`${parts.slice(0, i).join('.')}.*`)) return true
  }
  return false
}

export function hasAnyConsolePermission(names, access = current) {
  return names.length === 0 || names.some(name => hasConsolePermission(name, access))
}
