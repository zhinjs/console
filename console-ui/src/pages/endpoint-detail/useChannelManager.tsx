import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Hash, MessageSquare, User, Users } from 'lucide-react'
import { useWebSocket } from '@zhin.js/client'
import type { EndpointInfo, SidebarSelection } from './types'
import { listInboxCache } from '../../utils/inbox-cache'
import { adapterListHint, isIcqqAdapter } from '../../utils/endpoint-adapter'

export interface ChannelEntry {
  id: string
  name: string
  channelType: 'private' | 'group' | 'channel'
}

interface FriendsEntry {
  user_id: number
  nickname: string
  remark: string
}

interface GroupsEntry {
  group_id: number
  name: string
}

interface ChannelsEntry {
  id: string
  name: string
}

export function useChannelManager(params: {
  adapter: string
  endpointId: string
  connected: boolean
  info: EndpointInfo | null
}) {
  const { adapter, endpointId, connected, info } = params
  const { sendRequest } = useWebSocket()

  const [friends, setFriends] = useState<FriendsEntry[]>([])
  const [groups, setGroups] = useState<GroupsEntry[]>([])
  const [channelList, setChannelList] = useState<ChannelsEntry[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listErr, setListErr] = useState<string | null>(null)

  const [selection, setSelection] = useState<SidebarSelection | null>(null)
  const [showChannelList, setShowChannelList] = useState(false)
  const [listSearch, setListSearch] = useState('')

  const loadChannelsFromInbox = useCallback(async (): Promise<ChannelEntry[]> => {
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
      // inbox DB not available, fall through to local cache
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
    let nextFriends: FriendsEntry[] = []
    let nextGroups: GroupsEntry[] = []
    let nextChannels: ChannelsEntry[] = []
    let usedInboxFallback = false

    try {
      const tryFriendsGroups = isIcqqAdapter(adapter) || adapter === 'napcat'
      if (tryFriendsGroups) {
        try {
          const f = await sendRequest<{ friends: FriendsEntry[] }>({
            type: 'endpoint:friends',
            data: { adapter, endpointId },
          })
          nextFriends = f.friends || []
        } catch (e) {
          errors.push(`好友列表：${(e as Error).message}`)
        }
        try {
          const g = await sendRequest<{ groups: GroupsEntry[] }>({
            type: 'endpoint:groups',
            data: { adapter, endpointId },
          })
          nextGroups = g.groups || []
        } catch (e) {
          errors.push(`群列表：${(e as Error).message}`)
        }
      } else {
        try {
          const ch = await sendRequest<{ channels?: ChannelsEntry[] }>({
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

  const channels = useMemo(() => {
    const list: ChannelEntry[] = []
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

  const deleteFriend = useCallback(async () => {
    if (selection?.type !== 'channel' || selection.channelType !== 'private') return
    try {
      await sendRequest({
        type: 'endpoint:deleteFriend',
        data: { adapter, endpointId, userId: selection.id },
      })
      setFriends((prev) => prev.filter((f) => String(f.user_id) !== selection.id))
      setSelection(null)
      loadLists()
    } catch (e) {
      console.error('Failed to delete friend:', (e as Error).message)
    }
  }, [selection, sendRequest, adapter, endpointId, loadLists])

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

  const removeFriend = useCallback(
    (userId: string) => {
      setFriends((prev) => prev.filter((f) => String(f.user_id) !== userId))
    },
    [],
  )

  return {
    friends,
    groups,
    channelList,
    listLoading,
    listErr,
    selection,
    setSelection,
    showChannelList,
    setShowChannelList,
    listSearch,
    setListSearch,
    channels,
    filteredChannels,
    loadLists,
    deleteFriend,
    getChannelIcon,
    setFriends,
    setGroups,
    setChannelList,
    removeFriend,
  }
}
