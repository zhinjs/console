import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { Hash, MessageSquare, User, Users } from 'lucide-react'
import { useWebSocket } from '@zhin.js/client'
import { useToast } from '../../components/toast'
import type {
  ChannelParentRef,
  ConversationChannelType,
  ConversationEntry,
  ConversationSection,
  ConversationSectionId,
  EndpointInfo,
  SidebarSelection,
} from './types'
import { listInboxCache } from '../../utils/inbox-cache'
import {
  adapterListHint,
  adapterSupportsChannels,
  adapterSupportsPrivateGroups,
  sectionEmptyHint,
} from '../../utils/endpoint-adapter'
import { subscribeEndpointPush } from '../../utils/endpoint-push'
import {
  buildMetadataIndex,
  conversationKey,
  ingestInboxRow,
  previewFromMessageContent,
  unreadCountForConversation,
  type ConversationMetaIndex,
  type ConversationNameIndex,
} from './conversation-metadata'
import {
  channelNameFromMessagePayload,
  channelEntryFromPushPayload,
  displayNameForConversation,
  fetchEndpointChannelCatalog,
  normalizeFriendRecord,
  normalizeGroupRecord,
  pickLabel,
  toConsoleChannelParent,
  mergeInboxSessions,
  type ChannelsEntry,
  type FriendsEntry,
  type GroupsEntry,
} from './conversation-labels'
import { setLastReadAt } from './conversation-read-state'

interface ChannelEntry {
  id: string
  name: string
  channelType: ConversationChannelType
  parent?: ChannelParentRef
}

function normalizeList<T>(items: unknown[], map: (raw: Record<string, unknown>) => T): T[] {
  return items
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(map)
}

const SECTION_TITLES: Record<ConversationSectionId, string> = {
  private: '私聊',
  group: '群聊',
  channel: '频道',
}

function sortEntries(entries: ConversationEntry[]): ConversationEntry[] {
  return [...entries].sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0))
}

