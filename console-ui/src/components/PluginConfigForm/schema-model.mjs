/** Consume the Host's ConsoleSchema projection. This module edits drafts; only the Host validates. */
export function objectFields(schema) { return schema?.type === 'object' && schema.object && !Array.isArray(schema.object) ? schema.object : {} }
const simpleTypes = new Set(['string', 'number', 'integer', 'boolean', 'const'])
const unsupportedKeys = ['$ref', 'anyOf', 'oneOf', 'allOf', 'prefixItems', 'patternProperties', 'additionalProperties']
export function unsupportedFormFields(schema, path = '$') {
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) return [`${path}：Host 未提供可编辑的字段定义`]
  const keyword = unsupportedKeys.find(key => schema[key] !== undefined && schema[key] !== false)
  if (keyword) return [`${path}：${keyword} 需要源码编辑`]
  if (schema.type === 'object') {
    if (!schema.object || typeof schema.object !== 'object' || Array.isArray(schema.object)) return [`${path}：对象字段尚未由 Host 投影`]
    return Object.entries(schema.object).flatMap(([key, field]) => unsupportedFormFields(field, `${path}.${key}`))
  }
  if (schema.type === 'list') return schema.inner ? unsupportedFormFields(schema.inner, `${path}[]`) : [`${path}：列表缺少元素定义`]
  return simpleTypes.has(schema.type) ? [] : [`${path}：${String(schema.type ?? '未知类型')} 需要源码编辑`]
}
function copy(value) { return value === undefined ? undefined : structuredClone(value) }
export function declaredDefaults(schema, value) {
  const current = value === undefined && Object.hasOwn(schema, 'default') ? copy(schema.default) : copy(value)
  if (schema.type === 'object' && current && typeof current === 'object' && !Array.isArray(current)) {
    for (const [key, field] of Object.entries(objectFields(schema))) {
      const child = declaredDefaults(field, current[key])
      if (child !== undefined) Object.defineProperty(current, key, { value: child, enumerable: true, configurable: true, writable: true })
    }
  }
  if (schema.type === 'list' && Array.isArray(current) && schema.inner) return current.map(item => declaredDefaults(schema.inner, item))
  return current
}
/** Own-property writes preserve unknown siblings, literal dots and array structure; never use dotted paths. */
export function updateObjectField(value, key, child) {
  const next = value && typeof value === 'object' && !Array.isArray(value) ? { ...value } : {}
  if (child === undefined) delete next[key]
  else Object.defineProperty(next, key, { value: child, enumerable: true, configurable: true, writable: true })
  return next
}
export function updateListItem(value, index, child) {
  const next = [...value]; next[index] = child; return next
}
/** Empty fields stay absent. Invalid numeric drafts stay strings so Host feedback never loses user input. */
export function numericDraft(text) {
  if (text === '') return undefined
  if (/^\$\{[A-Za-z_][A-Za-z0-9_]*\}$/.test(text)) return text
  const number = Number(text)
  return text.trim() && Number.isFinite(number) ? number : text
}
export function requiredGuidance(schema, value, path = '$') {
  const entries = []
  for (const [key, field] of Object.entries(objectFields(schema))) {
    const child = value?.[key]
    const childPath = `${path}.${key}`
    if (field.required && child === undefined && !Object.hasOwn(field, 'default')) entries.push(childPath)
    if (child && field.type === 'object') entries.push(...requiredGuidance(field, child, childPath))
    if (field.type === 'list' && field.inner && Array.isArray(child)) child.forEach((item, i) => entries.push(...requiredGuidance(field.inner, item, `${childPath}[${i}]`)))
  }
  return entries
}
export function hostValidationSummary(checked) {
  if (!checked) return null
  if (!checked.valid) return '配置未通过 Host 校验，请根据字段提示修改。'
  if (checked.missingEnv?.length) return '字段格式已通过校验，但环境变量尚未配置，不能完成最小配置。'
  return 'Host 校验通过，可以保存配置。'
}
