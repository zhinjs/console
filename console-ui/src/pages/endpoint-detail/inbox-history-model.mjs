import { readRendering, readMessagePush } from './rendering-diagnostics.mjs'
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

/** The public RPC projects storage fields; the browser consumes only that contract. */
export function readMessageHistory(payload) {
  return read(payload, 'messages').map(row => {
    if (!row.sender || typeof row.sender.id !== 'string' || row.sender.name !== undefined && typeof row.sender.name !== 'string'
      || typeof row.platformMessageId !== 'string' || !Number.isFinite(new Date(row.timestamp).getTime())
      || !['private','group','channel'].includes(row.channel.type)
      || row.channel.parent && (!['group','guild'].includes(row.channel.parent.type) || typeof row.channel.parent.id !== 'string')) throw new Error('消息历史信息格式不正确。')
    if (row.direction !== undefined && !['inbound','outbound'].includes(row.direction)) throw new Error('消息历史方向格式不正确。')
    if (row.conversation !== undefined && (!readMessagePush({...row, messageId:row.platformMessageId})
      || row.conversation.kind !== row.channel.type || row.conversation.id !== row.channel.id)) throw new Error('消息历史会话标识格式不正确。')
    let rendering, renderingError
    try { rendering = readRendering(row.rendering) } catch (error) { renderingError = error.message }
    return { id:row.id, platformMessageId:row.platformMessageId, sender:{...row.sender}, content:row.content,
      raw:row.raw, timestamp:row.timestamp, channel:{...row.channel, ...(row.channel.parent ? {parent:{...row.channel.parent}} : {})},
      direction:row.direction, conversation:row.conversation, rendering, renderingError }
  }).sort((left,right) => left.timestamp-right.timestamp || left.id-right.id)
}
