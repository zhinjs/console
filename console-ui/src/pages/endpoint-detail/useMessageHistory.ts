import { useI18n } from '../../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
}

interface SendMessageOptions {
  overrideSegments?: MessageContent
  displayPrefixSegments?: MessageContent
  textPrefix?: string
  onSent?: () => void
}

export function useMessageHistory(params: {
  adapter: string
  endpointId: string
  endpoint?: { id: string; adapter: string }
  selection: SidebarSelection | null
}) {
  const i18n = useI18n()
  const { adapter, endpointId, endpoint, selection } = params
  const cacheScope = useInboxCacheScope()
  const { error: toastError } = useToast()

  const [receivedMessages, setReceivedMessages] = useState<ReceivedMessage[]>([])
  const [localSent, setLocalSent] = useState<LocalSentMessage[]>([])
  const [msgContent, setMsgContent] = useState('')
  const [sending, setSending] = useState(false)

  const [inboxMessages, setInboxMessages] = useState<InboxMessageRow[]>([])
  const [inboxMessagesError, setInboxMessagesError] = useState<string | null>(null)
  const [inboxMessagesLoading, setInboxMessagesLoading] = useState(false)
  const [inboxMessagesHasMore, setInboxMessagesHasMore] = useState(true)
  const [inboxMessagesEnabled, setInboxMessagesEnabled] = useState(false)
  // 递增序号：切换会话后在途的旧请求 resolve 时序号已过期，直接丢弃，避免覆盖/混入新会话数据
  const inboxLoadSeqRef = useRef(0)
  const endpointEpoch = useRef(0)
  const viewKey = JSON.stringify([adapter, endpointId, selection])
  const viewKeyRef = useRef(viewKey)
  viewKeyRef.current = viewKey
  useEffect(() => {
    endpointEpoch.current++; inboxLoadSeqRef.current++
    setReceivedMessages([]); setLocalSent([]); setSending(false)
    return () => { endpointEpoch.current++; inboxLoadSeqRef.current++ }
  }, [adapter, endpointId, cacheScope])

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
        const rows = readMessageHistory(res, i18n.locale)
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
    [adapter, endpointId, selection, cacheScope, i18n],
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
      const payload = readMessagePush(msg.data, i18n.locale)
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
    const requestedView = viewKeyRef.current
    setSending(true)
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
      if (epoch !== endpointEpoch.current || !isInboxCacheScopeActive(cacheScope)) return
      setLocalSent((prev) => [
        ...prev,
        {
          id: `local-${response.messageId || crypto.randomUUID()}`,
          messageId: response.messageId || undefined, endpoint,
          parent: selection?.type === 'channel' ? selection.parent : undefined,
          threadId: selection?.type === 'channel' ? selection.threadId : undefined,
          channelId: targetId,
          channelType: msgType,
          segments: displaySegments.length ? displaySegments : outgoingSegments,
          timestamp: Date.now(),
        },
      ].slice(-500))
      if (requestedView === viewKeyRef.current) { setMsgContent(current => current === msgContent ? '' : current); options?.onSent?.() }
    } catch (e) {
      if (epoch === endpointEpoch.current) toastError((e as Error).message, i18n.t("发送到 {0} 失败", [targetId]))
    } finally {
      if (epoch === endpointEpoch.current) setSending(false)
    }
  }, [selection, msgContent, adapter, endpointId, endpoint, toastError, i18n])

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
  }
}
