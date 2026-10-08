export function pendingRequestKey(row) { return row.platformRequestId ? `platform:${row.platformRequestId}` : `row:${row.id}` }
export function readPendingRequests(payload) {
  if (!payload || !Array.isArray(payload.requests) || !['endpoint', 'inbox'].includes(payload.source) || typeof payload.inboxEnabled !== 'boolean') throw new Error('待处理请求响应格式不正确。')
  return payload.requests.map(row => {
    if (!row || typeof row.platformRequestId !== 'string' || !row.platformRequestId || !row.actor || typeof row.actor.id !== 'string' || typeof row.type !== 'string' || !row.channel || typeof row.channel.id !== 'string' || typeof row.channel.type !== 'string' || !Number.isFinite(row.timestamp) || (row.id !== undefined && !Number.isSafeInteger(row.id)) || (payload.source === 'inbox' && !Number.isSafeInteger(row.id))) throw new Error('待处理请求信息格式不正确。')
    return {id:row.id, platformRequestId:row.platformRequestId, type:row.type, sender:row.actor, comment:row.comment ?? '', channel:row.channel, timestamp:row.timestamp, canAct:false}
  })
}
