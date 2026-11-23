export const MODELS_PATH: '/agent/models'
export type InferenceTabId = 'profiles' | 'accounts' | 'services' | 'purposes' | 'sessions'
export const DEFAULT_INFERENCE_TAB: 'profiles'
export function inferenceTabs(hostAdministrator: boolean | undefined): readonly InferenceTabId[]
export function resolveInferenceTab(value: string | null | undefined, hostAdministrator: boolean | undefined, account?: string | null): InferenceTabId
export function inferenceFocusAccount(value: string | null | undefined): string | undefined
export function inferenceTabParams(current: URLSearchParams, tab: string | undefined): URLSearchParams
export function modelsHref(tab?: string): string
export const LEGACY_SETTINGS_MODEL_SECTIONS: readonly string[]
export function legacySettingsModelsRedirect(params: URLSearchParams): string | null
export function inferenceFocusPurpose(value: string | null | undefined): import('./model.mjs').PurposeFocus | undefined
export function inferencePurposeParams(current: URLSearchParams, focus: string): URLSearchParams
