import { listInboxCache } from '../../utils/inbox-cache'
import { normalizeInboundContent } from '../../utils/parseComposerContent'
import type { ConversationChannelType } from './types'
import { channelNameFromMessagePayload, pickLabel, toConsoleChannelParent } from './conversation-labels'
import { countUnreadSince, getLastReadAt } from './conversation-read-state'

export interface ConversationMeta {
  lastMessageAt: number
  lastMessagePreview: string
  messageTimestamps: number[]
}

export type ConversationMetaIndex = Map<string, ConversationMeta>
export type ConversationNameIndex = Map<string, string>

export function conversationKey(channelType: ConversationChannelType, channelId: string): string {
  return `${channelType}:${channelId}`
}

const PREVIEW_LABELS: Record<string, string> = {
  image: '[图片]',
  video: '[视频]',
  audio: '[语音]',
  face: '[表情]',
  at: '[@]',
  record: '[语音]',
  file: '[文件]',
}

export function previewFromMessageContent(
  raw: unknown,
  maxLen = 48,
): string {
  const segments = normalizeInboundContent(raw)
  if (!segments.length) return ''
  const parts: string[] = []
  for (const seg of segments) {
    if (seg.type === 'text') {
      const t = String(seg.data?.text ?? '').trim()
      if (t) parts.push(t)
    } else {
      parts.push(PREVIEW_LABELS[seg.type] ?? `[${seg.type}]`)
    }
  }
  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  if (!joined) return ''
  return joined.length > maxLen ? `${joined.slice(0, maxLen)}…` : joined
}

function upsertMeta(
  index: ConversationMetaIndex,
  channelType: ConversationChannelType,
  channelId: string,
  ts: number,
  preview: string,
): void {
  const key = conversationKey(channelType, channelId)
  const prev = index.get(key)
  const safeTs = Number(ts) || 0
  if (!prev) {
    index.set(key, {
      lastMessageAt: safeTs,
      lastMessagePreview: preview,
      messageTimestamps: safeTs ? [safeTs] : [],
    })
    return
  }
  if (!prev.messageTimestamps.includes(safeTs)) {
    prev.messageTimestamps.push(safeTs)
  }
  if (safeTs >= prev.lastMessageAt) {
    prev.lastMessageAt = safeTs
    if (preview) prev.lastMessagePreview = preview
  }
}

function upsertName(
  index: ConversationNameIndex,
  channelType: ConversationChannelType,
  channelId: string,
  name: string | undefined,
): void {
  const label = name?.trim()
  if (!label || channelType === 'private') return
  const key = conversationKey(channelType, channelId)
  index.set(key, label)
}

export function ingestInboxRow(
  index: ConversationMetaIndex,
  channelType: string,
  channelId: string,
  content: unknown,
  ts: number,
  nameIndex?: ConversationNameIndex,
  payload?: Record<string, unknown>,
): void {
  if (channelType !== 'private' && channelType !== 'group' && channelType !== 'channel') return
  const scope = channelType as ConversationChannelType
  const preview = previewFromMessageContent(content)
  upsertMeta(index, scope, String(channelId), ts, preview)
  if (nameIndex && payload) {
    const name = channelNameFromMessagePayload(payload, channelType)
    upsertName(nameIndex, scope, String(channelId), name)
  }
}

type SendRequestFn = <T>(req: { type: string; [key: string]: unknown }) => Promise<T>

export async function buildMetadataIndex(
  adapter: string,
  endpointId: string,
  sendRequest?: SendRequestFn,
): Promise<{ meta: ConversationMetaIndex; names: ConversationNameIndex }> {
  const index: ConversationMetaIndex = new Map()
  const names: ConversationNameIndex = new Map()

  if (sendRequest) {
    try {
      const result = await sendRequest<{
        rows: Array<{
          channel_id: string
          channel_type: string
          channel_name?: string | null
          channel_parent_type?: string | null
          channel_parent_id?: string | null
          content: string
          created_at: number
        }>
      }>({
        type: 'db:select',
        table: 'unified_inbox_message',
        page: 1,
        pageSize: 500,
        where: { adapter, endpoint_id: endpointId },
      })
      for (const row of result.rows ?? []) {
        let content: unknown = row.content
        try {
          content = JSON.parse(row.content)
        } catch {
          /* plain text */
        }
        const payload =
          typeof content === 'object' && content !== null && !Array.isArray(content)
            ? (content as Record<string, unknown>)
            : {}
        const channelName = pickLabel(
          row.channel_name,
          channelNameFromMessagePayload(payload, row.channel_type),
        )
        const parent = toConsoleChannelParent({
          type: row.channel_parent_type ?? undefined,
          id: row.channel_parent_id ?? undefined,
        })
        const displayName =
          row.channel_type === 'channel' && parent?.name && channelName && !channelName.includes(parent.name)
            ? `${parent.name} / ${channelName}`
            : channelName
        if (
          row.channel_type === 'private' ||
          row.channel_type === 'group' ||
          row.channel_type === 'channel'
        ) {
          upsertName(
            names,
            row.channel_type,
            String(row.channel_id),
            displayName,
          )
        }
        ingestInboxRow(
          index,
          row.channel_type,
          String(row.channel_id),
          content,
          row.created_at,
          names,
          payload,
        )
      }
    } catch {
      /* inbox DB not available */
    }
  }

  const cached = await listInboxCache(adapter, endpointId, 'message')
  for (const rec of cached) {
    const d = rec.payload
    const channelId = String(d.channelId ?? d.channel_id ?? '')
    const channelType = String(d.channelType ?? d.channel_type ?? 'private')
    const ts = Number(d.timestamp ?? rec.updatedAt)
    const name = channelNameFromMessagePayload(d, channelType)
    if (name) {
      upsertName(names, channelType as ConversationChannelType, channelId, name)
    }
    ingestInboxRow(index, channelType, channelId, d.content, ts, names, d)
  }

  return { meta: index, names }
}

export function unreadCountForConversation(
  adapter: string,
  endpointId: string,
  channelType: ConversationChannelType,
  channelId: string,
  meta: ConversationMeta | undefined,
): number {
  const lastRead = getLastReadAt(adapter, endpointId, channelType, channelId)
  return meta ? countUnreadSince(meta.messageTimestamps, lastRead) : 0
}
