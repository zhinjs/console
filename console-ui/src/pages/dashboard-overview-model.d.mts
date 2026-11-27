import type { MessageRecord } from './dashboard-activity-model.mjs'

export type EndpointStatusTone = 'ok' | 'warn' | 'progress' | 'neutral'
export interface EndpointStatusLike { name: string; adapter: string; connected?: boolean; status?: string; pendingLogin?: boolean; loginStep?: unknown; transportState?: string }
/** A LoginAssist task (`login.list`): the account it waits on. */
export interface EndpointLoginTaskLike { readonly adapter: string; readonly endpointKey: string }
export function endpointStatusTone(endpoint: EndpointStatusLike | null | undefined, tasks?: readonly EndpointLoginTaskLike[] | null): EndpointStatusTone
export function endpointStatusLabel(endpoint: EndpointStatusLike | null | undefined, t?: (text: string) => string, tasks?: readonly EndpointLoginTaskLike[] | null): string
export function latestConversations(records: readonly MessageRecord[] | null | undefined, limit?: number): MessageRecord[]
