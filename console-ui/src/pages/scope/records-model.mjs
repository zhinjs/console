/**
 * 记录 tab of every object page: which record pages hold records of this scope, how each one can be
 * narrowed to it, and how exact that narrowing is. Only fields that name the scope are used
 * (session keys, audit targets, decision platform / scene). Nothing is matched by time.
 *
 * `association`:
 * - `exact`   the record carries this scope's identity (session key, audit target)
 * - `partial` the record names a wider scope (decisions name the platform and the conversation, not
 *             the account; audit targets stop at the account)
 * - `text`    运行日志 has no scope fields: the page matches the identities as text
 * Links carry the shared scope parameters (`adapter` / `endpoint` / `conversation`,
 * insights/scope-filter.mjs); 审计日志 takes its audit `target`.
 * - `all`     全局: everything, no filter
 */
import { scopeLevel } from '../../scope/scope-tree.mjs'
import { scopeFilterHref } from '../insights/scope-filter.mjs'

/** Record sources in display order. */
export const RECORD_SOURCES = Object.freeze(['sessions', 'replay', 'logs', 'audit'])

/** Authored titles / descriptions (displayed through i18n). */
export const RECORD_SOURCE_COPY = Object.freeze({
  sessions: Object.freeze({ title: '聊天记录', description: '机器人在会话里的对话、轨迹与分支（Agent 会话）。' }),
  replay: Object.freeze({ title: '决策回放', description: '机器人每次回或不回、调没调模型、发没发消息的原因。' }),
  logs: Object.freeze({ title: '运行日志', description: '实例的运行日志。' }),
  audit: Object.freeze({ title: '审计日志', description: 'Console 里的登录、访问控制变更与写操作。' }),
})

/** Authored notes per source and level: what the filter really covers. */
const NOTES = Object.freeze({
  sessions: Object.freeze({
    global: '全部会话。',
    adapter: '会话标识以这个适配器开头的会话。',
    endpoint: '会话标识属于这个账号的会话。',
    conversation: '这个会话自己的聊天记录。',
  }),
  replay: Object.freeze({
    global: '全部决策。',
    adapter: '按平台筛选。',
    endpoint: '决策只记录平台与会话，不能按账号筛选：这里是这个平台全部账号的决策。',
    conversation: '按平台与会话筛选；同一平台的其他账号在这个会话里的决策也会列出。',
  }),
  logs: Object.freeze({
    global: '全部日志。',
    adapter: '日志是自由文本：按适配器名做文本匹配，结果可能包含无关的行。',
    endpoint: '日志是自由文本：按适配器名与账号 ID 做文本匹配，结果可能包含无关的行。',
    conversation: '日志是自由文本：按适配器名、账号 ID 与会话 ID 做文本匹配，结果可能包含无关的行。',
  }),
  audit: Object.freeze({
    global: '全部审计记录。',
    adapter: '目标是这个适配器的写操作（在已读取的记录中筛选）。',
    endpoint: '目标是这个账号的写操作（在已读取的记录中筛选）。',
    conversation: '审计只记录到账号一级：这里是这个账号的写操作（在已读取的记录中筛选）。',
  }),
})

const ASSOCIATION = Object.freeze({
  sessions: { global: 'all', adapter: 'exact', endpoint: 'exact', conversation: 'exact' },
  // Same readings as the target pages (insights/scope-filter.mjs: replayScopeFilter, logScopeTokens).
  replay: { global: 'all', adapter: 'exact', endpoint: 'partial', conversation: 'partial' },
  logs: { global: 'all', adapter: 'text', endpoint: 'text', conversation: 'text' },
  audit: { global: 'all', adapter: 'exact', endpoint: 'exact', conversation: 'partial' },
})

/** Authored badge per association (displayed through i18n). */
export const ASSOCIATION_LABELS = Object.freeze({ exact: '精确', partial: '范围更宽', text: '文本匹配', all: '全部' })

/** Session key of an IM conversation (`@zhin.js/ai` resolveIMSessionId): `<platform>:<endpoint>:<kind>:<id>`. */
export function conversationSessionKey(scope) {
  return `${scope.adapter}:${scope.endpoint}:${scope.kind}:${scope.id}`
}

/** Audit `target` written by the gateway for RPCs addressed to an adapter or an account (`rpcAuditTarget`). */
export function auditTargetOf(scope) {
  const level = scopeLevel(scope)
  if (level === 'adapter') return `adapter:${scope.adapter}`
  if (level === 'endpoint' || level === 'conversation') return `endpoint:${scope.adapter}/${scope.endpoint}`
  return ''
}

