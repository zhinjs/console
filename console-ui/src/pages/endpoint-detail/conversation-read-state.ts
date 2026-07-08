import type { ConversationChannelType } from './types'

const STORAGE_PREFIX = 'zhin_conv_read'

function readKey(
  adapter: string,
  endpointId: string,
  channelType: ConversationChannelType,
  channelId: string,
): string {
  return `${STORAGE_PREFIX}:${adapter}:${endpointId}:${channelType}:${channelId}`
}

export function getLastReadAt(
  adapter: string,
  endpointId: string,
  channelType: ConversationChannelType,
  channelId: string,
): number {
  if (typeof localStorage === 'undefined') return 0
  const raw = localStorage.getItem(readKey(adapter, endpointId, channelType, channelId))
  if (!raw) return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

export function setLastReadAt(
  adapter: string,
  endpointId: string,
  channelType: ConversationChannelType,
  channelId: string,
  at: number,
): void {
  if (typeof localStorage === 'undefined') return
  localStorage.setItem(readKey(adapter, endpointId, channelType, channelId), String(at))
}

export function countUnreadSince(
  messageTimestamps: number[],
  lastReadAt: number,
): number {
  return messageTimestamps.filter((ts) => ts > lastReadAt).length
}
