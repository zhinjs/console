import { parseConversationSessionKey } from '@zhin.js/console-protocol'
import { translate } from '../i18n/locale.mjs'

/**
 * Readable names of Agent session keys, shared by every page that lists sessions (Token 用量,
 * 聊天记录, 机器人状态, 工具审批). zhin hashes the keys of IM conversations
 * (`personal-session:v1:<sha>`, `scene-task:v1:<sha>` for group chats) and names scheduled runs
 * `schedule:<id>`, so a key alone rarely names a conversation: the name comes from what the Host
 * sends next to it (`scopeKind` / `sceneLabel` / `platform` / `displayName`), and only falls back
 * to the key's shape. The full key belongs in a tooltip / detail, never in the main view.
 */

const label = value => (typeof value === 'string' && value.trim() ? value.trim() : '')

const SCOPE_NAMES = Object.freeze({ group: '群', private: '私聊', direct: '私聊', channel: '频道', guild: '频道' })
const HASHED_KEY = /^([a-z][a-z-]*):v\d+:([0-9a-f]{16,})$/u
/** What a hashed key names when the Host sends nothing else: `scene-task` keys are group chats. */
const HASHED_NAMES = Object.freeze({ 'personal-session': '私聊会话', 'scene-task': '群聊' })
const HASHED_KINDS = Object.freeze({ 'personal-session': 'private', 'scene-task': 'group' })
/** Origins that are not an IM conversation (`scopeKind`, zhin 第 58 批). */
const ORIGIN_NAMES = Object.freeze({ http: 'HTTP', a2a: 'A2A', mcp: 'MCP' })
const KIND_ALIASES = Object.freeze({ direct: 'private', guild: 'channel' })
const IM_SCOPES = new Set(['private', 'group', 'channel', 'direct', 'guild'])
/**
 * 「平台 · 群 名称」 as an older Host writes `displayName` (the name may be missing: 「平台 · 群」): the
 * type word is Chinese whatever the UI language.
 */
const CHINESE_SCOPE_LABEL = /^(.+?) · (群|私聊|频道)(?: (.+))?$/u
const CHINESE_SCOPE_KINDS = Object.freeze({ 群: 'group', 私聊: 'private', 频道: 'channel' })
/** 「定时任务 名称」/「内部任务 名称」/「内部 名称」 of an older Host, the name optional. */
const CHINESE_TASK_LABEL = /^(定时任务|内部任务|内部)(?: (.+))?$/u
const CHINESE_TASK_MESSAGES = Object.freeze({ 定时任务: '定时任务 {0}', 内部任务: '内部任务 {0}', 内部: '内部任务 {0}' })

/** Long keys keep their head and tail: `abcdefghij…uvwxyz`. */
export function middleEllipsis(text, max = 32) {
  return text.length <= max ? text : `${text.slice(0, Math.ceil((max - 1) / 2))}…${text.slice(-Math.floor((max - 1) / 2))}`
}

/**
 * 拆 sessionKey：真实格式是 `platform:endpoint:scope:sceneId`（sceneId 里允许再有冒号），由
 * `@zhin.js/console-protocol` 的 `parseConversationSessionKey` 解析。
 * 优先用 Host 给的 platform / endpoint / scope / sceneId；缺失时按上面拆，
 * 拆不出来（少于 4 段，如 `schedule:assistant-profile-weatherReport`；或平台、类型、会话 ID 为空）不猜，
 * 整条 key 当作会话 ID 显示。
 */
export function splitSessionKey(row) {
  const parsed = parseConversationSessionKey(String(row.sessionKey))
  const fallback = parsed
    ? { platform: parsed.adapter, endpoint: parsed.endpointKey, scope: parsed.kind, sceneId: parsed.id }
    : { platform: '', endpoint: '', scope: '', sceneId: row.sessionKey }
  return {
    sessionKey: row.sessionKey,
    platform: row.platform || fallback.platform,
    endpoint: row.endpoint || fallback.endpoint,
    scope: row.scope || fallback.scope,
    sceneId: row.sceneId || fallback.sceneId,
  }
}

const IM_CONVERSATION_KINDS = new Set(['private', 'group', 'channel'])

/**
 * The conversation an IM session key names, as the Console reads it: the protocol's
 * `parseConversationSessionKey` (on the trimmed key), narrowed to what a Console link needs — a
 * non-blank platform, account and conversation id, and a `private` / `group` / `channel` kind.
 * The protocol also accepts an empty account (`qq::private:1`, written for a scene without one,
 * #1250 b80); such a key has no account page to open, so the Console still treats it as no
 * conversation. Null when the key is not one.
 */
export function parseImConversationKey(key) {
  const parsed = parseConversationSessionKey(String(key ?? '').trim())
  if (!parsed || !parsed.adapter.trim() || !parsed.endpointKey.trim() || !parsed.id.trim() || !IM_CONVERSATION_KINDS.has(parsed.kind)) return null
  return { platform: parsed.adapter, endpoint: parsed.endpointKey, kind: parsed.kind, id: parsed.id }
}

