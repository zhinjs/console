import { translate } from '../i18n/locale.mjs'
import { diagnosticConversationKey, validDiagnosticConversation } from './endpoint-detail/message-diagnostics.mjs'

const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0
const sequence = value => Number.isSafeInteger(value) && value >= 0
const timestamp = value => Number.isFinite(value) && Number.isFinite(new Date(value).getTime())

export function conversationHistoryQuery(sessionKey, beforeSequence) {
  const params = new URLSearchParams({ sessionKey })
  if (beforeSequence !== undefined) params.set('beforeSequence', String(beforeSequence))
  return `/api/conversations/history?${params}`
}

/** Bind every message and subsequent page to the complete identity returned by the Host. */
export function readConversationHistory(body, expectedConversation, beforeSequence, locale = 'zh-CN') {
  const fail = () => { throw new Error(translate(locale, '聊天记录响应格式不正确。')) }
  const data = body?.data
  if (body?.success !== true || !validDiagnosticConversation(data?.conversation)
    || !Array.isArray(data.items) || data.items.length > 50 || typeof data.hasMore !== 'boolean'
    || data.nextBeforeSequence !== null && !sequence(data.nextBeforeSequence)) fail()
  const conversation = data.conversation
  const key = diagnosticConversationKey(conversation)
  if (expectedConversation && diagnosticConversationKey(expectedConversation) !== key) fail()
  let previous = -1
  const items = data.items.map(item => {
    if (!record(item) || !sequence(item.sequence) || item.sequence <= previous || !text(item.type) || !timestamp(item.timestamp)
      || beforeSequence !== undefined && item.sequence >= beforeSequence) fail()
    previous = item.sequence
    const result = { sequence: item.sequence, type: item.type, timestamp: item.timestamp }
    if (item.type === 'message.created') {
      const message = item.message
      if (!record(message) || !text(message.ref?.id) || diagnosticConversationKey(message.ref?.conversation) !== key
        || !timestamp(message.timestamp) || !Array.isArray(message.segments)
        || !message.segments.every(segment => record(segment) && text(segment.type) && record(segment.data))
        || message.contentStatus !== undefined && message.contentStatus !== 'unavailable'
        || message.actor !== undefined && (!record(message.actor) || !text(message.actor.id)
          || message.actor.displayName !== undefined && typeof message.actor.displayName !== 'string')) fail()
      result.message = message
    }
    if (item.type === 'message.recalled' && item.messageRef !== undefined) {
      if (!text(item.messageRef?.id) || diagnosticConversationKey(item.messageRef?.conversation) !== key) fail()
      result.messageRef = item.messageRef
    }
    return result
  })
  if (data.hasMore && (!items.length || data.nextBeforeSequence !== items[0].sequence)
    || !data.hasMore && data.nextBeforeSequence !== null) fail()
  return { conversation, items, hasMore: data.hasMore, nextBeforeSequence: data.nextBeforeSequence }
}

/** All events advance the cursor, including events that do not appear in the reading view. */
export function prependConversationHistory(current, earlier) {
  return { ...earlier, items: [...earlier.items, ...(current?.items ?? [])] }
}

export function conversationHistoryFailure(status, body, locale = 'zh-CN') {
  if (status === 404) return { kind: '404', message: translate(locale, body?.code === 'history_not_recorded'
    ? '尚无可读取的聊天记录。' : '尚无可读取的聊天记录，或当前 Host 尚不支持此功能。') }
  if (status === 409) return { kind: 'other', message: translate(locale, '此会话对应多个频道或话题，无法准确读取。') }
  if (status === 503) return { kind: '503', message: translate(locale, '聊天记录暂不可用，请稍后重试。') }
  if (status === 400) return { kind: 'other', message: translate(locale, '会话标识或分页参数无效。') }
  if (status === 403) return { kind: 'other', message: translate(locale, '当前身份无权读取聊天记录。') }
  return { kind: 'other', message: typeof body?.error === 'string' ? body.error : translate(locale, '聊天记录读取失败（HTTP {0}）。', [status]) }
}
