export function numericFieldIssue(field, value) {
  if (value == null) return field.required ? '请输入数字' : null
  if (typeof value !== 'number' || !Number.isFinite(value)) return '请输入有效数字'
  if (field.integer && !Number.isInteger(value)) return '须为整数'
  if (typeof field.min === 'number' && value < field.min) return `不能小于 ${field.min}`
  if (typeof field.max === 'number' && value > field.max) return `不能大于 ${field.max}`
  return null
}

export function numericConfigInvalid(fields, config) {
  return Object.entries(fields).some(([key, field]) => {
    const value = config?.[key] ?? field.default
    if (field.type === 'number') return Boolean(numericFieldIssue(field, value))
    if (field.type === 'object' && value && typeof value === 'object') return numericConfigInvalid(field.object ?? field.properties ?? {}, value)
    if (field.type === 'list' && Array.isArray(value) && field.inner) return value.some(item => numericConfigInvalid({item:field.inner}, {item}))
    return false
  })
}
