import { getWebSocketManager, type TableInfo, type DatabaseInfo } from '@zhin.js/client'
import { useConsoleRead } from '../../hooks/use-console-read'
export function useDatabaseConsole() {
  const manager = getWebSocketManager()
  const infoRead = useConsoleRead<DatabaseInfo | null>(() => manager.getDbInfo(), null)
  const tablesRead = useConsoleRead<TableInfo[]>(async () => (await manager.getDbTables()).tables, [])
  return {
    info: infoRead.data, tables: tablesRead.data, loaded: tablesRead.loaded,
    loading: infoRead.loading || tablesRead.loading, error: tablesRead.error || infoRead.error,
    loadInfo: infoRead.refresh, loadTables: tablesRead.refresh,
    dropTable: async (table: string) => { const result = await manager.dbDropTable(table); await tablesRead.refresh(); return result },
    select: (table: string, page = 1, pageSize = 10, where?: unknown) => manager.dbSelect(table, page, pageSize, where),
    insert: (table: string, row: unknown) => manager.dbInsert(table, row),
    update: (table: string, row: unknown, where: unknown) => manager.dbUpdate(table, row, where),
    remove: (table: string, where: unknown) => manager.dbDelete(table, where),
    kvGet: (table: string, key: string) => manager.kvGet(table, key),
    kvSet: (table: string, key: string, value: unknown, ttl?: number) => manager.kvSet(table, key, value, ttl),
    kvDelete: (table: string, key: string) => manager.kvDelete(table, key),
    kvEntries: (table: string) => manager.kvGetEntries(table),
  }
}
