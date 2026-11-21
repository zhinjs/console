import { serverCodeOf } from '../components/status-state-model.mjs'

/**
 * Whether a failed `config:get-source` was refused for lack of permission: HTTP 403 or the Host's
 * `forbidden` / `permission_denied` code, nothing else. A 401 (signed out, expired session) is
 * not a missing `ops.config.read`: it stays a read failure, and the session handling signs in again.
 */
export function isReadDenied(cause) {
 const details = cause !== null && typeof cause === 'object' && cause.details !== null && typeof cause.details === 'object' ? cause.details : {}
 if (Number(details.httpStatus) === 403) return true
 const code = serverCodeOf(cause)
 return code === 'forbidden' || code === 'permission_denied'
}

/** `readDenied` is present only while the last read was refused for lack of permission. */
function withoutDenied(state) {
 const { readDenied: _denied, ...rest } = state
 return rest
}
export function configErrorReducer(state, action) {
 switch (action.type) {
  case 'read-start': return {...withoutDenied(state), readError: null}
  // `denied`: the identity may not read the configuration (403) — a 无权限 panel, never 重试读取.
  case 'read-failed': return action.denied === true ? {...state, readError: action.error, readDenied: true} : {...withoutDenied(state), readError: action.error}
  case 'save-start':
  case 'save-succeeded':
  case 'discard-save': return {...state, saveError: null}
  case 'save-failed': return {...state, saveError: action.error}
  default: return state
 }
}
