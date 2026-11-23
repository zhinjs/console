import { translate } from '../i18n/locale.mjs'
import { diagnosticConversationKey, validDiagnosticConversation } from './endpoint-detail/message-diagnostics.mjs'
import { unwrapComponentOutput } from './introspection/component-output.mjs'

const record = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0
const sequence = value => Number.isSafeInteger(value) && value >= 0
const timestamp = value => Number.isFinite(value) && Number.isFinite(new Date(value).getTime())

export function conversationHistoryQuery(sessionKey, beforeSequence, connectionId) {
  const params = new URLSearchParams({ sessionKey })
  if (beforeSequence !== undefined) params.set('beforeSequence', String(beforeSequence))
  if (typeof connectionId === 'string' && connectionId.trim()) params.set('connectionId', connectionId.trim())
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
  if (status === 404) return { kind: '404', message: body?.code === 'history_not_recorded'
    ? translate(locale, '尚无可读取的聊天记录。') : translate(locale, '尚无可读取的聊天记录，或当前 Host 尚不支持此功能。') }
  if (status === 409) return { kind: 'other', message: translate(locale, '此会话对应多个频道或话题，无法准确读取。') }
  if (status === 503) return { kind: '503', message: translate(locale, '聊天记录暂不可用，请稍后重试。') }
  if (status === 400) return { kind: 'other', message: translate(locale, '会话标识或分页参数无效。') }
  if (status === 403) return { kind: 'other', message: translate(locale, '当前身份无权读取聊天记录。') }
  return { kind: 'other', message: typeof body?.error === 'string' ? body.error : translate(locale, '聊天记录读取失败（HTTP {0}）。', [status]) }
}

const RAW_CONTENT = 'zhin.raw-content/1'
const isSegment = value => record(value) && text(value.type) && record(value.data)
const isEnvelope = value => record(value) && value.$content === RAW_CONTENT && Object.hasOwn(value, 'payload')

/** The segments a raw-content envelope wraps, or null when it wraps something else. */
function wrappedSegments(value) {
  const unwrapped = unwrapComponentOutput(value)
  const items = Array.isArray(unwrapped) ? unwrapped : [unwrapped]
  if (!items.length) return null
  const segments = items.map(item => typeof item === 'string' ? { type: 'text', data: { text: item } } : isSegment(item) ? item : null)
  return segments.every(Boolean) ? segments : null
}

/**
 * Message segments as the history view should show them (#64 `history-raw-content-json`): a reply
 * stored as a `zhin.raw-content/1` envelope — as a text segment holding its JSON, or as a segment whose
 * data is the envelope — becomes the segments it wraps (an image stays an image instead of screens of
 * base64). Anything that is not such an envelope, or wraps something else, is kept as it was.
 */
export function expandRawContentSegments(segments) {
  if (!Array.isArray(segments)) return []
  return segments.flatMap(segment => {
    let envelope = null
    if (record(segment) && isEnvelope(segment.data)) envelope = segment.data
    else if (record(segment) && segment.type === 'text' && typeof segment.data?.text === 'string') {
      const value = segment.data.text.trim()
      if (value.startsWith('{') && value.includes(RAW_CONTENT)) {
        try { const parsed = JSON.parse(value); if (isEnvelope(parsed)) envelope = parsed } catch { /* plain text */ }
      }
    }
    return (envelope && wrappedSegments(envelope)) || [segment]
  })
}
