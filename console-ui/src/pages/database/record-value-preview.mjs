import { translate } from '../../i18n/locale.mjs'
function clip(text, maxChars) {
  const compact = text.replace(/\s+/gu, ' ').trim()
  return compact.length > maxChars ? compact.slice(0, maxChars - 1) + '…' : compact
}
function shortValue(value, locale = 'zh-CN') {
  if (Array.isArray(value)) return translate(locale, "数组 · {0} 项", [value.length])
  if (value !== null && typeof value === 'object') return translate(locale, "对象 · {0} 个字段", [Object.keys(value).length])
  return clip(String(value), 48)
}
export function valuePreview(value, maxChars = 140, omitKeys = [], locale = 'zh-CN') {
  if (Array.isArray(value)) return shortValue(value, locale)
  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value).filter(key => !omitKeys.includes(key))
    if (!keys.length) return translate(locale, "无其他字段")
    const fields = keys.slice(0, 3).map(key => `${key}: ${shortValue(value[key], locale)}`)
    if (keys.length > 3) fields.push(translate(locale, "另 {0} 个字段", [keys.length - 3]))
    return clip(fields.join(' · '), maxChars)
  }
  return clip(String(value ?? (value === null ? 'null' : 'undefined')), maxChars)
}
export function fullValueText(value) {
  if (typeof value === 'string') return value
  return JSON.stringify(value, null, 2) ?? String(value)
}
