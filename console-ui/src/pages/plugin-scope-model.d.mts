import type { FeatureLock, FeatureMatrixRow } from './features/feature-model.mjs'

type Translate = (message: string, values?: readonly unknown[]) => string
type MatrixLike = {
  readonly adapters?: readonly string[]
  readonly endpoints?: Readonly<Record<string, readonly string[]>>
  readonly rows?: readonly Pick<FeatureMatrixRow, 'plugin' | 'global' | 'adapters' | 'conversationOverrides'>[]
} | null | undefined

export interface PluginScopeSummary {
  readonly plugin: string
  readonly global: { readonly enabled: boolean; readonly overridden: boolean; readonly href: string }
  readonly adapters: readonly { readonly alias: string; readonly enabled: boolean | null; readonly overridden: boolean; readonly lockedBy?: FeatureLock; readonly accounts: number; readonly href: string }[]
  readonly conversations: readonly { readonly alias: string; readonly endpoint: string; readonly count: number; readonly href: string }[]
  readonly totals: { readonly adaptersOn: number; readonly adaptersOff: number; readonly adapterOverrides: number; readonly conversationOverrides: number }
  readonly matrixHref: string
}
export type PluginPermissionLevel = 'read' | 'operate' | 'manage'
export interface PluginPermissionGroup {
  readonly level: PluginPermissionLevel
  readonly catalogPermission: string
  readonly permissions: readonly { readonly permission: string; readonly description?: string; readonly declared: boolean }[]
}

export function matrixRowOf(matrix: MatrixLike, plugin: string): Pick<FeatureMatrixRow, 'plugin' | 'global' | 'adapters' | 'conversationOverrides'> | null
export function pluginScopeSummary(matrix: MatrixLike, plugin: string): PluginScopeSummary | null
export function scopeSummaryLine(summary: PluginScopeSummary | null, t: Translate): string
export const PLUGIN_PERMISSION_LEVELS: readonly PluginPermissionLevel[]
export const PLUGIN_LEVEL_PERMISSIONS: Readonly<Record<PluginPermissionLevel, string>>
export function inferredPermissionLevel(permission: string): PluginPermissionLevel
export function pluginPermissionGroups(catalog: readonly { permission: string; plugin: string; level?: string; description?: string }[] | null | undefined,
  names: string | readonly (string | null | undefined)[]): PluginPermissionGroup[]
export function capabilityPlugin(row: unknown): string | null
export function capabilityPlugins(rows: readonly unknown[] | null | undefined): string[]
