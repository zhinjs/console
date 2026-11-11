export const MODELS_PATH: '/agent/models'
export type InferenceTabId = 'profiles' | 'accounts' | 'services' | 'purposes' | 'sessions'
export const DEFAULT_INFERENCE_TAB: 'profiles'
export function inferenceTabs(hostAdministrator: boolean | undefined): readonly InferenceTabId[]
export function resolveInferenceTab(value: string | null | undefined, hostAdministrator: boolean | undefined): InferenceTabId
export function inferenceTabParams(current: URLSearchParams, tab: string | undefined): URLSearchParams
export function modelsHref(tab?: string): string
export const LEGACY_SETTINGS_MODEL_SECTIONS: readonly string[]
export function legacySettingsModelsRedirect(params: URLSearchParams): string | null
