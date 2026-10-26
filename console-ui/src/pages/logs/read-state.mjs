import { translate } from '../../i18n/locale.mjs'
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