const query = (path, params) => {
  const search = new URLSearchParams(Object.entries(params).filter(([, value]) => value))
  const text = search.toString()
  return text ? `${path}?${text}` : path
}

/** Link to the sessions page narrowed to the scope (a conversation also opens its own session). */
export function sessionsHref(scope) {
  const level = scopeLevel(scope)
  return scopeFilterHref('/agent/sessions', scope, level === 'conversation' ? { sessionKey: conversationSessionKey(scope) } : undefined)
}

/**
 * Every record source of a scope: `{ id, href, association, note, filter }` (`filter` is the text
 * shown as "筛选：…", empty for 全局).
 */
export function recordSources(scope) {
  const level = scopeLevel(scope)
  const target = auditTargetOf(scope)
  const identity = level === 'global' ? '' : [scope.adapter, scope.endpoint, level === 'conversation' ? `${scope.kind}:${scope.id}` : ''].filter(Boolean).join(' / ')
  const links = {
    sessions: { href: sessionsHref(scope), filter: level === 'conversation' ? conversationSessionKey(scope) : level === 'global' ? '' : `${level === 'adapter' ? scope.adapter : `${scope.adapter}:${scope.endpoint}`}:*` },
    replay: { href: scopeFilterHref('/agent/replay', scope), filter: identity },
    logs: { href: scopeFilterHref('/logs', scope), filter: identity },
    audit: { href: query('/access/audit', { target }), filter: target },
  }
  return RECORD_SOURCES.map(id => ({
    id,
    href: links[id].href,
    filter: links[id].filter,
    association: ASSOCIATION[id][level],
    note: NOTES[id][level],
  }))
}

/** Whether a Host session key belongs to the scope (exact identity, never a time window). */
export function sessionKeyInScope(sessionKey, scope) {
  if (typeof sessionKey !== 'string') return false
  const level = scopeLevel(scope)
  if (level === 'global') return true
  const parts = sessionKey.split(':')
  if (parts.length < 4) return false
  if (parts[0] !== scope.adapter) return false
  if (level === 'adapter') return true
  if (parts[1] !== scope.endpoint) return false
  if (level === 'endpoint') return true
  return sessionKey === conversationSessionKey(scope)
}

/**
 * The conversation page a session can be continued on (its 聊天 tab), or null for sessions that are
 * history only (personal sessions, keys that do not name an IM conversation).
 */
export function sessionConversationScope(sessionKey) {
  if (typeof sessionKey !== 'string') return null
  const parts = sessionKey.split(':')
  if (parts.length < 4) return null
  const [adapter, endpoint, kind] = parts
  const id = parts.slice(3).join(':')
  if (!adapter || !endpoint || !id || !['private', 'group', 'channel'].includes(kind)) return null
  return { level: 'conversation', adapter, endpoint, kind, id }
}

/** Audit entries whose target names the scope (`?target=`). */
export function auditEntriesForTarget(entries, target) {
  if (!target) return entries
  return entries.filter(entry => entry?.target === target)
}

const IM_KINDS = new Set(['private', 'group', 'channel'])
/** Session keys that hide their conversation (`personal-session:v1:<sha>`, `scene-task:v1:<sha>`). */
const HASHED_SESSION_KEY = /^[a-z][a-z-]*:v\d+:[0-9a-f]{16,}$/u
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : '')
const record = value => !!value && typeof value === 'object' && !Array.isArray(value)

/**
 * Where a trace-archive session row came from, read from the fields the Host records about it:
 * `origin` (a turn's `ToolInvocationOrigin`: `{ kind: 'im', platform, endpoint, scope, sceneId,
 * conversation? }`), else top-level `platform` / `endpoint`. Returns
 * `{ im: false }` for a non-IM origin (schedule, HTTP, …), `{ im: true, adapter, endpoint?, kind?, id?, name? }`
 * for an IM one, or null when the row says nothing (today's Hosts, zhinjs/zhin#1250).
 */
