export function logReadState({ readOnly, loaded, error, statsError, stats }) {
 return {
   logsKnown: loaded && !error,
   total: stats?.total ?? '—',
   canManage: !readOnly && loaded && stats !== null && !error && !statsError,
 }
}

/** Logs endpoints return HTTP 200 with a note when SystemLog is unavailable. */
export function logPayloadAvailability(payload) {
 const note = typeof payload.note === 'string' ? payload.note.trim() : ''
 return { available: !note, message: note ? `日志数据源暂不可用：${note}` : null }
}
