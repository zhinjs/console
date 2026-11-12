import { useI18n } from '../../i18n'
import { useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from 'react'
import type {
  ChatRow,
  InboxMessageRow,
  ReceivedMessage,
  SidebarSelection,
} from './types'
import {
  hasRenderableComposerSegments,
  normalizeInboundContent,
  parseComposerToSegments,
  type MessageContent,
} from '../../utils/parseComposerContent'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { listInboxCache, putInboxCache, isInboxCacheScopeActive } from '../../utils/inbox-cache'
import {
  subscribeConsoleRecoveryGap,
  subscribeEndpointPush,
  type EndpointPushMessage,
} from '../../utils/endpoint-push'
import { correlateChatRows, matchesMessageConversation, readMessagePush } from './rendering-diagnostics.mjs'
import { readMessageHistory, mergeHistoryRows } from './inbox-history-model.mjs'
import { toRpcChannelParent } from './conversation-labels'
import { conversationSelectionKey, readComposerDraft, writeComposerDraft } from './composer-draft-model.mjs'
import { deliveryAfterError, deliveryAfterSend, type DeliveryState } from './chat-workspace-model.mjs'
import { draftStoreKey, readDraftStore, updateDraftStore, writeDraftStore } from './chat-draft-store.mjs'
import { useToast } from '../../components/toast'
import { ENDPOINT_RPC, INBOX_RPC, SIDE_EVENT_PUSH } from '../../contracts/zhin-console'
import { requestConsole } from '../../utils/console-rpc'

interface LocalSentMessage {
  messageId?: string
  endpoint?: { id: string; adapter: string }
  parent?: ReceivedMessage['parent']
  threadId?: string
  id: string
  channelId: string
  channelType: string
  segments: MessageContent
  timestamp: number
  /** What the send receipt says (chat-workspace-model DELIVERY_STATES). */
  delivery: DeliveryState
  /** Host's reason for a refused send, shown under the bubble. */
  failure?: string
  /** Composer text it was sent from, offered back after an unknown outcome. */
  draftText?: string
  draftKey?: string | null
}

interface SendMessageOptions {
  overrideSegments?: MessageContent
  displayPrefixSegments?: MessageContent
  textPrefix?: string
  /** Called after a successful send with the conversation it went to (the user may have switched since). */
  onSent?: (sent: { draftKey: string | null }) => void
}

export function useMessageHistory(params: {
  adapter: string
  endpointId: string
  endpoint?: { id: string; adapter: string }
  selection: SidebarSelection | null
}) {
  const i18n = useI18n()
  const messages = useRef(i18n); messages.current = i18n
  const { adapter, endpointId, endpoint, selection } = params
  const cacheScope = useInboxCacheScope()
  const { error: toastError } = useToast()

  const [receivedMessages, setReceivedMessages] = useState<ReceivedMessage[]>([])
  const [localSent, setLocalSent] = useState<LocalSentMessage[]>([])
  // Unsent text is kept per conversation: switching chats shows that chat's own draft, never the
  // previous one, and coming back restores it. The in-memory store keeps it across tab switches.
  const draftKey = conversationSelectionKey(selection)
  // The conversation on screen now: a failed send there is shown on its bubble; elsewhere it also toasts.
  const visibleKey = useRef(draftKey); visibleKey.current = draftKey
  const storeKey = draftStoreKey(cacheScope, adapter, endpointId)
  const [msgDrafts, setMsgDrafts] = useState<Record<string, string>>(() => readDraftStore<Record<string, string>>(storeKey, 'text') ?? {})
  const msgContent = readComposerDraft(msgDrafts, draftKey, '')
  const setMsgContent = useCallback((next: SetStateAction<string>) => {
    setMsgDrafts((prev) => writeComposerDraft(prev, draftKey,
      typeof next === 'function' ? next(readComposerDraft(prev, draftKey, '')) : next))
  }, [draftKey])
  const [sending, setSending] = useState(false)

  const [inboxMessages, setInboxMessages] = useState<InboxMessageRow[]>([])
  const [inboxMessagesError, setInboxMessagesError] = useState<string | null>(null)
  const [inboxMessagesLoading, setInboxMessagesLoading] = useState(false)
  const [inboxMessagesHasMore, setInboxMessagesHasMore] = useState(true)
  const [inboxMessagesEnabled, setInboxMessagesEnabled] = useState(false)
  // 递增序号：切换会话后在途的旧请求 resolve 时序号已过期，直接丢弃，避免覆盖/混入新会话数据
  const inboxLoadSeqRef = useRef(0)
  const endpointEpoch = useRef(0)
  useEffect(() => {
    endpointEpoch.current++; inboxLoadSeqRef.current++
    setReceivedMessages([]); setLocalSent([]); setSending(false)
    const stored = readDraftStore<Record<string, string>>(storeKey, 'text') ?? {}
    setMsgDrafts((prev) => (Object.keys(prev).length || Object.keys(stored).length ? stored : prev))
    return () => { endpointEpoch.current++; inboxLoadSeqRef.current++ }
  }, [adapter, endpointId, cacheScope, storeKey])
  useEffect(() => { writeDraftStore(storeKey, 'text', msgDrafts) }, [storeKey, msgDrafts])

  const loadInboxMessages = useCallback(
    async (beforeTs?: number) => {
      if (!adapter || !endpointId || selection?.type !== 'channel') return
      const seq = ++inboxLoadSeqRef.current
      setInboxMessagesLoading(true)
      setInboxMessagesError(null)
      const append = beforeTs != null
      try {
        const rpcParent = toRpcChannelParent(selection.parent)
        const res = await requestConsole<{ messages: InboxMessageRow[]; inboxEnabled: boolean }>({
          type: INBOX_RPC.MESSAGES,
          ...{
            adapter,
            endpointKey: endpointId,
            channelId: selection.id,
            channelType: selection.channelType,
            ...(rpcParent ? { parent: rpcParent } : {}),
            limit: 50,
            ...(beforeTs != null && { beforeTs }),
          },
        })
        if (seq !== inboxLoadSeqRef.current || !isInboxCacheScopeActive(cacheScope)) return
        const rows = readMessageHistory(res, messages.current.locale)
        setInboxMessagesEnabled(res.inboxEnabled)
        if (!res.inboxEnabled || !rows.length) {
          if (!append) setInboxMessages([])
          setInboxMessagesHasMore(false)
          return
        }
        if (append) {
          setInboxMessages((prev) => mergeHistoryRows(prev, rows))
        } else {
          setInboxMessages(rows)
        }
        setInboxMessagesHasMore(rows.length >= 50)
      } catch (caught) {
        if (seq !== inboxLoadSeqRef.current || !isInboxCacheScopeActive(cacheScope)) return
        setInboxMessagesError(caught instanceof Error ? caught.message : String(caught))
        setInboxMessagesHasMore(false)
      } finally {
        if (seq === inboxLoadSeqRef.current) setInboxMessagesLoading(false)
      }
    },
    [adapter, endpointId, selection, cacheScope],
  )

  useEffect(() => {
    if (selection?.type === 'channel') {
      setInboxMessages([])
      setInboxMessagesHasMore(true)
      void loadInboxMessages()
    }
  }, [selection, loadInboxMessages])

  // A bounded event-history gap means incremental state is incomplete. Reload
  // the authoritative Inbox projection instead of pretending replay succeeded.
  useEffect(() => {
    if (selection?.type !== 'channel') return
    return subscribeConsoleRecoveryGap(() => {
      setReceivedMessages([])
      setInboxMessages([])
      setInboxMessagesHasMore(true)
      void loadInboxMessages()
    })
  }, [loadInboxMessages, selection?.type])

  // Listen for real-time inbound messages via the console push event
  useEffect(() => {
    if (!adapter || !endpointId) return
    const onPush = (msg: EndpointPushMessage) => {
      if (msg.type !== SIDE_EVENT_PUSH.MESSAGE_RECEIVE) return
      const payload = readMessagePush(msg.data, messages.current.locale)
      if (!isInboxCacheScopeActive(cacheScope) || !payload || !endpoint || payload.endpoint.adapter !== endpoint.adapter || payload.endpoint.id !== endpoint.id) return
      void putInboxCache(adapter, endpointId, 'message', { ...payload })
      const content = normalizeInboundContent(payload.content) as ReceivedMessage['content']
      setReceivedMessages((prev) => [
        ...prev,
        {
          id: `msg-${payload.messageId ?? crypto.randomUUID()}`,
          messageId: payload.messageId,
          conversation: payload.conversation,
          endpoint: payload.endpoint,
          parent: payload.parent,
          threadId: payload.threadId,
          outgoing: payload.outgoing,
          rendering: payload.rendering,
          renderingError: payload.renderingError,
          channelId: payload.channelId,
          channelType: payload.channelType,
          sender: (payload.sender as ReceivedMessage['sender']) ?? { id: '', name: '' },
          content,
          timestamp: payload.timestamp,
        },
      ].slice(-500))
    }
    return subscribeEndpointPush(onPush)
  }, [adapter, endpointId, endpoint?.id, endpoint?.adapter, cacheScope])

  // Hydrate received messages from inbox cache on mount
  useEffect(() => {
    if (!adapter || !endpointId) return
    let cancelled = false
    void (async () => {
      const cachedMessages = await listInboxCache(adapter, endpointId, 'message')
      if (cancelled || !isInboxCacheScopeActive(cacheScope)) return
      if (cachedMessages.length) {
        setReceivedMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id))
          const fromCache = cachedMessages
            .flatMap((rec) => {
              const d = readMessagePush(rec.payload, i18n.locale)
              if (!d || !endpoint || d.endpoint.id !== endpoint.id || d.endpoint.adapter !== endpoint.adapter) return []
              return [{
                id: `cache-${rec.id}`, endpoint: d.endpoint, messageId: d.messageId, conversation: d.conversation,
                channelId: d.channelId, channelType: d.channelType, parent: d.parent, threadId: d.threadId,
                outgoing: d.outgoing, rendering: d.rendering, renderingError: d.renderingError,
                sender: (d.sender as ReceivedMessage['sender']) ?? { id: '', name: '' },
                content: normalizeInboundContent(d.content) as ReceivedMessage['content'], timestamp: d.timestamp,
              }]
            })
            .filter((m) => !seen.has(m.id))
          return [...prev, ...fromCache].slice(-500)
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, endpointId, endpoint?.id, endpoint?.adapter, cacheScope])

  const channelMessages = useMemo((): ChatRow[] => {
    if (selection?.type !== 'channel') return []
    const fromInbox: ChatRow[] = inboxMessages
      .filter((message) => message.channel.id === selection.id && message.channel.type === selection.channelType)
      .slice().sort((left, right) => left.timestamp - right.timestamp || left.id - right.id)
      .map((m) => {
        const observed = m.conversation ? readMessagePush({ ...m, messageId: m.platformMessageId }, i18n.locale) : undefined
        const content = normalizeInboundContent(m.content) as ReceivedMessage['content']
        return {
          id: `inbox-${m.id}`,
          messageId: m.platformMessageId || undefined,
          conversation: m.conversation,
          endpoint: observed?.endpoint ?? endpoint,
          parent: observed?.parent ?? m.channel.parent,
          threadId: observed?.threadId,
          rendering: m.rendering,
          renderingError: m.renderingError,
          channelId: m.channel.id,
          channelType: m.channel.type,
          sender: m.sender,
          content,
          timestamp: m.timestamp,
          outgoing: m.direction === undefined ? undefined : m.direction === 'outbound',
          directionUnknown: m.direction === undefined,
        }
      }).filter(message => matchesMessageConversation(message, selection) && (!endpoint || !message.endpoint || message.endpoint.id === endpoint.id && message.endpoint.adapter === endpoint.adapter))
    const fromRealtime: ChatRow[] = receivedMessages
      .filter((m) => matchesMessageConversation(m, selection))
    const outbound: ChatRow[] = localSent
      .filter((m) => matchesMessageConversation(m, selection))
      .map((m) => ({
        id: m.id, messageId: m.messageId, endpoint: m.endpoint, parent: m.parent, threadId: m.threadId, local: true,
        delivery: m.delivery, failure: m.failure, restorable: m.delivery === 'unknown' && !!m.draftText,
        channelId: m.channelId,
        channelType: m.channelType,
        sender: { id: 'self', name: i18n.t("我") },
        content: m.segments as ReceivedMessage['content'],
        timestamp: m.timestamp,
        outgoing: true,
      }))
    return correlateChatRows([...fromInbox, ...fromRealtime, ...outbound])
  }, [selection, receivedMessages, inboxMessages, localSent, endpoint, i18n])

  const handleSend = useCallback(async (options?: SendMessageOptions) => {
    const targetId = selection?.type === 'channel' ? selection.id : ''
    const msgType = selection?.type === 'channel' ? selection.channelType : 'private'
    const segments = options?.overrideSegments ?? parseComposerToSegments(msgContent)
    const textPrefix = options?.textPrefix?.trim()
    const prefixTextSegments: MessageContent = textPrefix
      ? [{ type: 'text', data: { text: `${textPrefix}\n` } }]
      : []
    const outgoingSegments = [...prefixTextSegments, ...segments]
    const displaySegments = [
      ...(options?.displayPrefixSegments ?? []),
      ...segments,
    ]
    if (!targetId || !hasRenderableComposerSegments(outgoingSegments)) return
    const epoch = endpointEpoch.current
    const sentDraftKey = draftKey
    const sentText = msgContent
    const sentStoreKey = storeKey
    const localId = `local-${crypto.randomUUID()}`
    const updateLocal = (patch: Partial<LocalSentMessage>) =>
      setLocalSent((prev) => prev.map((row) => (row.id === localId ? { ...row, ...patch } : row)))
    // Clear the draft of the conversation this was sent to, even if the user has moved on (or left
    // the tab: the store is updated too, so the text is not offered again and sent twice).
    const clearSentText = (prev: Record<string, string>) =>
      readComposerDraft(prev, sentDraftKey, '') === sentText ? writeComposerDraft(prev, sentDraftKey, '') : prev
    setSending(true)
    setLocalSent((prev) => [
      ...prev,
      {
        id: localId, endpoint,
        parent: selection?.type === 'channel' ? selection.parent : undefined,
        threadId: selection?.type === 'channel' ? selection.threadId : undefined,
        channelId: targetId,
        channelType: msgType,
        segments: displaySegments.length ? displaySegments : outgoingSegments,
        timestamp: Date.now(),
        delivery: 'sending' as const,
        draftText: sentText,
        draftKey: sentDraftKey,
      },
    ].slice(-500))
    try {
      const rpcParent = selection?.type === 'channel' ? toRpcChannelParent(selection.parent) : undefined
      const response = await requestConsole<{ messageId: string }>({
        type: ENDPOINT_RPC.SEND_MESSAGE,
        ...{
          adapter,
          endpointKey: endpointId,
          channelId: targetId,
          channelType: msgType,
          ...(rpcParent ? { parent: rpcParent } : {}),
          content: outgoingSegments,
        },
      })
      updateDraftStore<Record<string, string>>(sentStoreKey, 'text', clearSentText)
      if (epoch !== endpointEpoch.current || !isInboxCacheScopeActive(cacheScope)) return
      updateLocal({ messageId: response?.messageId || undefined, delivery: deliveryAfterSend(response) })
      setMsgDrafts(clearSentText)
      options?.onSent?.({ draftKey: sentDraftKey })
    } catch (e) {
      const delivery = deliveryAfterError(e)
      // An unknown outcome may already be on the platform: take the text out of the box (it is
      // offered back on the bubble) so Enter cannot send it a second time by accident.
      if (delivery === 'unknown') updateDraftStore<Record<string, string>>(sentStoreKey, 'text', clearSentText)
      if (epoch !== endpointEpoch.current) return
      updateLocal({ delivery, failure: (e as Error).message })
      if (delivery === 'unknown') {
        setMsgDrafts(clearSentText)
        options?.onSent?.({ draftKey: sentDraftKey })
      }
      // The receipt is on the bubble; a toast only when the user has moved to another conversation.
      if (visibleKey.current !== sentDraftKey) {
        if (delivery === 'unknown') toastError(i18n.t("发送到 {0} 的结果未知，请先在会话里核对", [targetId]))
        else toastError((e as Error).message, i18n.t("发送到 {0} 失败", [targetId]))
      }
    } finally {
      if (epoch === endpointEpoch.current) setSending(false)
    }
  }, [selection, draftKey, storeKey, msgContent, adapter, endpointId, endpoint, toastError, i18n, cacheScope])

  /** Drop a failed / unknown local bubble (the platform record, if any, stays in the history). */
  const dismissLocal = useCallback((id: string) => {
    setLocalSent((prev) => prev.filter((row) => row.id !== id || row.delivery === 'sending'))
  }, [])

  /** Put the text of an unknown send back into its conversation's box; the user decides whether to send again. */
  const restoreLocal = useCallback((id: string) => {
    const row = localSent.find((item) => item.id === id)
    if (!row?.draftText) return
    const text = row.draftText
    setMsgDrafts((prev) => writeComposerDraft(prev, row.draftKey ?? null, readComposerDraft(prev, row.draftKey ?? null, '') || text))
    setLocalSent((prev) => prev.filter((item) => item.id !== id))
  }, [localSent])

  return {
    receivedMessages,
    setReceivedMessages,
    localSent,
    setLocalSent,
    msgContent,
    setMsgContent,
    sending,
    inboxMessages,
    setInboxMessages,
    inboxMessagesLoading,
    inboxMessagesError,
    inboxMessagesHasMore,
    inboxMessagesEnabled,
    setInboxMessagesEnabled,
    setInboxMessagesHasMore,
    loadInboxMessages,
    channelMessages,
    handleSend,
    dismissLocal,
    restoreLocal,
    /** Some conversation of this account has unsent text. */
    hasTextDrafts: Object.keys(msgDrafts).length > 0,
    draftStoreKey: storeKey,
  }
}
