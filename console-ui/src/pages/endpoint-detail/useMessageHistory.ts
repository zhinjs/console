import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useWebSocket } from '@zhin.js/client'
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
import { listInboxCache, putInboxCache } from '../../utils/inbox-cache'
import { subscribeEndpointPush } from '../../utils/endpoint-push'
import { toRpcChannelParent } from './conversation-labels'
import { useToast } from '../../components/toast'

interface LocalSentMessage {
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
  selection: SidebarSelection | null
}) {
  const { adapter, endpointId, selection } = params
  const { sendRequest } = useWebSocket()
  const { error: toastError } = useToast()

  const [receivedMessages, setReceivedMessages] = useState<ReceivedMessage[]>([])
  const [localSent, setLocalSent] = useState<LocalSentMessage[]>([])
  const [msgContent, setMsgContent] = useState('')
  const [sending, setSending] = useState(false)

  const [inboxMessages, setInboxMessages] = useState<InboxMessageRow[]>([])
  const [inboxMessagesLoading, setInboxMessagesLoading] = useState(false)
  const [inboxMessagesHasMore, setInboxMessagesHasMore] = useState(true)
  const [inboxMessagesEnabled, setInboxMessagesEnabled] = useState(false)
  // 递增序号：切换会话后在途的旧请求 resolve 时序号已过期，直接丢弃，避免覆盖/混入新会话数据
  const inboxLoadSeqRef = useRef(0)

  const loadInboxMessages = useCallback(
    async (beforeTs?: number) => {
      if (!adapter || !endpointId || selection?.type !== 'channel') return
      const seq = ++inboxLoadSeqRef.current
      setInboxMessagesLoading(true)
      const append = beforeTs != null
      try {
        const rpcParent = toRpcChannelParent(selection.parent)
        const res = await sendRequest<{ messages: InboxMessageRow[]; inboxEnabled: boolean }>({
          type: 'endpoint:inboxMessages',
          data: {
            adapter,
            endpointId,
            channelId: selection.id,
            channelType: selection.channelType,
            ...(rpcParent ? { parent: rpcParent } : {}),
            limit: 50,
            ...(beforeTs != null && { beforeTs }),
          },
        })
        if (seq !== inboxLoadSeqRef.current) return
        setInboxMessagesEnabled(!!res.inboxEnabled)
        if (!res.inboxEnabled || !res.messages?.length) {
          if (!append) setInboxMessages([])
          setInboxMessagesHasMore(false)
          return
        }
        if (append) {
          setInboxMessages((prev) => [...prev, ...res.messages])
        } else {
          setInboxMessages(res.messages)
        }
        setInboxMessagesHasMore(res.messages.length >= 50)
      } catch {
        if (seq !== inboxLoadSeqRef.current) return
        if (!append) setInboxMessages([])
        setInboxMessagesHasMore(false)
      } finally {
        if (seq === inboxLoadSeqRef.current) setInboxMessagesLoading(false)
      }
    },
    [adapter, endpointId, selection, sendRequest],
  )

  useEffect(() => {
    if (selection?.type === 'channel') {
      setInboxMessages([])
      setInboxMessagesHasMore(true)
      void loadInboxMessages()
    }
  }, [selection?.id, selection?.channelType, selection?.type, selection?.parent?.type, selection?.parent?.id, loadInboxMessages])

  // Listen for real-time inbound messages via the console push event
  useEffect(() => {
    if (!adapter || !endpointId) return
    const onPush = (msg: { type: string; data?: Record<string, unknown> }) => {
      const d = msg.data
      if (!d) return
      const pushEndpointId = String(d.endpointId ?? '')
      if (msg.type === 'message.receive') {
        if (d.adapter === adapter && pushEndpointId === endpointId) {
          void putInboxCache(adapter, endpointId, 'message', d)
          const content = normalizeInboundContent(d.content) as ReceivedMessage['content']
          setReceivedMessages((prev) => [
            ...prev,
            {
              id: `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`,
              channelId: String(d.channelId ?? ''),
              channelType: String(d.channelType ?? 'private'),
              sender: (d.sender as ReceivedMessage['sender']) ?? { id: '', name: '' },
              content,
              timestamp: Number(d.timestamp ?? Date.now()),
            },
          ])
        }
      }
    }
    return subscribeEndpointPush(onPush)
  }, [adapter, endpointId])

  // Hydrate received messages from inbox cache on mount
  useEffect(() => {
    if (!adapter || !endpointId) return
    let cancelled = false
    void (async () => {
      const cachedMessages = await listInboxCache(adapter, endpointId, 'message')
      if (cancelled) return
      if (cachedMessages.length) {
        setReceivedMessages((prev) => {
          const seen = new Set(prev.map((m) => m.id))
          const fromCache = cachedMessages
            .map((rec) => {
              const d = rec.payload
              const channelId = String(d.channelId ?? d.channel_id ?? '')
              const channelType = String(d.channelType ?? d.channel_type ?? 'private')
              const content = normalizeInboundContent(d.content) as ReceivedMessage['content']
              return {
                id: `cache-${rec.id}`,
                channelId,
                channelType,
                sender: (d.sender as ReceivedMessage['sender']) ?? { id: '', name: '' },
                content,
                timestamp: Number(d.timestamp ?? rec.updatedAt),
              }
            })
            .filter((m) => !seen.has(m.id))
          return [...prev, ...fromCache]
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, endpointId])

  const channelMessages = useMemo((): ChatRow[] => {
    if (selection?.type !== 'channel') return []
    const fromInbox: ChatRow[] = inboxMessages
      .filter(() => selection.id && selection.channelType)
      .map((m) => {
        const content = normalizeInboundContent(m.content) as ReceivedMessage['content']
        return {
          id: `inbox-${m.id}`,
          channelId: selection.id,
          channelType: selection.channelType,
          sender: { id: m.sender_id, name: m.sender_name ?? undefined },
          content,
          timestamp: m.created_at,
          outgoing: false,
        }
      })
    const fromRealtime: ChatRow[] = receivedMessages
      .filter((m) => m.channelId === selection.id && m.channelType === selection.channelType)
      .map((m) => ({ ...m, outgoing: false }))
    const outbound: ChatRow[] = localSent
      .filter((m) => m.channelId === selection.id && m.channelType === selection.channelType)
      .map((m) => ({
        id: m.id,
        channelId: m.channelId,
        channelType: m.channelType,
        sender: { id: 'self', name: '我' },
        content: m.segments as ReceivedMessage['content'],
        timestamp: m.timestamp,
        outgoing: true,
      }))
    return [...fromInbox, ...fromRealtime, ...outbound].sort((a, b) => a.timestamp - b.timestamp)
  }, [selection, receivedMessages, inboxMessages, localSent])

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
    setSending(true)
    try {
      const rpcParent = selection?.type === 'channel' ? toRpcChannelParent(selection.parent) : undefined
      await sendRequest({
        type: 'endpoint:sendMessage',
        data: {
          adapter,
          endpointId,
          id: targetId,
          type: msgType,
          ...(rpcParent ? { parent: rpcParent } : {}),
          content: outgoingSegments,
        },
      })
      setLocalSent((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          channelId: targetId,
          channelType: msgType,
          segments: displaySegments.length ? displaySegments : outgoingSegments,
          timestamp: Date.now(),
        },
      ])
      setMsgContent('')
      options?.onSent?.()
    } catch (e) {
      toastError((e as Error).message, '发送失败')
    } finally {
      setSending(false)
    }
  }, [selection, msgContent, sendRequest, adapter, endpointId, toastError])

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
    inboxMessagesHasMore,
    inboxMessagesEnabled,
    setInboxMessagesEnabled,
    setInboxMessagesHasMore,
    loadInboxMessages,
    channelMessages,
    handleSend,
  }
}
