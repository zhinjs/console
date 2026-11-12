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
/** zhin chat roles come only from grants (ADR 0056); platform standing (群主 / 管理员) is a separate platform identity. */
export const CHAT_ROLE_SOURCES = Object.freeze(['grant'])

/** Authored labels (displayed through i18n). */
export const CHAT_ROLE_LABELS = Object.freeze({ owner: '所有者', admin: '管理员', trusted: '受信任' })
export const CHAT_ROLE_SOURCE_LABELS = Object.freeze({ grant: '直接授予' })

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
  if (!SCOPE_LEVELS.includes(level) || typeof key !== 'string') return null
  if (!CHAT_ROLES.includes(role) || !CHAT_ROLE_SOURCES.includes(source)) return null
  if (level === 'global' ? key !== '' : parseScopeKey(key)?.level !== level) return null
  // A scope the caller does not manage (inherited from above): role and level only, no identity.
  if (item.redacted === true) return Object.freeze({ level, key, role, source, redacted: true })
  if (typeof adapter !== 'string' || !adapter || typeof userId !== 'string' || !userId) return null
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
 * relation, then role (owner first), then identity (redacted rows last). `revocable`: only a stored
 * grant at this scope whose identity is shown; a `redacted` row (上级授予，身份不显示) never is.
 */
export function chatRoleRows(entries, scope) {
  const key = scopeKey(scope)
  const chain = new Set(scopeChain(scope).map(item => scopeKey(item)))
  const order = { direct: 0, inherited: 1, below: 2 }
  const seen = new Map()
  return entries.map(entry => {
    const relation = entry.key === key ? 'direct' : chain.has(entry.key) ? 'inherited' : 'below'
    const base = entry.redacted ? `${entry.level}\u0000${entry.key}\u0000\u0000${entry.role}` : `${entry.level}\u0000${entry.key}\u0000${entry.adapter}\u0000${entry.userId}`
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    const id = `${base}\u0000${entry.source}${entry.redacted ? `\u0000redacted:${count}` : ''}`
    return { ...entry, relation, revocable: !entry.redacted && relation === 'direct' && entry.source === 'grant', id }
  }).sort((a, b) => order[a.relation] - order[b.relation] || rank(a.role) - rank(b.role)
    || Number(Boolean(a.redacted)) - Number(Boolean(b.redacted))
    || (a.adapter ?? '').localeCompare(b.adapter ?? '') || (a.userId ?? '').localeCompare(b.userId ?? ''))
}

/** The highest role an identity holds at the scope (its own and inherited entries), or null. */
export function effectiveChatRole(entries, scope, adapter, userId) {
  const chain = new Set(scopeChain(scope).map(item => scopeKey(item)))
  let best = null
  for (const entry of entries) {
    if (entry.redacted || !chain.has(entry.key) || entry.adapter !== adapter || entry.userId !== userId) continue
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
  const stored = entries.find(entry => !entry.redacted && entry.key === key && entry.source === 'grant' && entry.adapter === adapter && entry.userId === userId)
  return action === 'revoke' ? !stored : stored?.role === role
}

/**
 * Granting / revoking `owner` — or replacing / removing an existing owner grant — needs a **global**
 * `iam.manage` binding whatever the scope (ADR 0056 §3); `admin` / `trusted` need it at the scope.
 */
export function chatRoleNeedsGlobalManage(role) {
  return role === 'owner'
}

/** Roles the grant form offers: `owner` only with a global `iam.manage`. */
export function grantableChatRoles(globalManage) {
  return CHAT_ROLES.filter(role => globalManage || !chatRoleNeedsGlobalManage(role))
}

/** Authored copy (displayed through i18n). */
export const CHAT_ROLE_COPY = Object.freeze({
  unpersisted: '当前数据库不支持持久化角色，未保存',
  ownerNeedsGlobal: '授予或撤销所有者需要全局 iam.manage 权限',
  redacted: '上级授予（身份不显示）',
})

/**
 * A grant / revoke the Host certainly refused, as the reason the receipt shows; null for anything
 * else (an unknown outcome stays 结果未知 and is only re-read). `classified` is `statusFromError`.
 * - 503 `chat-roles-unpersisted`: the project database cannot store grants, nothing was saved.
 * - 403 / 400 with the Host's own sentence (owner needs global iam.manage, cannot grant above or
 *   equal to your own role, wrong adapter …): that sentence is the answer.
 */
export function chatRoleRefusal(classified) {
  if (!classified || typeof classified !== 'object') return null
  if (classified.serverCode === 'chat-roles-unpersisted') return { code: 'unpersisted' }
  if (classified.serverCode) return null
  if ((classified.kind === 'forbidden' || classified.kind === 'error') && typeof classified.message === 'string' && classified.message.trim()
    && !/^(?:REST request failed|HTTP \d+)$/u.test(classified.message.trim())) {
    return { code: 'refused', message: classified.message.trim() }
  }
  return null
}