/** The id of a `schedule:<id>` key, '' for other keys. */
export function scheduleIdOfKey(sessionKey) {
  const key = String(sessionKey ?? '')
  return key.startsWith('schedule:') && key.length > 9 ? key.slice(9) : ''
}

/**
 * A hashed Agent session key (`<kind>:v<n>:<hex>`, zhin 1.9): `personal-session:v1:` with its full
 * 64-digit hash, any other kind (`scene-task:v1:` …) with at least 16 hex digits.
 */
export function isHashedSessionKey(sessionKey) {
  const hashed = HASHED_KEY.exec(String(sessionKey ?? ''))
  if (!hashed) return false
  return hashed[1] !== 'personal-session' || /^[0-9a-f]{64}$/u.test(hashed[2])
}

/**
 * A session the key alone identifies — hashed keys and `schedule:<id>` — with no conversation
 * address in it: its turns are read by key (「轨迹」), its conversation is not linked here yet.
 */
export function isKeyOnlySessionKey(sessionKey) {
  return isHashedSessionKey(sessionKey) || !!scheduleIdOfKey(sessionKey)
}

/**
 * Kind of a session: the Host's `scopeKind` (`direct` → `private`, `guild` → `channel`), else the
 * Host's `scope` / the scope of a `platform:endpoint:scope:sceneId` key, else what a hashed key
 * names (`scene-task` → `group`, `personal-session` → `private`), `schedule` for `schedule:` keys,
 * else '' (unknown — callers must not count it as any IM kind).
 */
export function sessionKind(row) {
  const own = label(row?.scopeKind)
  if (own) return KIND_ALIASES[own] ?? own
  const key = String(row?.sessionKey ?? '')
  const parsed = parseConversationSessionKey(key)
  const scope = label(row?.scope) || (parsed && label(parsed.id) ? parsed.kind : '')
  if (IM_SCOPES.has(scope)) return KIND_ALIASES[scope] ?? scope
  const hashed = HASHED_KEY.exec(key)
  if (hashed && HASHED_KINDS[hashed[1]]) return HASHED_KINDS[hashed[1]]
  if (scheduleIdOfKey(key)) return 'schedule'
  return ''
}

function scopeWord(scope, locale) {
  return SCOPE_NAMES[scope] ? translate(locale, SCOPE_NAMES[scope]) : scope
}

/**
 * Platform of a session row: the Host's `platform` (zhin 第 58 批 sends it for hashed keys too, from
 * the recorded origin), else the first part of a `platform:endpoint:scope:sceneId` key.
 */
function sessionPlatform(row) {
  return label(splitSessionKey(row).platform)
}

/** 「#前 8 位」 of a hashed key, '' for other keys. */
function hashedTag(row) {
  const hashed = HASHED_KEY.exec(String(row?.sessionKey ?? ''))
  return hashed ? `#${hashed[2].slice(0, 8)}` : ''
}

/** 「平台 · 名称」, or just the name without a platform. */
function withPlatform(platform, body) {
  return platform ? `${platform} · ${body}` : body
}

/** 「平台 · 类型 名称」 from `scopeKind` / `sceneLabel` (zhin 第 58 批), in the UI language. */
function sessionLabelFromParts(row, locale) {
  const kind = label(row?.scopeKind)
  if (!kind) return ''
  const scene = label(row.sceneLabel)
  if (ORIGIN_NAMES[kind]) return scene ? `${ORIGIN_NAMES[kind]} · ${scene}` : ORIGIN_NAMES[kind]
  if (kind === 'schedule') return translate(locale, '定时任务 {0}', [scene || middleEllipsis(scheduleIdOfKey(row.sessionKey))]).trim()
  if (kind === 'internal') return translate(locale, '内部任务 {0}', [scene]).trim()
  // A hashed key carries no scene id: its short hash tells it apart instead of the raw key.
  const name = scene || hashedTag(row) || middleEllipsis(splitSessionKey(row).sceneId)
  return withPlatform(sessionPlatform(row), `${scopeWord(kind, locale)} ${name}`.trim())
}

/**
 * A group (or channel) has two kinds of hashed session under the same name: its shared one
 * (`scene-task:`) and each member's personal one (`personal-session:`). Their names gain
 * 「· 群聊」 (「· 共享会话」 for a channel) / 「· 个人会话」 so the two rows differ (#64
 * `sessions-same-group-twice`). Old-style keys name the conversation itself and stay as they are.
 */
function groupSessionWord(row, kind, locale) {
  if (kind !== 'group' && kind !== 'channel') return ''
  const hashed = HASHED_KEY.exec(String(row?.sessionKey ?? ''))
  if (!hashed) return ''
  if (hashed[1] === 'personal-session') return translate(locale, '个人会话')
  if (hashed[1] === 'scene-task') return translate(locale, kind === 'group' ? '群聊' : '共享会话')
  return ''
}

