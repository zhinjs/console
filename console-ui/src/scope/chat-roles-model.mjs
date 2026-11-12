/**
 * Chat roles (ADR 0056): `owner` ⊃ `admin` ⊃ `trusted`, held by a platform identity
 * `(adapter alias, userId)` at one scope of the four-level chain. RPC names and roles come from
 * the protocol mirror (`contracts/console-protocol-mirror.mjs`).
 */
import { SCOPE_LEVELS, parseScopeKey, scopeChain, scopeKey } from './scope-tree.mjs'
import { CHAT_ROLES_RPC, CHAT_ROLES_RPC_PERMISSIONS, CONSOLE_CHAT_ROLES } from '../contracts/console-protocol-mirror.mjs'

export { CHAT_ROLES_RPC }

/** Every `chat-roles.*` RPC needs `iam.manage` (scoped bindings count for scopes under them). */
export const CHAT_ROLES_PERMISSION = CHAT_ROLES_RPC_PERMISSIONS[CHAT_ROLES_RPC.LIST]

export const CHAT_ROLES = CONSOLE_CHAT_ROLES
export const CHAT_ROLE_SOURCES = Object.freeze(['grant', 'config', 'mapping'])

/** Authored labels (displayed through i18n). */
export const CHAT_ROLE_LABELS = Object.freeze({ owner: '所有者', admin: '管理员', trusted: '受信任' })
export const CHAT_ROLE_SOURCE_LABELS = Object.freeze({ grant: '直接授予', config: '配置文件', mapping: '平台映射' })

const ALIAS = /^[a-z0-9][a-z0-9-]*$/u
const rank = role => CHAT_ROLES.indexOf(role)

/** `chat-roles.list` body: entries effective at the scope (its own and inherited from above). */
export function chatRolesListRequest(scope, { descendants = false } = {}) {
  const key = scopeKey(scope)
  if (key === null) throw new Error('This scope cannot hold chat roles')
  const level = parseScopeKey(key).level
  return { type: CHAT_ROLES_RPC.LIST, level, ...(level === 'global' ? {} : { key }), ...(descendants ? { descendants: true } : {}) }
}

function readEntry(item) {
  if (!item || typeof item !== 'object') return null
  const { level, key, adapter, userId, role, source } = item
  if (!SCOPE_LEVELS.includes(level) || typeof key !== 'string' || typeof adapter !== 'string' || !adapter || typeof userId !== 'string' || !userId) return null
  if (!CHAT_ROLES.includes(role) || !CHAT_ROLE_SOURCES.includes(source)) return null
  if (level === 'global' ? key !== '' : parseScopeKey(key)?.level !== level) return null
  return Object.freeze({
    level, key, adapter, userId, role, source,
    ...(typeof item.grantedBy === 'string' && item.grantedBy ? { grantedBy: item.grantedBy } : {}),
    ...(Number.isFinite(item.grantedAt) ? { grantedAt: item.grantedAt } : {}),
    ...(typeof item.detail === 'string' && item.detail ? { detail: item.detail } : {}),
  })
}

/** `chat-roles.list` reply -> entries; malformed rows are dropped. */
export function readChatRoles(payload) {
  const roles = payload && typeof payload === 'object' && Array.isArray(payload.roles) ? payload.roles : []
  return roles.map(readEntry).filter(Boolean)
}

/**
 * Rows for one scope's 角色 tab: `relation` is `direct` (held at this scope), `inherited` (held
 * above, effective here) or `below` (held under this scope; only with `descendants`). Sorted by
 * relation, then role (owner first), then identity. `revocable`: only a stored grant at this scope.
 */
export function chatRoleRows(entries, scope) {
  const key = scopeKey(scope)
  const chain = new Set(scopeChain(scope).map(item => scopeKey(item)))
  const order = { direct: 0, inherited: 1, below: 2 }
  return entries.map(entry => {
    const relation = entry.key === key ? 'direct' : chain.has(entry.key) ? 'inherited' : 'below'
    return { ...entry, relation, revocable: relation === 'direct' && entry.source === 'grant', id: `${entry.level}\u0000${entry.key}\u0000${entry.adapter}\u0000${entry.userId}\u0000${entry.source}` }
  }).sort((a, b) => order[a.relation] - order[b.relation] || rank(a.role) - rank(b.role)
    || a.adapter.localeCompare(b.adapter) || a.userId.localeCompare(b.userId))
}

/** The highest role an identity holds at the scope (its own and inherited entries), or null. */
export function effectiveChatRole(entries, scope, adapter, userId) {
  const chain = new Set(scopeChain(scope).map(item => scopeKey(item)))
  let best = null
  for (const entry of entries) {
    if (!chain.has(entry.key) || entry.adapter !== adapter || entry.userId !== userId) continue
    if (best === null || rank(entry.role) < rank(best)) best = entry.role
  }
  return best
}

function scopeTarget(scope) {
  const key = scopeKey(scope)
  if (key === null) throw new Error('This scope cannot hold chat roles')
  const level = parseScopeKey(key).level
  return { level, key, alias: level === 'global' ? null : parseScopeKey(key).adapter }
}

/**
 * `chat-roles.grant` body. Below 全局 the identity's adapter must be the scope's own alias; at 全局
 * any alias may be given (one identity per platform).
 */
