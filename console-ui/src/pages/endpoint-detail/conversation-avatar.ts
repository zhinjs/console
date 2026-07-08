import type { CSSProperties } from 'react'
import type { ConversationChannelType } from './types'

function hashSeed(seed: string): number {
  let h = 0
  for (let i = 0; i < seed.length; i++) {
    h = (h * 31 + seed.charCodeAt(i)) >>> 0
  }
  return h
}

export function conversationInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return '?'
  if (/^\d+$/.test(trimmed)) {
    return trimmed.length >= 2 ? trimmed.slice(-2) : trimmed
  }
  const chars = [...trimmed.replace(/\s+/g, '')]
  if (chars.length >= 2 && /^[a-zA-Z]/.test(chars[0])) {
    return (chars[0] + chars[1]).toUpperCase()
  }
  return chars[0]
}

export function conversationAvatarStyle(
  seed: string,
  channelType: ConversationChannelType,
): CSSProperties {
  if (channelType === 'group') {
    return {
      background: 'linear-gradient(145deg, hsl(213 72% 52%), hsl(228 68% 44%))',
    }
  }
  if (channelType === 'channel') {
    return {
      background: 'linear-gradient(145deg, hsl(158 52% 42%), hsl(172 55% 34%))',
    }
  }
  const hue = hashSeed(seed) % 360
  const hue2 = (hue + 28) % 360
  return {
    background: `linear-gradient(145deg, hsl(${hue} 62% 54%), hsl(${hue2} 68% 44%))`,
  }
}
