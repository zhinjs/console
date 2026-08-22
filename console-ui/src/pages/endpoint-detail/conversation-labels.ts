import type { ChannelParentRef, ChannelParentType, ConversationChannelType } from './types'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'

export function pickLabel(...candidates: unknown[]): string | undefined {
  for (const c of candidates) {
    if (c == null) continue
    const s = typeof c === 'string' ? c.trim() : String(c).trim()
    if (s) return s
  }
  return undefined
}

/** 名称是否实质等于 ID（纯数字 ID 等） */
export function isIdLikeName(name: string | undefined, id: string): boolean {
  if (!name?.trim()) return true
  const n = name.trim()
  const i = id.trim()
  if (n === i) return true
  if (/^\d+$/.test(n) && /^\d+$/.test(i) && n === i) return true
  return false
}

export function displayNameForConversation(
  channelType: ConversationChannelType,
  id: string,
  primaryName: string | undefined,
  hintName?: string,
): string {
  const resolved = pickLabel(hintName, primaryName)
  if (resolved && !isIdLikeName(resolved, id)) return resolved
  if (channelType === 'group') return `群聊 ${id}`
  if (channelType === 'channel') return `频道 ${id}`
  return resolved || id
}

export interface FriendsEntry {
  user_id: number
  nickname: string
  remark: string
}

export interface GroupsEntry {
  group_id: number
  name: string
}

export interface ChannelsEntry {
  id: string
  name: string
  parent?: ChannelParentRef
}

export interface InboxChannelEntry {
  id: string
  name: string
  channelType: ConversationChannelType
  parent?: ChannelParentRef
}

/** 将收件箱恢复的会话并入 RPC 列表（按 id 去重，不覆盖已有 RPC 项） */
export function mergeInboxSessions(
  friends: FriendsEntry[],
  groups: GroupsEntry[],
  channels: ChannelsEntry[],
  inbox: InboxChannelEntry[],
): { friends: FriendsEntry[]; groups: GroupsEntry[]; channels: ChannelsEntry[]; mergedCount: number } {
  const friendIds = new Set(friends.map((f) => String(f.user_id)))
  const groupIds = new Set(groups.map((g) => String(g.group_id)))
  const channelIds = new Set(channels.map((c) => c.id))
  let mergedCount = 0

  const outFriends = [...friends]
  const outGroups = [...groups]
  const outChannels = [...channels]

  for (const item of inbox) {
    if (item.channelType === 'private') {
      if (friendIds.has(item.id)) continue
      friendIds.add(item.id)
      outFriends.push({
        user_id: Number(item.id) || 0,
        nickname: item.name,
        remark: '',
      })
      mergedCount++
    } else if (item.channelType === 'group') {
      if (groupIds.has(item.id)) continue
      groupIds.add(item.id)
      outGroups.push({
        group_id: Number(item.id) || 0,
        name: item.name,
      })
      mergedCount++
    } else if (item.channelType === 'channel') {
      if (channelIds.has(item.id)) continue
      channelIds.add(item.id)
      outChannels.push(
        item.parent ? { id: item.id, name: item.name, parent: item.parent } : { id: item.id, name: item.name },
      )
      mergedCount++
    }
  }

  return { friends: outFriends, groups: outGroups, channels: outChannels, mergedCount }
}

export function normalizeFriendRecord(raw: Record<string, unknown>): FriendsEntry {
  const user_id = Number(raw.user_id ?? raw.userId ?? raw.id ?? 0)
  const nickname =
    pickLabel(raw.nickname, raw.name, raw.user_name, raw.userName) ?? String(user_id || '')
  const remark = pickLabel(raw.remark, raw.card) ?? ''
  return { user_id, nickname, remark }
}

export function normalizeGroupRecord(raw: Record<string, unknown>): GroupsEntry {
  const group_id = Number(raw.group_id ?? raw.groupId ?? raw.id ?? 0)
  const name =
    pickLabel(
      raw.group_name,
      raw.groupName,
      raw.name,
      raw.nickname,
      raw.title,
      raw.remark,
      raw.card,
    ) ?? String(group_id || '')
  return { group_id, name }
}

function normalizeChannelParent(raw: unknown): ChannelParentRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  return toConsoleChannelParent(raw as { type?: string; id?: string; name?: string })
}

