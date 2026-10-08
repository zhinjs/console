import type { CSSProperties } from 'react'
import type { ConversationChannelType } from './types'

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

/** Identity is expressed by the name/initials and channel icon, not an arbitrary hue. */
export function conversationAvatarStyle(
  _seed: string,
  _channelType: ConversationChannelType,
): CSSProperties {
  return {
    background: 'hsl(var(--im-row-active))',
    color: 'hsl(var(--im-row-active-fg))',
  }
}
