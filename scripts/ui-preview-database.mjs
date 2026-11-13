/**
 * In-memory database for the UI fixture (`ui-preview-host.mjs`): `db:*` answered from a
 * `node:sqlite` `:memory:` database with synthetic rows. Reads, sorting, filtering, read-only SQL,
 * dry runs and DDL previews work; writes and schema changes are refused like every fixture write.
 */
import { DatabaseSync } from 'node:sqlite'

const db = new DatabaseSync(':memory:')
db.exec(`
CREATE TABLE messages (id INTEGER PRIMARY KEY, channel TEXT NOT NULL, sender TEXT, content TEXT, score INTEGER, created_at TEXT);
CREATE TABLE rss_feeds (id INTEGER PRIMARY KEY, url TEXT NOT NULL, title TEXT, interval_minutes INTEGER DEFAULT 30, enabled INTEGER DEFAULT 1);
CREATE TABLE github_oauth_users (id INTEGER PRIMARY KEY, login TEXT NOT NULL, access_token TEXT, refresh_token TEXT, updated_at TEXT);
CREATE INDEX messages_channel ON messages (channel);
`)
const senders = ['演示同事', '测试同学', '群主小王', '新同学', 'Zhin']
const texts = ['今天的发布准备完成了吗？', '收到，我先看一下监控。', '定时任务在 10:00 正常执行过一次。', '回归测试开始。', '账号已连接。', '有问题在群里说。']
const insertMessage = db.prepare('INSERT INTO messages (channel, sender, content, score, created_at) VALUES (?, ?, ?, ?, ?)')
for (let i = 0; i < 137; i++) {
  insertMessage.run(i % 3 === 0 ? 'group:20001' : i % 3 === 1 ? 'private:10001' : 'group:20002', senders[i % senders.length], texts[i % texts.length], i % 7 === 0 ? null : (i * 37) % 100, new Date(Date.UTC(2026, 10, 1, 8, i * 11)).toISOString())
}
const insertFeed = db.prepare('INSERT INTO rss_feeds (url, title, interval_minutes, enabled) VALUES (?, ?, ?, ?)')
for (const [url, title, minutes, enabled] of [['https://example.invalid/blog.xml', '团队博客', 30, 1], ['https://example.invalid/changelog.xml', '版本更新', 60, 1], ['https://example.invalid/status.xml', '服务状态', 5, 0]]) insertFeed.run(url, title, minutes, enabled)
const insertUser = db.prepare('INSERT INTO github_oauth_users (login, access_token, refresh_token, updated_at) VALUES (?, ?, ?, ?)')
for (const login of ['octo-demo', 'preview-bot', 'release-helper']) insertUser.run(login, `gho_preview_${login.replace(/-/g, '')}_not_real`, `ghr_preview_${login.length}_not_real`, '2026-11-12T08:00:00.000Z')

const quote = name => `"${String(name).replaceAll('"', '""')}"`
const tables = () => db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all().map(row => row.name)
const columnsOf = table => db.prepare(`PRAGMA table_info(${quote(table)})`).all()
const zhinType = native => /INT/i.test(native) ? 'integer' : /REAL|FLOA|DOUB/i.test(native) ? 'float' : 'text'
const definition = table => Object.fromEntries(columnsOf(table).map(column => [column.name, { type: zhinType(column.type), ...(column.pk ? { primary: true } : {}), ...(column.notnull ? { nullable: false } : {}) }]))

const OPERATORS = { $eq: '=', $ne: '<>', $gt: '>', $gte: '>=', $lt: '<', $lte: '<=', $like: 'LIKE', $nlike: 'NOT LIKE' }
function whereSql(table, where) {
  const known = new Set(columnsOf(table).map(column => column.name))
  const clauses = [], params = []
  for (const [column, condition] of Object.entries(where ?? {})) {
    if (!known.has(column)) throw new Error(`Unknown filter column '${column}'`)
    const entries = condition !== null && typeof condition === 'object' ? Object.entries(condition) : [['$eq', condition]]
    for (const [operator, value] of entries) {
      if (!OPERATORS[operator]) throw new Error(`Unsupported filter operator '${operator}'`)
      if (value === null) clauses.push(`${quote(column)} IS ${operator === '$ne' ? 'NOT ' : ''}NULL`)
      else { clauses.push(`${quote(column)} ${OPERATORS[operator]} ?`); params.push(typeof value === 'boolean' ? Number(value) : value) }
    }
  }
  return { sql: clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '', params }
}

