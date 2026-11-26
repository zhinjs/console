import { resolveConsoleHttpPermission } from '@zhin.js/console-protocol'

/** Rules any signed-in identity passes without a named permission. */
const OPEN_RULES = new Set(['authenticated', 'public'])

/**
 * The permission the Host requires for one Console HTTP request (`relativePath` under the API base,
 * e.g. `/agent/sessions/<key>/leaf`), from the protocol's `CONSOLE_HTTP_PERMISSIONS`: a permission
 * name, '' when any signed-in identity may, or null when the Host denies it (unmapped, RPC envelope
 * or bootstrap-only routes). Buttons that send the request are enabled from this, so they agree with
 * the Host (#64 `session-leaf-permission-mismatch`).
 */
export function httpRoutePermission(method, relativePath) {
  const rule = resolveConsoleHttpPermission(method, relativePath)
  if (!rule) return null
  if (OPEN_RULES.has(rule.permission)) return ''
  return typeof rule.permission === 'string' && rule.permission.includes('.') ? rule.permission : null
}

/**
 * Whether the current identity may send the request (`has` checks one permission): `allowed`, and the
 * permission it lacks (`missing`, null when nothing is missing or the Host denies the route for everyone).
 */
export function httpRouteAccess(method, relativePath, has) {
  const permission = httpRoutePermission(method, relativePath)
  if (permission === null) return { allowed: false, missing: null }
  if (permission === '' || has(permission)) return { allowed: true, missing: null }
  return { allowed: false, missing: permission }
}
