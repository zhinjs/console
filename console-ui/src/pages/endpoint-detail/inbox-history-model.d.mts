import type { InboxRequestRow, InboxNoticeRow } from './types.js'
export function readRequestHistory(payload: unknown, locale?: 'zh-CN' | 'en'): InboxRequestRow[]
export function readNoticeHistory(payload: unknown, locale?: 'zh-CN' | 'en'): InboxNoticeRow[]
export function mergeHistoryRows<T extends {id: number}>(previous: T[], incoming: T[]): T[]
export function readMessageHistory(payload: unknown, locale?: 'zh-CN' | 'en'): import('./types.js').InboxMessageRow[]