/**
 * The name a session shows: 「平台 · 类型 名称」 from `scopeKind` / `sceneLabel` in the UI language
 * when the Host sends them (zhin 第 58 批), else the Host's `displayName` (`label` / `name` from older
 * shapes; its Chinese type word is translated), else 「平台 · 类型 sceneId」 from a
 * `platform:endpoint:scope:sceneId` key, else for a hashed key 「平台 · 私聊会话 #前 8 位」
 * (`personal-session:v1:<sha>`) / 「平台 · 群聊 #前 8 位」 (`scene-task:v1:<sha>`) — the platform
 * from `platform`, left out when the Host has none —, 「定时任务 …」 for `schedule:<id>`, else the
 * key shortened in the middle. Never 「自定义会话」.
 */
export function sessionLabel(row, locale = 'zh-CN') {
  const { name, kind } = sessionLabelParts(row, locale)
  return kind ? `${name} · ${kind}` : name
}

/**
 * `sessionLabel` in two parts, for a list too narrow to show the whole name: `name` without the
 * 「群聊 / 个人会话」 word, and that word as `kind` ('' when the name needs none).
 */
export function sessionLabelParts(row, locale = 'zh-CN') {
  const fromParts = sessionLabelFromParts(row, locale)
  if (fromParts) return { name: fromParts, kind: groupSessionWord(row, KIND_ALIASES[label(row.scopeKind)] ?? label(row.scopeKind), locale) }
  const own = label(row?.displayName) || label(row?.label) || label(row?.name)
  if (own) {
    const chinese = CHINESE_SCOPE_LABEL.exec(own)
    if (chinese) {
      const kind = CHINESE_SCOPE_KINDS[chinese[2]]
      return { name: `${chinese[1]} · ${`${scopeWord(kind, locale)} ${chinese[3] ?? ''}`.trim()}`, kind: groupSessionWord(row, kind, locale) }
    }
    const task = CHINESE_TASK_LABEL.exec(own)
    if (task) return { name: translate(locale, CHINESE_TASK_MESSAGES[task[1]], [task[2] ?? '']).trim(), kind: '' }
    return { name: own, kind: '' }
  }
  const key = String(row?.sessionKey ?? '')
  const hashed = HASHED_KEY.exec(key)
  if (hashed) return { name: withPlatform(sessionPlatform(row), `${translate(locale, HASHED_NAMES[hashed[1]] ?? '会话')} #${hashed[2].slice(0, 8)}`), kind: '' }
  const scheduleId = scheduleIdOfKey(key)
  if (scheduleId) return { name: translate(locale, '定时任务 {0}', [middleEllipsis(scheduleId)]), kind: '' }
  const parts = splitSessionKey({ ...row, sessionKey: key })
  if (parts.platform && parts.scope) return { name: `${parts.platform} · ${scopeWord(parts.scope, locale)} ${middleEllipsis(parts.sceneId)}`.trim(), kind: '' }
  return { name: middleEllipsis(key), kind: '' }
}

/**
 * Short key of a session for its tooltip / detail (never a name qualifier): the Host's `shortKey`
 * (zhin 第 58 批), else the first 8 hex digits of a hashed key, else the key shortened in the middle.
 */
export function sessionShortKey(row) {
  const own = label(row?.shortKey)
  const key = String(row?.sessionKey ?? '')
  if (own) return middleEllipsis(own, 24)
  const hashed = HASHED_KEY.exec(key)
  return hashed ? `${hashed[1]}:${hashed[2].slice(0, 8)}` : middleEllipsis(key, 24)
}

/**
 * Names of the AI scheduled tasks (`schedule:<id>` sessions) by id from `schedule:list` →
 * `persistent[]`: `label` when it is a real name (not the id), as the 定时任务 page shows it.
 * Rows without an id or a name are skipped.
 */
export function scheduleNamesFromList(data) {
  const names = new Map()
  for (const job of Array.isArray(data?.persistent) ? data.persistent : []) {
    const id = label(job?.id)
    const name = label(job?.label)
    if (id && name && name !== id && !names.has(id)) names.set(id, name)
  }
  return names
}

/**
 * A session row with the name of its scheduled task: for a `schedule:<id>` row whose task name is
 * known, `scopeKind: 'schedule'` and `sceneLabel: <name>` (unless the Host already sent a real
 * name); a `scopeKind` the Host sent is kept. Every other row unchanged.
 */
export function withScheduleName(row, names) {
  const id = scheduleIdOfKey(row?.sessionKey)
  const name = id && names ? names.get(id) : ''
  if (!name) return row
  const scene = label(row.sceneLabel)
  if (scene && scene !== id) return row
  // A kind the Host sent stays; only a row without one becomes a scheduled task.
  return { ...row, scopeKind: label(row.scopeKind) || 'schedule', sceneLabel: name }
}
