function read(payload, key) {
  if (!payload || typeof payload.inboxEnabled !== 'boolean' || !Array.isArray(payload[key])) throw new Error('历史记录响应格式不正确。')
  if (!payload.inboxEnabled && payload[key].length) throw new Error('历史记录可用状态不一致。')
  return payload[key].map(row => {
    if (!row || !Number.isSafeInteger(row.id) || !Number.isFinite(row.timestamp) || !row.channel || typeof row.channel.id !== 'string' || typeof row.channel.type !== 'string') throw new Error('历史记录信息格式不正确。')
    return row
  })
}
export function readRequestHistory(payload) {
  return read(payload, 'requests').map(row => {
    if (!row.actor || typeof row.actor.id !== 'string' || typeof row.platformRequestId !== 'string' || typeof row.type !== 'string' || typeof row.resolved !== 'boolean') throw new Error('请求历史信息格式不正确。')
    return {id:row.id,platform_request_id:row.platformRequestId,type:row.type,sub_type:row.subType ?? null,channel_id:row.channel.id,channel_type:row.channel.type,sender_id:row.actor.id,sender_name:row.actor.name ?? null,comment:row.comment ?? null,created_at:row.timestamp,resolved:Number(row.resolved),resolved_at:row.resolvedAt ?? null}
  })
}
export function readNoticeHistory(payload) {
  return read(payload, 'notices').map(row => {
    if (typeof row.platformNoticeId !== 'string' || typeof row.noticeType !== 'string' || typeof row.payload !== 'string') throw new Error('通知历史信息格式不正确。')
    return {id:row.id,platform_notice_id:row.platformNoticeId,type:row.noticeType,sub_type:row.subType ?? null,channel_id:row.channel.id,channel_type:row.channel.type,operator_id:row.operator?.id ?? null,operator_name:row.operator?.name ?? null,target_id:row.target?.id ?? null,target_name:row.target?.name ?? null,payload:row.payload,created_at:row.timestamp}
  })
}
export function mergeHistoryRows(previous, incoming) { return [...new Map([...previous,...incoming].map(row=>[row.id,row])).values()] }
