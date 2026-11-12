/**
 * 访问控制区（ADR 0049）的纯数据与校验。
 *
 * Protocol constants (`IAM_RPC`, the permission catalog, scoped permissions) come from
 * `contracts/console-protocol-mirror.mjs`; reply readers follow the Host's `iam.*` shapes
 * (`packages/host/gateway/src/iam/{rpc,service}.ts` in zhinjs/zhin). Readers tolerate missing
 * fields and never invent data.
 */

import {
  CONSOLE_BUILTIN_ROLE_NAMES, CONSOLE_PERMISSION_LIST as PROTOCOL_PERMISSION_LIST, CONSOLE_SCOPED_PERMISSIONS, IAM_RPC,
} from '../../contracts/console-protocol-mirror.mjs'

export { IAM_RPC }

export const IAM_VIEW = 'iam.view'
export const IAM_MANAGE = 'iam.manage'

/** ADR 0049 §3 catalog, grouped by the area the checklist shows. Order is display order. */
export const PERMISSION_AREAS = Object.freeze([
  Object.freeze({ id: 'status', permissions: Object.freeze(['status.view']) }),
  Object.freeze({ id: 'endpoint', permissions: Object.freeze(['endpoint.view', 'endpoint.operate', 'endpoint.manage']) }),
  Object.freeze({ id: 'feature', permissions: Object.freeze(['feature.view', 'feature.configure', 'feature.toggle']) }),
  Object.freeze({ id: 'plugin', permissions: Object.freeze(['plugin.manage', 'plugin.perms.read', 'plugin.perms.operate', 'plugin.perms.manage']) }),
  Object.freeze({ id: 'agent', permissions: Object.freeze(['agent.view', 'agent.configure']) }),
  Object.freeze({ id: 'ops', permissions: Object.freeze([
    'ops.config.read', 'ops.config.write', 'ops.env.read', 'ops.env.write', 'ops.database.read', 'ops.database.write',
    'ops.schedule.read', 'ops.schedule.write', 'ops.files.read', 'ops.files.write', 'ops.restart', 'ops.terminal',
  ]) }),
  Object.freeze({ id: 'iam', permissions: Object.freeze(['iam.view', 'iam.manage']) }),
  Object.freeze({ id: 'external', permissions: Object.freeze(['mcp.access', 'a2a.access']) }),
])

/** Every catalog permission, in checklist order (the areas cover the protocol catalog exactly; tested). */
export const CONSOLE_PERMISSION_LIST = Object.freeze(PERMISSION_AREAS.flatMap(area => area.permissions))
const knownPermissions = new Set(PROTOCOL_PERMISSION_LIST)

export function isConsolePermission(value) {
  return typeof value === 'string' && knownPermissions.has(value)
}

/**
 * Permissions an adapter / endpoint binding can narrow; the rest only count at global scope.
 * `iam.manage` narrows to `chat-roles.*` of scopes under the binding (ADR 0056 §3).
 */
export const SCOPED_PERMISSIONS = CONSOLE_SCOPED_PERMISSIONS

export const BUILTIN_ROLE_NAMES = CONSOLE_BUILTIN_ROLE_NAMES
export const OWNER_ROLE = 'owner'

export function areaLabel(id, t) {
  const labels = {
    status: t('概览'),
    endpoint: t('聊天账号'),
    feature: t('功能'),
    plugin: t('插件'),
    agent: t('AI 与 Agent'),
    ops: t('运维'),
    iam: t('访问控制'),
    external: t('外部接口'),
  }
  return labels[id] ?? id
}

export function permissionLabel(permission, t) {
  const labels = {
    'status.view': t('查看状态、日志与观测'),
    'endpoint.view': t('查看账号与会话'),
    'endpoint.operate': t('发消息、处理请求与群管理'),
    'endpoint.manage': t('新增、修改、删除、启停账号'),
    'feature.view': t('查看功能配置'),
    'feature.configure': t('修改功能配置'),
    'feature.toggle': t('启用或禁用功能'),
    'plugin.manage': t('安装、更新、卸载插件'),
    'plugin.perms.read': t('插件权限：读取级'),
    'plugin.perms.operate': t('插件权限：操作级'),
    'plugin.perms.manage': t('插件权限：管理级'),
    'agent.view': t('查看 AI 与 Agent 设置'),
    'agent.configure': t('修改 AI 与 Agent 设置'),
    'ops.config.read': t('读取配置文件'),
    'ops.config.write': t('写入配置文件'),
    'ops.env.read': t('读取环境变量'),
    'ops.env.write': t('写入环境变量'),
    'ops.database.read': t('浏览数据库'),
    'ops.database.write': t('修改数据库'),
    'ops.schedule.read': t('查看定时任务'),
    'ops.schedule.write': t('管理定时任务'),
    'ops.files.read': t('读取项目文件'),
    'ops.files.write': t('写入项目文件'),
    'ops.restart': t('重启进程'),
    'ops.terminal': t('使用终端'),
    'iam.view': t('查看用户、角色、令牌与审计'),
    'iam.manage': t('管理用户、角色与令牌'),
    'mcp.access': t('访问 MCP Server'),
    'a2a.access': t('访问 A2A Server'),
  }
  return labels[permission] ?? permission
}

