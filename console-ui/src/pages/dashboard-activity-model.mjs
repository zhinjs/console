/**
 * Message activity derived from the Host's bounded Console event journal
 * (`message.receive`). Pure functions: no fetch, no React, no clock reads.
 */

const HOUR_MS = 60 * 60 * 1000

/** Placeholder labels for non-text segments; callers may pass translated copies. */
export const DEFAULT_PREVIEW_LABELS = Object.freeze({
  image: '[图片]',
  audio: '[语音]',
  video: '[视频]',
  file: '[文件]',
  sticker: '[表情]',
})
const REPLY_PAIR_WINDOW_MS = 2 * 60 * 1000

/** Readable one-line preview of message content (string, segment array or unknown). */
export function messagePreview(content, labels = DEFAULT_PREVIEW_LABELS) {
  if (content == null) return ''
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content.map((segment) => segmentPreview(segment, labels)).filter(Boolean).join(' ').trim()
  }
  if (typeof content === 'object') return segmentPreview(content, labels)
  return String(content)
}

function segmentPreview(segment, labels) {
  if (typeof segment === 'string') return segment
  if (!segment || typeof segment !== 'object') return ''
  const type = String(segment.type ?? 'text')
  const data = segment.data && typeof segment.data === 'object' ? segment.data : {}
  switch (type) {
    case 'text':
      return String(data.text ?? data.content ?? '')
    case 'markdown':
    case 'md':
      return String(data.content ?? data.text ?? '')
    case 'image':
      return labels.image
    case 'audio':
    case 'record':
      return labels.audio
    case 'video':
      return labels.video
    case 'file':
      return labels.file
    case 'face':
    case 'sticker':
      return labels.sticker
    case 'mention':
    case 'at': {
      const name = data.name ?? data.target ?? data.id ?? data.qq
      return name ? `@${name}` : '@'
    }
    case 'reply':
      return ''
    default:
      return data.text || data.content ? String(data.text ?? data.content) : `[${type}]`
  }
}

function readSender(sender) {
  if (!sender || typeof sender !== 'object') return null
  const id = sender.id == null ? '' : String(sender.id)
  const name = typeof sender.name === 'string' && sender.name.trim()
    ? sender.name.trim()
    : typeof sender.nickname === 'string' && sender.nickname.trim() ? sender.nickname.trim() : ''
  if (!id && !name) return null
  return { id, name }
}

/** Normalizes one Console event envelope into a message record, or null when it is not a message. */
export function toMessageRecord(event, labels = DEFAULT_PREVIEW_LABELS) {
  if (!event || event.type !== 'message.receive' || !event.data || typeof event.data !== 'object') return null
  const data = event.data
  const direction = data.direction === 'outbound' ? 'outbound' : data.direction === 'inbound' ? 'inbound' : null
  if (!direction) return null
  const timestamp = Number.isFinite(data.timestamp) ? data.timestamp : Number.isFinite(event.timestamp) ? event.timestamp : 0
  const conversation = data.conversation && typeof data.conversation === 'object' ? data.conversation : null
  const adapter = String(conversation?.endpoint?.adapter ?? data.adapter ?? '')
  const endpoint = String(data.endpointKey ?? '')
  const kind = String(conversation?.kind ?? data.channelType ?? '')
  const channelId = String(conversation?.id ?? data.channelId ?? '')
  return {
    id: `${event.runtimeId ?? ''}:${event.eventId ?? `${timestamp}:${data.messageId ?? ''}`}`,
    eventId: Number.isFinite(event.eventId) ? event.eventId : 0,
    direction,
    timestamp,
    adapter,
    endpoint,
    kind,
    channelId,
    conversationKey: `${adapter}\u0000${endpoint}\u0000${kind}\u0000${channelId}`,
    sender: direction === 'inbound' ? readSender(data.sender) : null,
    text: messagePreview(data.content, labels),
  }
}

/** Message records in journal order, de-duplicated by event identity. */
export function messageRecords(events, labels = DEFAULT_PREVIEW_LABELS) {
  const seen = new Set()
  const records = []
  for (const event of events ?? []) {
    const record = toMessageRecord(event, labels)
    if (!record || seen.has(record.id)) continue
    seen.add(record.id)
    records.push(record)
  }
  return records.sort((a, b) => a.timestamp - b.timestamp || a.eventId - b.eventId)
}

/**
 * Hourly inbound/outbound counts for the `hours` hours ending at `now`.
 * The last bucket is the current (partial) hour.
 */
export function hourlyMessageActivity(records, now, hours = 24) {
  const currentHour = Math.floor(now / HOUR_MS) * HOUR_MS
  const first = currentHour - (hours - 1) * HOUR_MS
  const buckets = Array.from({ length: hours }, (_, index) => ({ start: first + index * HOUR_MS, inbound: 0, outbound: 0 }))
  for (const record of records) {
    if (record.timestamp < first || record.timestamp > now) continue
    const index = Math.floor((record.timestamp - first) / HOUR_MS)
    const bucket = buckets[index]
    if (bucket) bucket[record.direction] += 1
  }
  return buckets
}

/** Totals over records newer than `since`. */
export function summarizeMessages(records, since) {
  let inbound = 0
  let outbound = 0
  const conversations = new Set()
  const senders = new Set()
  for (const record of records) {
    if (record.timestamp < since) continue
    if (record.direction === 'inbound') {
      inbound += 1
      if (record.sender?.id) senders.add(`${record.adapter}\u0000${record.sender.id}`)
    } else {
      outbound += 1
    }
    conversations.add(record.conversationKey)
  }
  return { inbound, outbound, conversations: conversations.size, senders: senders.size }
}

/**
 * Newest-first feed: each inbound message carries the replies sent to the same
 * conversation close to it. Unpaired outbound messages stand alone.
 */
export function buildMessageFeed(records, limit = 20) {
  const inbound = records.filter((record) => record.direction === 'inbound')
  const replies = new Map()
  const standalone = []
  for (const record of records) {
    if (record.direction !== 'outbound') continue
    let best = null
    for (const candidate of inbound) {
      if (candidate.conversationKey !== record.conversationKey) continue
      const distance = Math.abs(record.timestamp - candidate.timestamp)
      if (distance > REPLY_PAIR_WINDOW_MS) continue
      // Prefer the latest inbound message at or before the reply; fall back to the nearest one.
      const before = candidate.timestamp <= record.timestamp
      if (!best
        || (before && !best.before)
        || (before === best.before && (before ? candidate.timestamp > best.record.timestamp : distance < best.distance))) {
        best = { record: candidate, before, distance }
      }
    }
    if (best) {
      const list = replies.get(best.record.id) ?? []
      list.push({ id: record.id, text: record.text, timestamp: record.timestamp })
      replies.set(best.record.id, list)
    } else {
      standalone.push(record)
    }
  }
  const items = [
    ...inbound.map((record) => ({ ...record, replies: replies.get(record.id) ?? [] })),
    ...standalone.map((record) => ({ ...record, replies: [] })),
  ]
  return items
    .sort((a, b) => b.timestamp - a.timestamp || b.eventId - a.eventId)
    .slice(0, limit)
}

/** Seconds between an inbound message and its first reply, when known. */
export function replyLatencySeconds(item) {
  if (item.direction !== 'inbound' || item.replies.length === 0) return null
  const first = Math.min(...item.replies.map((reply) => reply.timestamp))
  const seconds = (first - item.timestamp) / 1000
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null
}
