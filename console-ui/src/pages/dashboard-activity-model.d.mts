export interface PreviewLabels {
  image: string
  audio: string
  video: string
  file: string
  sticker: string
}
export declare const DEFAULT_PREVIEW_LABELS: Readonly<PreviewLabels>

export interface MessageRecord {
  id: string
  eventId: number
  direction: 'inbound' | 'outbound'
  timestamp: number
  adapter: string
  endpoint: string
  kind: string
  channelId: string
  conversationKey: string
  sender: { id: string; name: string } | null
  text: string
}

export interface MessageReply {
  id: string
  text: string
  timestamp: number
}

export interface MessageFeedItem extends MessageRecord {
  replies: MessageReply[]
}

export interface HourlyActivityBucket {
  start: number
  inbound: number
  outbound: number
}

export interface MessageSummary {
  inbound: number
  outbound: number
  conversations: number
  senders: number
}

export function messagePreview(content: unknown, labels?: PreviewLabels): string
export function toMessageRecord(event: unknown, labels?: PreviewLabels): MessageRecord | null
export function messageRecords(events: readonly unknown[] | null | undefined, labels?: PreviewLabels): MessageRecord[]
export function hourlyMessageActivity(records: readonly MessageRecord[], now: number, hours?: number): HourlyActivityBucket[]
export function summarizeMessages(records: readonly MessageRecord[], since: number): MessageSummary
export function buildMessageFeed(records: readonly MessageRecord[], limit?: number): MessageFeedItem[]
export function replyLatencySeconds(item: MessageFeedItem): number | null
