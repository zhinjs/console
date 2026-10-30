import { isPersonalSessionKey } from './personal-models-model.mjs'
import { translate } from '../i18n/locale.mjs'
const SCOPES = new Set(['private', 'group', 'channel'])
const validKey = key => {
  if (isPersonalSessionKey(key)) return true
  const parts = key.trim().split(':')
  return parts.length >= 4 && !!parts[0].trim() && !!parts[1].trim() && SCOPES.has(parts[2]) && !!parts.slice(3).join(':').trim()
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
    .map(row => ({ sessionKey: row.session_key, turns: row.turns, lastAt: row.last_started_at, lastStatus: typeof row.last_status === 'string' ? row.last_status : '' }))
}

/** Short past-time label, e.g. “5 分钟前”. */
export function relativeSince(timestamp, now = Date.now(), locale = 'zh-CN') {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000))
  if (seconds < 60) return translate(locale, '刚刚')
  if (seconds < 3600) return translate(locale, '{0} 分钟前', [Math.round(seconds / 60)])
  if (seconds < 86400) return translate(locale, '{0} 小时前', [Math.round(seconds / 3600)])
  return translate(locale, '{0} 天前', [Math.round(seconds / 86400)])
}
