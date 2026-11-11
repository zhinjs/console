export type FeatureRpcFailure = 'unsupported' | 'forbidden' | 'error'
export type FeatureProbeStatus = 'available' | 'unsupported' | 'forbidden'
export type FeatureLevel = 'global' | 'adapter' | 'endpoint'
export type FeatureOverrideLevel = 'adapter' | 'endpoint'
export type FeatureLock = 'global' | 'adapter'
export interface FeatureCell { readonly enabled: boolean; readonly overridden: boolean; readonly lockedBy?: FeatureLock }
export interface GlobalFeatureRow {
  readonly plugin: string
  readonly name: string
  readonly description: string
  readonly hasSchema: boolean
  readonly global: FeatureCell
}
export interface FeatureMatrixRow extends GlobalFeatureRow { readonly adapters: Readonly<Record<string, FeatureCell>> }
export interface FeatureMatrix {
  readonly revision: string
  readonly adapters: readonly string[]
  readonly endpoints: Readonly<Record<string, readonly string[]>>
  readonly rows: ReadonlyArray<{ plugin: string; displayName?: string; global: FeatureCell; adapters: Readonly<Record<string, FeatureCell>> }>
}
export interface MergedFeatureMatrix {
  readonly revision: string
  readonly adapters: readonly string[]
  readonly endpoints: Readonly<Record<string, readonly string[]>>
  readonly rows: FeatureMatrixRow[]
}
export interface AdapterSummary { readonly adapter: string; readonly accounts: number; readonly online: number; readonly pending: number }
export interface FeatureSummary {
  readonly plugin: string
  readonly displayName: string
  readonly levels: readonly FeatureLevel[]
  readonly hasSchema: boolean
  readonly globalEnabled: boolean
  readonly adapter: boolean
}
export interface FeatureList { readonly revision: string; readonly features: FeatureSummary[] }
export interface FeatureDetail {
  readonly revision: string
  readonly plugin: string
  readonly level: FeatureLevel
  readonly key?: string
  readonly levels: readonly FeatureLevel[]
  readonly schema: Readonly<Record<string, unknown>> | null
  readonly values: Readonly<Record<string, unknown>>
  readonly effective: Readonly<Record<string, unknown>>
  readonly sources: Readonly<Record<string, FeatureLevel>>
  readonly enabled: boolean
  readonly lockedBy?: FeatureLock
}
export interface FeatureFieldRow {
  readonly name: string
  readonly editable: boolean
  readonly schema: Readonly<Record<string, unknown>> | null
  readonly overridden: boolean
  readonly source: FeatureLevel | null
  readonly badge: 'here' | 'adapter' | 'global' | 'unset'
  readonly effective: unknown
  readonly stored: unknown
}
export interface FeatureWriteResult {
  readonly status: 'saved' | 'unchanged' | 'conflict' | 'invalid'
  readonly revision: string
  readonly message: string
  readonly restartRequired: boolean
  readonly warnings: ReadonlyArray<{ code: string; path: string; message: string }>
  readonly errors: ReadonlyArray<{ path: string; message: string }>
}
export interface FeatureRpcBody { readonly type: string; readonly [key: string]: unknown }

export function classifyFeatureRpcError(error: unknown): FeatureRpcFailure
export function featureProbeStatus(outcome: { ok: true } | { ok: false; error: unknown }): FeatureProbeStatus
export function globalFeatureRows(plugins: readonly unknown[]): GlobalFeatureRow[]
export function readFeatureMatrix(payload: unknown): FeatureMatrix
export function mergeFeatureMatrix(globalRows: readonly GlobalFeatureRow[], matrix: FeatureMatrix | null): MergedFeatureMatrix
export function summarizeAdapters(endpoints: readonly unknown[]): AdapterSummary[]
export function endpointsOfAdapter<T>(endpoints: readonly T[], adapter: string): T[]
export function readFeatureList(payload: unknown): FeatureList
export function featuresAtLevel(features: readonly FeatureSummary[], level: FeatureOverrideLevel): FeatureSummary[]
export function readFeatureDetail(payload: unknown): FeatureDetail
export const REDACTED_VALUE: '[redacted]'
export function containsRedacted(value: unknown): boolean
export function fieldSource(sources: Readonly<Record<string, FeatureLevel>> | undefined, name: string): FeatureLevel | null
export function featureFieldRows(detail: FeatureDetail): FeatureFieldRow[]
export function overrideDraftSeed(row: FeatureFieldRow): unknown
export function setOverrideRequest(input: { plugin: string; level: FeatureLevel; key: string; field: string; value: unknown; revision?: string }): FeatureRpcBody
export function removeOverrideRequest(input: { plugin: string; level: FeatureLevel; key: string; field?: string; revision?: string }): FeatureRpcBody
export function setEnabledRequest(input: { plugin: string; level: FeatureLevel; key?: string; enabled: boolean; revision?: string }): FeatureRpcBody
export function readFeatureWriteResult(payload: unknown): FeatureWriteResult
export function cellToggleable(cell: FeatureCell | null | undefined, canToggle: boolean): boolean
export function cellState(cell: FeatureCell | null | undefined): 'enabled' | 'disabled' | 'locked' | 'unknown'
export function jsonSchemaToField(schema: unknown): import('../../components/PluginConfigForm/types.js').SchemaField