export function useChannelManager(params: {
  adapter: string
  endpointId: string
  connected: boolean
  info: EndpointInfo | null
}) {
  const { adapter, endpointId, connected, info } = params
  const { sendRequest } = useWebSocket()
  const { success, error: toastError } = useToast()

  const [friends, setFriends] = useState<FriendsEntry[]>([])
  const [groups, setGroups] = useState<GroupsEntry[]>([])
  const [channelList, setChannelList] = useState<ChannelsEntry[]>([])
  const [listLoading, setListLoading] = useState(false)
  const [listErr, setListErr] = useState<string | null>(null)
  const [metaIndex, setMetaIndex] = useState<ConversationMetaIndex>(new Map())
  const [nameIndex, setNameIndex] = useState<ConversationNameIndex>(new Map())

  const [selection, setSelection] = useState<SidebarSelection | null>(null)
  const [showChannelList, setShowChannelList] = useState(false)
  const [listSearch, setListSearch] = useState('')
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<ConversationSectionId, boolean>>({
    private: false,
    group: false,
    channel: false,
  })
  const [systemSectionCollapsed, setSystemSectionCollapsed] = useState(false)

  const loadChannelsFromInbox = useCallback(async (): Promise<ChannelEntry[]> => {
    const byKey = new Map<
      string,
      {
        id: string
        name: string
        channelType: ConversationChannelType
        ts: number
        parent?: ChannelParentRef
      }
    >()
    const upsert = (
      channelType: string,
      channelId: string,
      name: string | null | undefined,
      ts: number,
      parent?: ChannelParentRef,
    ) => {
      if (channelType !== 'private' && channelType !== 'group' && channelType !== 'channel') return
      const scope = channelType as ConversationChannelType
      const key = `${scope}:${channelId}`
      const prev = byKey.get(key)
      const safeTs = Number(ts) || 0
      const label = name?.trim() || String(channelId)
      if (!prev || safeTs > prev.ts) {
        byKey.set(key, {
          id: String(channelId),
          name: label,
          channelType: scope,
          ts: safeTs,
          ...(parent ? { parent } : {}),
        })
      } else if (parent && !prev.parent) {
        byKey.set(key, { ...prev, parent })
      }
    }

    try {
      const result = await sendRequest<{
        rows: Array<{
          channel_id: string
          channel_type: string
          channel_name?: string | null
          channel_parent_type?: string | null
          channel_parent_id?: string | null
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
        const channelType = String(row.channel_type)
        const channelId = String(row.channel_id)
        const name =
          channelType === 'private'
            ? row.sender_name
            : pickLabel(row.channel_name) ?? undefined
        const parent = toConsoleChannelParent({
          type: row.channel_parent_type ?? undefined,
          id: row.channel_parent_id ?? undefined,
        })
        const displayName =
          channelType === 'channel' && parent?.name && name && !name.includes(parent.name)
            ? `${parent.name} / ${name}`
            : name
        upsert(channelType, channelId, displayName, row.created_at, parent)
      }
    } catch {
      // inbox DB not available
    }

    if (byKey.size === 0) {
      const cached = await listInboxCache(adapter, endpointId, 'message')
      for (const rec of cached) {
        const d = rec.payload
        const channelId = String(d.channelId ?? d.channel_id ?? '')
        const channelType = String(d.channelType ?? d.channel_type ?? 'private')
        const name = channelNameFromMessagePayload(d, channelType)
        const parent = toConsoleChannelParent(
          (d.parent as { type?: string; id?: string; name?: string } | undefined) ??
            ((d.channel as { parent?: { type?: string; id?: string; name?: string } } | undefined)
              ?.parent),
        )
        upsert(channelType, channelId, name, Number(d.timestamp ?? rec.updatedAt), parent)
      }
    }

    return [...byKey.values()]
      .sort((a, b) => b.ts - a.ts)
      .map(({ id, name, channelType, parent }) =>
        parent ? { id, name, channelType, parent } : { id, name, channelType },
      )
  }, [adapter, endpointId, sendRequest])

  const refreshMetadata = useCallback(async () => {
    const { meta, names } = await buildMetadataIndex(adapter, endpointId, sendRequest)
    setMetaIndex(meta)
    setNameIndex(names)
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
    let inboxMergedCount = 0

    try {
      const loadFriendsGroups = adapterSupportsPrivateGroups(adapter)

      if (loadFriendsGroups) {
        try {
          const f = await sendRequest<{ friends: unknown[] }>({
            type: 'endpoint:friends',
            data: { adapter, endpointId },
          })
          nextFriends = normalizeList(f.friends ?? [], normalizeFriendRecord).filter(
            (x) => x.user_id > 0,
          )
        } catch (e) {
          errors.push(`好友列表：${(e as Error).message}`)
        }
        try {
          const g = await sendRequest<{ groups: unknown[] }>({
            type: 'endpoint:groups',
            data: { adapter, endpointId },
          })
          nextGroups = normalizeList(g.groups ?? [], normalizeGroupRecord).filter(
            (x) => x.group_id > 0,
          )
        } catch (e) {
          errors.push(`群列表：${(e as Error).message}`)
        }
      }

      try {
        nextChannels = await fetchEndpointChannelCatalog(sendRequest, adapter, endpointId)
      } catch (e) {
        errors.push(`频道列表：${(e as Error).message}`)
      }

      const rpcEmpty =
        nextFriends.length === 0 && nextGroups.length === 0 && nextChannels.length === 0

      const inboxChannels = await loadChannelsFromInbox()
      if (inboxChannels.length > 0) {
        const merged = mergeInboxSessions(nextFriends, nextGroups, nextChannels, inboxChannels)
        nextFriends = merged.friends
        nextGroups = merged.groups
        nextChannels = merged.channels
        inboxMergedCount = merged.mergedCount
        if (rpcEmpty && inboxMergedCount > 0) {
          usedInboxFallback = true
        }
      }

      setFriends(nextFriends)
      setGroups(nextGroups)
      setChannelList(nextChannels)
      await refreshMetadata()

      const total = nextFriends.length + nextGroups.length + nextChannels.length
      if (total === 0) {
        const hint = adapterListHint(adapter)
        if (errors.length) {
          setListErr(`${errors.join('；')}。${hint}`)
        } else if (!info?.connected) {
          setListErr(`Endpoint 未在线。${hint}`)
        } else {
          setListErr(`暂无会话。${hint}`)
        }
      } else if (usedInboxFallback) {
        setListErr('已从收件箱历史恢复最近会话（主列表接口未返回数据）')
      } else if (inboxMergedCount > 0) {
        setListErr(`已从收件箱补充 ${inboxMergedCount} 个最近会话`)
      } else if (errors.length) {
        setListErr(errors.join('；'))
      }
    } catch (e) {
      setListErr((e as Error).message)
    } finally {
      setListLoading(false)
    }
  }, [adapter, endpointId, connected, sendRequest, loadChannelsFromInbox, info?.connected, refreshMetadata])

  useEffect(() => {
    if (connected) loadLists()
  }, [connected, loadLists])

  const resolveDisplayName = useCallback(
    (channelType: ConversationChannelType, id: string, primaryName: string) => {
      const hint = nameIndex.get(conversationKey(channelType, id))
      return displayNameForConversation(channelType, id, primaryName, hint)
    },
    [nameIndex],
  )

  const buildEntry = useCallback(
    (
      id: string,
      name: string,
      channelType: ConversationChannelType,
      parent?: ChannelParentRef,
    ): ConversationEntry => {
      const key = conversationKey(channelType, id)
      const meta = metaIndex.get(key)
      const displayName = resolveDisplayName(channelType, id, name)
      return {
        id,
        name: displayName,
        channelType,
        ...(parent ? { parent } : {}),
        lastMessagePreview: meta?.lastMessagePreview,
        lastMessageAt: meta?.lastMessageAt,
        unreadCount: unreadCountForConversation(adapter, endpointId, channelType, id, meta),
      }
    },
    [adapter, endpointId, metaIndex, resolveDisplayName],
  )

  const channels = useMemo(() => {
    const list: ChannelEntry[] = []
    friends.forEach((f) => {
      const id = String(f.user_id)
      list.push({
        id,
        name: resolveDisplayName('private', id, f.nickname || f.remark || id),
        channelType: 'private',
      })
    })
    groups.forEach((g) => {
      const id = String(g.group_id)
      list.push({
        id,
        name: resolveDisplayName('group', id, g.name),
        channelType: 'group',
      })
    })
    channelList.forEach((c) => {
      list.push({
        id: c.id,
        name: resolveDisplayName('channel', c.id, c.name),
        channelType: 'channel',
        parent: c.parent,
      })
    })
    return list
  }, [friends, groups, channelList, resolveDisplayName])

  const conversationSections = useMemo((): ConversationSection[] => {
    const q = listSearch.trim().toLowerCase()
    const filterEntry = (e: ConversationEntry) =>
      !q || e.name.toLowerCase().includes(q) || e.id.toLowerCase().includes(q)

    const privateEntries = sortEntries(
      friends.map((f) =>
        buildEntry(
          String(f.user_id),
          f.nickname || f.remark || f.user_id.toString(),
          'private',
        ),
      ),
    ).filter(filterEntry)

    const groupEntries = sortEntries(
      groups.map((g) =>
        buildEntry(String(g.group_id), g.name, 'group'),
      ),
    ).filter(filterEntry)

    const channelEntries = sortEntries(
      channelList.map((c) => buildEntry(c.id, c.name, 'channel', c.parent)),
    ).filter(filterEntry)

    const showPrivate = adapterSupportsPrivateGroups(adapter) || privateEntries.length > 0
    const showGroup = adapterSupportsPrivateGroups(adapter) || groupEntries.length > 0
    const showChannel = adapterSupportsChannels(adapter) || channelEntries.length > 0

    const sections: ConversationSection[] = [
      {
        id: 'private',
        title: SECTION_TITLES.private,
        entries: privateEntries,
        emptyHint: sectionEmptyHint(adapter, 'private'),
        hidden: !showPrivate,
      },
      {
        id: 'group',
        title: SECTION_TITLES.group,
        entries: groupEntries,
        emptyHint: sectionEmptyHint(adapter, 'group'),
        hidden: !showGroup,
      },
      {
        id: 'channel',
        title: SECTION_TITLES.channel,
        entries: channelEntries,
        emptyHint: sectionEmptyHint(adapter, 'channel'),
        hidden: !showChannel,
      },
    ]

    if (q) {
      return sections.filter((s) => !s.hidden && s.entries.length > 0)
    }
    return sections.filter((s) => !s.hidden)
  }, [adapter, friends, groups, channelList, listSearch, buildEntry])

  const filteredChannels = useMemo(() => {
    return conversationSections.flatMap((s) => s.entries)
  }, [conversationSections])

  const markConversationRead = useCallback(
    (channelType: ConversationChannelType, channelId: string, at?: number) => {
      const meta = metaIndex.get(conversationKey(channelType, channelId))
      const readAt = at ?? meta?.lastMessageAt ?? Date.now()
      setLastReadAt(adapter, endpointId, channelType, channelId, readAt)
    },
    [adapter, endpointId, metaIndex],
  )

  useEffect(() => {
    if (selection?.type === 'channel') {
      markConversationRead(selection.channelType, selection.id)
    }
  }, [selection, markConversationRead])

  useEffect(() => {
    if (!adapter || !endpointId) return
    return subscribeEndpointPush((message) => {
      if (message.type !== 'endpoint:message') return
      const d = message.data as Record<string, unknown> | undefined
      if (!d) return
      const pushAdapter = String(d.adapter ?? '')
      const pushEndpointId = String(d.endpointId ?? '')
      if (pushAdapter !== adapter || pushEndpointId !== endpointId) return

      const channelId = String(d.channelId ?? d.channel_id ?? '')
      const channelType = String(d.channelType ?? d.channel_type ?? 'private') as ConversationChannelType
      if (channelType !== 'private' && channelType !== 'group' && channelType !== 'channel') return

      const ts = Number(d.timestamp ?? Date.now())
      const preview = previewFromMessageContent(d.content)

      const channelName = channelNameFromMessagePayload(d, channelType)
      if (channelName) {
        setNameIndex((prev) => {
          const next = new Map(prev)
          next.set(conversationKey(channelType, channelId), channelName)
          return next
        })
      }

      if (channelType === 'channel') {
        const entry = channelEntryFromPushPayload(d, channelId)
        if (entry) {
          setChannelList((prev) => {
            if (prev.some((c) => c.id === channelId)) return prev
            return [...prev, entry]
          })
        }
      }

      setMetaIndex((prev) => {
        const next = new Map(prev)
        ingestInboxRow(next, channelType, channelId, d.content, ts, undefined, d)
        return next
      })

      const isActive =
        selection?.type === 'channel' &&
        selection.id === channelId &&
        selection.channelType === channelType

      if (isActive) {
        markConversationRead(channelType, channelId, ts)
      }
    })
  }, [adapter, endpointId, selection, markConversationRead])

  const toggleSection = useCallback((id: ConversationSectionId) => {
    setSectionCollapsed((prev) => ({ ...prev, [id]: !prev[id] }))
  }, [])

  const toggleSystemSection = useCallback(() => {
    setSystemSectionCollapsed((prev) => !prev)
  }, [])

  const deleteFriend = useCallback(async () => {
    if (selection?.type !== 'channel' || selection.channelType !== 'private') return false
    try {
      await sendRequest({
        type: 'endpoint:deleteFriend',
        data: { adapter, endpointId, userId: selection.id },
      })
      setFriends((prev) => prev.filter((f) => String(f.user_id) !== selection.id))
      setSelection(null)
      await loadLists()
      success(`已删除好友「${selection.name}」`)
      return true
    } catch (e) {
      toastError((e as Error).message, '删除好友失败')
      return false
    }
  }, [selection, sendRequest, adapter, endpointId, loadLists, success, toastError])

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

  const removeFriend = useCallback((userId: string) => {
    setFriends((prev) => prev.filter((f) => String(f.user_id) !== userId))
  }, [])

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
    conversationSections,
    sectionCollapsed,
    systemSectionCollapsed,
    toggleSection,
    toggleSystemSection,
    markConversationRead,
    loadLists,
    deleteFriend,
    getChannelIcon,
    setFriends,
    setGroups,
    setChannelList,
    removeFriend,
  }
}
