import type { InboxRequestRow, InboxNoticeRow } from './types.js'
export function readRequestHistory(payload: unknown): InboxRequestRow[]
export function readNoticeHistory(payload: unknown): InboxNoticeRow[]
export function mergeHistoryRows<T extends {id: number}>(previous: T[], incoming: T[]): T[]