export function levelLabel(level, t) {
  const labels = { read: t('读取'), operate: t('操作'), manage: t('管理') }
  return labels[level] ?? level
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => (typeof value === 'string' ? value : '')
const optionalNumber = value => (typeof value === 'number' && Number.isFinite(value) ? value : null)
const stringList = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string' && item.trim()).map(item => item.trim()) : [])

/** Plugin that contributed a permission string not in the core catalog. */
export function permissionPlugin(permission) {
  const value = String(permission)
  const prefixed = /^plugin[.:]([^.:]+)[.:]/u.exec(value)
  if (prefixed) return prefixed[1]
  const cut = Math.max(value.lastIndexOf('.'), value.lastIndexOf(':'))
  return cut > 0 ? value.slice(0, cut) : value
}

/**
 * Plugin-declared permissions, when the Host reports them next to the roles
 * (`pluginPermissions` or `permissions` in the `iam.roles.list` reply). Absent: empty.
 */
export function readPluginPermissionCatalog(payload) {
  if (!isRecord(payload)) return []
  const source = Array.isArray(payload.pluginPermissions) ? payload.pluginPermissions
    : Array.isArray(payload.permissions) ? payload.permissions : []
  const seen = new Set()
  const result = []
  for (const item of source) {
    const entry = typeof item === 'string' ? { permission: item } : isRecord(item) ? item : null
    if (!entry) continue
    const permission = text(entry.permission) || text(entry.name) || text(entry.id)
    if (!permission || isConsolePermission(permission) || seen.has(permission)) continue
    seen.add(permission)
    const level = text(entry.level)
    result.push(Object.freeze({
      permission,
      plugin: text(entry.plugin) || text(entry.owner) || permissionPlugin(permission),
      ...(level ? { level } : {}),
      description: text(entry.description) || text(entry.label) || text(entry.title),
    }))
  }
  return result
}

/**
 * Checklist groups: the core areas, then one group per plugin for every plugin permission the
 * Host declared or that a role already holds. `extra` are permissions held by the roles shown.
 */
export function permissionGroups(pluginCatalog = [], extra = []) {
  const core = PERMISSION_AREAS.map(area => ({ kind: 'area', id: area.id, permissions: area.permissions.map(permission => ({ permission })) }))
  const byPlugin = new Map()
  const add = entry => {
    const list = byPlugin.get(entry.plugin) ?? []
    if (!list.some(item => item.permission === entry.permission)) list.push(entry)
    byPlugin.set(entry.plugin, list)
  }
  for (const entry of pluginCatalog) add(entry)
  for (const permission of extra) {
    if (typeof permission === 'string' && permission && !isConsolePermission(permission)) add({ permission, plugin: permissionPlugin(permission), description: '' })
  }
  const plugins = [...byPlugin.entries()].sort(([a], [b]) => a.localeCompare(b))
    .map(([plugin, permissions]) => ({ kind: 'plugin', id: plugin, permissions: [...permissions].sort((a, b) => a.permission.localeCompare(b.permission)) }))
  return [...core, ...plugins]
}

/** Toggles one permission or a whole group; the result is sorted and deduplicated. */
export function togglePermissions(selected, permissions, checked) {
  const next = new Set(selected)
  for (const permission of permissions) {
    if (checked) next.add(permission)
    else next.delete(permission)
  }
  return [...next].sort()
}

/** `true` / `false` / `'indeterminate'` for a group checkbox. */
export function groupCheckState(selected, permissions) {
  const held = permissions.filter(permission => selected.includes(permission)).length
  if (held === 0) return false
  return held === permissions.length ? true : 'indeterminate'
}

// ------------------------------------------------------------------ scopes & bindings

export function readScope(value) {
  if (!isRecord(value)) return null
  if (value.kind === 'global') return Object.freeze({ kind: 'global' })
  if ((value.kind === 'adapter' || value.kind === 'endpoint') && text(value.key)) return Object.freeze({ kind: value.kind, key: value.key })
  return null
}

export function scopeLabel(scope, t) {
  if (!scope || scope.kind === 'global') return t('全局')
  if (scope.kind === 'adapter') return t('适配器 {0}', [scope.key])
  return t('账号 {0}', [scope.key])
}

/** Same rules as the protocol's `parseConsoleBindingScope`; `null` = valid. */
export function scopeProblem(kind, key, t) {
  if (kind === 'global') return null
  const value = typeof key === 'string' ? key : ''
  if (!value.trim()) return kind === 'adapter' ? t('请填写适配器别名') : t('请填写账号（别名/账号 ID）')
  if (value.trim() !== value || value.length > 256) return t('作用域不能有首尾空格，且不超过 256 个字符')
  if (kind === 'adapter') return value.includes('/') ? t('适配器别名不能包含 /') : null
  if (kind === 'endpoint') {
    const slash = value.indexOf('/')
    return slash > 0 && slash < value.length - 1 ? null : t('账号作用域格式为 别名/账号 ID')
  }
  return t('未知的作用域类型')
}

/** Binding views → the `bindings` input of `iam.users.create` / `iam.bindings.set`. */
export function bindingInputs(bindings) {
  return bindings.map(binding => {
    const scope = binding.scope ?? { kind: 'global' }
    return scope.kind === 'global'
      ? { role: binding.role, scopeKind: 'global' }
      : { role: binding.role, scopeKind: scope.kind, scopeKey: scope.key }
  })
}

const bindingKey = binding => `${binding.role}|${binding.scope?.kind ?? 'global'}|${binding.scope?.key ?? ''}`

export function addBinding(bindings, binding) {
  return bindings.some(item => bindingKey(item) === bindingKey(binding)) ? bindings : [...bindings, binding]
}

export function removeBinding(bindings, index) {
  return bindings.filter((_, position) => position !== index)
}

export function isGlobalOwner(user) {
  return Boolean(user && !user.disabled && user.bindings.some(binding => binding.role === OWNER_ROLE && binding.scope?.kind === 'global'))
}

/**
 * Whether a change would leave no enabled global owner (ADR 0049 §5 invariant). The Host
 * enforces it; the Console only warns before sending. `change`: `{ disable }`, `{ remove }`
 * or `{ bindings }` for one user.
 */
export function breaksLastOwner(users, userId, change) {
  const owners = users.filter(isGlobalOwner)
  if (!owners.some(user => user.id === userId)) return false
  if (owners.length > 1) return false
  if (change.disable || change.remove) return true
  if (change.bindings) return !change.bindings.some(binding => binding.role === OWNER_ROLE && (binding.scope?.kind ?? 'global') === 'global')
  return false
}

// ------------------------------------------------------------------ replies

function readBinding(value) {
  if (!isRecord(value)) return null
  const role = text(value.role)
  const scope = readScope(value.scope) ?? (value.scopeKind ? readScope({ kind: value.scopeKind, key: value.scopeKey }) : null)
  if (!role || !scope) return null
  return Object.freeze({ id: text(value.id), roleId: text(value.roleId), role, scope })
}

export function readUser(value) {
  if (!isRecord(value) || !text(value.id) || !text(value.username)) return null
  return Object.freeze({
    id: value.id,
    username: value.username,
    displayName: text(value.displayName) || value.username,
    disabled: value.disabled === true,
    createdAt: optionalNumber(value.createdAt),
    updatedAt: optionalNumber(value.updatedAt),
    passwordChangedAt: optionalNumber(value.passwordChangedAt),
    bindings: Object.freeze((Array.isArray(value.bindings) ? value.bindings : []).map(readBinding).filter(Boolean)),
  })
}

export function readUsers(payload) {
  const list = isRecord(payload) && Array.isArray(payload.users) ? payload.users : []
  return list.map(readUser).filter(Boolean)
}

export function readRole(value) {
  if (!isRecord(value) || !text(value.id) || !text(value.name)) return null
  return Object.freeze({
    id: value.id,
    name: value.name,
    description: text(value.description),
    builtin: value.builtin === true,
    permissions: Object.freeze(stringList(value.permissions)),
  })
}

/** Built-ins first in ADR order, then custom roles by name. */
export function readRoles(payload) {
  const list = isRecord(payload) && Array.isArray(payload.roles) ? payload.roles : []
  const rank = role => {
    const index = BUILTIN_ROLE_NAMES.indexOf(role.name)
    return role.builtin ? (index >= 0 ? index : BUILTIN_ROLE_NAMES.length) : BUILTIN_ROLE_NAMES.length + 1
  }
  return list.map(readRole).filter(Boolean).sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
}

export function builtinRoleLabel(name, t) {
  const labels = { owner: t('所有者'), admin: t('管理员'), operator: t('运营'), viewer: t('只读') }
  return labels[name] ?? null
}

export function readTokens(payload) {
  const list = isRecord(payload) && Array.isArray(payload.tokens) ? payload.tokens : []
  return list.flatMap(value => {
    if (!isRecord(value) || !text(value.id)) return []
    return [Object.freeze({
      id: value.id,
      userId: text(value.userId),
      name: text(value.name) || value.id,
      permissions: Array.isArray(value.permissions) ? Object.freeze(stringList(value.permissions)) : null,
      expiresAt: optionalNumber(value.expiresAt),
      lastUsedAt: optionalNumber(value.lastUsedAt),
      createdAt: optionalNumber(value.createdAt),
    })]
  })
}

export function tokenExpired(token, now = Date.now()) {
  return token.expiresAt !== null && token.expiresAt <= now
}

export function readAuditPage(payload) {
  const list = isRecord(payload) && Array.isArray(payload.entries) ? payload.entries : []
  const entries = list.flatMap(value => {
    if (!isRecord(value) || !text(value.id) || optionalNumber(value.at) === null) return []
    return [Object.freeze({
      id: value.id,
      at: value.at,
      actor: text(value.actor),
      action: text(value.action),
      target: text(value.target) || null,
      outcome: text(value.outcome),
      detail: value.detail ?? null,
      ip: text(value.ip) || null,
    })]
  })
  const next = isRecord(payload) ? optionalNumber(payload.next) : null
  return { entries, next }
}

/** `user:<id>` → the username when known; other actors stay as recorded. */
export function actorLabel(actor, usersById, t) {
  if (actor === 'bootstrap') return t('初始化令牌')
  const user = /^user:(.+)$/u.exec(actor)
  if (user) {
    const found = usersById.get(user[1])
    return found ? found.username : actor
  }
  const token = /^api-token:(.+)$/u.exec(actor)
  if (token) return t('API 令牌 {0}', [token[1]])
  return actor
}

export function outcomeVariant(outcome) {
  if (outcome === 'ok') return 'success'
  if (outcome === 'denied') return 'warning'
  if (outcome === 'error') return 'destructive'
  return 'outline'
}

export const AUDIT_PAGE_SIZE = 50

/** `datetime-local` input → epoch ms, or undefined when blank / invalid. */
export function localDateTimeToMs(value) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? ms : undefined
}

