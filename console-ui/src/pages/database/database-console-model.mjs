import { translate } from '../../i18n/locale.mjs'
import { filterColumnKind } from './record-query.mjs'

// ---- Resizable split (table list | table detail) ----

export const SPLIT_STORAGE_KEY = 'zhin.console.database.split'
export const SPLIT_DEFAULT = 240
export const SPLIT_MIN = 168
export const SPLIT_MAX = 560
/** The detail pane keeps at least this much room. */
export const DETAIL_MIN = 360
export const SPLIT_STEP = 16

/** Width of the list pane within the bounds and the container (the detail keeps {@link DETAIL_MIN}). */
export function clampSplit(width, containerWidth) {
  const upper = Number.isFinite(containerWidth) && containerWidth > 0
    ? Math.max(SPLIT_MIN, Math.min(SPLIT_MAX, containerWidth - DETAIL_MIN))
    : SPLIT_MAX
  const value = Number.isFinite(width) ? Math.round(width) : SPLIT_DEFAULT
  return Math.min(upper, Math.max(SPLIT_MIN, value))
}

/** Stored width, or the default when storage is empty, blocked or holds garbage. */
export function readSplitWidth(storage) {
  try {
    const raw = storage?.getItem(SPLIT_STORAGE_KEY)
    const value = raw == null ? NaN : Number(raw)
    return Number.isFinite(value) ? clampSplit(value) : SPLIT_DEFAULT
  } catch {
    return SPLIT_DEFAULT
  }
}

export function saveSplitWidth(storage, width) {
  try {
    storage?.setItem(SPLIT_STORAGE_KEY, String(Math.round(width)))
    return true
  } catch {
    return false
  }
}

/** Keyboard on the separator: arrows move by a step (Shift: 4 steps), Home / End jump to the bounds. */
export function splitKeyTarget(key, width, containerWidth, shift = false) {
  const step = shift ? SPLIT_STEP * 4 : SPLIT_STEP
  if (key === 'ArrowLeft') return clampSplit(width - step, containerWidth)
  if (key === 'ArrowRight') return clampSplit(width + step, containerWidth)
  if (key === 'Home') return clampSplit(SPLIT_MIN, containerWidth)
  if (key === 'End') return clampSplit(SPLIT_MAX, containerWidth)
  return null
}

// ---- Host capabilities (feature detection) ----

/**
 * What the Host's database port supports (`db:info` `capabilities`). An older Host reports none:
 * sorting stays on the loaded page and the SQL / schema editors are hidden.
 */
export function databaseCapabilities(info) {
  const reported = info?.capabilities && typeof info.capabilities === 'object' ? info.capabilities : null
  return Object.freeze({
    reported: !!reported,
    sort: reported?.sort === true,
    filterOperators: Array.isArray(reported?.filterOperators) ? reported.filterOperators.filter(item => typeof item === 'string') : [],
    sql: reported?.sql === true,
    schema: reported?.schema === true,
    reason: typeof reported?.reason === 'string' ? reported.reason : '',
    // Why raw SQL is off while the schema editor may work (no restricted account, failed probe, ADR 0059).
    sqlReason: typeof reported?.sqlReason === 'string' ? reported.sqlReason : '',
    // `separate-store` (SQLite) | `restricted-credential` (PostgreSQL / MySQL) | '' (older Host).
    sqlIsolation: reported?.sqlIsolation === 'separate-store' || reported?.sqlIsolation === 'restricted-credential' ? reported.sqlIsolation : '',
    // `console-role-missing` | `console-role-invalid` | `text-compatibility` | `sqlite-isolation` | '' (older Host).
    sqlReasonCode: typeof reported?.sqlReasonCode === 'string' ? reported.sqlReasonCode : '',
  })
}

/** Why the SQL editor is unavailable, as the Host reported it ('' when it gave none). */
export function sqlUnavailableReason(capabilities) {
  return capabilities?.sqlReason || capabilities?.reason || ''
}

/**
 * The SQL editor is off because PostgreSQL / MySQL have no usable restricted account
 * (`zhin db console-role`): the Host's `sqlReasonCode` is `console-role-missing` or
 * `console-role-invalid` — not for other reasons (e.g. `standard_conforming_strings`).
 */
export function needsConsoleRole(capabilities) {
  return capabilities?.sql === false && !!capabilities?.reported
    && (capabilities?.sqlReasonCode === 'console-role-missing' || capabilities?.sqlReasonCode === 'console-role-invalid')
}

/**
 * The server refused a statement for lack of privilege (SQLSTATE 42501, or MySQL 42000 with a
 * "command denied" message): the restricted Console account cannot do it. Hosts before ADR 0059
 * send no SQLSTATE; PostgreSQL's "permission denied" text is recognised then.
 */
export function isPrivilegeRefusal(error) {
  const state = error?.details?.sqlState
  if (state === '42501') return true
  const message = String(error?.message ?? error ?? '')
  if (state === '42000') return /command denied|access denied/iu.test(message)
  return state === undefined && /^permission denied for /iu.test(message)
}

