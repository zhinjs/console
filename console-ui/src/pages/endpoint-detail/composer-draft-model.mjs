/**
 * Composer drafts are kept per conversation so switching chats never carries text, attachments or
 * quotes into another group. Keys follow the same identity used to match messages to a selection.
 */
export function conversationSelectionKey(selection) {
  if (selection?.type !== 'channel') return null
  const parent = selection.parent
  return JSON.stringify([selection.channelType, selection.id, parent?.type ?? '', parent?.id ?? '', selection.threadId ?? ''])
}

export function readComposerDraft(drafts, key, fallback) {
  return key != null && Object.hasOwn(drafts, key) ? drafts[key] : fallback
}

/** Immutable write; empty values are dropped and unchanged writes keep the same object. */
export function writeComposerDraft(drafts, key, value, isEmpty = draftValue => !draftValue) {
  if (key == null) return drafts
  if (isEmpty(value)) {
    if (!Object.hasOwn(drafts, key)) return drafts
    const next = { ...drafts }
    delete next[key]
    return next
  }
  if (Object.hasOwn(drafts, key) && Object.is(drafts[key], value)) return drafts
  return { ...drafts, [key]: value }
}

/** Enter that confirms an IME candidate (e.g. Chinese pinyin) arrives with isComposing or keyCode 229. */
export function isImeComposing(event) {
  const native = event?.nativeEvent
  return !!(event?.isComposing || native?.isComposing || event?.keyCode === 229 || native?.keyCode === 229)
}

export function shouldSubmitOnEnter(event, options = {}) {
  if (event?.key !== 'Enter' || isImeComposing(event)) return false
  return !!options.allowShift || !event.shiftKey
}

/** Non-text composer state that belongs to one conversation. */
export const EMPTY_COMPOSER_EXTRAS = Object.freeze({ attachments: Object.freeze([]), quote: null, forward: null, mediaPanel: null, mediaUrl: '' })

export function isEmptyComposerExtras(extras) {
  return !extras.attachments.length && extras.quote == null && extras.forward == null && extras.mediaPanel == null && !extras.mediaUrl
}

/** After a send, drop exactly what was sent; anything added while the send was in flight stays. */
export function clearSentComposerExtras(current, sent) {
  const sentIds = new Set(sent.attachments.map(item => item.id))
  return {
    attachments: current.attachments.filter(item => !sentIds.has(item.id)),
    quote: current.quote === sent.quote ? null : current.quote,
    forward: current.forward === sent.forward ? null : current.forward,
    mediaPanel: null,
    mediaUrl: '',
  }
}
