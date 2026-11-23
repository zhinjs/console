// Model management has one entry: /features/ai (ADR 0052). Its tab lives in the URL (?tab=...)
// so a refresh or a shared link reopens the same tab; older settings links redirect here.
export const MODELS_PATH = '/features/ai'

export const DEFAULT_INFERENCE_TAB = 'profiles'

/** Tabs every owner sees, then the one that depends on who manages the graph. */
const SHARED_TABS = Object.freeze(['profiles', 'accounts', 'services'])
const ADMINISTRATOR_TABS = Object.freeze([...SHARED_TABS, 'purposes'])
const PERSONAL_TABS = Object.freeze([...SHARED_TABS, 'sessions'])

export function inferenceTabs(hostAdministrator) {
  return hostAdministrator ? ADMINISTRATOR_TABS : PERSONAL_TABS
}

/**
 * Missing, unknown or unavailable (e.g. purposes for a personal owner) tabs fall back to the default;
 * a link naming an account (`?account=<id>`, e.g. from an attention item) without a usable tab opens 账号.
 */
export function resolveInferenceTab(value, hostAdministrator, account) {
  if (typeof value === 'string' && inferenceTabs(hostAdministrator).includes(value)) return value
  return inferenceFocusAccount(account) ? 'accounts' : DEFAULT_INFERENCE_TAB
}

/** The account a `?account=` link points at, or undefined. */
export function inferenceFocusAccount(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

/**
 * The URL for a tab; the default tab keeps the plain path and unrelated parameters survive. Leaving
 * 账号 drops `account`, which only points into that tab.
 */
export function inferenceTabParams(current, tab) {
  const next = new URLSearchParams(current)
  if (!tab || tab === DEFAULT_INFERENCE_TAB) next.delete('tab')
  else next.set('tab', tab)
  if (tab !== 'accounts') next.delete('account')
  if (tab !== 'purposes') next.delete('purpose')
  return next
}

const PURPOSE_SECTIONS = ['defaults', 'ambient', 'decisions', 'agents']
const PURPOSE_LEVELS = ['adapters', 'endpoints', 'scenes']

/**
 * What a `?purpose=` link points at on 用途 (#64 `profile-usage-not-linked`): a section, or an
 * adapter / account / conversation override (`adapters:sandbox`, `scenes:qq:group:9`). Undefined otherwise.
 */
export function inferenceFocusPurpose(value) {
  if (typeof value !== 'string') return undefined
  if (PURPOSE_SECTIONS.includes(value)) return { section: value }
  const colon = value.indexOf(':')
  const level = colon > 0 ? value.slice(0, colon) : ''
  const key = colon > 0 ? value.slice(colon + 1) : ''
  return PURPOSE_LEVELS.includes(level) && key ? { section: 'scopes', level, key } : undefined
}

/** The URL parameters that open 用途 at `focus` (a `?purpose=` value). */
export function inferencePurposeParams(current, focus) {
  const next = inferenceTabParams(current, 'purposes')
  next.set('purpose', focus)
  return next
}

export function modelsHref(tab) {
  const search = inferenceTabParams(new URLSearchParams(), tab).toString()
  return search ? `${MODELS_PATH}?${search}` : MODELS_PATH
}

/** Settings locations that used to embed the same model workspace. */
export const LEGACY_SETTINGS_MODEL_SECTIONS = Object.freeze(['models', 'ai:inference'])

/** `/config?section=models[&tab=…]` -> `/features/ai[?tab=…]`; any other settings location stays. */
export function legacySettingsModelsRedirect(params) {
  const section = params.get('section')?.trim() ?? ''
  if (params.get('plugin')?.trim() || !LEGACY_SETTINGS_MODEL_SECTIONS.includes(section)) return null
  return modelsHref(params.get('tab')?.trim() || undefined)
}
