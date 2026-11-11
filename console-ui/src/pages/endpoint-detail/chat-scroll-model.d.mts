export const NEAR_BOTTOM_THRESHOLD: number
export interface ScrollMetrics {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}
export function isNearBottom(metrics: ScrollMetrics | null | undefined, threshold?: number): boolean
export function appendedMessageIds(previousIds: readonly string[], nextIds: readonly string[]): string[]
export interface ChatScrollSnapshot {
  key: string | null
  ids: readonly string[]
  ownIds?: readonly string[]
}
export interface ChatScrollState {
  settled: boolean
  nearBottom: boolean
  unread: number
  prepending: boolean
}
export interface ChatScrollPlan {
  scroll: 'bottom' | 'preserve' | 'none'
  unread: number
  settled: boolean
}
export function planChatScroll(previous: ChatScrollSnapshot | null, next: ChatScrollSnapshot, state: ChatScrollState): ChatScrollPlan
export function scrollTopAfterPrepend(before: { scrollTop: number; scrollHeight: number }, nextScrollHeight: number): number
