/**
 * Chat members (ADR 0060 §2 / §7): people behind chat identities, their platform identities, roles
 * and the one-to-one link to a Console user. RPC names are spelled out here because the published
 * `@zhin.js/console-protocol` the Console builds against may predate them; a Host without them is
 * detected per call (`isMissingIdentityRpc`) and the entries are hidden.
 */
import { statusFromError } from '../components/status-state-model.mjs'
import { parseScopeKey, scopeKey } from './scope-tree.mjs'
import { CHAT_ROLES_RPC } from './chat-roles-model.mjs'

export const CHAT_IDENTITY_RPC = Object.freeze({
  PRINCIPALS_LIST: 'chat-principals.list',
  MERGE: 'chat-principals.merge',
  SPLIT: 'chat-principals.split',
  RENAME: 'chat-principals.rename',
  RECENT: 'chat-identities.recent',
  BIND_CODE_CREATE: 'chat-identities.bind-code.create',
  ME: 'chat-identities.me',
  SIMULATED_ENSURE: 'chat-identities.simulated.ensure',
})

const ROLES = ['owner', 'admin', 'trusted']
const LEVELS = ['global', 'adapter', 'endpoint', 'conversation']
const LINK_METHODS = ['implicit', 'code', 'manual', 'import', 'console']
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value ? value : undefined
const time = value => Number.isFinite(value) && value > 0 ? value : undefined

/**
 * Whether a Host refused because it does not know the RPC (older Host): not listed in its
 * permission map (`unmapped`), `未知请求`, or an explicit unsupported answer.
 */
export function isMissingIdentityRpc(error) {
  const status = statusFromError(error)
  if (status.kind === 'unsupported') return true
  const message = typeof status.message === 'string' ? status.message : ''
  return status.serverCode === 'unmapped' || status.serverCode === 'unknown_rpc' || /未登记权限|未知请求|not registered with a Console permission/u.test(message)
}

function readIdentity(item) {
  if (!isRecord(item) || !text(item.adapter) || !text(item.userId)) return null
  return Object.freeze({
    adapter: item.adapter, userId: item.userId,
    ...(LINK_METHODS.includes(item.linkMethod) ? { linkMethod: item.linkMethod } : {}),
    ...(time(item.linkedAt) ? { linkedAt: item.linkedAt } : {}),
    ...(time(item.lastSeenAt) ? { lastSeenAt: item.lastSeenAt } : {}),
    ...(text(item.lastDisplayName) ? { lastDisplayName: item.lastDisplayName } : {}),
    ...(text(item.principalId) ? { principalId: item.principalId } : {}),
  })
}

function readRole(item) {
  if (!isRecord(item) || !ROLES.includes(item.role) || !LEVELS.includes(item.level) || typeof item.key !== 'string') return null
  if (item.redacted === true) return Object.freeze({ level: item.level, key: item.key, role: item.role, redacted: true })
  return Object.freeze({ level: item.level, key: item.key, role: item.role,
    ...(text(item.adapter) ? { adapter: item.adapter } : {}), ...(text(item.userId) ? { userId: item.userId } : {}),
    ...(text(item.grantedBy) ? { grantedBy: item.grantedBy } : {}), ...(text(item.grantedByName) ? { grantedByName: item.grantedByName } : {}) })
}

export function readPrincipal(item) {
  if (!isRecord(item) || !text(item.id)) return null
  const identities = Array.isArray(item.identities) ? item.identities.map(readIdentity).filter(Boolean) : []
  const roles = Array.isArray(item.roles) ? item.roles.map(readRole).filter(Boolean) : []
  const link = isRecord(item.consoleLink) && text(item.consoleLink.consoleUserId) ? Object.freeze({
    consoleUserId: item.consoleLink.consoleUserId,
    ...(text(item.consoleLink.consoleDisplayName) ? { consoleDisplayName: item.consoleLink.consoleDisplayName } : {}),
    ...(text(item.consoleLink.linkedVia) ? { linkedVia: item.consoleLink.linkedVia } : {}),
  }) : undefined
  return Object.freeze({
    id: item.id, stored: item.id.startsWith('cp_'),
    ...(text(item.displayName) ? { displayName: item.displayName } : {}),
    identities: Object.freeze(identities), roles: Object.freeze(roles),
    ...(Number.isInteger(item.hiddenIdentities) && item.hiddenIdentities > 0 ? { hiddenIdentities: item.hiddenIdentities } : {}),
    ...(link ? { consoleLink: link } : {}),
    ...(item.unverified === true ? { unverified: true } : {}),
  })
}

