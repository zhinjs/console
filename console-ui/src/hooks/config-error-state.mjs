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
