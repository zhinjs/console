import type { FeatureDetail, FeatureFieldRow, FeatureLevel, FeatureLock, FeatureSummary, FeatureWriteResult } from './feature-model.mjs'
import type { ScopeRef } from '../../scope/scope-tree.mjs'

export type FeatureRowFilter = 'all' | 'overridden' | 'disabled' | 'locked'
export type FeatureRowState = 'enabled' | 'disabled' | 'locked' | 'unknown'

export interface FeatureLevelRow {
  readonly plugin: string
  readonly displayName: string
  readonly state: FeatureRowState
  readonly lockedBy?: FeatureLock
  readonly stateSource: FeatureLevel | null
  readonly switchOverridden: boolean
  readonly fieldOverrides: number
  readonly overriddenHere: boolean
  readonly configurable: boolean
  readonly editableFields: number
  readonly fields: readonly FeatureFieldRow[]
}

export interface FeatureFieldView {
  readonly name: string
  readonly editable: boolean
  readonly overridden: boolean
  readonly inherited: { readonly known: boolean; readonly value: unknown; readonly source: FeatureLevel | null }
  readonly here: { readonly value: unknown } | null
  readonly effective: unknown
  readonly source: FeatureLevel | null
  readonly masked: boolean
}

export type FeatureChange =
  | { readonly kind: 'enabled'; readonly enabled: boolean }
  | { readonly kind: 'set'; readonly field: string; readonly value: unknown }
  | { readonly kind: 'remove'; readonly field: string }
  | { readonly kind: 'clear' }

export type FeatureReceiptOutcome =
  | { readonly status: 'saved' | 'unchanged' | 'conflict' | 'invalid'; readonly message?: string; readonly locked?: undefined }
  | { readonly locked: true; readonly lockedBy?: FeatureLock; readonly message: string; readonly status?: undefined }

export const FEATURE_ROW_FILTERS: readonly FeatureRowFilter[]
export function parentFeatureTarget(level: FeatureLevel, key?: string): { level: FeatureLevel; key?: string } | null
export function switchOverridden(detail: FeatureDetail | null | undefined): boolean
export function featureStateSource(detail: FeatureDetail | null | undefined): FeatureLevel | null
export function featureState(detail: FeatureDetail | null | undefined): FeatureRowState
export function featureLevelRow(feature: FeatureSummary, detail: FeatureDetail | null | undefined, level: FeatureLevel): FeatureLevelRow
export function filterFeatureRows(rows: readonly FeatureLevelRow[], filter?: FeatureRowFilter, query?: string): FeatureLevelRow[]
export function featureRowCounts(rows: readonly FeatureLevelRow[]): Record<FeatureRowFilter, number>
export function featureLockHref(lockedBy: FeatureLock, scope: ScopeRef): string
export function featureFieldView(row: FeatureFieldRow, parentDetail?: FeatureDetail | null): FeatureFieldView
export function featureValueText(value: unknown, copy: { unset: string; masked: string }): string
export function featureReceiptOutcome(result: FeatureWriteResult | null | undefined): FeatureReceiptOutcome
export function featureChangeApplied(detail: FeatureDetail | null | undefined, change: FeatureChange): boolean

export interface GlobalFeatureOverviewRow {
  readonly plugin: string
  readonly name: string
  readonly description: string
  readonly enabled: boolean
  /** Declared levels; null when the Host has no `feature.list`. */
  readonly levels: readonly FeatureLevel[] | null
  readonly adapter: boolean
  readonly nested: boolean
  readonly below: readonly { readonly adapter: string; readonly state: 'overridden' | 'disabled' }[]
  readonly conversations: readonly { readonly adapter: string; readonly endpoint: string; readonly count: number }[]
}
export function globalFeatureOverview(
  matrixRows?: readonly import('./feature-model.mjs').FeatureMatrixRow[],
  adapters?: readonly string[],
  features?: readonly FeatureSummary[] | null,
): GlobalFeatureOverviewRow[]
export function globalFeatureCounts(rows: readonly GlobalFeatureOverviewRow[]): { total: number; enabled: number; disabled: number; customized: number }
export function featureWriteSharesRevision(level: string): boolean
export function featureReadBackMismatch(detail: FeatureDetail | null | undefined, change: FeatureChange): import('../../components/apply-outcome-model.mjs').ReadBackMismatch | null
