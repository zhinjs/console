/**
 * Drop first, then refresh the table list as a separate step. A refresh failure
 * must not be reported as a failed drop: the table is already gone.
 * Errors from `drop` propagate unchanged.
 */
export async function dropThenRefresh(drop, refresh) {
  const result = await drop()
  try {
    await refresh()
    return { result, refreshError: null }
  } catch (error) {
    return { result, refreshError: error ?? new Error('refresh failed') }
  }
}

/**
 * Hide tables dropped from `source` while the list still is that same (stale) snapshot.
 * Any newer list from the server replaces the snapshot and is shown as-is.
 */
export function withoutDroppedTables(tables, dropped) {
  if (!dropped || dropped.source !== tables || !dropped.names.length) return tables
  return tables.filter(table => !dropped.names.includes(table.name))
}
