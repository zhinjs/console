import { targetDraftIssue } from '../components/PluginConfigForm/conversation-scope-model.mjs'

const outcomes = new Set(['match', 'mismatch', 'unknown', 'not_evaluated'])
const kinds = new Set(['adapter', 'group', 'private', 'channel', 'user', 'role', 'platform', 'unknown'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string'
const strings = value => Array.isArray(value) && value.every(text)
const integer = value => Number.isSafeInteger(value) && value >= 0
const invalid = () => { throw new Error('权限说明响应无效，请刷新目录或更新 Host。') }
const validTarget = value => targetDraftIssue(value) === null && value.endpoint.id.length <= 8192
  && [value.endpoint.adapter, value.id, value.parent?.id, value.threadId].every(item => item === undefined || item.length <= 2048)
const targetKey = value => JSON.stringify([value.endpoint.id, value.endpoint.adapter, value.kind, value.id,
  value.parent?.kind ?? null, value.parent?.id ?? null, value.threadId ?? null])

function command(value) {
  if (!object(value) || !text(value.id) || !value.id || !text(value.owner) || !value.owner || !text(value.name)
    || value.description !== undefined && !text(value.description) || !strings(value.permits) || value.adapter !== undefined && !text(value.adapter)) invalid()
  return { id: value.id, owner: value.owner, name: value.name, description: value.description ?? '',
    permits: [...value.permits], ...(value.adapter === undefined ? {} : { adapter: value.adapter }) }
}
function result(value) {
  if (!object(value) || !outcomes.has(value.outcome) || !text(value.reason)) invalid()
  return { outcome: value.outcome, reason: value.reason }
}

export function readPermissionCatalog(body) {
  const data = body?.data
  if (body?.success !== true || !object(data) || !integer(data.generation) || !integer(data.total)
    || !integer(data.page) || data.page < 1 || !integer(data.pageSize) || data.pageSize < 1 || data.pageSize > 100
    || !Array.isArray(data.commands) || data.commands.length > data.pageSize) invalid()
  const commands = data.commands.map(command)
  if (new Set(commands.map(item => item.id)).size !== commands.length) invalid()
  return { generation: data.generation, page: data.page, pageSize: data.pageSize, total: data.total, commands }
}

export function permissionRequest(generation, selected, { target, requireTarget = false, senderId = '', roles = '' } = {}) {
  if (!integer(generation) || !selected?.id) throw new Error('请先从当前运行代目录选择命令。')
  if ((target !== undefined || requireTarget) && !validTarget(target)) throw new Error('请填写完整的假设账号与会话身份。')
  if (senderId.length > 200 || roles.length > 2000) throw new Error('假设身份过长，请精简后重试。')
  const values = roles.split(/[,，\s]+/u).filter(Boolean)
  if (values.length && !senderId) throw new Error('填写假设角色时，请同时提供发送者 ID。')
  return { generation, commandId: selected.id, ...(target === undefined ? {} : { target }),
    ...(senderId ? { sender: { id: senderId, ...(values.length ? { roles: [...new Set(values)] } : {}) } } : {}) }
}

export function readPermissionExplanation(body, requested) {
  const data = body?.data
  if (body?.success !== true || !object(data) || data.simulation !== true || data.generation !== requested.generation
    || !['present', 'missing', 'unverified'].includes(data.permissionHost) || !Array.isArray(data.rules)
    || !strings(data.unconstrained) || !strings(data.assumptions)) invalid()
  const selected = command(data.command)
  if (selected.id !== requested.commandId || data.rules.length !== selected.permits.length) invalid()
  if (requested.target === undefined ? data.target !== undefined
    : !validTarget(data.target) || targetKey(data.target) !== targetKey(requested.target)) invalid()
  if (requested.sender === undefined ? data.sender !== undefined
    : !object(data.sender) || data.sender.id !== requested.sender.id
      || JSON.stringify(data.sender.roles) !== JSON.stringify(requested.sender.roles)) invalid()
  const rules = data.rules.map((item, index) => {
    if (!object(item) || item.index !== index || item.rule !== selected.permits[index] || !kinds.has(item.kind)
      || item.values !== undefined && !strings(item.values)) invalid()
    return { index, rule: item.rule, kind: item.kind, ...result(item), ...(item.values === undefined ? {} : { values: [...item.values] }) }
  })
  return { generation: data.generation, simulation: true, command: selected, target: data.target, sender: data.sender,
    permissionHost: data.permissionHost, adapter: result(data.adapter), rules, summary: result(data.summary),
    unconstrained: [...data.unconstrained], assumptions: [...data.assumptions] }
}

export function permissionOutcomeLabel(outcome) {
  return ({ match: '条件符合', mismatch: '条件不符', unknown: '缺少依据', not_evaluated: '未评估' })[outcome] ?? '未识别'
}

export function permissionHttpError(status) {
  return status === 404 ? '当前 Host 尚不支持权限说明，或命令已移除；请更新 Host 并刷新目录。'
    : status === 409 ? '运行代已变化，请刷新命令目录并重新检查。'
      : status === 401 || status === 403 ? '需要当前 Host 有效的 full scope Token，不能使用演示权限。'
        : status === 400 ? '假设身份或会话格式不完整，请检查填写内容。' : '权限说明读取失败，请检查 Host 后重试。'
}