/** An RPC the Host does not know (older Host): hide the feature rather than report a failure. */
export function isUnsupportedRpcError(error) {
  const message = String(error?.message ?? error ?? '')
  const details = error?.details ?? {}
  return details.dataCode === 'unsupported' || details.serverCode === 'unmapped' || details.serverCode === 'unsupported'
    || /unknown rpc type|not available on plugin runtime host|not supported by this database host|未登记权限/iu.test(message)
}

/** The database port's refusal code (`read_only`, `protected_table`, `confirm_required`, …), if any. */
export function databaseRefusalCode(error) {
  const code = error?.details?.dataCode
  return typeof code === 'string' ? code : ''
}

// ---- Sorting ----

/** Header click: none → ascending → descending → none (a different column starts at ascending). */
export function nextSort(current, column) {
  if (!current || current.column !== column) return { column, direction: 'asc' }
  if (current.direction === 'asc') return { column, direction: 'desc' }
  return null
}

// ---- Per-column filters ----

export const COLUMN_FILTER_OPERATORS = Object.freeze(['eq', 'ne', 'contains', 'gt', 'lt', 'null', 'notnull'])
const VALUELESS = new Set(['null', 'notnull'])

export function operatorNeedsValue(operator) {
  return !VALUELESS.has(operator)
}

/** Operators a column offers by its kind (`filterColumnKind`); unknown kinds only test for null. */
export function columnFilterOperators(kind) {
  if (kind === 'text') return ['contains', 'eq', 'ne', 'gt', 'lt', 'null', 'notnull']
  if (kind === 'integer' || kind === 'float') return ['eq', 'ne', 'gt', 'lt', 'null', 'notnull']
  if (kind === 'boolean') return ['eq', 'ne', 'null', 'notnull']
  return ['null', 'notnull']
}

export function operatorSymbol(operator) {
  return { eq: '=', ne: '≠', contains: '∋', gt: '>', lt: '<', null: '∅', notnull: '≠ ∅' }[operator] ?? operator
}

/** Translated operator name. */
export function operatorLabel(operator, locale = 'zh-CN') {
  const t = message => translate(locale, message)
  switch (operator) {
    case 'eq': return t('等于')
    case 'ne': return t('不等于')
    case 'contains': return t('包含')
    case 'gt': return t('大于')
    case 'lt': return t('小于')
    case 'null': return t('为空')
    case 'notnull': return t('不为空')
    default: return operator
  }
}

function typedValue(kind, text, locale) {
  if (kind === 'text') return { value: text }
  const trimmed = text.trim()
  if (kind === 'integer') {
    if (!/^-?\d+$/.test(trimmed)) return { error: translate(locale, '请输入整数。') }
    const number = Number(trimmed)
    return { value: Number.isSafeInteger(number) ? number : trimmed }
  }
  if (kind === 'float') {
    const number = Number(trimmed)
    return trimmed && Number.isFinite(number) ? { value: number } : { error: translate(locale, '请输入有效数字。') }
  }
  if (kind === 'boolean') {
    const lower = trimmed.toLowerCase()
    if (lower === 'true' || lower === '1') return { value: true }
    if (lower === 'false' || lower === '0') return { value: false }
    return { error: translate(locale, '请输入 true、false、0 或 1。') }
  }
  return { error: translate(locale, '此列暂不支持查找。') }
}

const OPERATOR_KEYS = { eq: '$eq', ne: '$ne', gt: '$gt', lt: '$lt' }

/**
 * The `where` of per-column filters (`[{ column, operator, value }]`), combined with AND and sent to
 * Host `db:select` for the whole table. Returns `{ where }` or `{ error, column }` for the first
 * invalid filter.
 */
export function columnFiltersWhere(filters, definitions = {}, sampleRow, locale = 'zh-CN') {
  const where = {}
  for (const filter of filters ?? []) {
    const column = filter?.column
    if (!column) return { error: translate(locale, '请选择要查找的列。'), column: '' }
    const kind = filterColumnKind(definitions?.[column], sampleRow?.[column])
    const operators = columnFilterOperators(kind)
    if (!operators.includes(filter.operator)) return { error: translate(locale, '此列不支持这种查找方式。'), column }
    let condition
    if (filter.operator === 'null') condition = { $eq: null }
    else if (filter.operator === 'notnull') condition = { $ne: null }
    else {
      const text = String(filter.value ?? '')
      if (!text.trim()) return { error: translate(locale, '请输入要查找的值。'), column }
      if (filter.operator === 'contains') condition = { $like: `%${text}%` }
      else {
        const parsed = typedValue(kind, text, locale)
        if (parsed.error) return { error: parsed.error, column }
        condition = { [OPERATOR_KEYS[filter.operator]]: parsed.value }
      }
    }
    const previous = where[column]
    // Plain equality is the value itself: every Host version reads `{ column: value }`.
    if (!previous && filter.operator === 'eq') { where[column] = condition.$eq; continue }
    if (previous !== undefined && (previous === null || typeof previous !== 'object' || Object.keys(condition).some(key => Object.hasOwn(previous, key)))) {
      return { error: translate(locale, '同一列的同一种条件只能有一个。'), column }
    }
    where[column] = { ...(previous ?? {}), ...condition }
  }
  return { where }
}

