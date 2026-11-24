import { translate } from '../i18n/locale.mjs'
import { isKeyOnlySessionKey, parseImConversationKey, sessionKind } from '../utils/session-label.mjs'
import { sessionRowOrigin } from './scope/records-model.mjs'
/**
 * Every Agent session the picker can open — and so every one the summary counts, so the two agree:
 * legacy `platform:endpoint:scope:sceneId` keys, hashed keys (`personal-session:v1:`,
 * `scene-task:v1:` …) and `schedule:<id>`.
 */
const validKey = key => isKeyOnlySessionKey(key) || parseImConversationKey(key) !== null
const text = value => (typeof value === 'string' && value.trim() ? value.trim() : '')
/** What a newer Host may send next to the key (snake_case like the archive, or camelCase); only present fields are kept. */
function describedFields(row) {
  const fields = {
    platform: text(row.platform),
    scopeKind: text(row.scope_kind) || text(row.scopeKind),
    sceneLabel: text(row.scene_label) || text(row.sceneLabel),
    displayName: text(row.display_name) || text(row.displayName),
  }
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value))
}

/**
 * The group a row is about: from the origin the Host recorded (zhin 1.10), else from an address key
 * (`platform:endpoint:group:id`). `name` is the group name the record kept, '' when it kept none.
 */
function groupOfRow(row) {
  const origin = sessionRowOrigin(row)
  if (origin?.im && origin.kind === 'group' && origin.id) return { adapter: origin.adapter, id: origin.id, name: origin.name ?? '' }
  const parsed = parseImConversationKey(row.session_key)
  return parsed?.kind === 'group' ? { adapter: parsed.platform, id: parsed.id, name: '' } : null
}

/** No kind yet, or a group: the only rows a group name may be given to. */
const groupKind = kind => !kind || kind === 'group'

/** A row with what it says about its group: `group` (adapter and id), and the recorded name as its scene label. */
function withGroupFields(fields, row) {
  const group = groupOfRow(row)
  // A row the Host calls something other than a group (`scope_kind`) is not named as one.
  if (!group || !groupKind(fields.scopeKind)) return fields
  const named = !fields.sceneLabel && group.name ? { platform: fields.platform || group.adapter, scopeKind: fields.scopeKind || 'group', sceneLabel: group.name } : {}
  return { ...fields, ...named, group: { adapter: group.adapter, id: group.id } }
}

/** The group name a row shows (scene label, else the name part of 「平台 · 群 名称」), '' when it shows only the number. */
function shownGroupName(row) {
  const scene = typeof row.sceneLabel === 'string' ? row.sceneLabel.trim() : ''
  if (scene) return scene === row.group.id ? '' : scene
  const display = typeof row.displayName === 'string' ? /^.+? · 群(?: (.+))?$/u.exec(row.displayName.trim()) : null
  return display?.[1] && display[1] !== row.group.id ? display[1] : ''
}

/**
 * Whether a group in the list shows only its number (#64 `session-group-name-missing`: older traces kept
 * no `conversation.name`), so the page should read the group lists for its name.
 */
export function sessionsNeedingGroupNames(rows) {
  return (Array.isArray(rows) ? rows : []).some(row => row?.group && groupKind(row.scopeKind) && !shownGroupName(row))
}

/**
 * Rows whose group shows only its number get the name the adapter has now (`names`: 「平台:群号」 →
 * 群名, from the group lists); a name the record has is kept, and groups in no list keep the number.
 */
export function withGroupNames(rows, names) {
  if (!names || names.size === 0) return rows
  return rows.map(row => {
    if (!row.group || !groupKind(row.scopeKind) || shownGroupName(row)) return row
    const name = names.get(`${row.group.adapter}:${row.group.id}`)
    return name ? { ...row, platform: row.platform || row.group.adapter, scopeKind: row.scopeKind || 'group', sceneLabel: name } : row
  })
}

/**
 * Host trace-archive session rows → recent conversations, newest first.
 * Malformed rows are dropped rather than failing the page: this list only helps choose a session.
 */
export function readRecentSessions(body, limit = 12) {
  const rows = body?.success === true && Array.isArray(body.data) ? body.data : []
  const seen = new Set()
  return rows
    .filter(row => row && typeof row.session_key === 'string' && validKey(row.session_key)
      && Number.isFinite(row.last_started_at) && Number.isInteger(row.turns) && row.turns >= 0)
    .sort((a, b) => b.last_started_at - a.last_started_at)
    .filter(row => !seen.has(row.session_key) && seen.add(row.session_key))
    .slice(0, limit)
    .map(row => ({ sessionKey: row.session_key, turns: row.turns, lastAt: row.last_started_at, lastStatus: typeof row.last_status === 'string' ? row.last_status : '', ...withGroupFields(describedFields(row), row) }))
}

const DAY_MS = 24 * 60 * 60 * 1000
const FAILED_STATUSES = new Set(['failed', 'error'])

/**
 * Totals over every archived session the picker can list (not just its recent slice).
 * The kinds come from what the rows carry (`scope_kind` / `scopeKind`), else the key's shape
 * (`sessionKind`: `scene-task:` ⇒ group, `personal-session:` ⇒ private): `groups` (group chats and
 * channels), `privates`, and `others` for scheduled tasks, HTTP / A2A sessions and unknown kinds —
 * never silently counted as a group or private chat.
 * Returns null when the archive could not be read, so callers show “unknown”, not zero.
 */
export function summarizeRecentSessions(body, now = Date.now()) {
  if (body?.success !== true || !Array.isArray(body.data)) return null
  const latest = new Map()
  for (const row of body.data) {
    if (!row || typeof row.session_key !== 'string' || !validKey(row.session_key)) continue
    if (!Number.isFinite(row.last_started_at) || !Number.isInteger(row.turns) || row.turns < 0) continue
    const previous = latest.get(row.session_key)
    if (!previous || row.last_started_at > previous.last_started_at) latest.set(row.session_key, row)
  }
  let turns = 0, active = 0, groups = 0, privates = 0, others = 0, failed = 0
  for (const row of latest.values()) {
    turns += row.turns
    if (now - row.last_started_at <= DAY_MS) active += 1
    if (FAILED_STATUSES.has(String(row.last_status ?? '').toLowerCase())) failed += 1
    const kind = sessionKind({ sessionKey: row.session_key, ...describedFields(row) })
    if (kind === 'group' || kind === 'channel') groups += 1
    else if (kind === 'private') privates += 1
    else others += 1
  }
  return { sessions: latest.size, turns, active, groups, privates, others, failed }
}

/** Short past-time label, e.g. “5 分钟前”. */
export function relativeSince(timestamp, now = Date.now(), locale = 'zh-CN') {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return translate(locale, '刚刚')
  if (seconds < 3600) return translate(locale, '{0} 分钟前', [Math.round(seconds / 60)])
  if (seconds < 86400) return translate(locale, '{0} 小时前', [Math.round(seconds / 3600)])
  return translate(locale, '{0} 天前', [Math.round(seconds / 86400)])
}
