function parsed(value) {
  try { return { valid: true, value: JSON.parse(value) } }
  catch { return { valid: false } }
}

export function relatedFieldIssue(value, definition = {}) {
  if (value === undefined || value === '') return null
  const type = definition.type?.toLowerCase()
  if (!['integer', 'float', 'boolean', 'date', 'json'].includes(type)) return null
  const result = parsed(value)
  if (result.valid && result.value === null) return definition.nullable === false ? '此字段不能为 null。' : null
  if (type === 'integer') return result.valid && Number.isSafeInteger(result.value) ? null : '请输入安全范围内的整数。'
  if (type === 'float') return result.valid && typeof result.value === 'number' && Number.isFinite(result.value) ? null : '请输入有效数字。'
  if (type === 'boolean') return result.valid && [true, false, 0, 1].includes(result.value) ? null : '请输入 true、false、0 或 1。'
  if (type === 'json') return result.valid ? null : '请输入有效的 JSON。'
  const date = result.valid && typeof result.value === 'string' ? result.value : value
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].+)?$/.exec(date)
  if (match) {
    const year = Number(match[1]), month = Number(match[2]), day = Number(match[3])
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate()
    if (month >= 1 && month <= 12 && day >= 1 && day <= lastDay && Number.isFinite(Date.parse(date))) return null
  }
  return '请输入有效日期，如 2026-10-08 或 ISO 日期时间。'
}

export function relatedRowIssues(columns, draft, definitions = {}) {
  const issues = {}
  for (const column of columns) {
    const issue = relatedFieldIssue(draft[column], definitions[column])
    if (issue) issues[column] = issue
  }
  return issues
}
