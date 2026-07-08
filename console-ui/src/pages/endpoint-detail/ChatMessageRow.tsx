import { Copy, Forward, Quote } from 'lucide-react'
import { cn } from '@zhin.js/client'
import type { ChatRow } from './types'
import { MessageBody, messageContentSummary } from './MessageBody'

export interface MessageDraftReference {
  id: string
  senderName: string
  summary: string
}

interface ChatMessageRowProps {
  message: ChatRow
  onQuote: (ref: MessageDraftReference) => void
  onForward: (ref: MessageDraftReference) => void
}

function senderNameOf(message: ChatRow): string {
  if (message.outgoing) return '我'
  return message.sender?.name || message.sender?.id || '未知'
}

export function toDraftReference(message: ChatRow): MessageDraftReference {
  return {
    id: message.id,
    senderName: senderNameOf(message),
    summary: messageContentSummary(message.content, 96) || '[空消息]',
  }
}

export function ChatMessageRow({ message, onQuote, onForward }: ChatMessageRowProps) {
  const out = message.outgoing === true
  const senderName = senderNameOf(message)
  const timeLabel = new Date(message.timestamp).toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
  })
  const draftRef = toDraftReference(message)

  const copySummary = () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return
    void navigator.clipboard.writeText(draftRef.summary)
  }

  return (
    <article className={cn('im-message-row', out && 'im-message-row--out')}>
      <div className="im-message-actions" aria-label="消息操作">
        <button type="button" title="引用" onClick={() => onQuote(draftRef)}>
          <Quote className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="转发" onClick={() => onForward(draftRef)}>
          <Forward className="h-3.5 w-3.5" />
        </button>
        <button type="button" title="复制摘要" onClick={copySummary}>
          <Copy className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className={cn('im-bubble', out ? 'im-bubble-out' : 'im-bubble-in')}>
        <div className={cn('im-meta flex items-center gap-2 text-[10px] mb-0.5', out ? '' : 'text-muted-foreground')}>
          <span className={cn('font-medium', out ? '' : 'text-foreground/90')}>{senderName}</span>
          <span className="tabular-nums opacity-80">{timeLabel}</span>
        </div>
        <div className="im-message-text text-[14px] leading-snug break-words">
          <MessageBody content={message.content} />
        </div>
      </div>
    </article>
  )
}
