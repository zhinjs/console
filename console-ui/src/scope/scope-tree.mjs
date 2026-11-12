/**
 * The four-level object tree of the Console: 全局 ─ 适配器 ─ 账号 ─ 会话 (ADR 0050 / 0055 / 0056).
 *
 * Pure data and string helpers shared by the object pages, the breadcrumb, the scope picker and the
 * tests. A scope is `{ level, adapter?, endpoint?, kind?, id? }`; its resolution key is the one the
 * Host uses for feature overrides and chat roles: `''`, `<alias>`, `<alias>/<endpointId>` or
 * `<alias>/<endpointId>/<kind>:<escaped id>` (`%` -> `%25`, `/` -> `%2F`).
 */
import { CONVERSATION_KINDS, conversationKey, parseConversationKey, parseConversationSegment } from '../pages/features/feature-model.mjs'

export const SCOPE_LEVELS = Object.freeze(['global', 'adapter', 'endpoint', 'conversation'])

/** First segment of every object page. */
export const SCOPE_ROOT = '/scope'

/**
 * Tabs of each level, in display order. `overview` is the default and is left out of the URL.
 * 账号 adds 接入 (login, connection test) and 聊天 (the account workspace); 会话 adds 聊天.
 */
export const SCOPE_TABS = Object.freeze({
  global: Object.freeze(['overview', 'features', 'roles', 'records']),
  adapter: Object.freeze(['overview', 'features', 'roles', 'records']),
  endpoint: Object.freeze(['overview', 'chat', 'access', 'features', 'roles', 'records']),
  conversation: Object.freeze(['overview', 'chat', 'features', 'roles', 'records']),
})

export const DEFAULT_SCOPE_TAB = 'overview'

/** Query parameter that remembers the open tab. */
export const SCOPE_TAB_PARAM = 'tab'

/** Authored tab labels (displayed through i18n). */
export const SCOPE_TAB_LABELS = Object.freeze({
  overview: '概览',
  chat: '聊天',
  access: '接入',
  features: '功能',
  roles: '角色',
  records: '记录',
})

/** Authored level names (displayed through i18n). */
export const SCOPE_LEVEL_LABELS = Object.freeze({
  global: '全局',
  adapter: '适配器',
  endpoint: '账号',
  conversation: '会话',
})

/**
 * Any-of Console permissions a tab needs (ADR 0049). A tab the principal cannot use stays visible
 * and explains the missing permission; selecting a scope never grants anything.
 */
export const SCOPE_TAB_PERMISSIONS = Object.freeze({
  overview: Object.freeze(['endpoint.view', 'feature.view']),
  chat: Object.freeze(['endpoint.view', 'endpoint.operate']),
  access: Object.freeze(['endpoint.view', 'endpoint.operate']),
  features: Object.freeze(['feature.view']),
  // chat-roles.* (ADR 0056) need iam.manage; `feature.admins.*` (ADR 0055) is retired.
  roles: Object.freeze(['iam.manage']),
  records: Object.freeze(['status.view']),
})

const segment = value => encodeURIComponent(String(value))

/** Level of a scope object, from the fields it has. */
export function scopeLevel(scope) {
  if (!scope?.adapter) return 'global'
  if (!scope.endpoint) return 'adapter'
  if (!scope.kind || !scope.id) return 'endpoint'
  return 'conversation'
}

/** The tab to show: the requested one when the level has it, else 概览. */
export function resolveScopeTab(level, requested) {
  const tabs = SCOPE_TABS[level] ?? SCOPE_TABS.global
  return typeof requested === 'string' && tabs.includes(requested) ? requested : DEFAULT_SCOPE_TAB
}

/** Path of a scope's object page; `tab` (other than 概览) and extra parameters go in the query. */
export function scopeHref(scope = {}, tab, params) {
  const level = scopeLevel(scope)
  let path = SCOPE_ROOT
  if (level !== 'global') path += `/${segment(scope.adapter)}`
  if (level === 'endpoint' || level === 'conversation') path += `/${segment(scope.endpoint)}`
  if (level === 'conversation') path += `/${segment(`${scope.kind}:${scope.id}`)}`
  const query = new URLSearchParams(params ?? undefined)
  query.delete(SCOPE_TAB_PARAM)
  const next = new URLSearchParams()
  if (tab && tab !== DEFAULT_SCOPE_TAB && (SCOPE_TABS[level] ?? []).includes(tab)) next.set(SCOPE_TAB_PARAM, tab)
  for (const [key, value] of query) next.append(key, value)
  const search = next.toString()
  return search ? `${path}?${search}` : path
}

