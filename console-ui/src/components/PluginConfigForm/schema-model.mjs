/** Consume the Host's ConsoleSchema projection. This module edits drafts; only the Host validates. */
export function objectFields(schema) { return schema?.type === 'object' && schema.object && !Array.isArray(schema.object) ? schema.object : {} }
const simpleTypes = new Set(['string', 'number', 'integer', 'boolean', 'const', 'null', 'any', 'constraint'])
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
  if (schema.type === 'dict') return schema.inner ? unsupportedFormFields(schema.inner, `${path}.*`) : []
  if (['union', 'tuple', 'intersect'].includes(schema.type)) return Array.isArray(schema.list) ? schema.list.flatMap((field, i) => unsupportedFormFields(field, `${path}[${i}]`)) : []
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
  if (schema.type === 'tuple' && Array.isArray(current)) return current.map((item, index) => {
    const field = schema.list?.[index] ?? schema.inner
    return field ? declaredDefaults(field, item) : item
  })
  if (schema.type === 'dict' && current && typeof current === 'object' && !Array.isArray(current) && schema.inner) {
    for (const key of Object.keys(current)) Object.defineProperty(current, key, { value: declaredDefaults(schema.inner, current[key]), enumerable: true, configurable: true, writable: true })
  }
  if (schema.type === 'intersect') return (schema.list ?? []).reduce((value, branch) => branch.type === 'constraint' ? value : declaredDefaults(branch, value), current)
  return current
}
/** Explicit add/branch-selection seed, never an implicit conversion of a saved value. */
export function initialSchemaValue(schema) {
  if (Object.hasOwn(schema, 'default')) return copy(schema.default)
  if (schema.type === 'const') return copy(Object.hasOwn(schema, 'value') ? schema.value : schema.default)
  if (schema.type === 'null') return null
  if (schema.type === 'object') {
    const result = {}
    for (const [key, field] of Object.entries(objectFields(schema))) {
      if (field.required || field.type === 'const' || Object.hasOwn(field, 'default')) {
        const child = initialSchemaValue(field)
        if (child !== undefined) Object.defineProperty(result, key, { value: child, enumerable: true, configurable: true, writable: true })
      }
    }
    return result
  }
  if (schema.type === 'dict') return {}
  if (schema.type === 'intersect') {
    const branches = (schema.list ?? []).filter(field => field.type !== 'constraint')
    const values = branches.map(initialSchemaValue)
    if (values.length && values.every(value => value && typeof value === 'object' && !Array.isArray(value))) return Object.assign({}, ...values)
  }
  if (schema.type === 'list') return []
  if (schema.type === 'tuple') return (schema.list ?? []).map(field => initialSchemaValue(field) ?? null)
  return undefined
}
/** Presentation only, never a replacement for Host validation or a claim of branch validity. */
export function matchingSchemaBranches(branches, value) {
  function matches(field, current) {
    if (field.type === 'const') return JSON.stringify(current) === JSON.stringify(Object.hasOwn(field, 'value') ? field.value : field.default)
    if (field.type === 'null') return current === null
    if (field.type === 'object' || field.type === 'dict') {
      if (!current || typeof current !== 'object' || Array.isArray(current)) return false
      return Object.entries(objectFields(field)).every(([key, child]) => child.type !== 'const' || matches(child, current[key]))
    }
    if (field.type === 'list' || field.type === 'tuple') return Array.isArray(current)
    if (field.type === 'number' || field.type === 'integer') return typeof current === 'number'
    if (field.type === 'any') return true
    return typeof current === field.type
  }
  return branches.flatMap((field, index) => matches(field, value) ? [index] : [])
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
