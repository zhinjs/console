import type { Scope } from '../../scope/scope-tree.mjs'
export declare function scopeFilterHref(path: string, scope: Scope | null | undefined): string
export declare function readScopeFilterParams(params: URLSearchParams | null | undefined): Scope | null
