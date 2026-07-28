import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useWebSocket } from '@zhin.js/client'
import type {
  EndpointInfo,
  InboxRequestRow,
  InboxNoticeRow,
  ReqItem,
  NoticeItem,
} from './types'
import { normalizeInboundContent } from '../../utils/parseComposerContent'
import { listInboxCache, putInboxCache } from '../../utils/inbox-cache'
import { useChannelManager } from './useChannelManager'
import { useMessageHistory } from './useMessageHistory'
import { useGroupActions } from './useGroupActions'
import { subscribeEndpointPush } from '../../utils/endpoint-push'

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

  // --- Endpoint info ---
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

  // --- Channel manager ---
  const channelMgr = useChannelManager({ adapter, endpointId, connected, info })

  // --- Message history ---
  const msgHistory = useMessageHistory({
    adapter,
    endpointId,
    selection: channelMgr.selection,
  })

  // --- Group actions ---
  const groupAct = useGroupActions({
    adapter,
    endpointId,
    selection: channelMgr.selection,
  })

  // --- Requests & notices state ---
  const [requests, setRequests] = useState<Map<number, ReqItem>>(new Map())
  const [notices, setNotices] = useState<Map<number, NoticeItem>>(new Map())
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

  // --- Load requests from server ---
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
          m.set(r.id, { ...r, canAct: false })
        }
        return m
      })
    } catch {
      /* ignore */
    }
  }, [adapter, endpointId, connected, sendRequest])

  useEffect(() => {
    loadRequestsFromServer()
  }, [loadRequestsFromServer])

  // --- Load inbox requests ---
  // 递增序号：切换 endpoint 后在途的旧请求 resolve 时序号已过期，直接丢弃
  const inboxRequestsSeqRef = useRef(0)
  const inboxNoticesSeqRef = useRef(0)
  const loadInboxRequests = useCallback(
    async (append: boolean) => {
      if (!adapter || !endpointId) return
      const seq = ++inboxRequestsSeqRef.current
      setInboxRequestsLoading(true)
      try {
        const offset = append ? inboxRequestsOffset : 0
        const res = await sendRequest<{ requests: InboxRequestRow[]; inboxEnabled: boolean }>({
          type: 'endpoint:inboxRequests',
          data: { adapter, endpointId, limit: 30, offset },
        })
        if (seq !== inboxRequestsSeqRef.current) return
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
        // 一次性网络错误不改变 enabled 状态；仅服务端明确 inboxEnabled===false 才置 false
        if (seq !== inboxRequestsSeqRef.current) return
        if (!append) setInboxRequests([])
      } finally {
        if (seq === inboxRequestsSeqRef.current) setInboxRequestsLoading(false)
      }
    },
    [adapter, endpointId, inboxRequestsOffset, sendRequest],
  )

  // --- Load inbox notices ---
  const loadInboxNotices = useCallback(
    async (append: boolean) => {
      if (!adapter || !endpointId) return
      const seq = ++inboxNoticesSeqRef.current
      setInboxNoticesLoading(true)
      try {
        const offset = append ? inboxNoticesOffset : 0
        const res = await sendRequest<{ notices: InboxNoticeRow[]; inboxEnabled: boolean }>({
          type: 'endpoint:inboxNotices',
          data: { adapter, endpointId, limit: 30, offset },
        })
        if (seq !== inboxNoticesSeqRef.current) return
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
        // 一次性网络错误不改变 enabled 状态；仅服务端明确 inboxEnabled===false 才置 false
        if (seq !== inboxNoticesSeqRef.current) return
        if (!append) setInboxNotices([])
      } finally {
        if (seq === inboxNoticesSeqRef.current) setInboxNoticesLoading(false)
      }
    },
    [adapter, endpointId, inboxNoticesOffset, sendRequest],
  )

  // --- Hydrate requests/notices/messages from local inbox cache ---
  useEffect(() => {
    if (!adapter || !endpointId) return
    let cancelled = false
    void (async () => {
      const [cachedRequests, cachedNotices] = await Promise.all([
        listInboxCache(adapter, endpointId, 'request'),
        listInboxCache(adapter, endpointId, 'notice'),
      ])
      if (cancelled) return

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
    })()
    return () => {
      cancelled = true
    }
  }, [adapter, endpointId])

  // --- Listen for real-time push events for requests and notices ---
  useEffect(() => {
    const onPush = (msg: { type: string; data?: Record<string, unknown> }) => {
      const d = msg.data
      if (!d) return
      const pushEndpointId = String(d.endpointId ?? '')
      if (msg.type === 'request.receive') {
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
      } else if (msg.type === 'notice.receive') {
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
      }
    }
    return subscribeEndpointPush(onPush)
  }, [adapter, endpointId])

  // --- Derived lists ---
  const requestList = useMemo(() => [...requests.values()].sort((a, b) => b.timestamp - a.timestamp), [requests])
  const noticeList = useMemo(() => [...notices.values()].sort((a, b) => b.timestamp - a.timestamp), [notices])

  // --- Request/notice actions ---
  const approve = useCallback(
    async (platformRequestId: string, approveIt: boolean) => {
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
        console.error('Failed to approve/reject request:', (e as Error).message)
      }
    },
    [sendRequest, adapter, endpointId, requestList],
  )

  const dismissRequest = useCallback(
    async (id: number) => {
      try {
        await sendRequest({ type: 'endpoint:requestConsumed', data: { id } })
        setRequests((prev) => {
          const m = new Map(prev)
          m.delete(id)
          return m
        })
      } catch (e) {
        console.error('Failed to dismiss request:', (e as Error).message)
      }
    },
    [sendRequest],
  )

  const dismissNotice = useCallback(
    async (id: number) => {
      try {
        await sendRequest({ type: 'endpoint:noticeConsumed', data: { id } })
        setNotices((prev) => {
          const m = new Map(prev)
          m.delete(id)
          return m
        })
      } catch (e) {
        console.error('Failed to dismiss notice:', (e as Error).message)
      }
    },
    [sendRequest],
  )

  const refreshNotices = useCallback(async () => {
    if (!adapter || !endpointId) return
    const cachedNotices = await listInboxCache(adapter, endpointId, 'notice')
    if (cachedNotices.length) {
      setNotices((prev) => {
        const m = new Map(prev)
        for (const rec of cachedNotices) {
          const d = rec.payload
          const id = d.id as number
          if (id == null) continue
          m.set(id, {
            id,
            noticeType: String(d.noticeType ?? d.type ?? ''),
            channel: (d.channel as NoticeItem['channel']) ?? { id: '', type: 'private' },
            payload: String(d.payload ?? '{}'),
            timestamp: Number(d.timestamp ?? rec.updatedAt),
          })
        }
        return m
      })
    }
    if (noticesTab === 'history') {
      await loadInboxNotices(false)
    }
  }, [adapter, endpointId, noticesTab, loadInboxNotices])

  const showRightPanel =
    channelMgr.selection?.type === 'channel' && channelMgr.selection.channelType === 'group' && adapter === 'icqq'

  // --- Public API (preserves original shape) ---
  return {
    valid,
    adapter,
    endpointId,
    connected,
    info,
    loadErr,
    // message sending
    msgContent: msgHistory.msgContent,
    setMsgContent: msgHistory.setMsgContent,
    sending: msgHistory.sending,
    // channel manager
    listLoading: channelMgr.listLoading,
    listErr: channelMgr.listErr,
    selection: channelMgr.selection,
    setSelection: channelMgr.setSelection,
    showChannelList: channelMgr.showChannelList,
    setShowChannelList: channelMgr.setShowChannelList,
    listSearch: channelMgr.listSearch,
    setListSearch: channelMgr.setListSearch,
    channels: channelMgr.channels,
    filteredChannels: channelMgr.filteredChannels,
    conversationSections: channelMgr.conversationSections,
    sectionCollapsed: channelMgr.sectionCollapsed,
    systemSectionCollapsed: channelMgr.systemSectionCollapsed,
    toggleSection: channelMgr.toggleSection,
    toggleSystemSection: channelMgr.toggleSystemSection,
    markConversationRead: channelMgr.markConversationRead,
    deleteFriend: channelMgr.deleteFriend,
    getChannelIcon: channelMgr.getChannelIcon,
    loadLists: channelMgr.loadLists,
    // message history
    channelMessages: msgHistory.channelMessages,
    inboxMessagesLoading: msgHistory.inboxMessagesLoading,
    inboxMessagesHasMore: msgHistory.inboxMessagesHasMore,
    inboxMessagesEnabled: msgHistory.inboxMessagesEnabled,
    loadInboxMessages: msgHistory.loadInboxMessages,
    inboxMessages: msgHistory.inboxMessages,
    handleSend: msgHistory.handleSend,
    // group actions
    members: groupAct.members,
    membersLoading: groupAct.membersLoading,
    loadMembers: groupAct.loadMembers,
    groupAction: groupAct.groupAction,
    // requests & notices
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
    loadRequestsFromServer,
    refreshNotices,
    approve,
    dismissRequest,
    dismissNotice,
    showRightPanel,
  }
}