export function chatRoleGrantRequest(scope, { adapter, userId, role }) {
  const target = scopeTarget(scope)
  const platform = target.alias ?? (typeof adapter === 'string' ? adapter.trim() : '')
  const user = typeof userId === 'string' ? userId.trim() : ''
  if (!ALIAS.test(platform)) throw new Error('Adapter must be an instance alias')
  if (target.alias && adapter !== undefined && adapter !== target.alias) throw new Error('Below global the identity belongs to the scope adapter')
  if (!user || user.length > 128) throw new Error('User id is required')
  if (!CHAT_ROLES.includes(role)) throw new Error('Role must be owner, admin or trusted')
  return { type: CHAT_ROLES_RPC.GRANT, level: target.level, ...(target.level === 'global' ? {} : { key: target.key }), adapter: platform, userId: user, role }
}

/** `chat-roles.revoke` body for a stored grant at the scope. */
export function chatRoleRevokeRequest(scope, { adapter, userId }) {
  const target = scopeTarget(scope)
  if (!ALIAS.test(adapter ?? '') || (target.alias && adapter !== target.alias)) throw new Error('Adapter must be the scope adapter')
  if (typeof userId !== 'string' || !userId) throw new Error('User id is required')
  return { type: CHAT_ROLES_RPC.REVOKE, level: target.level, ...(target.level === 'global' ? {} : { key: target.key }), adapter, userId }
}

/** `{ status: 'saved' | 'unchanged', entry? }` -> receipt result. */
export function readChatRoleChange(payload) {
  const status = payload && typeof payload === 'object' && (payload.status === 'saved' || payload.status === 'unchanged') ? payload.status : 'saved'
  return { status }
}

/** Read-only check after an unknown outcome: whether the grant is (or is no longer) stored here. */
export function chatRoleApplied(entries, scope, { adapter, userId, role }, action) {
  const key = scopeKey(scope)
  const stored = entries.find(entry => entry.key === key && entry.source === 'grant' && entry.adapter === adapter && entry.userId === userId)
  return action === 'revoke' ? !stored : stored?.role === role
}

/**
 * Mapping rules (ADR 0056 §4): platform standing → chat role, declared per level. The protocol is
 * still being settled (draft `chat-roles.mappings` in zhinjs/zhin); a Host without it answers
 * "Unknown RPC type" and the section says a newer Host is needed. Read-only here: conversation
 * rules are edited once `chat-roles.set-mappings` is final.
 */
export const CHAT_ROLE_MAPPINGS_RPC = Object.freeze({ LIST: 'chat-roles.mappings' })

export const CHAT_ROLE_MAPPING_LEVELS = Object.freeze(['default', 'adapter', 'endpoint', 'conversation'])
export const CHAT_ROLE_MAPPING_LEVEL_LABELS = Object.freeze({ default: '内置默认', adapter: '适配器', endpoint: '账号', conversation: '会话' })
export const PLATFORM_STANDING_LABELS = Object.freeze({ owner: '群主', admin: '管理员', member: '成员', guest: '访客' })

/** `chat-roles.mappings` body; null for 全局 (rules start at the adapter level). */
export function chatRoleMappingsRequest(scope) {
  const key = scopeKey(scope)
  if (key === null || key === '') return null
  return { type: CHAT_ROLE_MAPPINGS_RPC.LIST, level: parseScopeKey(key).level, key }
}

const strings = value => Array.isArray(value) ? value.filter(item => typeof item === 'string' && item) : []

function readRule(item) {
  if (!item || typeof item !== 'object') return null
  const match = item.match && typeof item.match === 'object' ? item.match : {}
  const grant = item.grant === 'none' || CHAT_ROLES.includes(item.grant) ? item.grant : null
  if (!grant) return null
  const rule = { match: { standing: strings(match.standing), role: strings(match.role), permission: strings(match.permission) }, grant }
  return CHAT_ROLE_MAPPING_LEVELS.includes(item.level) ? { ...rule, level: item.level } : rule
}

/**
 * `chat-roles.mappings` reply -> `{ layers: [{ level, rules, inherit, revision?, updatedAt?, updatedBy? }], effective: [{ match, grant, level }] }`.
 * Malformed layers and rules are dropped.
 */
export function readChatRoleMappings(payload) {
  const record = payload && typeof payload === 'object' ? payload : {}
  const layers = (Array.isArray(record.layers) ? record.layers : []).filter(layer => layer && CHAT_ROLE_MAPPING_LEVELS.includes(layer.level)).map(layer => ({
    level: layer.level,
    rules: (Array.isArray(layer.rules) ? layer.rules : []).map(readRule).filter(Boolean),
    inherit: layer.inherit !== false,
    ...(Number.isInteger(layer.revision) ? { revision: layer.revision } : {}),
    ...(Number.isFinite(layer.updatedAt) ? { updatedAt: layer.updatedAt } : {}),
    ...(typeof layer.updatedBy === 'string' && layer.updatedBy ? { updatedBy: layer.updatedBy } : {}),
  }))
  const effective = (Array.isArray(record.effective) ? record.effective : []).map(readRule).filter(rule => rule && rule.level && rule.grant !== 'none')
  return { layers, effective }
}

/** One-line description parts of a rule's match: standings, platform roles, permissions. */
export function mappingMatchParts(match) {
  return {
    standing: strings(match?.standing),
    role: strings(match?.role),
    permission: strings(match?.permission),
  }
}

/** Remembered (per browser) whether the mapping section is collapsed. */
export const CHAT_ROLE_MAPPINGS_HIDDEN_KEY = 'zhin-console.chat-role-mappings.hidden'
