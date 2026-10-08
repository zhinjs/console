import type { ReqItem } from './types.js'
export function pendingRequestKey(row: {platformRequestId?: string; id?: number}): string
export function readPendingRequests(payload: unknown): ReqItem[]
