import { translate } from '../../i18n/locale.mjs'
import { httpRouteAccess } from '../../utils/http-permission.mjs'
export function logReadState({ readOnly, loaded, error, statsError, stats }) {
 return {
   logsKnown: loaded && !error,
   total: stats?.total ?? '—',
   canManage: !readOnly && loaded && stats !== null && !error && !statsError,
 }
}

/** Logs endpoints return HTTP 200 with a note when SystemLog is unavailable. */
export function logPayloadAvailability(payload, locale = 'zh-CN') {
 const note = typeof payload.note === 'string' ? payload.note.trim() : ''
 return { available: !note, message: note ? translate(locale, "日志数据源暂不可用：{0}", [note]) : null }
}

/** The requests 「清理」 and 「清空」 send. */
const LOG_MANAGE_ROUTES = Object.freeze([['DELETE', '/logs'], ['POST', '/logs/cleanup']])

/**
 * Whether the current identity may clean up or clear logs (`has` checks one permission): exactly when the
 * Host accepts DELETE /logs and POST /logs/cleanup per the protocol table (`ops.database.write` in 1.10),
 * not `ops.config.write` (#64 `logs-manage-permission-mismatch`). `missing` lists what it lacks.
 */
export function logManageAccess(has) {
  const results = LOG_MANAGE_ROUTES.map(([method, path]) => httpRouteAccess(method, path, has))
  return {
    allowed: results.every(result => result.allowed),
    missing: [...new Set(results.flatMap(result => result.missing ? [result.missing] : []))],
  }
}
