import { validDiagnosticConversation } from './endpoint-detail/message-diagnostics.mjs'
const string = value => typeof value === 'string' && value.length > 0
const states = new Set(['scheduled', 'paused', 'running', 'unknown', 'succeeded', 'failed', 'cancelled'])
const actions = new Set(['pause', 'resume', 'cancel', 'update'])
export const TASK_STATE_LABELS = Object.freeze({ scheduled: '等待执行', paused: '已暂停', running: '执行中', unknown: '结果不确定', succeeded: '已完成', failed: '执行失败', cancelled: '已取消' })
export const TASK_ACTION_LABELS = Object.freeze({ pause: '暂停', resume: '恢复', cancel: '取消', update: '修改' })
const object = value => !!value && typeof value === 'object' && !Array.isArray(value)
export function readTaskSnapshot(value) {
  if (!object(value) || !string(value.revision) || !Array.isArray(value.tasks) || !Array.isArray(value.receipts)) throw new Error('任务快照格式无效，未显示可能不完整的任务。')
  const ids = new Set()
  const tasks = value.tasks.map(task => {
    if (!object(task) || !string(task.id) || ids.has(task.id) || task.ownership !== 'administrator' || !string(task.title)
      || !validDiagnosticConversation(task.target) || !states.has(task.state) || !Number.isFinite(task.createdAt)
      || task.nextRunAt !== undefined && !Number.isFinite(task.nextRunAt) || task.lastRunAt !== undefined && !Number.isFinite(task.lastRunAt)
      || task.timezone !== undefined && typeof task.timezone !== 'string' || task.detail !== undefined && typeof task.detail !== 'string'
      || !object(task.parameters) || !Array.isArray(task.actions) || !task.actions.every(action => actions.has(action))) throw new Error('管理员任务字段或目标无效，未与聊天用户任务混合。')
    ids.add(task.id)
    return { ...task, actions: [...new Set(task.actions)] }
  })
  const requestIds = new Set()
  const receipts = value.receipts.map(receipt => {
    if (!object(receipt) || !string(receipt.requestId) || requestIds.has(receipt.requestId) || !string(receipt.taskId) || !['create', ...actions].includes(receipt.operation)) throw new Error('任务操作确认格式无效。')
    requestIds.add(receipt.requestId)
    return { requestId: receipt.requestId, taskId: receipt.taskId, operation: receipt.operation }
  })
  return { revision: value.revision, tasks, receipts }
}
export function readTaskProviders(body) {
  if (body?.success !== true || !Number.isSafeInteger(body.data?.generation) || body.data.generation < 0 || !Array.isArray(body.data.providers)) throw new Error('任务提供方响应格式无效。')
  const owners = new Set()
  return { generation: body.data.generation, providers: body.data.providers.map(provider => {
    if (!object(provider) || !string(provider.owner) || owners.has(provider.owner) || !string(provider.title) || typeof provider.description !== 'string'
      || !object(provider.schema) || !Array.isArray(provider.effects) || !provider.effects.every(effect => typeof effect === 'string')
      || provider.packageName !== undefined && provider.packageName !== null && !string(provider.packageName)) throw new Error('任务提供方字段无效。')
    owners.add(provider.owner)
    return { ...provider, ...readTaskSnapshot(provider) }
  }) }
}
export function readTaskMutation(body) {
  const parsed = readTaskProviders({ success: body?.success, data: { generation: body?.data?.generation, providers: [body?.data?.provider] } })
  return { generation: parsed.generation, provider: parsed.providers[0] }
}
export function taskBusinessError(body) {
  return body?.success === false && ['invalid_input', 'conflict', 'not_found', 'unsupported', 'forbidden'].includes(body.code)
    && typeof body.error === 'string' && body.error.length > 0 && body.error.length <= 1000 ? body.error : undefined
}
export function readTaskUseCases(body) {
  if (body?.success !== true || !Array.isArray(body.data)) throw new Error('用途目录格式无效。')
  return body.data.map(item => {
    if (!object(item) || !['id', 'title', 'summary', 'packageName', 'mode'].every(key => string(item[key]))
      || !Array.isArray(item.steps) || !item.steps.every(string) || !Array.isArray(item.limitations) || !item.limitations.every(string)) throw new Error('用途目录字段无效。')
    return { id: item.id, title: item.title, summary: item.summary, packageName: item.packageName, mode: item.mode, steps: [...item.steps], limitations: [...item.limitations] }
  })
}
export function reconcileTaskMutation(catalog, pending) {
  const provider = catalog.providers.find(item => item.owner === pending.owner)
  const receipt = provider?.receipts.find(item => item.requestId === pending.requestId && item.operation === pending.operation)
  return receipt ? { receipt, task: provider.tasks.find(item => item.id === receipt.taskId) } : undefined
}
export function readPendingTask(value) {
  if (!object(value) || !['owner', 'requestId', 'operation', 'host', 'scope'].every(key => string(value[key])) || !Number.isSafeInteger(value.generation)
    || !['create', ...actions].includes(value.operation)) return undefined
  return { owner: value.owner, requestId: value.requestId, operation: value.operation, generation: value.generation, host: value.host, scope: value.scope }
}
/** This adapter edits primitive JSON Schema fields; it is not a configuration transaction. */
export function taskParameterFields(schema) {
  const unsupported = ['$ref', 'anyOf', 'oneOf', 'allOf', 'not', 'if', 'then', 'else', 'dependentSchemas', 'patternProperties', 'prefixItems']
  if (!object(schema) || schema.type !== 'object' || !object(schema.properties) || unsupported.some(key => key in schema)
    || schema.additionalProperties !== undefined && schema.additionalProperties !== false) return { fields: {}, unsupported: '此任务使用复杂参数 Schema，当前工作台无法完整编辑；请使用提供方的正式入口。' }
  const fields = {}
  for (const [key, value] of Object.entries(schema.properties)) {
    if (!object(value) || !['string', 'integer', 'number', 'boolean'].includes(value.type) || unsupported.some(name => name in value)
      || value.enum !== undefined && (!Array.isArray(value.enum) || !value.enum.every(item => ['string', 'number', 'boolean'].includes(typeof item)))) return { fields: {}, unsupported: '此任务包含尚不支持的嵌套或复合字段，表单未部分保存。' }
    Object.defineProperty(fields, key, { enumerable: true, value: { ...value, key: value.title ?? key,
      required: Array.isArray(schema.required) && schema.required.includes(key), min: value.minimum, max: value.maximum,
      ...(value.type === 'string' && key === 'text' ? { component: 'textarea' } : {}) } })
  }
  return { fields }
}
export function taskDefaults(schema) {
  const { fields, unsupported } = taskParameterFields(schema)
  if (unsupported) return {}
  return Object.fromEntries(Object.entries(fields).filter(([, field]) => Object.hasOwn(field, 'default')).map(([key, field]) => [key, structuredClone(field.default)]))
}
export function validateTaskParameters(schema, parameters) {
  const { fields, unsupported } = taskParameterFields(schema)
  if (unsupported) return [unsupported]
  const issues = []
  for (const [key, field] of Object.entries(fields)) {
    const value = Object.hasOwn(parameters, key) ? parameters[key] : undefined
    if (value === undefined || value === '') { if (field.required) issues.push(`${field.key}为必填项`); continue }
    const type = field.type
    if (type === 'integer' ? !Number.isSafeInteger(value) : type === 'number' ? typeof value !== 'number' || !Number.isFinite(value) : typeof value !== type) { issues.push(`${field.key}格式不正确`); continue }
    if (typeof value === 'number' && (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max)) issues.push(`${field.key}超出允许范围`)
    if (field.enum && !field.enum.includes(value)) issues.push(`${field.key}不在允许选项中`)
    if (typeof value === 'string' && field.minLength !== undefined && value.length < field.minLength) issues.push(`${field.key}内容过短`)
    if (typeof value === 'string' && field.maxLength !== undefined && value.length > field.maxLength) issues.push(`${field.key}内容过长`)
    if (field.format === 'date-time' && (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/u.test(value) || !Number.isFinite(Date.parse(value)))) issues.push(`${field.key}须为包含 Z 或 ±hh:mm 的完整 ISO 时间`)
  }
  if (schema.additionalProperties === false && Object.keys(parameters).some(key => !Object.hasOwn(fields, key))) issues.push('参数含当前 Schema 未声明的字段，未静默删除；请核对草稿或明确重新配置。')
  return issues
}
export function availableTaskActions(task) { return task.actions.filter(action => task.state !== 'unknown' || action === 'cancel') }
export function taskTimeLabel(time, timezone) {
  if (time === undefined) return '提供方未返回具体时间，请查看执行规则与任务详情'
  const date = new Date(time)
  if (!Number.isFinite(date.getTime())) return '时间超出可显示范围，请检查任务提供方'
  try { return `${date.toLocaleString('zh-CN', { timeZone: timezone || 'UTC', hour12: false })}（${timezone || 'UTC'}）` }
  catch { return `${date.toISOString()}（提供方时区无效）` }
}
export function taskDateTimeLabel(value, timezone) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value))) return String(value ?? '未设置')
  if (timezone) {
    try { return `${new Date(value).toLocaleString('zh-CN', { timeZone: timezone, hour12: false })}（${timezone}）` } catch { /* Preserve the explicit input offset below. */ }
  }
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/u)
  return parts ? `${parts[1]}年${Number(parts[2])}月${Number(parts[3])}日 ${parts[4]}:${parts[5]}${parts[6] && parts[6] !== '00' ? `:${parts[6]}` : ''}（${parts[7] === 'Z' ? 'UTC' : `UTC${parts[7]}`}）` : value
}
function readableValue(value) {
  if (value === null) return '空值'
  if (value === undefined) return '未设置'
  if (typeof value === 'boolean') return value ? '是' : '否'
  if (Array.isArray(value)) return value.map(readableValue).join('、') || '空列表'
  if (typeof value === 'object') return Object.entries(value).map(([key, child]) => `${key}：${readableValue(child)}`).join('；') || '空对象'
  return String(value)
}
export function taskParameterSummary(schema, parameters, timezone) {
  return Object.entries(parameters ?? {}).map(([key, value]) => {
    const field = object(schema?.properties?.[key]) ? schema.properties[key] : {}
    return { key, title: string(field.title) ? field.title : key,
      value: field.format === 'date-time' ? taskDateTimeLabel(value, timezone) : readableValue(value) }
  })
}
export function taskActionDescription(action) {
  return ({ create: '确认后保存管理员任务，后续按提供方的执行规则运行。请核对下方外部影响及投递目标；不会发送测试消息。',
    pause: '确认后请求暂停后续执行；已经开始的投递无法撤回。',
    resume: '确认后请求恢复调度，后续执行时间以提供方返回为准。不会重试不确定的投递。',
    cancel: '确认后取消后续执行，无法撤回已经开始或结果不确定的投递。',
    update: '确认后保存参数修改，投递目标保持不变；后续执行以提供方返回的任务状态为准。' })[action] ?? '请核对目标与操作内容。'
}
export function taskMutationBody({ generation, provider, requestId, target, parameters, id, action }) {
  if (!Number.isSafeInteger(generation) || generation < 0 || !string(provider?.owner) || !string(provider?.revision)
    || typeof requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(requestId)) throw new Error('缺少当前代、修订或操作身份，请刷新核对。')
  const base = { generation, owner: provider.owner, requestId, expectedRevision: provider.revision }
  if (action) {
    if (!string(id) || !actions.has(action)) throw new Error('任务操作无效')
    const task = provider.tasks.find(item => item.id === id)
    if (!task || !availableTaskActions(task).includes(action)) throw new Error('该任务当前不允许此操作，请刷新核对。')
    return { ...base, id, action, ...(parameters !== undefined ? { parameters: structuredClone(parameters) } : {}) }
  }
  if (!validDiagnosticConversation(target) || !object(parameters)) throw new Error('请提供完整投递目标与参数。')
  return { ...base, target: structuredClone(target), parameters: structuredClone(parameters) }
}
