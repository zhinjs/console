import { translate } from '../i18n/locale.mjs'
import { isKeyOnlySessionKey, sessionKind } from '../utils/session-label.mjs'
const SCOPES = new Set(['private', 'group', 'channel'])
/**
 * Every Agent session the picker can open — and so every one the summary counts, so the two agree:
 * legacy `platform:endpoint:scope:sceneId` keys, hashed keys (`personal-session:v1:`,
 * `scene-task:v1:` …) and `schedule:<id>`.
 */
const validKey = key => {
  if (isKeyOnlySessionKey(key)) return true
  const parts = key.trim().split(':')
  return parts.length >= 4 && !!parts[0].trim() && !!parts[1].trim() && SCOPES.has(parts[2]) && !!parts.slice(3).join(':').trim()
}
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
    .map(row => ({ sessionKey: row.session_key, turns: row.turns, lastAt: row.last_started_at, lastStatus: typeof row.last_status === 'string' ? row.last_status : '', ...describedFields(row) }))
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
