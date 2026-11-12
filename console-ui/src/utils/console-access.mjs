/**
 * What the signed-in principal may do, as reported by the Host (ADR 0049 permission names).
 *
 * Until the Host reports permissions (`/auth/*`, phase B) the Console treats the session as
 * unrestricted and leaves enforcement to the Host, which is how every existing token behaves.
 * Navigation and read-only affordances read this store; it never grants anything the Host denies.
 */

import { CONSOLE_SCOPED_PERMISSIONS } from '../contracts/console-protocol-mirror.mjs'

/**
 * `{ unrestricted: true }` or `{ unrestricted: false, permissions, scoped }`: `permissions` are held
 * through global bindings (what `/auth/me` reports as `permissions`); `scoped` are the adapter /
 * endpoint bindings (`/auth/me` `bindings`), which the gateway does not expand into `permissions`
 * and which count only for objects under their scope (`bindingScopeCovers`, ADR 0049 §3).
 */
export const UNRESTRICTED_ACCESS = Object.freeze({ unrestricted: true, permissions: Object.freeze(new Set()), scoped: Object.freeze([]) })

const SCOPED = new Set(CONSOLE_SCOPED_PERMISSIONS)

/** Scope targets a permission is checked at (mirror of `ConsoleScopeTarget`). */
export const GLOBAL_TARGET = Object.freeze({ kind: 'global' })
/** Any object (list reads such as `endpoint.list`, which a scoped binding can answer in part). */
export const ANY_TARGET = Object.freeze({ kind: 'any' })

function readBinding(binding) {
  const scope = binding && typeof binding === 'object' ? binding.scope : undefined
  if (!scope || typeof scope !== 'object' || (scope.kind !== 'adapter' && scope.kind !== 'endpoint')) return null
  if (typeof scope.key !== 'string' || !scope.key) return null
  if (scope.kind === 'endpoint' && !/^[^/]+\/[^/]+$/u.test(scope.key)) return null
  const list = Array.isArray(binding.permissions) ? binding.permissions : []
  const permissions = list.filter(item => typeof item === 'string' && SCOPED.has(item.trim())).map(item => item.trim())
  return permissions.length ? Object.freeze({ kind: scope.kind, key: scope.key, permissions: Object.freeze(new Set(permissions)) }) : null
}

let current = UNRESTRICTED_ACCESS
const listeners = new Set()

/** Normalises a Host report: a missing or non-array permission list means "not reported". */
export function createConsoleAccess(report) {
  const list = report && Array.isArray(report.permissions) ? report.permissions : null
  if (!list) return UNRESTRICTED_ACCESS
  const bindings = report && Array.isArray(report.bindings) ? report.bindings : []
  return Object.freeze({
    unrestricted: false,
    permissions: Object.freeze(new Set(list.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()))),
    scoped: Object.freeze(bindings.map(readBinding).filter(Boolean)),
  })
}

/**
 * The target of an object page's scope (`{ level, adapter, endpoint }`): an adapter, an account, or
 * for a conversation its account (conversations have no bindings of their own).
 */
export function scopePermissionTarget(scope) {
  if (!scope?.adapter) return GLOBAL_TARGET
  if (!scope.endpoint) return Object.freeze({ kind: 'adapter', adapter: String(scope.adapter) })
  return Object.freeze({ kind: 'endpoint', adapter: String(scope.adapter), endpoint: String(scope.endpoint) })
}

/** `bindingScopeCovers` of the protocol for a non-global binding and a Console permission. */
function bindingCovers(binding, target) {
  if (target.kind === 'any') return true
  if (target.kind !== 'adapter' && target.kind !== 'endpoint') return false
  if (binding.kind === 'adapter') return target.adapter === binding.key
  return target.kind === 'endpoint' && binding.key === `${target.adapter}/${target.endpoint}`
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

/**
 * Exact names, plus `*` and `<prefix>.*` grants (e.g. `ops.*`). With a `target` (an adapter, an
 * account, or `ANY_TARGET`), adapter / endpoint bindings that cover it count too, for the
 * permissions a binding can narrow (`CONSOLE_SCOPED_PERMISSIONS`); without one only global grants do.
 */
export function hasConsolePermission(name, access = current, target = GLOBAL_TARGET) {
  if (!access || access.unrestricted) return true
  if (access.permissions.has(name) || access.permissions.has('*')) return true
  const parts = String(name).split('.')
  for (let i = parts.length - 1; i > 0; i--) {
    if (access.permissions.has(`${parts.slice(0, i).join('.')}.*`)) return true
  }
  if (!SCOPED.has(name) || !target || target.kind === 'global') return false
  return (access.scoped ?? []).some(binding => binding.permissions.has(name) && bindingCovers(binding, target))
}

export function hasAnyConsolePermission(names, access = current, target = GLOBAL_TARGET) {
  return names.length === 0 || names.some(name => hasConsolePermission(name, access, target))
}