/** `chat-principals.list` reply → people (malformed rows dropped), most recently seen first. */
export function readPrincipals(payload) {
  const rows = isRecord(payload) && Array.isArray(payload.principals) ? payload.principals : []
  return rows.map(readPrincipal).filter(Boolean)
    .sort((left, right) => (lastSeen(right) ?? 0) - (lastSeen(left) ?? 0) || principalName(left).localeCompare(principalName(right)))
}

/** `chat-identities.recent` reply → identities. */
export function readRecentIdentities(payload) {
  const rows = isRecord(payload) && Array.isArray(payload.identities) ? payload.identities : []
  return rows.map(readIdentity).filter(Boolean)
}

/** `chat-identities.me` reply. */
export function readIdentityMe(payload) {
  const record = isRecord(payload) ? payload : {}
  const principal = readPrincipal(record.principal)
  return Object.freeze({
    ...(principal ? { principal } : {}),
    ...(isRecord(record.pendingCode) && time(record.pendingCode.expiresAt) ? { pendingCodeExpiresAt: record.pendingCode.expiresAt } : {}),
    suggestGlobalOwner: record.suggestGlobalOwner === true,
  })
}

/** `chat-identities.bind-code.create` reply. */
export function readBindCode(payload) {
  if (!isRecord(payload) || !text(payload.code) || !time(payload.expiresAt)) throw new Error('Malformed bind code reply')
  return Object.freeze({ code: payload.code, expiresAt: payload.expiresAt })
}

/** What to send in a private chat with the bot. */
export function bindInstruction(code, locale = 'zh-CN') {
  return locale === 'en' ? `bind ${code}` : `绑定 ${code}`
}

