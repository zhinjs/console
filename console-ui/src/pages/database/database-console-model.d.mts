import type { FilterColumnKind } from './record-query.mjs'

export const SPLIT_STORAGE_KEY: string
export const SPLIT_DEFAULT: number
export const SPLIT_MIN: number
export const SPLIT_MAX: number
export const DETAIL_MIN: number
export const SPLIT_STEP: number
export function clampSplit(width: number, containerWidth?: number): number
export function readSplitWidth(storage: Pick<Storage, 'getItem'> | null | undefined): number
export function saveSplitWidth(storage: Pick<Storage, 'setItem'> | null | undefined, width: number): boolean
export function splitKeyTarget(key: string, width: number, containerWidth?: number, shift?: boolean): number | null

export interface DatabaseCapabilities {
  readonly reported: boolean
  readonly sort: boolean
  readonly filterOperators: readonly string[]
  readonly sql: boolean
  readonly schema: boolean
  readonly reason: string
  readonly sqlReason: string
  readonly sqlIsolation: '' | 'separate-store' | 'restricted-credential'
  readonly sqlReasonCode: string
}
export function databaseCapabilities(info: unknown): DatabaseCapabilities
export function sqlUnavailableReason(capabilities: DatabaseCapabilities | null | undefined): string
export function needsConsoleRole(capabilities: DatabaseCapabilities | null | undefined): boolean
export function isPrivilegeRefusal(error: unknown): boolean
export function isUnsupportedRpcError(error: unknown): boolean
export function databaseRefusalCode(error: unknown): string

export interface SortState { readonly column: string; readonly direction: 'asc' | 'desc' }
export function nextSort(current: SortState | null, column: string): SortState | null

export type ColumnFilterOperator = 'eq' | 'ne' | 'contains' | 'gt' | 'lt' | 'null' | 'notnull'
export interface ColumnFilter { readonly column: string; readonly operator: ColumnFilterOperator; readonly value: string }
export const COLUMN_FILTER_OPERATORS: readonly ColumnFilterOperator[]
export function operatorNeedsValue(operator: ColumnFilterOperator): boolean
export function columnFilterOperators(kind: FilterColumnKind | null): ColumnFilterOperator[]
export function operatorSymbol(operator: ColumnFilterOperator): string
export function operatorLabel(operator: ColumnFilterOperator, locale?: string): string
export function columnFiltersWhere(
  filters: readonly ColumnFilter[] | null | undefined,
  definitions?: Record<string, { type?: string }>,
  sampleRow?: Record<string, unknown>,
  locale?: string,
): { where: Record<string, unknown>; error?: undefined; column?: undefined } | { error: string; column: string; where?: undefined }

export function isSensitiveColumn(name: string, definition?: { secret?: unknown } | null): boolean
export const MASK: string

export interface SqlHistoryEntry { readonly sql: string; readonly at: number; readonly ok: boolean }
export const SQL_HISTORY_KEY: string
export const SQL_HISTORY_LIMIT: number
export function readSqlHistory(storage: Pick<Storage, 'getItem'> | null | undefined): SqlHistoryEntry[]
export function pushSqlHistory(storage: Pick<Storage, 'setItem' | 'getItem'> | null | undefined, entry: { sql: string; at?: number; ok?: boolean }, previous?: SqlHistoryEntry[]): SqlHistoryEntry[]
export function clearSqlHistory(storage: Pick<Storage, 'removeItem'> | null | undefined): SqlHistoryEntry[]
export function sqlLooksReadOnly(sql: string): boolean
export function affectedRows(result: { statements?: readonly { affected?: number }[] } | null | undefined): number | null
export function cellText(value: unknown): string

export const SCHEMA_COLUMN_TYPES: readonly ('text' | 'integer' | 'bigint' | 'float' | 'boolean' | 'date' | 'json')[]
export function schemaWarningText(code: string, locale?: string): string
export function parseDefaultInput(text: string, type: string): { none: true; value?: undefined; error?: undefined } | { value: unknown; none?: undefined; error?: undefined } | { error: true; none?: undefined; value?: undefined }
