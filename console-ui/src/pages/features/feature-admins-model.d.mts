import type { FeatureLevel, FeatureRpcBody } from './feature-model.mjs'

export const FEATURE_ADMIN_RPC: Readonly<{ LIST: 'feature.admins.list'; ADD: 'feature.admins.add'; REMOVE: 'feature.admins.remove' }>
export type FeatureAdminSource = 'grant' | 'config' | 'master' | 'platform'
export interface FeatureAdmin {
  readonly level: FeatureLevel
  /** Empty on the global level. */
  readonly key: string
  readonly adapter: string
  readonly userId: string
  readonly displayName?: string
  readonly source: FeatureAdminSource
  readonly grantedBy?: string
  readonly grantedAt?: number | string
}
export interface FeatureAdminRow extends FeatureAdmin { readonly inherited: boolean }
export interface FeatureAdminPage { readonly items: FeatureAdmin[]; readonly cursor?: string }
export interface AdminScope { readonly level: FeatureLevel; readonly key?: string }

export function adminScopeChain(level: FeatureLevel, key?: string): AdminScope[]
export function adminScopeAdapter(level: FeatureLevel, key?: string): string | undefined
export function adminsListRequest(input: { level: FeatureLevel; key?: string; cursor?: string }): FeatureRpcBody
export function readAdminPage(payload: unknown): FeatureAdminPage
export function adminsApplyingTo(items: readonly FeatureAdmin[], level: FeatureLevel, key?: string): FeatureAdminRow[]
export function adminRemovable(row: FeatureAdminRow, canConfigure: boolean): boolean
export function adminMutationRequest(action: 'add' | 'remove', input: { level: FeatureLevel; key?: string; adapter?: string; userId: string }): FeatureRpcBody