export function sessionRowOrigin(row) {
  const origin = record(row?.origin) ? row.origin : null
  if (origin && text(origin.kind) && origin.kind !== 'im') return { im: false }
  const conversation = record(origin?.conversation) ? origin.conversation : null
  const adapter = text(conversation?.endpoint?.adapter) || text(origin?.platform) || text(row?.platform) || text(row?.adapter)
  if (!adapter) return null
  const endpoint = text(conversation?.endpoint?.id) || text(origin?.endpoint) || text(row?.endpoint) || text(row?.endpoint_id)
  let kind = IM_KINDS.has(conversation?.kind) ? conversation.kind : IM_KINDS.has(origin?.scope) ? origin.scope : ''
  let id = text(conversation?.id)
  if (!id && kind) {
    const scene = text(origin?.sceneId)
    id = scene.startsWith(`${kind}:`) ? scene.slice(kind.length + 1) : scene
  }
  if (!id) kind = ''
  const name = text(conversation?.name)
  return { im: true, adapter, ...(endpoint ? { endpoint } : {}), ...(kind ? { kind, id } : {}), ...(name ? { name } : {}) }
}

/** `in` / `out` of the scope, or `unknown` when the row does not say enough to tell. */
function originInScope(origin, scope, level) {
  if (!origin.im) return 'out'
  if (origin.adapter !== scope.adapter) return 'out'
  if (level === 'adapter') return 'in'
  if (!origin.endpoint) return 'unknown'
  if (origin.endpoint !== scope.endpoint) return 'out'
  if (level === 'endpoint') return 'in'
  if (!origin.kind) return 'unknown'
  return origin.kind === scope.kind && origin.id === scope.id ? 'in' : 'out'
}

/**
 * Whether a session row belongs to the scope: `in`, `out`, or `unknown` (a hashed key with no
 * recorded origin: it may well be this scope's, the record just does not say).
 * The recorded origin decides first; an old-style `<platform>:<endpoint>:<kind>:<id>` key is the fallback.
 * Keys of other shapes (`schedule:<id>`) are not IM conversations and stay out.
 */
export function sessionRowInScope(row, scope) {
  const level = scopeLevel(scope)
  const key = typeof row?.session_key === 'string' ? row.session_key : ''
  const origin = sessionRowOrigin(row)
  const hashed = HASHED_SESSION_KEY.test(key)
  if (level === 'global') return origin?.im || hashed || sessionConversationScope(key) ? 'in' : 'out'
  if (origin) return originInScope(origin, scope, level)
  if (sessionConversationScope(key)) return sessionKeyInScope(key, scope) ? 'in' : 'out'
  return hashed ? 'unknown' : 'out'
}

/**
 * 记录 → 聊天记录 of a scope, from the trace-archive session list (`/api/agent/trace-archive/sessions`):
 * - `matched`       sessions of the scope (newest first, `limit` of them); `unattributed` more may belong here
 * - `unattributed`  none matched, but `unattributed` sessions do not say where they came from (hashed keys
 *                   without an origin): the page must not claim there is no history
 * - `empty`         no session belongs here (the list is empty, or every session is known to be elsewhere)
 * Rows: `{ sessionKey, turns, lastAt, lastStatus, origin, conversation }` (`conversation`: the scope its
 * chat can be continued in, or null).
 */
export function scopeSessionRecords(body, scope, limit = 8) {
  const rows = body?.success === true && Array.isArray(body.data) ? body.data : []
  const latest = new Map()
  for (const row of rows) {
    if (!row || typeof row.session_key !== 'string' || !row.session_key.trim()) continue
    if (!Number.isFinite(row.last_started_at) || !Number.isInteger(row.turns) || row.turns < 0) continue
    const previous = latest.get(row.session_key)
    if (!previous || row.last_started_at > previous.last_started_at) latest.set(row.session_key, row)
  }
  const matched = []
  let unattributed = 0
  for (const row of latest.values()) {
    const verdict = sessionRowInScope(row, scope)
    if (verdict === 'unknown') unattributed += 1
    if (verdict === 'in') matched.push(row)
  }
  matched.sort((a, b) => b.last_started_at - a.last_started_at)
  const view = row => {
    const origin = sessionRowOrigin(row)
    const im = origin?.im ? origin : null
    const conversation = im?.endpoint && im.kind
      ? { level: 'conversation', adapter: im.adapter, endpoint: im.endpoint, kind: im.kind, id: im.id }
      : sessionConversationScope(row.session_key)
    return { sessionKey: row.session_key, turns: row.turns, lastAt: row.last_started_at,
      lastStatus: typeof row.last_status === 'string' ? row.last_status : '', origin: im, conversation }
  }
  const state = matched.length ? 'matched' : unattributed ? 'unattributed' : 'empty'
  return { state, rows: matched.slice(0, Math.max(0, limit)).map(view), total: matched.length, unattributed }
}
