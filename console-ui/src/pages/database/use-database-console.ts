import { type TableInfo, type DatabaseInfo, type SelectResult } from '@zhin.js/client'
import { getConsoleTransport } from '../../utils/console-client'
import { requestConsole } from '../../utils/console-rpc'
import { useConsoleRead } from '../../hooks/use-console-read'
import { dropThenRefresh } from './drop-table-model.mjs'
import type { DbExecuteResult, DbOrderBy, DbQueryResult, DbSchemaChange, DbSchemaPlan, DbTableSchema } from './database-types'

export function useDatabaseConsole() {
  const manager = getConsoleTransport()
  const infoRead = useConsoleRead<DatabaseInfo | null>(() => manager.getDbInfo(), null)
  const tablesRead = useConsoleRead<TableInfo[]>(async () => (await manager.getDbTables()).tables, [])
  return {
    info: infoRead.data, tables: tablesRead.data, loaded: tablesRead.loaded,
    loading: infoRead.loading || tablesRead.loading, error: tablesRead.error || infoRead.error,
    loadInfo: infoRead.refresh, loadTables: tablesRead.refresh,
    /** Rejects only when the drop fails; a failed list refresh is reported as `refreshError`. */
    dropTable: (table: string) => dropThenRefresh(() => manager.dbDropTable(table), tablesRead.refresh),
    // `orderBy` needs a Host that reports `capabilities.sort`; the SDK's dbSelect has no parameter for it.
    select: (table: string, page = 1, pageSize = 10, where?: unknown, orderBy?: DbOrderBy | null) => orderBy
      ? requestConsole<SelectResult>({ type: 'db:select', table, page, pageSize, where, orderBy })
      : manager.dbSelect(table, page, pageSize, where),
    insert: (table: string, row: unknown) => manager.dbInsert(table, row),
    update: (table: string, row: unknown, where: unknown) => manager.dbUpdate(table, row, where),
    remove: (table: string, where: unknown) => manager.dbDelete(table, where),
    kvGet: (table: string, key: string) => manager.kvGet(table, key),
    kvSet: (table: string, key: string, value: unknown, ttl?: number) => manager.kvSet(table, key, value, ttl),
    kvDelete: (table: string, key: string) => manager.kvDelete(table, key),
    kvEntries: (table: string) => manager.kvGetEntries(table),
  }
}

/** SQL editor and schema editor RPCs (Hosts reporting `capabilities.sql` / `capabilities.schema`). */
export const databaseAdmin = Object.freeze({
  query: (sql: string) => requestConsole<DbQueryResult>({ type: 'db:query', sql }),
  execute: (sql: string, dryRun = false) => requestConsole<DbExecuteResult>({ type: 'db:execute', sql, ...(dryRun ? { dryRun: true } : {}) }),
  describe: (table: string) => requestConsole<DbTableSchema>({ type: 'db:schema:describe', table }),
  preview: (change: DbSchemaChange) => requestConsole<DbSchemaPlan>({ type: 'db:schema:preview', change }),
  apply: (change: DbSchemaChange, confirm?: string) => requestConsole<DbSchemaPlan>({ type: 'db:schema:apply', change, ...(confirm ? { confirm } : {}) }),
})
export type DatabaseAdmin = typeof databaseAdmin
