import type { StatusKind } from '../../components/status-state-model.mjs'
export interface ConversationListNotice { text: string; tone: 'neutral' | 'warning' | 'error'; details?: string; kind?: StatusKind }
/** `causes`: the failures themselves (first one is classified when nothing could be read); `errors`: their display text. */
export function conversationListNotice(input: {total: number; errors?: string[]; causes?: unknown[]; connected?: boolean; historyOnly?: boolean}, locale?: 'zh-CN' | 'en'): ConversationListNotice | null
/** Whether a list read failed only because the adapter has no such list (not counted as a failure). */
export function listUnsupported(error: unknown): boolean
