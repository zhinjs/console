/**
 * Pure rules of the 聊天 tab (account and conversation level): which conversation the URL asks for,
 * which pane a phone shows, whether a composer may exist, how consecutive messages group, and what a
 * message sent from the Console is known to have done. Shared by the components and the tests.
 */
import { outcomeUnknown, statusFromError } from '../../components/status-state-model.mjs'

/** `?conversation=<kind>:<id>` on the account page's 聊天 tab. */
export const CHAT_CONVERSATION_PARAM = 'conversation'
/** `?inbox=requests|notices` on the account page's 聊天 tab. */
export const CHAT_INBOX_PARAM = 'inbox'

const KINDS = Object.freeze(['private', 'group', 'channel'])
const INBOX_VIEWS = Object.freeze(['requests', 'notices'])

/**
 * What the URL asks the account chat to show: `{ type: 'channel', channelType, id }`,
 * `{ type: 'requests' | 'notices' }` or null. A malformed conversation is ignored (the list stays).
 */
export function readChatRequest(params) {
  const raw = params?.get?.(CHAT_CONVERSATION_PARAM)
  if (typeof raw === 'string' && raw) {
    const split = raw.indexOf(':')
    const kind = raw.slice(0, split), id = raw.slice(split + 1)
    if (split > 0 && KINDS.includes(kind) && id) return { type: 'channel', channelType: kind, id }
    return null
  }
  const inbox = params?.get?.(CHAT_INBOX_PARAM)
  return INBOX_VIEWS.includes(inbox) ? { type: inbox } : null
}

/** Comparable identity of a request or a selection (`channel:<kind>:<id>`, `requests`, `notices`, null). Parent is not part of the URL. */
export function chatRequestKey(value) {
  if (!value) return null
  if (value.type === 'channel') return KINDS.includes(value.channelType) && value.id ? `channel:${value.channelType}:${value.id}` : null
  return INBOX_VIEWS.includes(value.type) ? value.type : null
}

/** Query with the chat request written in (other parameters, e.g. `tab`, are kept). */
export function writeChatRequest(params, value) {
  const next = new URLSearchParams(params ?? undefined)
  next.delete(CHAT_CONVERSATION_PARAM)
  next.delete(CHAT_INBOX_PARAM)
  if (value?.type === 'channel' && KINDS.includes(value.channelType) && value.id) next.set(CHAT_CONVERSATION_PARAM, `${value.channelType}:${value.id}`)
  else if (INBOX_VIEWS.includes(value?.type)) next.set(CHAT_INBOX_PARAM, value.type)
  return next
}

/**
 * Pane a phone shows (list → chat → details): the account chat shows its list until something is
 * selected; a conversation's own chat has no list. Wider screens show both and ignore this.
 */
export function chatPane(mode, selection) {
  if (mode === 'conversation') return 'chat'
  return selection ? 'chat' : 'list'
}

/**
 * Whether this conversation gets a message box. Without `endpoint.operate`, or while the account is
 * known to be offline, there is no input at all (only the reason); an unknown connection state does
 * not block, the Host answers the send.
 */
export function composerAvailability({ canOperate, connected }) {
  if (!canOperate) return { mode: 'notice', reason: 'read-only' }
  if (connected === false) return { mode: 'notice', reason: 'offline' }
  return { mode: 'compose' }
}

/** Authored copy of the composer notices (displayed through i18n). */
export const COMPOSER_NOTICE_COPY = Object.freeze({
  'read-only': '当前身份只能读取消息记录，不提供消息编辑器。',
  offline: '账号离线，暂时不能发送消息。账号恢复在线后输入框会出现。',
})

/** Messages closer than this, from the same sender and direction, share one header. */
export const CONTINUATION_WINDOW_MS = 5 * 60 * 1000

const senderOf = row => (row.outgoing ? 'self' : String(row.sender?.id ?? row.sender?.name ?? ''))

/**
 * One flag per row: true when the row continues the previous one (same direction and sender,
 * same day, within {@link CONTINUATION_WINDOW_MS}) so its name and time line can be left out.
 * A row after one with a delivery problem always starts a new group.
 */
export function continuationFlags(rows, dayOf = timestamp => new Date(timestamp).toDateString()) {
  return rows.map((row, index) => {
    const previous = rows[index - 1]
    if (!previous) return false
    if (!!previous.outgoing !== !!row.outgoing || senderOf(previous) !== senderOf(row)) return false
    if (previous.directionUnknown || row.directionUnknown) return false
    if (previous.delivery === 'failed' || previous.delivery === 'unknown') return false
    if (dayOf(previous.timestamp) !== dayOf(row.timestamp)) return false
    return row.timestamp - previous.timestamp >= 0 && row.timestamp - previous.timestamp <= CONTINUATION_WINDOW_MS
  })
}

/**
 * What is known about a message sent from the Console, from the send receipt only:
 * - `sending`  请求已发出，还没有答复
 * - `sent`     Host 返回了平台消息 ID：已交给平台（是否送达以平台为准）
 * - `accepted` Host 接受了请求但没有消息 ID：无法与平台记录对应
 * - `unknown`  超时或断连：可能已经发出，不能重发
 * - `failed`   Host 明确拒绝：没有发出
 * There is no 「生成中」 here: the endpoint send has no generation phase to report.
 */
export const DELIVERY_STATES = Object.freeze(['sending', 'sent', 'accepted', 'unknown', 'failed'])

/** Authored label / explanation per state (displayed through i18n). */
export const DELIVERY_COPY = Object.freeze({
  sending: Object.freeze({ label: '发送中', title: '请求已发出，正在等待 Host 答复。' }),
  sent: Object.freeze({ label: '已发送', title: 'Host 已把消息交给平台并返回了消息 ID；是否送达以平台为准。' }),
  accepted: Object.freeze({ label: '已提交', title: 'Host 接受了发送请求，但没有返回消息 ID，无法与平台记录对应。' }),
  unknown: Object.freeze({ label: '结果未知', title: '请求已发出，但没有收到可信的答复，消息可能已经发出。先在会话里核对，不要直接重发。' }),
  failed: Object.freeze({ label: '未发送', title: 'Host 拒绝了这次发送，消息没有发出。' }),
})

/** State after the send RPC answered. */
export function deliveryAfterSend(response) {
  return typeof response?.messageId === 'string' && response.messageId ? 'sent' : 'accepted'
}

/** State after the send RPC failed: `unknown` when it may have been applied (never replay it), else `failed`. */
export function deliveryAfterError(error) {
  return outcomeUnknown(statusFromError(error)) ? 'unknown' : 'failed'
}