const refused = (json, type, message) => json({ success: false, code: 'preview_read_only', error: message, type }, 503)
const failed = (json, type, error, code) => json({ success: false, error: error instanceof Error ? error.message : String(error), ...(code ? { data: { code } } : {}), type }, 400)

/** Answers `db:*`; returns false for other types. `memory`: report a non-relational dialect. */
export function answerDatabaseRpc(type, body, json, envelope, { memory = false } = {}) {
  if (!type.startsWith('db:')) return false
  const capabilities = memory
    ? { sort: true, filterOperators: ['$eq', '$ne', '$gt', '$lt', '$like'], sql: false, schema: false, reason: 'SQL and schema editing need SQLite, MySQL or PostgreSQL (current: memory)' }
    : { sort: true, filterOperators: Object.keys(OPERATORS), sql: true, schema: true }
  if (type === 'db:info') { json(envelope({ dialect: memory ? 'memory' : 'sqlite', type: 'related', tables: tables(), connected: true, capabilities })); return true }
  if (type === 'db:tables') { json(envelope({ tables: tables().map(name => ({ name, columns: definition(name) })) })); return true }
  if (type === 'db:select') {
    try {
      const table = String(body.table ?? '')
      if (!tables().includes(table)) { json(envelope({ rows: [], total: 0, page: 1, pageSize: 50 })); return true }
      const page = Math.max(1, Number(body.page) || 1), pageSize = Math.min(500, Math.max(1, Number(body.pageSize) || 50))
      const filter = whereSql(table, body.where)
      const order = body.orderBy && columnsOf(table).some(column => column.name === body.orderBy.column)
        ? ` ORDER BY ${quote(body.orderBy.column)} ${body.orderBy.direction === 'desc' ? 'DESC' : 'ASC'}, rowid ASC` : ''
      const total = db.prepare(`SELECT COUNT(*) AS total FROM ${quote(table)}${filter.sql}`).get(...filter.params).total
      const rows = db.prepare(`SELECT * FROM ${quote(table)}${filter.sql}${order} LIMIT ? OFFSET ?`).all(...filter.params, pageSize, (page - 1) * pageSize)
      json(envelope({ rows, total: Number(total), page, pageSize, ...(order ? { orderBy: body.orderBy } : {}) }))
    } catch (error) { failed(json, type, `Failed to select: ${error.message}`, 'invalid') }
    return true
  }
  if (memory && /^db:(?:query|execute|schema:)/u.test(type)) { failed(json, type, 'SQL is not supported by this database Host', 'unsupported'); return true }
  if (type === 'db:query') {
    const sql = String(body.sql ?? '').trim().replace(/;\s*$/u, '')
    if (sql.includes(';')) { failed(json, type, 'Only one statement can run as a read-only query', 'multi_statement'); return true }
    if (!/^\s*(?:select|with|explain|pragma\s+(?:table_info|index_list))\b/iu.test(sql) || /\b(?:insert|update|delete|drop|alter|create)\b/iu.test(sql)) {
      failed(json, type, 'Only read statements (SELECT / WITH / EXPLAIN / SHOW / read PRAGMA) run without ops.database.schema', 'read_only'); return true
    }
    if (/console_/iu.test(sql)) { failed(json, type, 'Statement references a table owned by the management gateway', 'protected_table'); return true }
    try {
      const started = performance.now()
      const all = db.prepare(sql).all()
      const rows = all.slice(0, 1000)
      json(envelope({ columns: [...new Set(rows.flatMap(row => Object.keys(row)))], rows, rowCount: all.length, truncated: all.length > 1000, durationMs: Math.max(1, Math.round(performance.now() - started)) }))
    } catch (error) { failed(json, type, error) }
    return true
  }
  if (type === 'db:execute') {
    if (body.dryRun !== true) { refused(json, type, '本地预览不执行写 SQL。请使用真实 Host 验证。'); return true }
    const statements = String(body.sql ?? '').split(';').map(part => part.trim()).filter(Boolean)
    try {
      db.exec('BEGIN')
      const results = statements.map(sql => ({ sql, affected: Number(db.prepare(sql).run().changes) }))
      db.exec('ROLLBACK')
      json(envelope({ statements: results, dryRun: true, durationMs: 2 }))
    } catch (error) { try { db.exec('ROLLBACK') } catch { /* not open */ } failed(json, type, error) }
    return true
  }
  if (type === 'db:schema:describe') {
    const table = String(body.table ?? '')
    if (!tables().includes(table)) { failed(json, type, `Table '${table}' not found`, 'not_found'); return true }
    const columns = columnsOf(table).map(column => ({ name: column.name, type: zhinType(column.type), nativeType: column.type, nullable: !column.notnull && !column.pk, primary: !!column.pk, ...(column.dflt_value != null ? { defaultSql: String(column.dflt_value) } : {}) }))
    const indexes = db.prepare(`PRAGMA index_list(${quote(table)})`).all().map(index => ({ name: index.name, columns: db.prepare(`PRAGMA index_info(${quote(index.name)})`).all().map(row => row.name), unique: !!index.unique, primary: index.origin === 'pk' }))
    json(envelope({ table, columns, indexes })); return true
  }
  if (type === 'db:schema:preview') {
    const change = body.change ?? {}
    const sqlType = value => ({ integer: 'INTEGER', bigint: 'INTEGER', float: 'REAL', boolean: 'INTEGER' })[value] ?? 'TEXT'
    const literal = value => value === null ? 'NULL' : typeof value === 'string' ? `'${value.replaceAll("'", "''")}'` : String(typeof value === 'boolean' ? Number(value) : value)
    const column = spec => [quote(spec.name), spec.autoIncrement ? 'INTEGER' : sqlType(spec.type), spec.primary ? 'PRIMARY KEY' : '', spec.autoIncrement ? 'AUTOINCREMENT' : '', spec.nullable === false && !spec.primary ? 'NOT NULL' : '', spec.default !== undefined ? `DEFAULT ${literal(spec.default)}` : ''].filter(Boolean).join(' ')
    const plans = {
      'create-table': () => ({ statements: [`CREATE TABLE ${quote(change.table)} (${(change.columns ?? []).map(column).join(', ')})`], destructive: false, warnings: (change.columns ?? []).some(spec => spec.primary) ? [] : ['no_primary_key'] }),
      'add-column': () => ({ statements: [`ALTER TABLE ${quote(change.table)} ADD COLUMN ${column(change.column)}`], destructive: false, warnings: [] }),
      'rename-column': () => ({ statements: [`ALTER TABLE ${quote(change.table)} RENAME COLUMN ${quote(change.column)} TO ${quote(change.to)}`], destructive: false, warnings: ['code_may_reference_column'] }),
      'drop-column': () => ({ statements: [`ALTER TABLE ${quote(change.table)} DROP COLUMN ${quote(change.column)}`], destructive: true, confirm: change.column, warnings: ['data_loss'] }),
      'create-index': () => ({ statements: [`CREATE ${change.unique ? 'UNIQUE ' : ''}INDEX ${quote(change.name)} ON ${quote(change.table)} (${(change.columns ?? []).map(quote).join(', ')})`], destructive: false, warnings: [] }),
      'drop-index': () => ({ statements: [`DROP INDEX ${quote(change.name)}`], destructive: true, confirm: change.name, warnings: [] }),
    }
    if (change.kind === 'alter-column') { failed(json, type, 'SQLite cannot change a column’s type, nullability or default in place (the table would have to be rebuilt)', 'unsupported'); return true }
    if (!plans[change.kind]) { failed(json, type, 'Unknown schema change kind', 'invalid'); return true }
    json(envelope({ change, ...plans[change.kind]() })); return true
  }
  if (type === 'db:schema:apply') { refused(json, type, '本地预览不修改表结构。请使用真实 Host 验证。'); return true }
  if (type === 'db:kv:entries') { json(envelope({ entries: [] })); return true }
  return false
}
