import type { ConsoleEngagementSummary, ConsoleVenueDefinition } from '@zhin.js/client'

export function hasRunningEngagement(engagements: readonly ConsoleEngagementSummary[]): boolean
export function engagementTotals(engagements: readonly ConsoleEngagementSummary[]): { running: number; failed: number; turns: number; tokens: number }
export function actorLabel(actor: unknown): string
export function collaborationEventSummary(event: Readonly<Record<string, unknown>>): string
export function venueChannelLabel(venue: ConsoleVenueDefinition): string
