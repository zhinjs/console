export type CoverageKind = 'none' | 'full' | 'partial' | 'since-restart'
export interface ObservationCoverage { kind: CoverageKind; since: number | null; until: number; windowStart: number }
export type Reading =
  | { kind: 'unrecorded' }
  | { kind: 'insufficient'; sample: number }
  | { kind: 'value'; value: number }

export const MIN_RATIO_SAMPLE: number
export const REPLY_PAIRING_BASIS: 'time-proximity'
export function observationCoverage(records: ReadonlyArray<{ timestamp: number }> | null | undefined, options: { now: number; windowMs: number; truncated?: boolean }): ObservationCoverage
export function countReading(value: number | null | undefined, options?: { loaded?: boolean }): { kind: 'unrecorded' } | { kind: 'value'; value: number }
export function ratioReading(part: number, total: number, minimum?: number): Reading
