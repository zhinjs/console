import type { DiagnosticConversation, ReceivedMessage } from './endpoint-detail/types'

export interface ConversationHistoryMessage {
  ref: { conversation: DiagnosticConversation; id: string }
  actor?: { id: string; displayName?: string }
  segments: ReceivedMessage['content']
  contentStatus?: 'unavailable'
  timestamp: number
}
export interface ConversationHistoryEvent {
  sequence: number
  type: string
  timestamp: number
  message?: ConversationHistoryMessage
  messageRef?: { conversation: DiagnosticConversation; id: string }
}
export interface ConversationHistoryPage {
  conversation: DiagnosticConversation
  items: ConversationHistoryEvent[]
  nextBeforeSequence: number | null
  hasMore: boolean
}
export interface ConversationHistoryFailure { kind: '404' | '503' | 'other'; message: string }
export function conversationHistoryQuery(sessionKey: string, beforeSequence?: number, connectionId?: string): string
export function readConversationHistory(body: unknown, expectedConversation?: DiagnosticConversation, beforeSequence?: number, locale?: 'zh-CN' | 'en'): ConversationHistoryPage
export function prependConversationHistory(current: ConversationHistoryPage | null, earlier: ConversationHistoryPage): ConversationHistoryPage
export function conversationHistoryFailure(status: number, body: unknown, locale?: 'zh-CN' | 'en'): ConversationHistoryFailure
