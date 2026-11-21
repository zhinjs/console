import type { ConsoleEngagementSummary, ConsoleVenueDefinition } from '@zhin.js/client'

export function hasRunningEngagement(engagements: readonly Pick<ConsoleEngagementSummary, 'status'>[] | readonly { status: string }[]): boolean
/** Turn / token totals are `null` when no collaboration in a non-empty list reports them. */
export function engagementTotals(engagements: readonly { status: string; turns?: number; tokensUsed?: number }[]): { running: number; failed: number; turns: number | null; tokens: number | null }
export function actorLabel(actor: unknown): string
export function collaborationEventSummary(event: Readonly<Record<string, unknown>>): string
export function venueChannelLabel(venue: ConsoleVenueDefinition): string
/** A list field the Host may omit: anything that is not an array reads as empty. */
export function listOf<T>(value: readonly T[] | null | undefined): readonly T[]
/** Participant refs of an engagement; a missing `participants` reads as none. */
export function engagementParticipants(summary: { participants?: readonly unknown[] | unknown } | null | undefined): string[]
/** A venue as text: a string as written, a `{ kind, id }` ref as `kind:id`; anything else is undefined. */
export function venueLabel(venue: unknown): string | undefined
export type EngagementStatus = 'running' | 'completed' | 'failed' | 'cancelled'
export interface NormalizedEngagementSummary {
  readonly engagementId: string
  readonly status: EngagementStatus
  readonly venue?: string
  readonly startedAt: number
  readonly participants: readonly string[]
  readonly hops?: number
  readonly turns?: number
  readonly tokensUsed?: number
  readonly wallClockMs?: number
  readonly stopReason?: string
}
/** Reads the protocol summary or the Host journal's summary into one display shape. */
export function normalizeEngagementSummary(raw: unknown): NormalizedEngagementSummary