// ---- Masking ----

const SENSITIVE_COLUMN = /token|password|passwd|secret|cookie|api_?key|private_?key|credential/iu

/** Columns masked by default: the name looks sensitive, or the Host marks the column `secret`. */
export function isSensitiveColumn(name, definition) {
  return definition?.secret === true || SENSITIVE_COLUMN.test(String(name ?? ''))
}

export const MASK = '••••••'

// ---- SQL editor ----

export const SQL_HISTORY_KEY = 'zhin.console.database.sqlHistory'
export const SQL_HISTORY_LIMIT = 30

/** Recent statements of this viewer (newest first); empty when storage is blocked or corrupt. */
export function readSqlHistory(storage) {
  try {
    const parsed = JSON.parse(storage?.getItem(SQL_HISTORY_KEY) ?? '[]')
    return Array.isArray(parsed)
      ? parsed.filter(item => item && typeof item.sql === 'string' && typeof item.at === 'number').slice(0, SQL_HISTORY_LIMIT)
      : []
  } catch {
    return []
  }
}

/** Adds a statement on top (an identical earlier entry moves up); returns the new list. */
export function pushSqlHistory(storage, entry, previous = readSqlHistory(storage)) {
  const sql = String(entry?.sql ?? '').trim()
  if (!sql) return previous
  const next = [{ sql, at: entry.at ?? Date.now(), ok: entry.ok !== false }, ...previous.filter(item => item.sql !== sql)].slice(0, SQL_HISTORY_LIMIT)
  try { storage?.setItem(SQL_HISTORY_KEY, JSON.stringify(next)) } catch { /* history is a convenience */ }
  return next
}

export function clearSqlHistory(storage) {
  try { storage?.removeItem(SQL_HISTORY_KEY) } catch { /* ignore */ }
  return []
}

/**
 * Whether the editor sends the text as a read (`db:query`) or a write (`db:execute`). Only a hint:
 * the Host classifies the statement again and runs reads in a read-only transaction.
 */
export function sqlLooksReadOnly(sql) {
  const code = String(sql ?? '')
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''")
    .trim()
    .toLowerCase()
  const statements = code.split(';').map(part => part.trim()).filter(Boolean)
  if (statements.length !== 1) return statements.length === 0
  const first = /^\(*\s*([a-z_]+)/.exec(statements[0])?.[1] ?? ''
  if (first === 'pragma') return !statements[0].includes('=')
  if (first === 'with') return !/\b(?:insert|update|delete|merge|replace)\b/.test(statements[0])
  return ['select', 'explain', 'show', 'describe', 'desc', 'values'].includes(first)
}

/** Total rows a write run changed, or null when the driver did not report counts. */
export function affectedRows(result) {
  const counts = (result?.statements ?? []).map(item => item?.affected).filter(value => typeof value === 'number')
  return counts.length ? counts.reduce((sum, value) => sum + value, 0) : null
}

/** Cell text for the SQL result grid and the data view. */
export function cellText(value) {
  if (value === null || value === undefined) return ''
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

// ---- Schema editor ----

export const SCHEMA_COLUMN_TYPES = Object.freeze(['text', 'integer', 'bigint', 'float', 'boolean', 'date', 'json'])

/** Translated warning of a schema plan (stable codes from the Host). */
export function schemaWarningText(code, locale = 'zh-CN') {
  const t = message => translate(locale, message)
  switch (code) {
    case 'data_loss': return t('此操作会删除数据，无法撤销。')
    case 'type_change_may_fail': return t('已有数据无法转换为新类型时，修改会失败且不改变任何内容。')
    case 'not_null_requires_values': return t('已有空值时，设为不可空会失败。')
    case 'not_null_without_default': return t('不可空且没有默认值：表中已有记录时添加会失败。')
    case 'no_primary_key': return t('没有主键：Console 将无法编辑或删除这张表的记录。')
    case 'code_may_reference_column': return t('插件代码可能仍按旧列名读写，改名前请确认。')
    case 'mysql_modify_restates_column': return t('MySQL 会按这里的完整定义重写整列。')
    default: return code
  }
}

/**
 * Parses the default-value field of the schema form: empty → no default, `NULL` → null, numbers
 * and booleans by the column type, anything else as text.
 */
export function parseDefaultInput(text, type) {
  const raw = String(text ?? '')
  if (!raw.trim()) return { none: true }
  if (raw.trim().toUpperCase() === 'NULL') return { value: null }
  if (type === 'integer' || type === 'bigint' || type === 'float') {
    const number = Number(raw.trim())
    return Number.isFinite(number) ? { value: number } : { error: true }
  }
  if (type === 'boolean') {
    const lower = raw.trim().toLowerCase()
    if (lower === 'true' || lower === '1') return { value: true }
    if (lower === 'false' || lower === '0') return { value: false }
    return { error: true }
  }
  return { value: raw }
}
