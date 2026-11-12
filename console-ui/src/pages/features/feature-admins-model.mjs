/**
 * In-chat feature admins (ADR 0055 extension): platform identities that manage features with the
 * `功能 …` chat commands at one of four levels. Admins of a level also manage every level below it.
 */
import { parseConversationKey } from './feature-model.mjs'

export const FEATURE_ADMIN_RPC = Object.freeze({
  LIST: 'feature.admins.list',
  ADD: 'feature.admins.add',
  REMOVE: 'feature.admins.remove',
})

const LEVELS = ['global', 'adapter', 'endpoint', 'conversation']
const RANK = { global: 0, adapter: 1, endpoint: 2, conversation: 3 }
/**
 * `grant`: stored by the instance (removable); `config`: `features.selfService.admins` in the
 * configuration file (read-only); `master` / `platform`: implicit (endpoint master, platform group
 * owner / admin), listed only by Hosts that report them.
 */
const SOURCE_ALIASES = { grant: 'grant', granted: 'grant', config: 'config', master: 'master', platform: 'platform' }
const ALIAS = /^[a-z0-9][a-z0-9-]*$/u

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** The level itself and every level above it, top-down, with their keys. Throws on a bad key. */
export function adminScopeChain(level, key) {
  if (level === 'global') return [{ level: 'global' }]
  if (level === 'adapter') {
    if (typeof key !== 'string' || !ALIAS.test(key)) throw new Error('Invalid adapter key')
    return [{ level: 'global' }, { level: 'adapter', key }]
  }
  if (level === 'endpoint') {
    const slash = typeof key === 'string' ? key.indexOf('/') : -1
    if (slash <= 0 || slash === key.length - 1 || key.includes('/', slash + 1) || !ALIAS.test(key.slice(0, slash))) throw new Error('Invalid endpoint key')
    return [{ level: 'global' }, { level: 'adapter', key: key.slice(0, slash) }, { level: 'endpoint', key }]
  }
  if (level === 'conversation') {
    const ref = parseConversationKey(key)
    if (!ref) throw new Error('Invalid conversation key')
    return [{ level: 'global' }, { level: 'adapter', key: ref.adapter }, { level: 'endpoint', key: `${ref.adapter}/${ref.endpoint}` }, { level: 'conversation', key }]
  }
  throw new Error('Unknown feature level')
}

/** Adapter alias a level key belongs to (undefined for global). */
export function adminScopeAdapter(level, key) {
  const chain = adminScopeChain(level, key)
  return chain[1]?.key
}

/**
 * `feature.admins.list { level, key? }`: the Host answers with the admins of the scope and of every
 * scope above it. Global has no key.
 */
export function adminsListRequest({ level, key, cursor } = {}) {
  if (!LEVELS.includes(level)) throw new Error('Unknown feature level')
  return {
    type: FEATURE_ADMIN_RPC.LIST,
    level,
    ...(level !== 'global' && typeof key === 'string' && key ? { key } : {}),
    ...(typeof cursor === 'string' && cursor ? { cursor } : {}),
  }
}

function readAdmin(item) {
  if (!isRecord(item) || !LEVELS.includes(item.level)) return null
  if (typeof item.adapter !== 'string' || !item.adapter || typeof item.userId !== 'string' || !item.userId) return null
  const key = item.level === 'global' ? '' : typeof item.key === 'string' ? item.key : ''
  if (item.level !== 'global' && !key) return null
  return {
    level: item.level,
    key,
    adapter: item.adapter,
    userId: item.userId,
    ...(typeof item.displayName === 'string' && item.displayName ? { displayName: item.displayName } : {}),
    // Unknown sources are read-only here.
    source: SOURCE_ALIASES[item.source] ?? 'config',
    ...(typeof item.grantedBy === 'string' && item.grantedBy ? { grantedBy: item.grantedBy } : {}),
    ...(typeof item.grantedAt === 'number' || typeof item.grantedAt === 'string' ? { grantedAt: item.grantedAt } : {}),
  }
}

/**
 * Validates a `feature.admins.list` result: `{ admins }` (also `{ items, cursor? }`). Malformed
 * entries are dropped.
 */
export function readAdminPage(payload) {
  const list = isRecord(payload) ? (Array.isArray(payload.admins) ? payload.admins : payload.items) : undefined
  if (!Array.isArray(list)) throw new Error('Invalid feature.admins.list response')
  return {
    items: list.map(readAdmin).filter(Boolean),
    ...(typeof payload.cursor === 'string' && payload.cursor ? { cursor: payload.cursor } : {}),
  }
}

function adminIdentity(item) {
  return `${item.level}\u0000${item.key}\u0000${item.adapter}\u0000${item.userId}\u0000${item.source}`
}

/**
 * Admins that apply at `level`/`key`: those of the level itself (direct) and of every level above
 * it on the same chain (inherited, read-only here). Admins of other scopes are dropped; duplicates
 * from overlapping list calls collapse. Ordered top-down, then by platform and user id.
 */
export function adminsApplyingTo(items, level, key) {
  const chain = adminScopeChain(level, key)
  const keys = new Map(chain.map(entry => [entry.level, entry.key ?? '']))
  const seen = new Set()
  const rows = []
  for (const item of items) {
    if (!keys.has(item.level) || keys.get(item.level) !== item.key) continue
    const identity = adminIdentity(item)
    if (seen.has(identity)) continue
    seen.add(identity)
    rows.push({ ...item, inherited: item.level !== level })
  }
  return rows.sort((a, b) => RANK[a.level] - RANK[b.level] || a.adapter.localeCompare(b.adapter) || a.userId.localeCompare(b.userId))
}

/** Only an instance-stored grant of this very level can be removed here, and only with `feature.configure`. */
export function adminRemovable(row, canConfigure) {
  return canConfigure === true && !row.inherited && row.source === 'grant'
}

/**
 * `feature.admins.add` / `feature.admins.remove` body. Outside the global level the adapter is the
 * level's own alias; on the global level the caller names the platform.
 */
export function adminMutationRequest(action, { level, key, adapter, userId }) {
  if (action !== 'add' && action !== 'remove') throw new Error('Unknown admin action')
  const chain = adminScopeChain(level, key)
  const scopeAdapter = chain[1]?.key
  const platform = level === 'global' ? (typeof adapter === 'string' ? adapter.trim() : '') : scopeAdapter
  if (!platform || !ALIAS.test(platform)) throw new Error('An admin needs an adapter alias')
  if (level !== 'global' && typeof adapter === 'string' && adapter && adapter !== scopeAdapter) throw new Error('The adapter must match the level key')
  const user = typeof userId === 'string' ? userId.trim() : ''
  if (!user) throw new Error('An admin needs a user id')
  return {
    type: action === 'add' ? FEATURE_ADMIN_RPC.ADD : FEATURE_ADMIN_RPC.REMOVE,
    level,
    ...(level === 'global' ? {} : { key }),
    adapter: platform,
    userId: user,
  }
}
