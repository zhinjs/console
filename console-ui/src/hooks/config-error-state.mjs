export function configErrorReducer(state, action) {
 switch (action.type) {
  case 'read-start': return {...state, readError: null}
  case 'read-failed': return {...state, readError: action.error}
  case 'save-start':
  case 'save-succeeded':
  case 'discard-save': return {...state, saveError: null}
  case 'save-failed': return {...state, saveError: action.error}
  default: return state
 }
}
