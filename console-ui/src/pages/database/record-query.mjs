import { translate } from '../../i18n/locale.mjs'

// Host `db:select` forwards `where` to the database query builder for both the page and its `total`,
// so filtering is table-wide. It has no ordering parameter: sorting can only reorder the loaded page.
const TEXT_TYPES = ['text', 'string', 'varchar', 'char', 'longtext']

/** How a column can be searched: 'text' | 'integer' | 'float' | 'boolean', or null when it cannot. */
export function filterColumnKind(definition, sample) {
  const type = definition?.type?.toLowerCase()
  if (type) {
    if (TEXT_TYPES.includes(type)) return 'text'
    if (type === 'integer' || type === 'bigint') return 'integer'
    if (type === 'float') return 'float'
    if (type === 'boolean') return 'boolean'
    return null
  }
  if (typeof sample === 'string') return 'text'
  if (typeof sample === 'number') return 'float'
  if (typeof sample === 'boolean') return 'boolean'
  return null
}

export function filterOperators(kind) {
  if (kind === 'text') return ['contains', 'eq']
  return kind ? ['eq'] : []
}

/** Columns that can be searched, in display order, with their kind. */
export function filterableColumns(columns, definitions = {}, sampleRow) {
  return columns
    .map(name => ({ name, kind: filterColumnKind(definitions?.[name], sampleRow?.[name]) }))
    .filter(column => column.kind)
}

function equalityValue(kind, text, locale) {
  if (kind === 'text') return { value: text }
  const trimmed = text.trim()
  if (kind === 'integer') {
    if (!/^-?\d+$/.test(trimmed)) return { error: translate(locale, "请输入整数。") }
    const number = Number(trimmed)
    return { value: Number.isSafeInteger(number) ? number : trimmed }
  }
  if (kind === 'float') {
    const number = Number(trimmed)
    return trimmed && Number.isFinite(number) ? { value: number } : { error: translate(locale, "请输入有效数字。") }
  }
  if (kind === 'boolean') {
    const lower = trimmed.toLowerCase()
    if (lower === 'true' || lower === '1') return { value: true }
    if (lower === 'false' || lower === '0') return { value: false }
    return { error: translate(locale, "请输入 true、false、0 或 1。") }
  }
  return { error: translate(locale, "此列暂不支持查找。") }
}

/** Builds the `where` sent to Host `db:select` for a related table, or explains why it cannot. */
export function relatedFilterWhere(filter, definitions = {}, sampleRow, locale = 'zh-CN') {
  const column = filter?.column
  if (!column) return { error: translate(locale, "请选择要查找的列。") }
  const kind = filterColumnKind(definitions?.[column], sampleRow?.[column])
  if (!kind) return { error: translate(locale, "此列暂不支持查找。") }
  const operator = filterOperators(kind).includes(filter.operator) ? filter.operator : filterOperators(kind)[0]
  const text = String(filter.value ?? '')
  if (!text.trim()) return { error: translate(locale, "请输入要查找的值。") }
  if (operator === 'contains') return { where: { [column]: { $like: `%${text}%` } }, operator }
  const parsed = equalityValue(kind, text, locale)
  return parsed.error ? { error: parsed.error } : { where: { [column]: parsed.value }, operator }
}

/** Builds an equality `where` for a document collection; the value is read as JSON when it parses. */
export function documentFilterWhere(filter, locale = 'zh-CN') {
  const field = String(filter?.field ?? '').trim()
  if (!field) return { error: translate(locale, "请输入字段名。") }
  if (field.startsWith('$')) return { error: translate(locale, "字段名不能以 $ 开头。") }
  const text = String(filter?.value ?? '')
  if (!text.trim()) return { error: translate(locale, "请输入要查找的值。") }
  let value = text
  try { value = JSON.parse(text) } catch { value = text }
  if (value !== null && typeof value === 'object') return { error: translate(locale, "只能按文本、数字、布尔值或 null 查找。") }
  return { where: { [field]: value } }
}

function sortText(value) {
  return typeof value === 'object' ? JSON.stringify(value) : String(value)
}

/** Reorders only the rows already loaded; Host has no ordering parameter for `db:select`. */
export function sortCurrentPageRows(rows, column, direction) {
  if (!rows?.length || !column) return rows ?? []
  return rows.slice().sort((a, b) => {
    const aVal = a?.[column]
    const bVal = b?.[column]
    if (aVal == null && bVal == null) return 0
    if (aVal == null) return 1
    if (bVal == null) return -1
    const cmp = sortText(aVal).localeCompare(sortText(bVal), undefined, { numeric: true, sensitivity: 'base' })
    return direction === 'desc' ? -cmp : cmp
  })
}
