import { translate } from '../i18n/locale.mjs'
import { targetDraftIssue } from '../components/PluginConfigForm/conversation-scope-model.mjs'

const outcomes = new Set(['match', 'mismatch', 'unknown', 'not_evaluated'])
/** `PermitKind` of `@zhin.js/permission` (ADR 0056 §5), plus `unknown` for a rule the Host cannot parse. */
const kinds = new Set(['adapter', 'group', 'private', 'channel', 'user', 'role',
  'platform', 'platform-role', 'platform-permission', 'bot', 'bot-role', 'bot-permission', 'unknown'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string'
const strings = value => Array.isArray(value) && value.every(text)
const integer = value => Number.isSafeInteger(value) && value >= 0
const invalid = (locale = 'zh-CN') => { throw new Error(translate(locale, "权限说明响应无效，请刷新目录或更新 Host。")) }
const validTarget = value => targetDraftIssue(value) === null && value.endpoint.id.length <= 8192
  && [value.endpoint.adapter, value.id, value.parent?.id, value.threadId].every(item => item === undefined || item.length <= 2048)
const targetKey = value => JSON.stringify([value.endpoint.id, value.endpoint.adapter, value.kind, value.id,
  value.parent?.kind ?? null, value.parent?.id ?? null, value.threadId ?? null])

function command(value, locale = 'zh-CN') {
  if (!object(value) || !text(value.id) || !value.id || !text(value.owner) || !value.owner || !text(value.name)
    || value.description !== undefined && !text(value.description) || !strings(value.permits) || value.adapter !== undefined && !text(value.adapter)) invalid(locale)
  return { id: value.id, owner: value.owner, name: value.name, description: value.description ?? '',
    permits: [...value.permits], ...(value.adapter === undefined ? {} : { adapter: value.adapter }) }
}
function result(value, locale = 'zh-CN') {
  if (!object(value) || !outcomes.has(value.outcome) || !text(value.reason)) invalid(locale)
  return { outcome: value.outcome, reason: value.reason }
}

export function readPermissionCatalog(body, locale = 'zh-CN') {
  const data = body?.data
  if (body?.success !== true || !object(data) || !integer(data.generation) || !integer(data.total)
    || !integer(data.page) || data.page < 1 || !integer(data.pageSize) || data.pageSize < 1 || data.pageSize > 100
    || !Array.isArray(data.commands) || data.commands.length > data.pageSize) invalid(locale)
  const commands = data.commands.map(item => command(item, locale))
  if (new Set(commands.map(item => item.id)).size !== commands.length) invalid(locale)
  return { generation: data.generation, page: data.page, pageSize: data.pageSize, total: data.total, commands }
}

/** Hypothetical zhin chat role: '' = unknown (omitted), 'none' = an ordinary user (null). */
export const HYPOTHETICAL_CHAT_ROLES = Object.freeze(['', 'none', 'owner', 'admin', 'trusted'])
/** Hypothetical platform standing (群主 / 管理员 …), a platform identity separate from zhin roles. */
export const HYPOTHETICAL_STANDINGS = Object.freeze(['', 'owner', 'admin', 'member', 'guest'])

/**
 * `POST /api/commands/permissions/explain` body (ADR 0056): the sender is `{ id, chatRole?, platform? }`;
 * `chatRole` is the zhin role (null = ordinary user), `platform` the platform standing with optional
 * platform role ids. Nothing is filled in that the user did not state.
 */
export function permissionRequest(generation, selected, { target, requireTarget = false, senderId = '', chatRole = '', standing = '', platformRoles = '' } = {}, locale = 'zh-CN') {
  if (!integer(generation) || !selected?.id) throw new Error(translate(locale, "请先从当前运行代目录选择命令。"))
  if ((target !== undefined || requireTarget) && !validTarget(target)) throw new Error(translate(locale, "请填写完整的假设账号与会话身份。"))
  if (senderId.length > 200 || platformRoles.length > 2000) throw new Error(translate(locale, "假设身份过长，请精简后重试。"))
  if (!HYPOTHETICAL_CHAT_ROLES.includes(chatRole) || !HYPOTHETICAL_STANDINGS.includes(standing)) throw new Error(translate(locale, "假设身份或会话格式不完整，请检查填写内容。"))
  const roles = platformRoles.split(/[,，]/u).map(value => value.trim()).filter(Boolean)
  if (roles.length && !standing) throw new Error(translate(locale, "填写平台角色时，请同时选择平台身份。"))
  if ((chatRole || standing) && !senderId) throw new Error(translate(locale, "假设角色或平台身份时，请同时提供发送者 ID。"))
  const sender = senderId ? {
    id: senderId,
    ...(chatRole ? { chatRole: chatRole === 'none' ? null : chatRole } : {}),
    ...(standing ? { platform: { standing, ...(roles.length ? { roles: [...new Set(roles)] } : {}) } } : {}),
  } : undefined
  return { generation, commandId: selected.id, ...(target === undefined ? {} : { target }), ...(sender ? { sender } : {}) }
}

export function readPermissionExplanation(body, requested, locale = 'zh-CN') {
  const data = body?.data
  if (body?.success !== true || !object(data) || data.simulation !== true || data.generation !== requested.generation
    || !['present', 'missing', 'unverified'].includes(data.permissionHost) || !Array.isArray(data.rules)
    || !strings(data.unconstrained) || !strings(data.assumptions)) invalid(locale)
  const selected = command(data.command, locale)
  if (selected.id !== requested.commandId || data.rules.length !== selected.permits.length) invalid(locale)
  if (requested.target === undefined ? data.target !== undefined
    : !validTarget(data.target) || targetKey(data.target) !== targetKey(requested.target)) invalid(locale)
  if (requested.sender === undefined ? data.sender !== undefined
    : !object(data.sender) || data.sender.id !== requested.sender.id
      || JSON.stringify(data.sender.chatRole) !== JSON.stringify(requested.sender.chatRole)
      || data.sender.platform?.standing !== requested.sender.platform?.standing) invalid(locale)
  const rules = data.rules.map((item, index) => {
    if (!object(item) || item.index !== index || item.rule !== selected.permits[index] || !kinds.has(item.kind)
      || item.values !== undefined && !strings(item.values)) invalid(locale)
    return { index, rule: item.rule, kind: item.kind, ...result(item, locale), ...(item.values === undefined ? {} : { values: [...item.values] }) }
  })
  return { generation: data.generation, simulation: true, command: selected, target: data.target, sender: data.sender,
    permissionHost: data.permissionHost, adapter: result(data.adapter, locale), rules, summary: result(data.summary, locale),
    unconstrained: [...data.unconstrained], assumptions: [...data.assumptions] }
}

const ROLE_LABELS = Object.freeze({ owner: '所有者', admin: '管理员', trusted: '受信任' })
const STANDING_LABELS = Object.freeze({ owner: '群主', admin: '管理员' })
const LEVEL_NOTES = Object.freeze({ global: '须在全局授予', adapter: '须在适配器层或更高层授予', endpoint: '须在账号层或更高层授予', conversation: '在当前会话链上任一层授予' })

/** `owner` / `owner@global` → 「所有者（须在全局授予）」; the bare role keeps no level note. */
function roleRequirementLabel(value, locale) {
  const at = value.indexOf('@')
  const role = at < 0 ? value : value.slice(0, at)
  const level = at < 0 ? null : value.slice(at + 1)
  if (!Object.hasOwn(ROLE_LABELS, role) || (level !== null && !Object.hasOwn(LEVEL_NOTES, level))) return value
  const name = translate(locale, ROLE_LABELS[role])
  return level === null ? name : translate(locale, '{0}（{1}）', [name, translate(locale, LEVEL_NOTES[level])])
}

/**
 * What a permit rule asks for, in words, for the dimensions that are easy to misread: zhin chat
 * roles (with the `<角色>@<层级>` form), the sender's platform standing and the bot account's own
 * standing (`bot:*`). Null for session conditions (`group()` …), whose code reads plainly.
 */
export function permitRuleMeaning(rule, locale = 'zh-CN') {
  const values = Array.isArray(rule?.values) ? rule.values.filter(text) : []
  const list = values.join(translate(locale, '、'))
  switch (rule?.kind) {
    case 'role': return values.length ? translate(locale, 'zhin 聊天角色：{0}', [values.map(value => roleRequirementLabel(value, locale)).join(translate(locale, ' 或 '))]) : null
    case 'platform': return translate(locale, '发送者的平台身份：{0}', [Object.hasOwn(STANDING_LABELS, values[0]) ? translate(locale, STANDING_LABELS[values[0]]) : list])
    case 'platform-role': return translate(locale, '发送者的平台角色：{0}', [list])
    case 'platform-permission': return translate(locale, '发送者的平台权限：{0}', [list])
    case 'bot': return translate(locale, '机器人账号在本会话的平台身份：{0}', [Object.hasOwn(STANDING_LABELS, values[0]) ? translate(locale, STANDING_LABELS[values[0]]) : list])
    case 'bot-role': return translate(locale, '机器人账号在本会话的平台角色：{0}', [list])
    case 'bot-permission': return translate(locale, '机器人账号在本会话的平台权限：{0}', [list])
    default: return null
  }
}

export function permissionOutcomeLabel(outcome, locale = 'zh-CN') {
  return ({ match: translate(locale, "条件符合"), mismatch: translate(locale, "条件不符"), unknown: translate(locale, "缺少依据"), not_evaluated: translate(locale, "未评估") })[outcome] ?? translate(locale, "未识别")
}

export function permissionHttpError(status, locale = 'zh-CN') {
  return status === 404 ? translate(locale, "当前 Host 尚不支持权限说明，或命令已移除；请更新 Host 并刷新目录。")
    : status === 409 ? translate(locale, "运行代已变化，请刷新命令目录并重新检查。")
      : status === 401 || status === 403 ? translate(locale, "需要当前 Host 有效的 full scope Token，不能使用演示权限。")
        : status === 400 ? translate(locale, "假设身份或会话格式不完整，请检查填写内容。") : translate(locale, "权限说明读取失败，请检查 Host 后重试。")
}
