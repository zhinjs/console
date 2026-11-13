/** Console database port payloads the published SDK does not type yet (`db:query`, `db:execute`, `db:schema:*`). */

export interface DbOrderBy { readonly column: string; readonly direction: 'asc' | 'desc' }

export interface DbQueryResult {
  readonly columns: readonly string[]
  readonly rows: readonly Record<string, unknown>[]
  readonly rowCount: number
  readonly truncated: boolean
  readonly durationMs: number
}

export interface DbExecuteResult {
  readonly statements: readonly { readonly sql: string; readonly affected?: number; readonly rows?: number }[]
  readonly dryRun: boolean
  readonly estimateUnavailable?: boolean
  readonly durationMs: number
}

export type DbColumnType = 'text' | 'integer' | 'bigint' | 'float' | 'boolean' | 'date' | 'json'

export interface DbColumnSpec {
  readonly name: string
  readonly type: DbColumnType
  readonly nullable?: boolean
  readonly default?: string | number | boolean | null
  readonly primary?: boolean
  readonly autoIncrement?: boolean
  readonly unique?: boolean
}

export type DbSchemaChange =
  | { readonly kind: 'create-table'; readonly table: string; readonly columns: readonly DbColumnSpec[] }
  | { readonly kind: 'add-column'; readonly table: string; readonly column: DbColumnSpec }
  | { readonly kind: 'rename-column'; readonly table: string; readonly column: string; readonly to: string }
  | { readonly kind: 'drop-column'; readonly table: string; readonly column: string }
  | { readonly kind: 'alter-column'; readonly table: string; readonly column: string; readonly type?: DbColumnType; readonly nullable?: boolean; readonly default?: string | number | boolean | null; readonly dropDefault?: boolean }
  | { readonly kind: 'create-index'; readonly table: string; readonly name: string; readonly columns: readonly string[]; readonly unique?: boolean }
  | { readonly kind: 'drop-index'; readonly table: string; readonly name: string }

export interface DbSchemaPlan {
  readonly change: DbSchemaChange
  readonly statements: readonly string[]
  readonly destructive: boolean
  readonly confirm?: string
  readonly warnings: readonly string[]
}

export interface DbTableSchema {
  readonly table: string
  readonly columns: readonly { readonly name: string; readonly type: string; readonly nativeType: string; readonly nullable: boolean; readonly primary: boolean; readonly defaultSql?: string }[]
  readonly indexes: readonly { readonly name: string; readonly columns: readonly string[]; readonly unique: boolean; readonly primary: boolean }[]
}