/**
 * The Host resolution key of a scope, or null when the scope cannot be addressed by the Host
 * (e.g. an adapter name that is not an instance alias). Never throws.
 */
export function scopeKey(scope) {
  const level = scopeLevel(scope)
  if (level === 'global') return ''
  if (!ALIAS.test(scope.adapter)) return null
  if (level === 'adapter') return scope.adapter
  if (!ENDPOINT_ID.test(scope.endpoint)) return null
  if (level === 'endpoint') return `${scope.adapter}/${scope.endpoint}`
  try {
    return conversationKey({ adapter: scope.adapter, endpoint: scope.endpoint, kind: scope.kind, id: scope.id })
  } catch {
    return null
  }
}

// Mirrors `@zhin.js/console-protocol` feature.ts (ADR 0055 §1).
const ALIAS = /^[a-z0-9][a-z0-9-]*$/u
const ENDPOINT_ID = /^[^/~\0]{1,128}$/u

/** Scope of a resolution key (`''`, alias, `alias/endpoint`, conversation key); null when it is none. */
export function parseScopeKey(key) {
  if (key === '' || key === undefined || key === null) return { level: 'global' }
  if (typeof key !== 'string') return null
  const parts = key.split('/')
  if (parts.length === 1) return ALIAS.test(key) ? { level: 'adapter', adapter: key } : null
  if (parts.length === 2) return ALIAS.test(parts[0]) && ENDPOINT_ID.test(parts[1]) ? { level: 'endpoint', adapter: parts[0], endpoint: parts[1] } : null
  const ref = parseConversationKey(key)
  return ref ? { level: 'conversation', adapter: ref.adapter, endpoint: ref.endpoint, kind: ref.kind, id: ref.id } : null
}

/**
 * Route parameters -> scope. Values are already URI-decoded (React Router decodes path parameters).
 * Returns `{ ok: true, scope, key }`, or `{ ok: false, reason: 'invalid-conversation', segment, scope }`
 * for a conversation segment that is not `<kind>:<id>` (`scope` is then its account). `key` is null
 * when the Host cannot address the scope.
 */
export function parseScopeParams(params = {}) {
  const text = value => typeof value === 'string' ? value : ''
  const adapter = text(params.adapter)
  const endpoint = text(params.endpoint)
  const conversation = text(params.conversation)
  if (!adapter) return { ok: true, scope: { level: 'global' }, key: '' }
  if (!endpoint) {
    const scope = { level: 'adapter', adapter }
    return { ok: true, scope, key: scopeKey(scope) }
  }
  if (!conversation) {
    const scope = { level: 'endpoint', adapter, endpoint }
    return { ok: true, scope, key: scopeKey(scope) }
  }
  const parsed = parseConversationSegment(conversation)
  if (!parsed) return { ok: false, reason: 'invalid-conversation', segment: conversation, scope: { level: 'endpoint', adapter, endpoint } }
  const scope = { level: 'conversation', adapter, endpoint, kind: parsed.kind, id: parsed.id }
  return { ok: true, scope, key: scopeKey(scope) }
}

/**
 * Raw (still encoded) `location.pathname` -> the same result as {@link parseScopeParams}, or null when
 * the path is not an object page. Reading the raw path keeps ids exact: the router turns a decoded
 * `%2F` back into `/`, so an id that literally contains `%2F` would not survive `useParams`.
 */
export function parseScopePath(pathname) {
  if (typeof pathname !== 'string') return null
  const path = pathname.length > 1 ? pathname.replace(/\/+$/u, '') : pathname
  if (path !== SCOPE_ROOT && !path.startsWith(`${SCOPE_ROOT}/`)) return null
  const raw = path.slice(SCOPE_ROOT.length).split('/').slice(1)
  if (raw.length > 3 || raw.some(part => !part)) return null
  const decoded = []
  for (const part of raw) {
    try {
      decoded.push(decodeURIComponent(part))
    } catch {
      return null
    }
  }
  const [adapter, endpoint, conversation] = decoded
  return parseScopeParams({ adapter, endpoint, conversation })
}

/** The scope one level up; null for 全局. */
export function parentScope(scope) {
  const level = scopeLevel(scope)
  if (level === 'global') return null
  if (level === 'adapter') return { level: 'global' }
  if (level === 'endpoint') return { level: 'adapter', adapter: scope.adapter }
  return { level: 'endpoint', adapter: scope.adapter, endpoint: scope.endpoint }
}

