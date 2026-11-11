export type FeatureRpcFailure = 'unsupported' | 'forbidden' | 'error'
export type FeatureProbeStatus = 'available' | 'unsupported' | 'forbidden'
export interface FeatureCell { readonly enabled: boolean; readonly overridden: boolean; readonly lockedBy?: 'global' | 'adapter' }
export interface GlobalFeatureRow {
  readonly plugin: string
  readonly name: string
  readonly description: string
  readonly hasSchema: boolean
  readonly global: FeatureCell
}
export interface FeatureMatrixRow extends GlobalFeatureRow { readonly adapters: Readonly<Record<string, FeatureCell>> }
export interface FeatureMatrix { readonly adapters: readonly string[]; readonly rows: ReadonlyArray<{ plugin: string; global: FeatureCell; adapters: Readonly<Record<string, FeatureCell>> }> }
export interface AdapterSummary { readonly adapter: string; readonly accounts: number; readonly online: number; readonly pending: number }

export function classifyFeatureRpcError(error: unknown): FeatureRpcFailure
export function featureProbeStatus(outcome: { ok: true } | { ok: false; error: unknown }): FeatureProbeStatus
export function globalFeatureRows(plugins: readonly unknown[]): GlobalFeatureRow[]
export function readFeatureMatrix(payload: unknown): FeatureMatrix
export function mergeFeatureMatrix(globalRows: readonly GlobalFeatureRow[], matrix: FeatureMatrix | null): { adapters: readonly string[]; rows: FeatureMatrixRow[] }
export function summarizeAdapters(endpoints: readonly unknown[]): AdapterSummary[]
export function endpointsOfAdapter<T>(endpoints: readonly T[], adapter: string): T[]
export function cellState(cell: FeatureCell | null | undefined): 'enabled' | 'disabled' | 'locked' | 'unknown'
