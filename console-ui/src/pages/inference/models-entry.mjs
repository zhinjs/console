// Model management has one entry: /agent/models. Its tab lives in the URL (?tab=...) so a
// refresh or a shared link reopens the same tab; older settings links redirect here.
export const MODELS_PATH = '/agent/models'

export const DEFAULT_INFERENCE_TAB = 'profiles'

/** Tabs every owner sees, then the one that depends on who manages the graph. */
const SHARED_TABS = Object.freeze(['profiles', 'accounts', 'services'])
const ADMINISTRATOR_TABS = Object.freeze([...SHARED_TABS, 'purposes'])
const PERSONAL_TABS = Object.freeze([...SHARED_TABS, 'sessions'])

export function inferenceTabs(hostAdministrator) {
  return hostAdministrator ? ADMINISTRATOR_TABS : PERSONAL_TABS
}

/** Missing, unknown or unavailable (e.g. purposes for a personal owner) tabs fall back to the default. */
export function resolveInferenceTab(value, hostAdministrator) {
  return typeof value === 'string' && inferenceTabs(hostAdministrator).includes(value) ? value : DEFAULT_INFERENCE_TAB
}

/** The URL for a tab; the default tab keeps the plain path and unrelated parameters survive. */
export function inferenceTabParams(current, tab) {
  const next = new URLSearchParams(current)
  if (!tab || tab === DEFAULT_INFERENCE_TAB) next.delete('tab')
  else next.set('tab', tab)
  return next
}

export function modelsHref(tab) {
  const search = inferenceTabParams(new URLSearchParams(), tab).toString()
  return search ? `${MODELS_PATH}?${search}` : MODELS_PATH
}

/** Settings locations that used to embed the same model workspace. */
export const LEGACY_SETTINGS_MODEL_SECTIONS = Object.freeze(['models', 'ai:inference'])

/** `/config?section=models[&tab=…]` -> `/agent/models[?tab=…]`; any other settings location stays. */
export function legacySettingsModelsRedirect(params) {
  const section = params.get('section')?.trim() ?? ''
  if (params.get('plugin')?.trim() || !LEGACY_SETTINGS_MODEL_SECTIONS.includes(section)) return null
  return modelsHref(params.get('tab')?.trim() || undefined)
}
