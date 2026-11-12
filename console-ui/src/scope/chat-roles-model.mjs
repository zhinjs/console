/**
 * Chat roles (ADR 0056): `owner` ⊃ `admin` ⊃ `trusted`, held by a platform identity
 * `(adapter alias, userId)` at one scope of the four-level chain. Mirrors
 * `@zhin.js/console-protocol` chat-roles.ts until the package is published.
 */
import { SCOPE_LEVELS, parseScopeKey, scopeChain, scopeKey } from './scope-tree.mjs'

export const CHAT_ROLES_RPC = Object.freeze({
  LIST: 'chat-roles.list',
  GRANT: 'chat-roles.grant',
  REVOKE: 'chat-roles.revoke',
})

/** Every `chat-roles.*` RPC needs `iam.manage` (scoped bindings count for scopes under them). */
export const CHAT_ROLES_PERMISSION = 'iam.manage'

export const CHAT_ROLES = Object.freeze(['owner', 'admin', 'trusted'])
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
