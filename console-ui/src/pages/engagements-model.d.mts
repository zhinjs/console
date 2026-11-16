import type { ConsoleEngagementSummary, ConsoleVenueDefinition } from '@zhin.js/client'

export function hasRunningEngagement(engagements: readonly ConsoleEngagementSummary[]): boolean
export function engagementTotals(engagements: readonly ConsoleEngagementSummary[]): { running: number; failed: number; turns: number; tokens: number }
export function actorLabel(actor: unknown): string
export function collaborationEventSummary(event: Readonly<Record<string, unknown>>): string
export function venueChannelLabel(venue: ConsoleVenueDefinition): string
/** A list field the Host may omit: anything that is not an array reads as empty. */
export function listOf<T>(value: readonly T[] | null | undefined): readonly T[]
/** Participant refs of an engagement; a missing `participants` reads as none. */
export function engagementParticipants(summary: Pick<ConsoleEngagementSummary, 'participants'> | null | undefined): string[]