/** `iam.audit.list` payload. `actor` / `action` match exactly on the Host. */
export function auditQuery(filter = {}, before) {
  const query = { limit: AUDIT_PAGE_SIZE }
  const actor = text(filter.actor).trim()
  const action = text(filter.action).trim()
  if (actor) query.actor = actor
  if (action) query.action = action
  const since = localDateTimeToMs(filter.since)
  const until = localDateTimeToMs(filter.until)
  if (since !== undefined) query.since = since
  if (until !== undefined) query.until = until
  if (typeof before === 'number') query.before = before
  return query
}

/** Same rules as the Host (`USERNAME`, `ROLE_NAME`, password ≥ 10). `null` = valid. */
export function usernameProblem(value, t) {
  const username = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return /^[a-z0-9][a-z0-9._-]{1,63}$/u.test(username) ? null : t('用户名需为 2-64 位小写字母、数字或 . _ -')
}

/** Same rule as the Host's `updateUser`: required, at most 128 characters; no control characters. */
export const DISPLAY_NAME_MAX_LENGTH = 128
export function displayNameProblem(value, t) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!name) return t('请填写显示名')
  if (name.length > DISPLAY_NAME_MAX_LENGTH) return t('显示名最多 128 个字符')
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f\u007f]/u.test(name)) return t('显示名不能包含控制字符')
  return null
}

export function passwordProblem(value, confirm, t) {
  if (typeof value !== 'string' || value.length < 10) return t('密码至少 10 位')
  if (confirm !== undefined && confirm !== value) return t('两次输入的密码不一致')
  return null
}

export function roleNameProblem(value, roles, t) {
  const name = typeof value === 'string' ? value.trim() : ''
  if (!/^[a-z][a-z0-9_-]{1,63}$/u.test(name)) return t('角色名需为 2-64 位小写字母、数字、_ 或 -，以字母开头')
  if (roles.some(role => role.name === name)) return t('角色名已存在')
  return null
}

/** Name for a copy of a role that does not collide with an existing one. */
export function copyRoleName(name, roles) {
  const base = `${name}-copy`.slice(0, 60)
  if (!roles.some(role => role.name === base)) return base
  for (let index = 2; index < 100; index++) {
    const candidate = `${base}-${index}`
    if (!roles.some(role => role.name === candidate)) return candidate
  }
  return base
}
