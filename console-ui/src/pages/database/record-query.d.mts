export type FilterColumnKind = 'text' | 'integer' | 'float' | 'boolean'
export type FilterOperator = 'contains' | 'eq'
export interface RelatedFilter { column: string; operator: FilterOperator; value: string }
export interface DocumentFilter { field: string; value: string }
export type FilterWhereResult =
  | { where: Record<string, unknown>; operator?: FilterOperator; error?: undefined }
  | { error: string; where?: undefined; operator?: undefined }

export function filterColumnKind(definition?: { type?: string } | null, sample?: unknown): FilterColumnKind | null
export function filterOperators(kind: FilterColumnKind | null): FilterOperator[]
export function filterableColumns(columns: string[], definitions?: Record<string, { type?: string }>, sampleRow?: Record<string, unknown>): { name: string; kind: FilterColumnKind }[]
export function relatedFilterWhere(filter: Partial<RelatedFilter> | null | undefined, definitions?: Record<string, { type?: string }>, sampleRow?: Record<string, unknown>, locale?: string): FilterWhereResult
export function documentFilterWhere(filter: Partial<DocumentFilter> | null | undefined, locale?: string): FilterWhereResult
export function sortCurrentPageRows<T>(rows: T[] | null | undefined, column: string | null, direction: 'asc' | 'desc'): T[]
