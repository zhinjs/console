import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampSplit, readSplitWidth, saveSplitWidth, splitKeyTarget, SPLIT_DEFAULT, SPLIT_MAX, SPLIT_MIN, SPLIT_STORAGE_KEY,
  databaseCapabilities, isUnsupportedRpcError, sqlUnavailableReason, needsConsoleRole, isPrivilegeRefusal, nextSort, columnFiltersWhere, columnFilterOperators, isSensitiveColumn,
  readSqlHistory, pushSqlHistory, clearSqlHistory, SQL_HISTORY_KEY, sqlLooksReadOnly, affectedRows, parseDefaultInput, schemaWarningText,
} from '../console-ui/src/pages/database/database-console-model.mjs'

const memoryStorage = () => { const map = new Map(); return { getItem: key => map.get(key) ?? null, setItem: (key, value) => map.set(key, String(value)), removeItem: key => map.delete(key), map } }
const blocked = { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') }, removeItem() { throw new Error('blocked') } }

test('the list width is clamped, remembered, and survives blocked storage', () => {
  assert.equal(clampSplit(10), SPLIT_MIN)
  assert.equal(clampSplit(9999), SPLIT_MAX)
  assert.equal(clampSplit(500, 700), 340, 'the detail pane keeps its minimum width')
  assert.equal(clampSplit(NaN), SPLIT_DEFAULT)
  const storage = memoryStorage()
  assert.equal(readSplitWidth(storage), SPLIT_DEFAULT)
  assert.equal(saveSplitWidth(storage, 300), true)
  assert.equal(storage.map.get(SPLIT_STORAGE_KEY), '300')
  assert.equal(readSplitWidth(storage), 300)
  storage.setItem(SPLIT_STORAGE_KEY, 'garbage')
  assert.equal(readSplitWidth(storage), SPLIT_DEFAULT)
  assert.equal(readSplitWidth(blocked), SPLIT_DEFAULT)
  assert.equal(saveSplitWidth(blocked, 300), false)
  assert.equal(readSplitWidth(null), SPLIT_DEFAULT)
})

test('the separator moves with the keyboard', () => {
  assert.equal(splitKeyTarget('ArrowRight', 240, 1200), 256)
  assert.equal(splitKeyTarget('ArrowLeft', 240, 1200, true), 176)
  assert.equal(splitKeyTarget('Home', 240, 1200), SPLIT_MIN)
  assert.equal(splitKeyTarget('End', 240, 1200), SPLIT_MAX)
  assert.equal(splitKeyTarget('End', 240, 800), 440)
  assert.equal(splitKeyTarget('Enter', 240, 1200), null)
})

test('features are detected from the Host capabilities, absent on older Hosts', () => {
  assert.deepEqual(databaseCapabilities({ dialect: 'sqlite' }), { reported: false, sort: false, filterOperators: [], sql: false, schema: false, reason: '', sqlReason: '', sqlIsolation: '' })
  assert.deepEqual(databaseCapabilities({ capabilities: { sort: true, filterOperators: ['$eq', 1], sql: true, schema: true } }),
    { reported: true, sort: true, filterOperators: ['$eq'], sql: true, schema: true, reason: '', sqlReason: '', sqlIsolation: '' })
  assert.equal(databaseCapabilities({ capabilities: { sort: true, sql: false, schema: false, reason: 'mongodb' } }).reason, 'mongodb')
  assert.equal(isUnsupportedRpcError(new Error('Unknown RPC type: db:query')), true)
  assert.equal(isUnsupportedRpcError(new Error('Database RPC is not available on Plugin Runtime Host yet')), true)
  assert.equal(isUnsupportedRpcError({ message: 'RPC "db:query" 未登记权限', details: { serverCode: 'unmapped' } }), true)
  assert.equal(isUnsupportedRpcError({ message: 'x', details: { dataCode: 'unsupported' } }), true)
  assert.equal(isUnsupportedRpcError(new Error('no such table: x')), false)
})

test('the SQL editor explains a missing restricted account and privilege refusals (ADR 0059)', () => {
  const restricted = databaseCapabilities({ capabilities: { sort: true, sql: false, schema: true, sqlIsolation: 'restricted-credential', sqlReason: 'run zhin db console-role', reason: 'run zhin db console-role' } })
  assert.equal(restricted.sqlIsolation, 'restricted-credential')
  assert.equal(sqlUnavailableReason(restricted), 'run zhin db console-role')
  assert.equal(needsConsoleRole(restricted), true)
  // SQLite, a working account, an older Host: no account hint.
  assert.equal(needsConsoleRole(databaseCapabilities({ capabilities: { sql: false, schema: true, sqlIsolation: 'separate-store', sqlReason: 'in-memory' } })), false)
  assert.equal(needsConsoleRole(databaseCapabilities({ capabilities: { sql: true, schema: true, sqlIsolation: 'restricted-credential' } })), false)
  assert.equal(needsConsoleRole(databaseCapabilities({ capabilities: { sql: false, schema: true, reason: 'sql_mode' } })), false)
  // An older Host reports only `reason`.
  assert.equal(sqlUnavailableReason(databaseCapabilities({ capabilities: { sql: false, schema: true, reason: 'sql_mode' } })), 'sql_mode')
  assert.equal(databaseCapabilities({ capabilities: { sqlIsolation: 'other' } }).sqlIsolation, '')

  assert.equal(isPrivilegeRefusal({ message: 'permission denied for schema public', details: { sqlState: '42501' } }), true)
  assert.equal(isPrivilegeRefusal({ message: "CREATE command denied to user 'x'@'%' for table 't'", details: { sqlState: '42000' } }), true)
  assert.equal(isPrivilegeRefusal({ message: 'You have an error in your SQL syntax', details: { sqlState: '42000' } }), false)
  assert.equal(isPrivilegeRefusal({ message: 'relation "x" does not exist', details: { sqlState: '42P01' } }), false)
  // Host before ADR 0059: no SQLSTATE, PostgreSQL's text.
  assert.equal(isPrivilegeRefusal(new Error('permission denied for table console_users')), true)
  assert.equal(isPrivilegeRefusal(new Error('no such table: x')), false)
})

test('header clicks cycle ascending, descending, none', () => {
  assert.deepEqual(nextSort(null, 'a'), { column: 'a', direction: 'asc' })
  assert.deepEqual(nextSort({ column: 'a', direction: 'asc' }, 'a'), { column: 'a', direction: 'desc' })
  assert.equal(nextSort({ column: 'a', direction: 'desc' }, 'a'), null)
  assert.deepEqual(nextSort({ column: 'a', direction: 'desc' }, 'b'), { column: 'b', direction: 'asc' })
})

test('per-column filters become one where combined with AND', () => {
  const definitions = { id: { type: 'integer' }, name: { type: 'text' }, ok: { type: 'boolean' }, meta: { type: 'json' } }
  assert.deepEqual(columnFiltersWhere([
    { column: 'id', operator: 'gt', value: '10' },
    { column: 'name', operator: 'contains', value: 'al' },
    { column: 'ok', operator: 'ne', value: 'true' },
    { column: 'meta', operator: 'notnull', value: '' },
  ], definitions).where, { id: { $gt: 10 }, name: { $like: '%al%' }, ok: { $ne: true }, meta: { $ne: null } })
  assert.deepEqual(columnFiltersWhere([{ column: 'name', operator: 'eq', value: 'x' }], definitions).where, { name: 'x' })
  assert.deepEqual(columnFiltersWhere([{ column: 'id', operator: 'gt', value: '1' }, { column: 'id', operator: 'lt', value: '9' }], definitions).where, { id: { $gt: 1, $lt: 9 } })
  assert.match(columnFiltersWhere([{ column: 'id', operator: 'gt', value: 'x' }], definitions).error, /整数/)
  assert.match(columnFiltersWhere([{ column: 'meta', operator: 'eq', value: '1' }], definitions).error, /不支持/)
  assert.match(columnFiltersWhere([{ column: 'name', operator: 'lt', value: ' ' }], definitions).error, /输入要查找的值/)
  assert.deepEqual(columnFilterOperators(null), ['null', 'notnull'])
  assert.deepEqual(columnFiltersWhere([], definitions).where, {})
})

test('sensitive-looking columns are masked by name or Host metadata', () => {
  for (const name of ['password', 'access_token', 'clientSecret', 'cookie', 'api_key', 'apikey', 'private_key', 'TOKEN']) assert.equal(isSensitiveColumn(name), true, name)
  for (const name of ['id', 'name', 'tokens_used_count_label'.replace('tokens', 'count')]) assert.equal(isSensitiveColumn(name), false, name)
  assert.equal(isSensitiveColumn('note', { secret: true }), true)
})

test('SQL history is per browser, newest first, de-duplicated and safe with blocked storage', () => {
  const storage = memoryStorage()
  let list = pushSqlHistory(storage, { sql: 'SELECT 1', at: 1 })
  list = pushSqlHistory(storage, { sql: 'SELECT 2', at: 2, ok: false }, list)
  list = pushSqlHistory(storage, { sql: ' SELECT 1 ', at: 3 }, list)
  assert.deepEqual(list.map(entry => entry.sql), ['SELECT 1', 'SELECT 2'])
  assert.deepEqual(readSqlHistory(storage), list)
  for (let i = 0; i < 40; i++) list = pushSqlHistory(storage, { sql: `SELECT ${i + 10}`, at: 10 + i }, list)
  assert.equal(readSqlHistory(storage).length, 30)
  storage.setItem(SQL_HISTORY_KEY, '{oops')
  assert.deepEqual(readSqlHistory(storage), [])
  assert.deepEqual(clearSqlHistory(storage), [])
  assert.deepEqual(readSqlHistory(blocked), [])
  assert.equal(pushSqlHistory(blocked, { sql: 'SELECT 1' }).length, 1)
})

test('the editor routes reads to db:query and anything else to db:execute', () => {
  for (const sql of ['select 1', '  -- note\nSELECT * FROM t;', 'WITH a AS (SELECT 1) SELECT * FROM a', 'PRAGMA table_info(t)', 'EXPLAIN SELECT 1', "SELECT 'a;b'"]) assert.equal(sqlLooksReadOnly(sql), true, sql)
  for (const sql of ['UPDATE t SET a = 1', 'SELECT 1; SELECT 2', 'PRAGMA user_version = 3', 'WITH a AS (SELECT 1) DELETE FROM t', 'ALTER TABLE t ADD c TEXT']) assert.equal(sqlLooksReadOnly(sql), false, sql)
  assert.equal(affectedRows({ statements: [{ affected: 2 }, { rows: 3 }, { affected: 1 }] }), 3)
  assert.equal(affectedRows({ statements: [{ sql: 'x' }] }), null)
})

test('schema form defaults parse by column type; warnings are translated', () => {
  assert.deepEqual(parseDefaultInput('', 'text'), { none: true })
  assert.deepEqual(parseDefaultInput('NULL', 'integer'), { value: null })
  assert.deepEqual(parseDefaultInput('42', 'integer'), { value: 42 })
  assert.deepEqual(parseDefaultInput('x', 'integer'), { error: true })
  assert.deepEqual(parseDefaultInput('TRUE', 'boolean'), { value: true })
  assert.deepEqual(parseDefaultInput(' hi ', 'text'), { value: ' hi ' })
  assert.match(schemaWarningText('data_loss'), /删除数据/)
  assert.match(schemaWarningText('data_loss', 'en'), /deletes data/)
  assert.equal(schemaWarningText('future_code'), 'future_code')
})
