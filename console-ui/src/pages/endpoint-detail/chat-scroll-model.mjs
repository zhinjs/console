// Scroll decisions for the chat message list. Pure so the rules can be tested without a DOM:
// the component measures, asks these functions what to do, then applies it.

/** Distance from the bottom (px) that still counts as "reading the latest messages". */
export const NEAR_BOTTOM_THRESHOLD = 80

/** Whether a scroll container is at, or within `threshold` px of, its bottom edge. */
export function isNearBottom(metrics, threshold = NEAR_BOTTOM_THRESHOLD) {
  if (!metrics) return true
  const { scrollTop = 0, scrollHeight = 0, clientHeight = 0 } = metrics
  return scrollHeight - scrollTop - clientHeight <= threshold
}

/**
 * Ids in `next` that arrived after the previous last message. Messages loaded above the old first
 * one (history) are not "new". If the old tail is gone (rows merged or trimmed), every unseen id counts.
 */
export function appendedMessageIds(previousIds, nextIds) {
  const seen = new Set(previousIds)
  if (!previousIds.length) return [...nextIds]
  const at = nextIds.lastIndexOf(previousIds[previousIds.length - 1])
  return (at >= 0 ? nextIds.slice(at + 1) : nextIds).filter((id) => !seen.has(id))
}

/**
 * Decide how the list reacts to a change of its messages.
 *
 * @param previous `{ key, ids }` rendered last time, or null on the first render
 * @param next `{ key, ids, ownIds? }` now; `ownIds` are messages this console just sent
 * @param state `{ settled, nearBottom, unread, prepending }`; `settled` is true once this conversation
 *   has been scrolled to the bottom after loading; `prepending` while "load earlier" is in flight
 * @returns `{ scroll: 'bottom' | 'preserve' | 'none', unread, settled }`
 */
export function planChatScroll(previous, next, state) {
  const unread = state?.unread ?? 0
  // A different conversation, or one emptied for a reload: start over and wait for messages.
  if (!previous || previous.key !== next.key || !next.ids.length) {
    return next.ids.length && (!previous || previous.key !== next.key)
      ? { scroll: 'bottom', unread: 0, settled: true }
      : { scroll: 'none', unread: 0, settled: false }
  }
  // First messages of this conversation have arrived: show the newest.
  if (!state?.settled) return { scroll: 'bottom', unread: 0, settled: true }
  const previousIds = previous.ids
  if (previousIds.length === next.ids.length && previousIds.every((id, index) => id === next.ids[index])) {
    return { scroll: 'none', unread, settled: true }
  }
  // Older history was loaded above: keep the message being read where it is.
  if (state.prepending && next.ids[0] !== previousIds[0]) return { scroll: 'preserve', unread, settled: true }
  const appended = appendedMessageIds(previousIds, next.ids)
  const own = new Set(next.ownIds ?? [])
  if (appended.some((id) => own.has(id)) || state.nearBottom) return { scroll: 'bottom', unread: 0, settled: true }
  // The user is reading history: do not move, count what arrived instead.
  return { scroll: 'none', unread: unread + appended.length, settled: true }
}

/** scrollTop that keeps the same content in view after `nextScrollHeight - before.scrollHeight` px were added above. */
export function scrollTopAfterPrepend(before, nextScrollHeight) {
  return Math.max(0, before.scrollTop + (nextScrollHeight - before.scrollHeight))
}