/** 与 Host `endpoint-channel.toConsoleChannelParent` 对齐（legacy channel → guild） */
export function toConsoleChannelParent(
  parent: { type?: string; id?: string; name?: string } | undefined | null,
): ChannelParentRef | undefined {
  if (!parent?.id) return undefined
  const id = String(parent.id)
  const name = pickLabel(parent.name)
  if (parent.type === 'group') {
    return name ? { type: 'group', id, name } : { type: 'group', id }
  }
  if (parent.type === 'guild') {
    return name ? { type: 'guild', id, name } : { type: 'guild', id }
  }
  // legacy: QQ 频道曾用 parent.type=channel 表示 guild_id
  if (parent.type === 'channel') {
    return name ? { type: 'guild', id, name } : { type: 'guild', id }
  }
  return undefined
}

/** Endpoint / Inbox RPC 出站 parent */
export function toRpcChannelParent(
  parent: ChannelParentRef | undefined,
): { type: ChannelParentType; id: string } | undefined {
  const normalized = parent ? toConsoleChannelParent(parent) : undefined
  if (!normalized) return undefined
  return { type: normalized.type, id: normalized.id }
}

export function normalizeChannelRecord(raw: Record<string, unknown>): ChannelsEntry {
  const id = String(raw.id ?? raw.channel_id ?? raw.channelId ?? '')
  const parent = normalizeChannelParent(raw.parent)
  const guildName = pickLabel(raw.guild_name, raw.guildName, parent?.name)
  const channelName = pickLabel(
    raw.name,
    raw.channel_name,
    raw.channelName,
    raw.label,
    raw.title,
  )
  const name =
    guildName && channelName && !channelName.includes(guildName)
      ? `${guildName} / ${channelName}`
      : (channelName ?? guildName ?? id)
  return parent ? { id, name, parent } : { id, name }
}

type SendRequestFn = <T>(req: { type: string; [key: string]: unknown }) => Promise<T>

/** 统一 Endpoint channel catalog RPC（ICQQ / QQ / 其他适配器） */
export async function fetchEndpointChannelCatalog(
  sendRequest: SendRequestFn,
  adapter: string,
  endpointId: string,
): Promise<ChannelsEntry[]> {
  const res = await sendRequest<{ channels?: unknown[]; count?: number }>({
    type: ENDPOINT_RPC.CHANNELS,
    data: { adapter, endpointKey: endpointId },
  })
  return (res.channels ?? [])
    .filter((item): item is Record<string, unknown> => !!item && typeof item === 'object')
    .map(normalizeChannelRecord)
    .filter((x) => x.id)
}

/** 从 Host 推送的 channel / parent 字段构建频道列表项 */
export function channelEntryFromPushPayload(
  d: Record<string, unknown>,
  channelId: string,
): ChannelsEntry | null {
  const channelType = String(d.channelType ?? d.channel_type ?? '')
  if (channelType !== 'channel') return null
  const ch = d.channel as Record<string, unknown> | undefined
  const parent = toConsoleChannelParent(
    (d.parent as { type?: string; id?: string; name?: string } | undefined) ??
      (ch?.parent as { type?: string; id?: string; name?: string } | undefined),
  )
  return normalizeChannelRecord({
    id: channelId,
    name: ch?.name,
    channel_name: d.channel_name ?? d.channelName,
    parent,
    guild_name: parent?.name,
  })
}

/** 从消息/收件箱 payload 提取会话（群/频道）显示名，勿用 sender 充当群名 */
export function channelNameFromMessagePayload(
  d: Record<string, unknown>,
  channelType: string,
): string | undefined {
  const channel = d.channel as Record<string, unknown> | undefined
  if (channelType === 'group') {
    return pickLabel(
      d.groupName,
      d.group_name,
      channel?.group_name,
      channel?.groupName,
      channel?.name,
      d.channelName,
      d.channel_name,
    )
  }
  if (channelType === 'channel') {
    const parent = toConsoleChannelParent(
      (d.parent as { type?: string; id?: string; name?: string } | undefined) ??
        (channel?.parent as { type?: string; id?: string; name?: string } | undefined),
    )
    const channelName = pickLabel(
      channel?.name,
      channel?.channel_name,
      d.channelName,
      d.channel_name,
    )
    const guildName = pickLabel(
      parent?.name,
      d.guildName,
      d.guild_name,
      (d.guild as { name?: string } | undefined)?.name,
    )
    if (guildName && channelName && !channelName.includes(guildName)) {
      return `${guildName} / ${channelName}`
    }
    return pickLabel(channelName, guildName)
  }
  if (channelType === 'private') {
    const sender = d.sender as { name?: string } | undefined
    return pickLabel(sender?.name, d.sender_name)
  }
  return pickLabel(channel?.name, d.channelName, d.channel_name)
}
