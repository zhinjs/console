export interface EndpointInfo {
  name: string
  adapter: string
  connected: boolean
  status: 'online' | 'offline'
}

export interface ReqItem {
  id: number
  platformRequestId: string
  type: string
  sender: { id: string; name: string }
  comment: string
  channel: { id: string; type: string }
  timestamp: number
  canAct?: boolean
}

export interface NoticeItem {
  id: number
  noticeType: string
  channel: { id: string; type: string }
  payload: string
  timestamp: number
}

export interface ReceivedMessage {
  id: string
  channelId: string
  channelType: string
  sender: { id: string; name?: string }
  content: Array<{ type: string; data?: Record<string, unknown> }>
  timestamp: number
}

/** 合并展示用：控制台发出的消息右对齐 */
export type ChatRow = ReceivedMessage & { outgoing?: boolean }

export interface InboxMessageRow {
  id: number
  platform_message_id: string
  sender_id: string
  sender_name: string | null
  content: string
  raw: string | null
  created_at: number
}

export interface InboxRequestRow {
  id: number
  platform_request_id: string
  type: string
  sub_type: string | null
  channel_id: string
  channel_type: string
  sender_id: string
  sender_name: string | null
  comment: string | null
  created_at: number
  resolved: number
  resolved_at: number | null
}

export interface InboxNoticeRow {
  id: number
  platform_notice_id: string
  type: string
  sub_type: string | null
  channel_id: string
  channel_type: string
  operator_id: string | null
  operator_name: string | null
  target_id: string | null
  target_name: string | null
  payload: string
  created_at: number
}

export type SidebarSelection =
  | {
      type: 'channel'
      id: string
      name: string
      channelType: 'private' | 'group' | 'channel'
      parent?: ChannelParentRef
    }
  | { type: 'requests' }
  | { type: 'notices' }

export type ConversationChannelType = 'private' | 'group' | 'channel'

/** 与 Host `ConsoleChannelParent` / sendMessage parent 一致 */
export type ChannelParentType = 'group' | 'guild'

export interface ChannelParentRef {
  type: ChannelParentType
  id: string
  name?: string
}

export interface ConversationEntry {
  id: string
  name: string
  channelType: ConversationChannelType
  parent?: ChannelParentRef
  lastMessagePreview?: string
  lastMessageAt?: number
  unreadCount: number
}

export type ConversationSectionId = ConversationChannelType

export interface ConversationSection {
  id: ConversationSectionId
  title: string
  entries: ConversationEntry[]
  emptyHint?: string
  hidden?: boolean
}

export type SystemInboxSectionId = 'requests' | 'notices'

export type MemberRow = {
  user_id?: number
  nickname?: string
  card?: string
  role?: string
  id?: string
  name?: string
  [k: string]: unknown
}
