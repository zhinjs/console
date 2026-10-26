import { translate } from '../../i18n/locale.mjs'
export function numericFieldIssue(field, value, locale = 'zh-CN') {
  if (value == null) return field.required ? translate(locale, "请输入数字") : null
  if (typeof value !== 'number' || !Number.isFinite(value)) return translate(locale, "请输入有效数字")
  if (field.integer && !Number.isInteger(value)) return translate(locale, "须为整数")
  if (typeof field.min === 'number' && value < field.min) return translate(locale, "不能小于 {0}", [field.min])
  if (typeof field.max === 'number' && value > field.max) return translate(locale, "不能大于 {0}", [field.max])
  return null
}

export function numericConfigInvalid(fields, config, locale = 'zh-CN') {
  return Object.entries(fields).some(([key, field]) => {
    const value = config?.[key] ?? field.default
    if (field.type === 'number') return Boolean(numericFieldIssue(field, value, locale))
    if (field.type === 'object' && value && typeof value === 'object') return numericConfigInvalid(field.object ?? field.properties ?? {}, value, locale)
    if (field.type === 'list' && Array.isArray(value) && field.inner) return value.some(item => numericConfigInvalid({item:field.inner}, {item}, locale))
    return false
  })
}
