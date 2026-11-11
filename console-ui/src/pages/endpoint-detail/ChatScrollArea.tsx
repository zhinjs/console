import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, Loader2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button } from '../../components/ui/button'
import {
  isNearBottom,
  planChatScroll,
  scrollTopAfterPrepend,
  type ChatScrollSnapshot,
} from './chat-scroll-model.mjs'

interface ScrollRow {
  id: string
  local?: boolean
}

interface ScrollMemory {
  snapshot: ChatScrollSnapshot | null
  settled: boolean
  nearBottom: boolean
  unread: number
  /** Measurements taken just before "load earlier" was requested; cleared once it finishes. */
  prepend: { scrollTop: number; scrollHeight: number } | null
}

/**
 * Scroll container of a conversation: opens at the newest message, follows new messages while the
 * user is at the bottom, otherwise counts them in a "N new messages" button, and keeps the reading
 * position when earlier history is loaded above.
 */
export function ChatScrollArea({
  conversationKey,
  rows,
  hasMore,
  loadingOlder,
  onLoadOlder,
  children,
}: {
  conversationKey: string | null
  rows: readonly ScrollRow[]
  hasMore: boolean
  loadingOlder: boolean
  onLoadOlder: () => void
  children: ReactNode
}) {
  const i18n = useI18n()
  const listRef = useRef<HTMLDivElement>(null)
  const memory = useRef<ScrollMemory>({ snapshot: null, settled: false, nearBottom: true, unread: 0, prepend: null })
  const [unread, setUnread] = useState(0)

  const updateUnread = (count: number) => {
    memory.current.unread = count
    setUnread(count)
  }

  const scrollToBottom = (smooth = false) => {
    const list = listRef.current
    memory.current.nearBottom = true
    if (!list) return
    const top = list.scrollHeight
    if (smooth && typeof list.scrollTo === 'function') list.scrollTo({ top, behavior: 'smooth' })
    else list.scrollTop = top
  }

  // Runs before paint, so the list never flashes at the wrong position.
  useLayoutEffect(() => {
    const state = memory.current
    const next: ChatScrollSnapshot = {
      key: conversationKey,
      ids: rows.map((row) => row.id),
      ownIds: rows.filter((row) => row.local).map((row) => row.id),
    }
    const plan = planChatScroll(state.snapshot, next, {
      settled: state.settled,
      nearBottom: state.nearBottom,
      unread: state.unread,
      prepending: state.prepend != null,
    })
    if (state.snapshot?.key !== conversationKey) state.prepend = null
    state.snapshot = next
    state.settled = plan.settled
    const list = listRef.current
    if (plan.scroll === 'bottom') scrollToBottom()
    else if (plan.scroll === 'preserve' && list && state.prepend) {
      list.scrollTop = scrollTopAfterPrepend(state.prepend, list.scrollHeight)
      state.prepend = null
    }
    if (plan.unread !== state.unread) updateUnread(plan.unread)
  }, [conversationKey, rows])

  // "Load earlier" finished without adding rows (or failed): forget the measurement.
  useLayoutEffect(() => {
    if (!loadingOlder) memory.current.prepend = null
  }, [loadingOlder])

  const onScroll = () => {
    const list = listRef.current
    if (!list) return
    const near = isNearBottom(list)
    memory.current.nearBottom = near
    if (near && memory.current.unread) updateUnread(0)
  }

  const loadOlder = () => {
    const list = listRef.current
    memory.current.prepend = list ? { scrollTop: list.scrollTop, scrollHeight: list.scrollHeight } : null
    onLoadOlder()
  }

  const jumpToLatest = () => {
    updateUnread(0)
    scrollToBottom(true)
  }

  return (
    <div className="im-chat-scroll">
      <div
        ref={listRef}
        onScroll={onScroll}
        className="im-message-list flex-1 overflow-y-auto px-3 py-2 min-h-0 flex flex-col"
      >
        {hasMore && (
          <div className="flex-shrink-0 py-2 flex justify-center">
            <Button variant="ghost" size="sm" className="text-xs" disabled={loadingOlder} onClick={loadOlder}>
              {loadingOlder ? <Loader2 className="h-4 w-4 animate-spin" /> : i18n.t("加载更早消息")}
            </Button>
          </div>
        )}
        {children}
      </div>
      {unread > 0 && (
        <button type="button" className="im-new-messages" onClick={jumpToLatest}>
          <ArrowDown className="h-3.5 w-3.5" aria-hidden />
          {i18n.t("有 {0} 条新消息", [unread])}
        </button>
      )}
    </div>
  )
}
