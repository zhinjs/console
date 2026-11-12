export type ChatConversationKind = 'private' | 'group' | 'channel'
export type ChatRequest =
  | { type: 'channel'; channelType: ChatConversationKind; id: string }
  | { type: 'requests' }
  | { type: 'notices' }

export declare const CHAT_CONVERSATION_PARAM: 'conversation'
export declare const CHAT_INBOX_PARAM: 'inbox'
export declare function readChatRequest(params: URLSearchParams | null | undefined): ChatRequest | null
export declare function chatRequestKey(value: { type: string; channelType?: string; id?: string } | null | undefined): string | null
export declare function writeChatRequest(params: URLSearchParams | null | undefined, value: { type: string; channelType?: string; id?: string } | null | undefined): URLSearchParams
export declare function chatPane(mode: 'account' | 'conversation', selection: unknown): 'list' | 'chat'
export type ComposerNoticeReason = 'read-only' | 'offline'
export declare function composerAvailability(input: { canOperate: boolean; connected?: boolean | null }): { mode: 'compose' } | { mode: 'notice'; reason: ComposerNoticeReason }
export declare const COMPOSER_NOTICE_COPY: Readonly<Record<ComposerNoticeReason, string>>
export declare const CONTINUATION_WINDOW_MS: number
export declare function continuationFlags(
  rows: readonly { outgoing?: boolean; directionUnknown?: boolean; delivery?: DeliveryState; sender?: { id?: string; name?: string }; timestamp: number }[],
  dayOf?: (timestamp: number) => string,
): boolean[]
export type DeliveryState = 'sending' | 'sent' | 'accepted' | 'unknown' | 'failed'
export declare const DELIVERY_STATES: readonly DeliveryState[]
export declare const DELIVERY_COPY: Readonly<Record<DeliveryState, { label: string; title: string }>>
export declare function deliveryAfterSend(response: unknown): 'sent' | 'accepted'
export declare function deliveryAfterError(error: unknown): 'unknown' | 'failed'
