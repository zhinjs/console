import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useParams } from 'react-router-dom'
import { Hash, MessageSquare, User, Users } from 'lucide-react'
import { useWebSocket } from '@zhin.js/client'
import type {
  EndpointInfo,
  ChatRow,
  InboxMessageRow,
  InboxNoticeRow,
  InboxRequestRow,
  MemberRow,
  NoticeItem,
  ReceivedMessage,
  ReqItem,
  SidebarSelection,
} from './types'
import {
  hasRenderableComposerSegments,
  normalizeInboundContent,
  parseComposerToSegments,
  type MessageContent,
} from '../../utils/parseComposerContent'
import { listInboxCache, putInboxCache } from '../../utils/inbox-cache'
import { adapterListHint, isIcqqAdapter } from '../../utils/endpoint-adapter'

export function useEndpointConsole() {
  const { adapter: adapterParam, endpointId: endpointIdParam } = useParams<{
    adapter: string
    endpointId: string
  }>()
  const adapter = adapterParam ? decodeURIComponent(adapterParam) : ''
  const endpointId = endpointIdParam ? decodeURIComponent(endpointIdParam) : ''
  const valid = Boolean(adapter && endpointId)

  const { sendRequest, connected } = useWebSocket()
  const [info, setInfo] = useState<EndpointInfo | null>(null)
  const [loadErr, setLoadErr] = useState<string | null>(null)

  const [msgContent, setMsgContent] = useState('')
  const [sending, setSending] = useState(false)

  const [friends, setFriends] = useState<Array<{ user_id: number; nickname: string; remark: string }>>([])
  const [groups, setGroups] = useState<Array<{ group_id: number; name: string }>>([])
  const [channelList, setChannelList] = useState<Array<{ id: string; name: string }>>([])
  const [listLoading, setListLoading] = useState(false)
  const [listErr, setListErr] = useState<string | null>(null)

  const [requests, setRequests] = useState<Map<number, ReqItem>>(new Map())
  const [notices, setNotices] = useState<Map<number, NoticeItem>>(new Map())

  const [selection, setSelection] = useState<SidebarSelection | null>(null)
  const [showChannelList, setShowChannelList] = useState(false)
  const [listSearch, setListSearch] = useState('')

  const [members, setMembers] = useState<MemberRow[]>([])
  const [membersLoading, setMembersLoading] = useState(false)
  const [receivedMessages, setReceivedMessages] = useState<ReceivedMessage[]>([])
  const [localSent, setLocalSent] = useState<
    Array<{
      id: string
      channelId: string
      channelType: string
      segments: MessageContent
      timestamp: number
    }>
  >([])
  const [inboxMessages, setInboxMessages] = useState<InboxMessageRow[]>([])
  const [inboxMessagesLoading, setInboxMessagesLoading] = useState(false)
  const [inboxMessagesHasMore, setInboxMessagesHasMore] = useState(true)
  const [inboxMessagesEnabled, setInboxMessagesEnabled] = useState(false)
  const [inboxRequests, setInboxRequests] = useState<InboxRequestRow[]>([])
  const [inboxRequestsLoading, setInboxRequestsLoading] = useState(false)
  const [inboxRequestsOffset, setInboxRequestsOffset] = useState(0)
  const [inboxRequestsEnabled, setInboxRequestsEnabled] = useState(false)
  const [inboxNotices, setInboxNotices] = useState<InboxNoticeRow[]>([])
  const [inboxNoticesLoading, setInboxNoticesLoading] = useState(false)
  const [inboxNoticesOffset, setInboxNoticesOffset] = useState(0)
  const [inboxNoticesEnabled, setInboxNoticesEnabled] = useState(false)
  const [requestsTab, setRequestsTab] = useState<'pending' | 'history'>('pending')
  const [noticesTab, setNoticesTab] = useState<'unread' | 'history'>('unread')

  const loadInfo = useCallback(async () => {
    if (!adapter || !endpointId || !connected) return
    try {
      const data = await sendRequest<EndpointInfo>({
        type: 'endpoint:info',
        data: { adapter, endpointId },
      })
      setInfo(data)
      setLoadErr(null)
    } catch (e) {
      setLoadErr((e as Error).message)
    }
  }, [adapter, endpointId, connected, sendRequest])

  useEffect(() => {
    loadInfo()
    const t = setInterval(loadInfo, 8000)
    return () => clearInterval(t)
  }, [loadInfo])

  const loadChannelsFromInbox = useCallback(async (): Promise<
    Array<{ id: string; name: string; channelType: 'private' | 'group' | 'channel' }>
  > => {
    const byKey = new Map<
      string,
      { id: string; name: string; channelType: 'private' | 'group' | 'channel'; ts: number }
    >()
    const upsert = (
      channelType: string,
      channelId: string,
      name: string | null | undefined,
      ts: number,
    ) => {
      if (channelType !== 'private' && channelType !== 'group' && channelType !== 'channel') return
      const scope = channelType as 'private' | 'group' | 'channel'
      const key = `${scope}:${channelId}`
      const prev = byKey.get(key)
      const safeTs = Number(ts) || 0
      const label = name?.trim() || String(channelId)
      if (!prev || safeTs > prev.ts) {
        byKey.set(key, { id: String(channelId), name: label, channelType: scope, ts: safeTs })
      }
    }

    try {
      const result = await sendRequest<{
        rows: Array<{
          channel_id: string
          channel_type: string
          sender_name: string | null
          created_at: number
        }>
      }>({
        type: 'db:select',
        table: 'unified_inbox_message',
        page: 1,
        pageSize: 200,
        where: { adapter, endpoint_id: endpointId },
      })
      for (const row of result.rows ?? []) {
        upsert(row.channel_type, String(row.channel_id), row.sender_name, row.created_at)
      }
    } catch {
      // 收件箱 DB 不可用时继续尝试本地缓存
    }

    if (byKey.size === 0) {
      const cached = await listInboxCache(adapter, endpointId, 'message')
      for (const rec of cached) {
        const d = rec.payload
        const channelId = String(d.channelId ?? d.channel_id ?? '')
        const channelType = String(d.channelType ?? d.channel_type ?? 'private')
        const sender = d.sender as { name?: string } | undefined
        const name = sender?.name ?? (d.sender_name as string | undefined)
        upsert(channelType, channelId, name, Number(d.timestamp ?? rec.updatedAt))
      }
    }

    return [...byKey.values()]
      .sort((a, b) => b.ts - a.ts)
      .map(({ id, name, channelType }) => ({ id, name, channelType }))
  }, [adapter, endpointId, sendRequest])

  const loadLists = useCallback(async () => {
    if (!adapter || !endpointId || !connected) return
    setListLoading(true)
    setListErr(null)
    const errors: string[] = []
    let nextFriends: typeof friends = []
    let nextGroups: typeof groups = []
    let nextChannels: Array<{ id: string; name: string }> = []
    let usedInboxFallback = false

    try {
      const tryFriendsGroups = isIcqqAdapter(adapter) || adapter === 'napcat'
      if (tryFriendsGroups) {
        try {
          const f = await sendRequest<{ friends: typeof friends }>({
            type: 'endpoint:friends',
            data: { adapter, endpointId },
          })
          nextFriends = f.friends || []
        } catch (e) {
          errors.push(`好友列表：${(e as Error).message}`)
        }
        try {
          const g = await sendRequest<{ groups: typeof groups }>({
            type: 'endpoint:groups',
            data: { adapter, endpointId },
          })
          nextGroups = g.groups || []
        } catch (e) {
          errors.push(`群列表：${(e as Error).message}`)
        }
      } else {
        try {
          const ch = await sendRequest<{ channels?: Array<{ id: string; name: string }> }>({
            type: 'endpoint:channels',
            data: { adapter, endpointId },
          })
          nextChannels = ch.channels ?? []
        } catch (e) {
          errors.push(`频道列表：${(e as Error).message}`)
        }
      }

      const primaryEmpty =
        nextFriends.length === 0 && nextGroups.length === 0 && nextChannels.length === 0
      if (primaryEmpty) {
        const inboxChannels = await loadChannelsFromInbox()
        if (inboxChannels.length > 0) {
          usedInboxFallback = true
          nextFriends = inboxChannels
            .filter((c) => c.channelType === 'private')
            .map((c) => ({
              user_id: Number(c.id) || 0,
              nickname: c.name,
              remark: '',
            }))
          nextGroups = inboxChannels
            .filter((c) => c.channelType === 'group')
            .map((c) => ({
              group_id: Number(c.id) || 0,
              name: c.name,
            }))
          nextChannels = inboxChannels
            .filter((c) => c.channelType === 'channel')
            .map((c) => ({ id: c.id, name: c.name }))
        }
      }

      setFriends(nextFriends)
      setGroups(nextGroups)
      setChannelList(nextChannels)

      const total = nextFriends.length + nextGroups.length + nextChannels.length
      if (total === 0) {
        const hint = adapterListHint(adapter)
        if (errors.length) {
          setListErr(`${errors.join('；')}。${hint}`)
        } else if (!info?.connected) {
          setListErr(`机器人未在线。${hint}`)
        } else {
          setListErr(`暂无会话。${hint}`)
        }
      } else if (usedInboxFallback) {
        setListErr('已从收件箱历史恢复最近会话（主列表接口未返回数据）')
      } else if (errors.length) {
        setListErr(errors.join('；'))
      }
    } catch (e) {
      setListErr((e as Error).message)
    } finally {
      setListLoading(false)
    }
  }, [adapter, endpointId, connected, sendRequest, loadChannelsFromInbox, info?.connected])

  useEffect(() => {
    if (connected) loadLists()
  }, [connected, loadLists])

  const loadRequestsFromServer = useCallback(async () => {
    if (!adapter || !endpointId || !connected) return
    try {
      const { requests: rows } = await sendRequest<{ requests: ReqItem[] }>({
        type: 'endpoint:requests',
        data: { adapter, endpointId },
      })
      setRequests((prev) => {
        const m = new Map(prev)
        for (const r of rows || []) {
          m.set(r.id, {
            ...r,
            canAct: false,
          })
        }
        return m
      })
    } catch {
      /* ignore */
    }
  }, [adapter, endpointId, connected, sendRequest])

  const loadInboxMessages = useCallback(
    async (beforeTs?: number) => {
      if (!adapter || !endpointId || selection?.type !== 'channel') return
      setInboxMessagesLoading(true)
      const append = beforeTs != null
      try {
        const res = await sendRequest<{ messages: InboxMessageRow[]; inboxEnabled: boolean }>({
          type: 'endpoint:inboxMessages',
          data: {
            adapter,
            endpointId,
            channelId: selection.id,
            channelType: selection.channelType,
            limit: 50,
            ...(beforeTs != null && { beforeTs }),
          },
        })
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
        if (!append) setInboxMessages([])
        setInboxMessagesEnabled(false)
        setInboxMessagesHasMore(false)
      } finally {
        setInboxMessagesLoading(false)
      }
    },
    [adapter, endpointId, selection, sendRequest],
  )

  const loadInboxRequests = useCallback(
    async (append: boolean) => {
      if (!adapter || !endpointId) return
      setInboxRequestsLoading(true)
      try {
        const offset = append ? inboxRequestsOffset : 0
        const res = await sendRequest<{ requests: InboxRequestRow[]; inboxEnabled: boolean }>({
          type: 'endpoint:inboxRequests',
          data: { adapter, endpointId, limit: 30, offset },
        })
        setInboxRequestsEnabled(!!res.inboxEnabled)
        if (!res.inboxEnabled || !res.requests?.length) {
          if (!append) setInboxRequests([])
          return
        }
        if (append) {
          setInboxRequests((prev) => [...prev, ...res.requests])
        } else {
          setInboxRequests(res.requests)
        }
        setInboxRequestsOffset(offset + (res.requests?.length ?? 0))
      } catch {
        if (!append) setInboxRequests([])
        setInboxRequestsEnabled(false)
      } finally {
        setInboxRequestsLoading(false)
      }
    },
    [adapter, endpointId, inboxRequestsOffset, sendRequest],
  )

  const loadInboxNotices = useCallback(
    async (append: boolean) => {
      if (!adapter || !endpointId) return
      setInboxNoticesLoading(true)
      try {
        const offset = append ? inboxNoticesOffset : 0
        const res = await sendRequest<{ notices: InboxNoticeRow[]; inboxEnabled: boolean }>({
          type: 'endpoint:inboxNotices',
          data: { adapter, endpointId, limit: 30, offset },
        })
        setInboxNoticesEnabled(!!res.inboxEnabled)
        if (!res.inboxEnabled || !res.notices?.length) {
          if (!append) setInboxNotices([])
          return
        }
        if (append) {
          setInboxNotices((prev) => [...prev, ...res.notices])
        } else {
          setInboxNotices(res.notices)
        }
        setInboxNoticesOffset(offset + res.notices.length)
      } catch {
        if (!append) setInboxNotices([])
        setInboxNoticesEnabled(false)
      } finally {
        setInboxNoticesLoading(false)
      }
    },
    [adapter, endpointId, inboxNoticesOffset, sendRequest],
  )

  useEffect(() => {
    loadRequestsFromServer()
  }, [loadRequestsFromServer])

  useEffect(() => {
    if (!adapter || !endpointId) return
    void (async () => {
      const [cachedRequests, cachedNotices, cachedMessages] = await Promise.all([
        listInboxCache(adapter, endpointId, 'request'),
        listInboxCache(adapter, endpointId, 'notice'),
        listInboxCache(adapter, endpointId, 'message'),
      ])

      if (cachedRequests.length) {
        setRequests((prev) => {
          const m = new Map(prev)
          for (const rec of cachedRequests) {
            const d = rec.payload
            const id = d.id as number
            if (id == null) continue
            m.set(id, {
              id,
              platformRequestId: String(d.platformRequestId ?? ''),
              type: String(d.type ?? ''),
              sender: (d.sender as ReqItem['sender']) ?? { id: '', name: '' },
              comment: String(d.comment ?? ''),
              channel: (d.channel as ReqItem['channel']) ?? { id: '', type: 'private' },
              timestamp: Number(d.timestamp ?? rec.updatedAt),
              canAct: d.canAct === true,
            })
          }
          return m
        })
      }

      if (cachedNotices.length) {
        setNotices((prev) => {
          const m = new Map(prev)
          for (const rec of cachedNotices) {
            const d = rec.payload
            const id = d.id as number
            if (id == null) continue
            m.set(id, {
              id,
              noticeType: String(d.noticeType ?? ''),
              channel: (d.channel as NoticeItem['channel']) ?? { id: '', type: 'private' },
              payload: String(d.payload ?? '{}'),
              timestamp: Number(d.timestamp ?? rec.updatedAt),
            })
          }
          return m
        })
      }

      if (cachedRequests.length) {
        setInboxRequests((prev) => {
          if (prev.length) return prev
          return cachedRequests.map((rec, idx) => {
            const d = rec.payload
            return {
              id: Number(d.id ?? idx),
              platform_request_id: String(d.platform_request_id ?? d.platformRequestId ?? ''),
              type: String(d.type ?? ''),
              sub_type: d.sub_type != null ? String(d.sub_type) : null,
              channel_id: String(d.channel_id ?? d.channelId ?? ''),
              channel_type: String(d.channel_type ?? d.channelType ?? 'private'),
              sender_id: String(d.sender_id ?? ''),
              sender_name: d.sender_name != null ? String(d.sender_name) : null,
              comment: d.comment != null ? String(d.comment) : null,
              created_at: Number(d.created_at ?? rec.updatedAt),
              resolved: Number(d.resolved ?? 0),
              resolved_at: d.resolved_at != null ? Number(d.resolved_at) : null,
            } satisfies InboxRequestRow
          })
        })
        setInboxRequestsEnabled(true)
      }

      if (cachedNotices.length) {
        setInboxNotices((prev) => {
          if (prev.length) return prev
          return cachedNotices.map((rec, idx) => {
            const d = rec.payload
            return {
              id: Number(d.id ?? idx),
              platform_notice_id: String(d.platform_notice_id ?? ''),
              type: String(d.type ?? d.noticeType ?? ''),
              sub_type: d.sub_type != null ? String(d.sub_type) : null,
              channel_id: String(d.channel_id ?? ''),
              channel_type: String(d.channel_type ?? 'private'),
              operator_id: d.operator_id != null ? String(d.operator_id) : null,
              operator_name: d.operator_name != null ? String(d.operator_name) : null,
              target_id: d.target_id != null ? String(d.target_id) : null,
              target_name: d.target_name != null ? String(d.target_name) : null,
              payload: String(d.payload ?? '{}'),
              created_at: Number(d.created_at ?? rec.updatedAt),
            } satisfies InboxNoticeRow
          })
        })
        setInboxNoticesEnabled(true)
      }

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
  }, [adapter, endpointId])

  useEffect(() => {
    if (selection?.type === 'channel') {
      setInboxMessages([])
      setInboxMessagesHasMore(true)
      void loadInboxMessages()
    }
  }, [selection?.id, selection?.channelType, selection?.type, loadInboxMessages])

  useEffect(() => {
    const onPush = (ev: Event) => {
      const msg = (ev as CustomEvent).detail as {
        type: string
        data: Record<string, unknown>
      }
      const d = msg.data
      const pushEndpointId = String(d.endpointId ?? d.botId ?? '')
      if (msg.type === 'endpoint:request') {
        if (d.adapter === adapter && pushEndpointId === endpointId) {
          void putInboxCache(adapter, endpointId, 'request', d)
          setRequests((prev) => {
            const m = new Map(prev)
            m.set(d.id as number, {
              id: d.id as number,
              platformRequestId: String(d.platformRequestId),
              type: String(d.type),
              sender: d.sender as ReqItem['sender'],
              comment: String(d.comment ?? ''),
              channel: d.channel as ReqItem['channel'],
              timestamp: Number(d.timestamp),
              canAct: d.canAct === true,
            })
            return m
          })
        }
      } else if (msg.type === 'endpoint:notice') {
        if (d.adapter === adapter && pushEndpointId === endpointId) {
          void putInboxCache(adapter, endpointId, 'notice', d)
          setNotices((prev) => {
            const m = new Map(prev)
            m.set(d.id as number, {
              id: d.id as number,
              noticeType: String(d.noticeType),
              channel: d.channel as NoticeItem['channel'],
              payload: String(d.payload ?? '{}'),
              timestamp: Number(d.timestamp),
            })
            return m
          })
        }
      } else if (msg.type === 'endpoint:message') {
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
    window.addEventListener('zhin-console-bot-push', onPush as EventListener)
    return () => window.removeEventListener('zhin-console-bot-push', onPush as EventListener)
  }, [adapter, endpointId])

  const requestList = useMemo(() => [...requests.values()].sort((a, b) => b.timestamp - a.timestamp), [requests])
  const noticeList = useMemo(() => [...notices.values()].sort((a, b) => b.timestamp - a.timestamp), [notices])

  const channels = useMemo(() => {
    const list: Array<{ id: string; name: string; channelType: 'private' | 'group' | 'channel' }> = []
    friends.forEach((f) => {
      list.push({
        id: String(f.user_id),
        name: f.nickname || f.remark || f.user_id.toString(),
        channelType: 'private',
      })
    })
    groups.forEach((g) => {
      list.push({ id: String(g.group_id), name: g.name || String(g.group_id), channelType: 'group' })
    })
    channelList.forEach((c) => {
      list.push({ id: c.id, name: c.name || c.id, channelType: 'channel' })
    })
    return list
  }, [friends, groups, channelList])

  const filteredChannels = useMemo(() => {
    const q = listSearch.trim().toLowerCase()
    if (!q) return channels
    return channels.filter((ch) => ch.name.toLowerCase().includes(q) || ch.id.toLowerCase().includes(q))
  }, [channels, listSearch])

  const channelMessages = useMemo((): ChatRow[] => {
    if (selection?.type !== 'channel') return []
    const fromInbox: ChatRow[] = inboxMessages
      .filter((m) => selection.id && selection.channelType)
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

  const deleteFriend = async () => {
    if (selection?.type !== 'channel' || selection.channelType !== 'private') return
    if (!confirm(`确定删除好友 ${selection.name}？`)) return
    try {
      await sendRequest({
        type: 'endpoint:deleteFriend',
        data: { adapter, endpointId, userId: selection.id },
      })
      setFriends((prev) => prev.filter((f) => String(f.user_id) !== selection.id))
      setSelection(null)
      loadLists()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const handleSend = async () => {
    const targetId = selection?.type === 'channel' ? selection.id : ''
    const msgType = selection?.type === 'channel' ? selection.channelType : 'private'
    const segments = parseComposerToSegments(msgContent)
    if (!targetId || !hasRenderableComposerSegments(segments)) return
    setSending(true)
    try {
      await sendRequest({
        type: 'endpoint:sendMessage',
        data: {
          adapter,
          endpointId,
          id: targetId,
          type: msgType,
          content: segments,
        },
      })
      setLocalSent((prev) => [
        ...prev,
        {
          id: `local-${Date.now()}-${Math.random().toString(36).slice(2)}`,
          channelId: targetId,
          channelType: msgType,
          segments,
          timestamp: Date.now(),
        },
      ])
      setMsgContent('')
    } catch (e) {
      alert((e as Error).message)
    } finally {
      setSending(false)
    }
  }

  const approve = async (platformRequestId: string, approveIt: boolean) => {
    try {
      await sendRequest({
        type: approveIt ? 'endpoint:requestApprove' : 'endpoint:requestReject',
        data: { adapter, endpointId, requestId: platformRequestId },
      })
      const row = requestList.find((r) => r.platformRequestId === platformRequestId)
      if (row) {
        setRequests((prev) => {
          const m = new Map(prev)
          m.delete(row.id)
          return m
        })
      }
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const dismissRequest = async (id: number) => {
    try {
      await sendRequest({ type: 'endpoint:requestConsumed', data: { id } })
      setRequests((prev) => {
        const m = new Map(prev)
        m.delete(id)
        return m
      })
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const dismissNotice = async (id: number) => {
    try {
      await sendRequest({ type: 'endpoint:noticeConsumed', data: { id } })
      setNotices((prev) => {
        const m = new Map(prev)
        m.delete(id)
        return m
      })
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const loadMembers = async () => {
    if (selection?.type !== 'channel' || selection.channelType !== 'group' || adapter !== 'icqq') return
    setMembersLoading(true)
    try {
      const r = await sendRequest<{ members: MemberRow[] }>({
        type: 'endpoint:groupMembers',
        data: { adapter, endpointId, groupId: selection.id },
      })
      setMembers(r.members || [])
    } catch (e) {
      alert((e as Error).message)
      setMembers([])
    } finally {
      setMembersLoading(false)
    }
  }

  const groupAction = async (
    type: 'endpoint:groupKick' | 'endpoint:groupMute' | 'endpoint:groupAdmin',
    userId: number | string,
    extra?: { enable?: boolean },
  ) => {
    if (selection?.type !== 'channel' || selection.channelType !== 'group') return
    try {
      await sendRequest({
        type,
        data: {
          adapter,
          endpointId,
          groupId: selection.id,
          userId: String(userId),
          ...extra,
        },
      })
      await loadMembers()
    } catch (e) {
      alert((e as Error).message)
    }
  }

  const getChannelIcon = (channelType: string): ReactNode => {
    switch (channelType) {
      case 'private':
        return <User size={16} />
      case 'group':
        return <Users size={16} />
      case 'channel':
        return <Hash size={16} />
      default:
        return <MessageSquare size={16} />
    }
  }

  const showRightPanel =
    selection?.type === 'channel' && selection.channelType === 'group' && adapter === 'icqq'

  return {
    valid,
    adapter,
    endpointId,
    connected,
    info,
    loadErr,
    msgContent,
    setMsgContent,
    sending,
    listLoading,
    listErr,
    selection,
    setSelection,
    showChannelList,
    setShowChannelList,
    listSearch,
    setListSearch,
    members,
    membersLoading,
    channelMessages,
    inboxMessagesLoading,
    inboxMessagesHasMore,
    inboxMessagesEnabled,
    loadInboxMessages,
    inboxMessages,
    requestList,
    noticeList,
    requestsTab,
    setRequestsTab,
    noticesTab,
    setNoticesTab,
    inboxRequests,
    inboxRequestsLoading,
    inboxRequestsEnabled,
    loadInboxRequests,
    inboxNotices,
    inboxNoticesLoading,
    inboxNoticesEnabled,
    loadInboxNotices,
    channels,
    filteredChannels,
    deleteFriend,
    handleSend,
    approve,
    dismissRequest,
    dismissNotice,
    loadMembers,
    groupAction,
    loadLists,
    loadRequestsFromServer,
    getChannelIcon,
    showRightPanel,
  }
}