/** `m:ss` until `expiresAt`; `0:00` when expired. */
export function bindCountdown(expiresAt, now = Date.now()) {
  const seconds = Math.max(0, Math.ceil((expiresAt - now) / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

export function principalName(principal) {
  if (principal.displayName) return principal.displayName
  const named = principal.identities.find(identity => identity.lastDisplayName)
  return named?.lastDisplayName ?? principal.identities[0]?.userId ?? principal.id
}

export function lastSeen(principal) {
  const times = principal.identities.map(identity => identity.lastSeenAt).filter(Boolean)
  return times.length ? Math.max(...times) : undefined
}

/** Whether the person holds a global grant (merging / splitting / renaming it needs global iam.manage). */
export function holdsGlobalRole(principal) {
  return principal.roles.some(role => role.level === 'global')
}

/**
 * Actions the Console offers on a person. The Host checks again; this only hides what would be
 * refused: everything needs `iam.manage`, a person with a global grant a global binding.
 */
export function principalActions(principal, { manage, globalManage }) {
  const allowed = manage && (!holdsGlobalRole(principal) || globalManage) && principal.stored
  return Object.freeze({
    rename: allowed,
    merge: allowed,
    split: allowed && principal.identities.length > 1,
    needsGlobal: holdsGlobalRole(principal) && !globalManage,
  })
}

/** People whose name, id, identity id / display name or Console link match the query (case-insensitive). */
export function filterPrincipals(principals, query) {
  const needle = String(query ?? '').trim().toLowerCase()
  if (!needle) return principals
  return principals.filter(principal => [principal.id, principal.displayName, principal.consoleLink?.consoleDisplayName, principal.consoleLink?.consoleUserId,
    ...principal.identities.flatMap(identity => [identity.userId, identity.lastDisplayName, `${identity.adapter}:${identity.userId}`])]
    .some(value => typeof value === 'string' && value.toLowerCase().includes(needle)))
}

/** `grantedByName` when the grantor is a linked Console user (ADR 0060 Q12), else the raw `grantedBy`. */
export function grantorLabel(entry) {
  return entry?.grantedByName ?? entry?.grantedBy
}

/**
 * Grant picker candidates for a scope: recent speakers first, then known people's identities —
 * only identities on `alias` below 全局 (a grant there only counts on its own adapter). One row
 * per identity; `query` filters by id, display name or person name.
 */
export function grantCandidates({ recent = [], principals = [], alias = null, query = '' }) {
  const rows = new Map()
  const add = (identity, source, person) => {
    if (alias && identity.adapter !== alias) return
    const key = `${identity.adapter}\u0000${identity.userId}`
    if (rows.has(key)) return
    rows.set(key, Object.freeze({ key, adapter: identity.adapter, userId: identity.userId, source,
      label: identity.lastDisplayName ?? (person ? principalName(person) : identity.userId),
      ...(person ? { personName: principalName(person), principalId: person.id } : identity.principalId ? { principalId: identity.principalId } : {}),
      ...(identity.lastSeenAt ? { lastSeenAt: identity.lastSeenAt } : {}) }))
  }
  for (const identity of recent) add(identity, 'recent')
  for (const person of principals) for (const identity of person.identities) add(identity, 'person', person)
  const needle = String(query ?? '').trim().toLowerCase()
  const list = [...rows.values()]
  return needle ? list.filter(row => [row.userId, row.label, row.personName, row.adapter].some(value => typeof value === 'string' && value.toLowerCase().includes(needle))) : list
}

/** `chat-principals.list` / `chat-identities.recent` body for a Console scope (`{}` = global). */
export function principalsListRequest(scope = {}) {
  const key = scopeKey(scope)
  const level = key === null || key === '' ? 'global' : parseScopeKey(key).level
  return { type: CHAT_IDENTITY_RPC.PRINCIPALS_LIST, ...(level === 'global' ? {} : { level, key }) }
}

export function recentIdentitiesRequest(scope = {}, limit = 50) {
  const key = scopeKey(scope)
  const level = key === null || key === '' ? 'global' : parseScopeKey(key).level
  return { type: CHAT_IDENTITY_RPC.RECENT, level, ...(level === 'global' ? {} : { key }), limit }
}

export const mergeRequest = (intoId, fromId) => ({ type: CHAT_IDENTITY_RPC.MERGE, into: { principalId: intoId }, from: { principalId: fromId } })
export const splitRequest = identity => ({ type: CHAT_IDENTITY_RPC.SPLIT, adapter: identity.adapter, userId: identity.userId })
export const renameRequest = (principalId, displayName) => ({ type: CHAT_IDENTITY_RPC.RENAME, principalId, displayName: String(displayName ?? '').trim() })

/**
 * ADR 0060 §3.1 「设为全局 owner」: a global `chat-roles.grant` of `owner` for one identity of the
 * caller's own person (the grant belongs to the person, so it counts for every identity). The
 * Host requires a global iam.manage and audits it as `chat-roles.grant`.
 */
export function promoteGlobalOwnerRequest(principal) {
  const identity = principal?.identities?.[0]
  if (!identity) throw new Error('The person has no identity')
  return { type: CHAT_ROLES_RPC.GRANT, level: 'global', adapter: identity.adapter, userId: identity.userId, role: 'owner' }
}

/** Distinct adapter instance aliases of `endpoint.list` rows (the grant dialog's adapter choices). */
export function adapterAliases(rows) {
  return [...new Set((Array.isArray(rows) ? rows : []).map(row => row?.adapter).filter(value => typeof value === 'string' && /^[a-z0-9][a-z0-9-]*$/u.test(value)))].sort()
}

/** Authored labels (through i18n). */
export const LINK_METHOD_LABELS = Object.freeze({ implicit: '自动', code: '绑定码', manual: '运营者归并', import: '配置导入', console: 'Console 本人' })
