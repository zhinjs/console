import { translate } from '../../i18n/locale.mjs'
import { useI18n } from '../../i18n'
import { AlertTriangle, Check, CircleHelp, Copy, Forward, Loader2, Quote, Undo2, X } from 'lucide-react'
import { cn } from '@zhin.js/client'
import type { ChatRow } from './types'
import { RenderingDiagnostics } from './RenderingDiagnostics'
import { MessageBody, messageContentSummary } from './MessageBody'
import { MessageDiagnosticsAction } from './MessageDiagnostics'
import { useToast } from '../../components/toast'
import { TEXT_REFERENCE_SUMMARY_LIMIT, copyMessageSummary } from './message-reference-model.mjs'
import { DELIVERY_COPY, type DeliveryState } from './chat-workspace-model.mjs'

export interface MessageDraftReference {
  id: string
  senderName: string
  summary: string
}

interface ChatMessageRowProps {
  message: ChatRow
  onQuote: (ref: MessageDraftReference) => void
  onForward: (ref: MessageDraftReference) => void
  /** Same sender shortly after the previous row: the name / time line is left out. */
  continued?: boolean
  /** Remove a failed or unknown local bubble. */
  onDismiss?: (id: string) => void
  /** Put an unknown send's text back into the box. */
  onRestore?: (id: string) => void
}

const DELIVERY_ICONS: Record<DeliveryState, typeof Check> = { sending: Loader2, sent: Check, accepted: Check, unknown: CircleHelp, failed: AlertTriangle }

/** What the send receipt says about a message sent from this Console; nothing more is claimed. */
function DeliveryStatus({ message, onDismiss, onRestore }: { message: ChatRow; onDismiss?: (id: string) => void; onRestore?: (id: string) => void }) {
  const i18n = useI18n()
  const state = message.delivery
  if (!state) return null
  const Icon = DELIVERY_ICONS[state]
  const copy = DELIVERY_COPY[state]
  const problem = state === 'failed' || state === 'unknown'
  return (
    <div className={cn('im-delivery', `im-delivery--${state}`)} role={problem ? 'alert' : undefined}>
      <div className="im-delivery-line">
        <span className="im-delivery-state" title={i18n.t(copy.title)}>
          <Icon className={cn('size-3.5', state === 'sending' && 'animate-spin')} aria-hidden />
          {i18n.t(copy.label)}
        </span>
        {state === 'unknown' && message.restorable && onRestore ? (
          <button type="button" className="im-delivery-action" onClick={() => onRestore(message.id)}>
            <Undo2 className="size-3.5" aria-hidden />{i18n.t("核对后放回输入框")}
          </button>
        ) : null}
        {problem && onDismiss ? (
          <button type="button" className="im-delivery-action" onClick={() => onDismiss(message.id)} aria-label={i18n.t("移除这条提示")} title={i18n.t("移除这条提示")}>
            <X className="size-3.5" aria-hidden />
          </button>
        ) : null}
      </div>
      {problem ? <p className="im-delivery-detail">{state === 'unknown' ? i18n.t(copy.title) : message.failure || i18n.t(copy.title)}</p> : null}
    </div>
  )
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

export function ChatMessageRow({ message, onQuote, onForward, continued = false, onDismiss, onRestore }: ChatMessageRowProps) {
  const i18n = useI18n()
  const toast = useToast()
  const out = message.outgoing === true
  const senderName = senderNameOf(message, i18n.locale)
  const timeLabel = new Date(message.timestamp).toLocaleTimeString(i18n.locale, {
    hour: '2-digit',
    minute: '2-digit',
  })
  const pending = message.delivery === 'sending' || message.delivery === 'failed' || message.delivery === 'unknown'
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
    // tabIndex -1: tapping a message on a phone focuses it, which reveals its actions (see im-workspace.css).
    <article tabIndex={-1} className={cn('im-message-row', out && 'im-message-row--out', continued && 'im-message-row--continued')}>
      <div className="im-message-main">
        {continued ? null : (
          <div className="im-meta">
            <span className="im-meta-sender">{senderName}</span>
            <time className="im-meta-time" dateTime={Number.isFinite(message.timestamp) ? new Date(message.timestamp).toISOString() : undefined}>{timeLabel}</time>
            {message.directionUnknown && <span className="im-direction-note">{i18n.t("历史方向未记录")}</span>}
          </div>
        )}
        <div className={cn('im-bubble', out ? 'im-bubble-out' : 'im-bubble-in', pending && 'im-bubble--pending')} title={continued ? `${senderName} · ${timeLabel}` : undefined}>
          <div className="im-message-text break-words">
            <MessageBody content={message.content} />
            {out && <RenderingDiagnostics rendering={message.rendering} messageId={message.messageId} error={message.renderingError} />}
          </div>
        </div>
        {message.local ? <DeliveryStatus message={message} onDismiss={onDismiss} onRestore={onRestore} /> : null}
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
