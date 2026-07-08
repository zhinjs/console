import { cn } from '@zhin.js/client'
import { formatConversationTime } from './date-utils'
import { conversationAvatarStyle, conversationInitials } from './conversation-avatar'
import type { ConversationEntry } from './types'

interface ConversationRowProps {
  entry: ConversationEntry
  active: boolean
  onSelect: () => void
}

export function ConversationRow({ entry, active, onSelect }: ConversationRowProps) {
  const timeLabel = entry.lastMessageAt ? formatConversationTime(entry.lastMessageAt) : ''
  const preview = entry.lastMessagePreview?.trim()
  const initials = conversationInitials(entry.name)

  return (
    <div
      role="button"
      tabIndex={0}
      className={cn('im-conversation-row', active && 'active')}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onSelect()
        }
      }}
    >
      <span
        className="im-conversation-avatar shrink-0"
        style={conversationAvatarStyle(`${entry.channelType}:${entry.id}`, entry.channelType)}
        aria-hidden
      >
        {initials}
      </span>
      <div className="im-conversation-body">
        <div className="im-conversation-title-row">
          <span className="im-conversation-name">{entry.name}</span>
          {timeLabel ? <span className="im-conversation-time">{timeLabel}</span> : null}
        </div>
        <div className="im-conversation-preview-row">
          {preview ? (
            <span className="im-conversation-preview">{preview}</span>
          ) : (
            <span className="im-conversation-preview im-conversation-preview--empty">暂无消息</span>
          )}
          {entry.unreadCount > 0 ? (
            <span className="im-conversation-unread">
              {entry.unreadCount > 99 ? '99+' : entry.unreadCount}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  )
}
