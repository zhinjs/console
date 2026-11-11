import { copyText } from '../clipboard-copy.mjs'

/**
 * "Quote" and "forward" in the chat workspace are text-only on purpose.
 *
 * The Host's canonical `reply` segment exists, but the Console cannot tell which Endpoint honours it:
 * the endpoint summary only carries `operations` (recall / edit / reaction / typing) and
 * `managementCapabilities`, not the adapter profile's `messaging.quote` / `messaging.forward`. Without
 * that fact a reply segment would be guessed platform capability, so the reference is sent as a
 * plain-text prefix instead, and the controls are named after what they really do.
 */

/** Longest summary taken from the referenced message (the original id is never sent). */
export const TEXT_REFERENCE_SUMMARY_LIMIT = 96

/** The text line put in front of the outgoing message for a quote or forward draft. */
export function textReferencePrefix(kind, reference, t) {
  return kind === 'quote'
    ? t("引用 {0}: {1}", [reference.senderName, reference.summary])
    : t("转发 {0}: {1}", [reference.senderName, reference.summary])
}

/**
 * Send options for the current drafts. The local echo shows exactly the text that was sent, so a
 * text quote never looks like a platform quote card in the Console.
 */
export function textReferenceSendOptions(drafts, t) {
  const kind = drafts.quote != null ? 'quote' : drafts.forward != null ? 'forward' : null
  if (!kind) return {}
  const textPrefix = textReferencePrefix(kind, kind === 'quote' ? drafts.quote : drafts.forward, t)
  return { textPrefix, displayPrefixSegments: [{ type: 'text', data: { text: `${textPrefix}\n` } }] }
}

/**
 * Copies a message summary: `copied`, `failed` (the browser refused both the Clipboard API and the
 * compatibility path) or `unavailable` (no clipboard and no document to fall back on).
 */
export async function copyMessageSummary(text, clipboard, document) {
  if (!clipboard?.writeText && !document?.body) return 'unavailable'
  if (!document?.body) {
    try { await clipboard.writeText(text); return 'copied' } catch { return 'failed' }
  }
  return await copyText(text, clipboard, document) ? 'copied' : 'failed'
}
