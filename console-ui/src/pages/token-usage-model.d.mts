import type { Locale } from '../i18n/locale.mjs'

export const USAGE_METHOD: 'usage-stats'
export const AUTO_HOURLY_MAX_MS: number
export const MAX_HOURLY_BUCKETS: number
export const USAGE_RANGES: ReadonlyArray<{ readonly value: string; readonly label: string }>
export const USAGE_BUCKETS: ReadonlyArray<{ readonly value: string; readonly label: string }>
export const MODEL_PALETTE: readonly string[]
export const OTHER_COLOR: string
export const SEGMENT_KEYS: readonly ['history', 'fixed', 'user']
export const SEGMENT_LABELS: Readonly<Record<string, string>>
export const SESSION_SORT_KEYS: readonly string[]

export type UsageBucket = 'hour' | 'day'
export interface UsageTokens { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheShare?: number; cacheWriteTokens?: number }
export interface UsageModelRow extends UsageTokens { provider: string; model: string }
export interface UsageSessionRow extends UsageTokens { sessionKey: string; platform?: string; endpoint?: string; scope?: string; sceneId?: string; turns: number }
export interface UsagePoint extends UsageTokens { bucketStart: number; byModel: Record<string, number> }
export interface UsageStats {
  range: { since: number; until: number; bucket: UsageBucket; timeZone?: string }
  totals: UsageTokens & { turns: number; cacheShare: number; cacheShareByCall?: { p50: number; p90: number } }
  byModel: UsageModelRow[]
  bySession: UsageSessionRow[]
  series: UsagePoint[]
  segments: { history: number; fixed: number; user: number }
  filesRead?: number
  malformedLines?: number
}
export interface UsageFilter {
  range?: string
  customSince?: number
  customUntil?: number
  bucket?: string
  session?: string
}
export interface UsageInput { since: number; until: number; bucket: UsageBucket; session?: string }
export interface StackBar { bucketStart: number; total: number; parts: Array<{ key: string; value: number }> }
export interface DonutSlice { key: string; value: number; share: number; start: number; end: number }

export function validateUsageStats(data: unknown, locale?: Locale): UsageStats
export function formatTokens(value: number, locale?: Locale): string
export function formatPercent(ratio: number, locale?: Locale): string
export function cacheRatio(row: { inputTokens: number; cacheReadTokens: number; cacheShare?: number } | null | undefined): number
export function hasCacheWrite(stats: UsageStats): boolean
export function cacheQuantiles(totals: UsageStats['totals']): { p50: number; p90: number } | null
export function cacheLinePoints(series: UsagePoint[]): Array<{ bucketStart: number; value: number | null }>
export function modelKey(provider: string, model: string): string
export function buildColorMap(keys: Iterable<string>): Map<string, string>
export function colorFor(map: Map<string, string>, key: string): string
export function collectModelKeys(stats: UsageStats): string[]
export function stackSeries(series: UsagePoint[], keys: string[]): { max: number; bars: StackBar[] }
export function topModelKeys(byModel: UsageModelRow[], limit?: number): string[]
export function niceMax(value: number): number
export function donutSlices(values: Array<{ key: string; value: number }>): DonutSlice[]
export function segmentValues(segments: UsageStats['segments']): Array<{ key: string; value: number }>
export function splitSessionKey(row: Pick<UsageSessionRow, 'sessionKey' | 'platform' | 'endpoint' | 'scope' | 'sceneId'>): { sessionKey: string; platform: string; endpoint: string; scope: string; sceneId: string }
export function sortSessions(rows: UsageSessionRow[], key?: string, direction?: 'asc' | 'desc'): UsageSessionRow[]
export function rangeFor(preset: string, now?: number): { since: number; until: number }
export function autoBucket(range: { since: number; until: number }): UsageBucket
export function resolveBucket(choice: string | undefined, range: { since: number; until: number }): UsageBucket
export function parseLocalDateTime(text: unknown): number | null
export function toLocalDateTime(ms: number): string
export function buildUsageInput(filter: UsageFilter, now?: number): { input: UsageInput; error?: undefined } | { error: 'range'; input?: undefined }
export function isPermissionDenied(error: unknown): boolean
export function formatBucketLabel(ms: number, bucket: UsageBucket, locale?: Locale): string
