import type { SidebarSelection } from './types'
export function conversationSelectionKey(selection: SidebarSelection | null | undefined): string | null
export function readComposerDraft<T>(drafts: Readonly<Record<string, T>>, key: string | null, fallback: NoInfer<T>): T
export function writeComposerDraft<T>(drafts: Readonly<Record<string, T>>, key: string | null, value: NoInfer<T>, isEmpty?: (value: T) => boolean): Record<string, T>
export interface ComposerKeyEvent {
  key: string
  shiftKey?: boolean
  keyCode?: number
  isComposing?: boolean
  nativeEvent?: { isComposing?: boolean; keyCode?: number }
}
export function isImeComposing(event: ComposerKeyEvent): boolean
export function shouldSubmitOnEnter(event: ComposerKeyEvent, options?: { allowShift?: boolean }): boolean
export interface ComposerExtras<A extends { id: string }, R> {
  attachments: readonly A[]
  quote: R | null
  forward: R | null
  mediaPanel: null | 'image' | 'video' | 'audio'
  mediaUrl: string
}
export const EMPTY_COMPOSER_EXTRAS: ComposerExtras<never, never>
export function isEmptyComposerExtras<A extends { id: string }, R>(extras: ComposerExtras<A, R>): boolean
export function clearSentComposerExtras<A extends { id: string }, R>(current: ComposerExtras<A, R>, sent: ComposerExtras<A, R>): ComposerExtras<A, R>
