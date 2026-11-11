import type { PermissionCatalog, PermissionCommand } from './permission-explanation-model.mjs'
export interface PermissionLink { id: string; name: string; owner: string }
export type PermissionLinkMatch = { status: 'none' | 'missing' | 'ambiguous'; command?: undefined } | { status: 'matched'; command: PermissionCommand }
export type PermissionCatalogState = 'unavailable' | 'loading' | 'error' | 'ready' | 'empty' | 'idle'
export function permissionCommandName(value: unknown): string
export function readPermissionLink(params: { get(key: string): string | null } | null | undefined): PermissionLink | null
export function permissionLinkSearch(command: { id?: string; name?: string; owner?: string } | null | undefined): URLSearchParams
export function permissionLinkFor(name: string, owner?: string): string
export function matchPermissionLink(commands: readonly PermissionCommand[] | null | undefined, link: PermissionLink | null): PermissionLinkMatch
export function permissionCatalogState(input: { denied: boolean; active: boolean; loading: boolean; error: string | null; catalog: PermissionCatalog | null }): PermissionCatalogState
