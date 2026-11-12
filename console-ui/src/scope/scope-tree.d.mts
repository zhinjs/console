import type { ConversationKind } from '../pages/features/feature-model.mjs'

export type ScopeLevel = 'global' | 'adapter' | 'endpoint' | 'conversation'
export type ScopeTab = 'overview' | 'chat' | 'access' | 'features' | 'roles' | 'records'

export interface ScopeRef {
  readonly level?: ScopeLevel
  readonly adapter?: string
  readonly endpoint?: string
  readonly kind?: ConversationKind
  readonly id?: string
}
export interface Scope extends ScopeRef { readonly level: ScopeLevel }

export type ScopeParseResult =
  | { readonly ok: true; readonly scope: Scope; readonly key: string | null }
  | { readonly ok: false; readonly reason: 'invalid-conversation'; readonly segment: string; readonly scope: Scope }

export interface ScopeCrumb { readonly level: ScopeLevel; readonly scope: Scope; readonly label: string; readonly href: string }

export interface ScopePickerAccount {
  readonly endpoint: string
  readonly connected: boolean
  /** False when the Host does not list the account right now (only the current scope). */
  readonly listed: boolean
  readonly current: boolean
  readonly conversations: readonly { readonly kind: ConversationKind; readonly id: string; readonly name?: string }[]
}
export interface ScopePickerAdapter { readonly adapter: string; readonly current: boolean; readonly accounts: readonly ScopePickerAccount[] }

export const SCOPE_LEVELS: readonly ScopeLevel[]
export const SCOPE_ROOT: '/scope'
export const SCOPE_TABS: Readonly<Record<ScopeLevel, readonly ScopeTab[]>>
export const DEFAULT_SCOPE_TAB: 'overview'
export const SCOPE_TAB_PARAM: 'tab'
export const SCOPE_TAB_LABELS: Readonly<Record<ScopeTab, string>>
export const SCOPE_LEVEL_LABELS: Readonly<Record<ScopeLevel, string>>
export const SCOPE_TAB_PERMISSIONS: Readonly<Record<ScopeTab, readonly string[]>>
export const CONVERSATION_KIND_LABELS: Readonly<Record<ConversationKind, string>>

export function scopeLevel(scope: ScopeRef | null | undefined): ScopeLevel
export function resolveScopeTab(level: ScopeLevel, requested: unknown): ScopeTab
export function scopeHref(scope?: ScopeRef, tab?: ScopeTab | null, params?: URLSearchParams | Record<string, string> | null): string
export function scopeKey(scope: ScopeRef): string | null
export function parseScopeKey(key: unknown): Scope | null
export function parseScopeParams(params?: { adapter?: string; endpoint?: string; conversation?: string }): ScopeParseResult
export function parseScopePath(pathname: unknown): ScopeParseResult | null
export function parentScope(scope: ScopeRef): Scope | null
export function scopeChain(scope?: ScopeRef | null): Scope[]
export function scopeCrumbs(scope: ScopeRef, names?: { adapter?: string; endpoint?: string; conversation?: string }): ScopeCrumb[]
export function scopeIdentity(scope: ScopeRef): string
export function sameScope(a: ScopeRef, b: ScopeRef): boolean
export function scopePickerTree(
  endpoints?: readonly { readonly adapter: string; readonly name: string; readonly connected?: boolean }[],
  current?: ScopeRef,
  conversations?: readonly { readonly kind: string; readonly id: string; readonly name?: string }[],
): ScopePickerAdapter[]
