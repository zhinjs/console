import type { MessageRecord } from './dashboard-activity-model.mjs'

export type EndpointStatusTone = 'ok' | 'warn' | 'progress' | 'neutral'
export interface EndpointStatusLike { connected?: boolean; status?: string; pendingLogin?: boolean; transportState?: string }
export function endpointStatusTone(endpoint: EndpointStatusLike | null | undefined): EndpointStatusTone
export function endpointStatusLabel(endpoint: EndpointStatusLike | null | undefined, t?: (text: string) => string): string
export function latestConversations(records: readonly MessageRecord[] | null | undefined, limit?: number): MessageRecord[]