/** Every scope from 全局 down to (and including) this one. */
export function scopeChain(scope) {
  const chain = []
  for (let current = scope ? { ...scope, level: scopeLevel(scope) } : { level: 'global' }; current; current = parentScope(current)) chain.unshift(current)
  return chain
}

/** Authored label of a conversation kind. */
export const CONVERSATION_KIND_LABELS = Object.freeze({ group: '群聊', private: '私聊', channel: '频道' })

/**
 * Breadcrumb entries `{ level, scope, label, href }` from 全局 to the scope. `label` is the raw
 * identity (alias, endpoint id, conversation id) or `names[level]` when a display name is known;
 * the 全局 label is authored copy for i18n.
 */
export function scopeCrumbs(scope, names = {}) {
  return scopeChain(scope).map(item => ({
    level: item.level,
    scope: item,
    href: scopeHref(item),
    label: item.level === 'global' ? SCOPE_LEVEL_LABELS.global
      : item.level === 'adapter' ? names.adapter || item.adapter
        : item.level === 'endpoint' ? names.endpoint || item.endpoint
          : names.conversation || item.id,
  }))
}

/** Full identity text of a scope, for copying and titles: `qq / bot-1 / group:123`. */
export function scopeIdentity(scope) {
  const level = scopeLevel(scope)
  if (level === 'global') return ''
  const parts = [scope.adapter]
  if (level !== 'adapter') parts.push(scope.endpoint)
  if (level === 'conversation') parts.push(`${scope.kind}:${scope.id}`)
  return parts.join(' / ')
}

/** Whether two scopes name the same object. */
export function sameScope(a, b) {
  const level = scopeLevel(a)
  if (level !== scopeLevel(b)) return false
  return (a.adapter ?? '') === (b.adapter ?? '') && (a.endpoint ?? '') === (b.endpoint ?? '')
    && (a.kind ?? '') === (b.kind ?? '') && (a.id ?? '') === (b.id ?? '')
}

/**
 * Picker model from `endpoint.list` rows (`{ adapter, name, connected }`) and, for the current
 * account, conversation rows (`{ kind, id, name? }`): adapters -> accounts -> conversations, sorted,
 * with the current scope's ancestors marked. The current scope is always present, even when the
 * Host does not list it (a stored override for an account that is offline right now).
 */
export function scopePickerTree(endpoints = [], current = { level: 'global' }, conversations = []) {
  const adapters = new Map()
  const ensureAdapter = alias => {
    if (!adapters.has(alias)) adapters.set(alias, { adapter: alias, accounts: new Map() })
    return adapters.get(alias)
  }
  for (const row of endpoints) {
    if (!row || typeof row.adapter !== 'string' || !row.adapter || typeof row.name !== 'string' || !row.name) continue
    ensureAdapter(row.adapter).accounts.set(row.name, { endpoint: row.name, connected: row.connected === true, listed: true })
  }
  const level = scopeLevel(current)
  if (level !== 'global') {
    const entry = ensureAdapter(current.adapter)
    if (level !== 'adapter' && !entry.accounts.has(current.endpoint)) entry.accounts.set(current.endpoint, { endpoint: current.endpoint, connected: false, listed: false })
  }
  const byName = (a, b) => a.localeCompare(b)
  const conversationRows = []
  const seen = new Set()
  for (const row of [...conversations, ...(level === 'conversation' ? [{ kind: current.kind, id: current.id }] : [])]) {
    if (!row || !CONVERSATION_KINDS.includes(row.kind) || typeof row.id !== 'string' || !row.id) continue
    const id = `${row.kind}:${row.id}`
    if (seen.has(id)) continue
    seen.add(id)
    conversationRows.push({ kind: row.kind, id: row.id, ...(typeof row.name === 'string' && row.name ? { name: row.name } : {}) })
  }
  return [...adapters.values()].sort((a, b) => byName(a.adapter, b.adapter)).map(entry => ({
    adapter: entry.adapter,
    current: level !== 'global' && entry.adapter === current.adapter,
    accounts: [...entry.accounts.values()].sort((a, b) => byName(a.endpoint, b.endpoint)).map(account => {
      const isCurrent = (level === 'endpoint' || level === 'conversation') && entry.adapter === current.adapter && account.endpoint === current.endpoint
      return { ...account, current: isCurrent, conversations: isCurrent ? conversationRows : [] }
    }),
  }))
}
