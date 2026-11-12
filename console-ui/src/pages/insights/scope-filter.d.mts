import type { Scope, ScopeRef, ScopeTab } from '../../scope/scope-tree.mjs'

export interface ScopeFilter {
  readonly active: boolean
  readonly scope: Scope
  readonly identity: string
  /** A `conversation` value that is not `<kind>:<id>`; the filter then stops at its account. */
  readonly invalid?: string
}

export const SCOPE_FILTER_PARAMS: readonly ['adapter', 'endpoint', 'conversation']
export function readScopeFilter(params: { get(name: string): string | null } | null | undefined): ScopeFilter
export function scopeFilterParams(scope: ScopeRef): URLSearchParams
export function scopeFilterHref(path: string, scope: ScopeRef, extra?: Record<string, string | number | null | undefined>): string
export function clearScopeFilter(params: URLSearchParams): URLSearchParams
export function scopeObjectHref(scope: ScopeRef, tab?: ScopeTab): string
export function logScopeTokens(scope: ScopeRef): string[]
export function logServerQuery(userQuery: string | null | undefined, scope: ScopeRef): string
export function matchesLogScope(entry: { message?: unknown; name?: unknown; source?: unknown } | null | undefined, tokens: readonly string[]): boolean
export function replayScopeFilter(scope: ScopeRef): { platform?: string; sceneId?: string }
export function replayScopeApproximate(scope: ScopeRef): boolean
export function usageSessionPattern(scope: ScopeRef): string
export function ambientGroupKey(scope: ScopeRef): string | null
export function ambientSettingsHref(scope: ScopeRef): string | null
