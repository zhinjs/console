export type EventStreamFailureReason = 'unauthorized' | 'not-found' | 'gateway' | 'http' | 'not-event-stream' | 'network'
export interface EventStreamFailure { readonly reason: EventStreamFailureReason; readonly status?: number; readonly at: number }
export interface ConnectionIndicator {
  readonly kind: 'connecting' | 'reconnecting' | 'disconnected'
  readonly reason?: { readonly code: EventStreamFailureReason; readonly status?: number }
}
export function isEventStreamUrl(url: unknown): boolean
export function classifyEventStreamReply(reply: { status?: number; contentType?: string | null; error?: unknown } | null | undefined, url?: string): { reason: EventStreamFailureReason; status?: number } | null
export function reportEventStreamReply(reply: { status?: number; contentType?: string | null; error?: unknown }, url: string, now?: number): void
export function getEventStreamFailure(): EventStreamFailure | null
export function subscribeEventStreamFailure(listener: () => void): () => void
export function clearEventStreamFailure(): void
export const CONNECTING_GRACE_MS: number
export const EVENT_STREAM_REASON_COPY: Readonly<Record<EventStreamFailureReason, string>>
export function connectionIndicatorView(input?: { state?: string; failure?: EventStreamFailure | null; ever?: boolean; since?: number; now?: number }): ConnectionIndicator | null
