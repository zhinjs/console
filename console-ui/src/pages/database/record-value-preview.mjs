function clip(text, maxChars) {
  const compact = text.replace(/\s+/gu, ' ').trim()
  return compact.length > maxChars ? compact.slice(0, maxChars - 1) + '…' : compact
}
function shortValue(value) {
  if (Array.isArray(value)) return `数组 · ${value.length} 项`
  if (value !== null && typeof value === 'object') return `对象 · ${Object.keys(value).length} 个字段`
  return clip(String(value), 48)
}
export function valuePreview(value, maxChars = 140, omitKeys = []) {
  if (Array.isArray(value)) return shortValue(value)
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => !omitKeys.includes(key))
    if (!keys.length) return '无其他字段'
    const fields = keys.slice(0, 3).map(key => `${key}: ${shortValue(value[key])}`)
    if (keys.length > 3) fields.push(`另 ${keys.length - 3} 个字段`)
    return clip(fields.join(' · '), maxChars)
  }
  return clip(String(value ?? (value === null ? 'null' : 'undefined')), maxChars)
}
export function fullValueText(value) {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}
