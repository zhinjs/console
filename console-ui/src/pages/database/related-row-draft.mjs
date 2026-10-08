export function parseRelatedRow(columns, draft, definitions = {}, original) {
  const row = {}
  for (const column of columns) {
    const value = draft[column]
    if (value === undefined) continue
    const type = definitions[column]?.type?.toLowerCase()
    const text = ['text', 'string', 'varchar', 'char', 'longtext'].includes(type) || (!type && typeof original?.[column] === 'string')
    if (value === '') {
      if (original && text) row[column] = ''
      continue
    }
    if (text) { row[column] = value; continue }
    try { row[column] = JSON.parse(value) } catch { row[column] = value }
  }
  return row
}
