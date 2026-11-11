import { translate } from '../../i18n/locale.mjs'
import { useI18n } from '../../i18n'
import { Copy, Forward, Quote } from 'lucide-react'
import { cn } from '@zhin.js/client'
import type { ChatRow } from './types'
import { RenderingDiagnostics } from './RenderingDiagnostics'
import { MessageBody, messageContentSummary } from './MessageBody'
import { MessageDiagnosticsAction } from './MessageDiagnostics'
import { useToast } from '../../components/toast'
import { TEXT_REFERENCE_SUMMARY_LIMIT, copyMessageSummary } from './message-reference-model.mjs'

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

function senderNameOf(message: ChatRow, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  if (message.outgoing) return translate(locale, "我")
  return message.sender?.name || message.sender?.id || translate(locale, "未知")
}

export function toDraftReference(message: ChatRow, locale: 'zh-CN' | 'en' = 'zh-CN'): MessageDraftReference {
  return {
    id: message.messageId ?? message.id,
    senderName: senderNameOf(message, locale),
    summary: messageContentSummary(message.content, TEXT_REFERENCE_SUMMARY_LIMIT, locale) || translate(locale, "[空消息]"),
  }
}

export function ChatMessageRow({ message, onQuote, onForward }: ChatMessageRowProps) {
  const i18n = useI18n()
  const toast = useToast()
  const out = message.outgoing === true
  const senderName = senderNameOf(message, i18n.locale)
  const timeLabel = new Date(message.timestamp).toLocaleTimeString(i18n.locale, {
    hour: '2-digit',
    minute: '2-digit',
  })
  const draftRef = toDraftReference(message, i18n.locale)

  const copySummary = async () => {
    const result = await copyMessageSummary(
      draftRef.summary,
      typeof navigator === 'undefined' ? undefined : navigator.clipboard,
      typeof document === 'undefined' ? undefined : document,
    )
    if (result === 'copied') toast.success(i18n.t("已复制消息摘要"))
    else if (result === 'unavailable') toast.error(i18n.t("当前浏览器无法访问剪贴板，请选中消息文本手动复制。"))
    else toast.error(i18n.t("复制失败，请选中消息文本手动复制。"))
  }

  return (
    <article className={cn('im-message-row', out && 'im-message-row--out')}>
      <div className={cn('im-bubble', out ? 'im-bubble-out' : 'im-bubble-in')}>
        <div className={cn('im-meta flex items-center gap-2 text-xs mb-0.5', out ? '' : 'text-muted-foreground')}>
          <span className={cn('font-medium', out ? '' : 'text-foreground/90')}>{senderName}</span>
          <span className="tabular-nums">{timeLabel}</span>
          {message.directionUnknown && <span className="im-direction-note">{i18n.t("历史方向未记录")}</span>}
        </div>
        <div className="im-message-text text-[14px] leading-snug break-words">
          <MessageBody content={message.content} />
          {out && <RenderingDiagnostics rendering={message.rendering} messageId={message.messageId} error={message.renderingError} />}
        </div>
      </div>
      <div className="im-message-actions" aria-label={i18n.t("消息操作")}>
        {!out && !message.local && <MessageDiagnosticsAction message={message} />}
        {/* Text-only: the Console cannot read the adapter's quote / forward capability (see message-reference-model). */}
        <button type="button" title={i18n.t("引用文本：把消息摘要作为文字放进输入框上方，发送时以纯文本发出")} aria-label={i18n.t("引用文本")} onClick={() => onQuote(draftRef)}><Quote className="size-4" /></button>
        <button type="button" title={i18n.t("以文本转发：把消息摘要作为文字放进输入框上方，发送时以纯文本发出，不是原样转发")} aria-label={i18n.t("以文本转发")} onClick={() => onForward(draftRef)}><Forward className="size-4" /></button>
        <button type="button" title={i18n.t("复制摘要")} aria-label={i18n.t("复制摘要")} onClick={() => { void copySummary() }}><Copy className="size-4" /></button>
      </div>
    </article>
  )
}
