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

export type UsageBucket = 'hour' | 'day'
export interface UsageTokens { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheShare?: number; cacheWriteTokens?: number }
export interface UsageModelRow extends UsageTokens {
  provider: string
  model: string
  /** 「服务名 · 模型」 from the Host; just the model when it could not resolve the service. */
  displayName?: string
  providerLabel?: string
  /** Recorded provider ids merged into this row (`services:…`, `accounts:…`). */
  providerIds?: string[]
  claimsWithoutToolCall?: number
  /** Older field names, still read. */
  label?: string
  serviceLabel?: string
  modelLabel?: string
  /** Display name of the service's Driver (zhin 第 58 批). */
  driverLabel?: string
  profileId?: string
  /** Readable name of the one model Profile the row ran on (zhin 第 58 批). */
  profileName?: string
  /** Set by `mergeUsageModels`: the `<provider>/<model>` keys merged into this row. */
  rawKeys?: string[]
  /** Set by `mergeUsageModels`: the service and model parts of the display name. */
  serviceName?: string
  modelName?: string
}
export interface UsageSessionRow extends UsageTokens {
  sessionKey: string; platform?: string; endpoint?: string; scope?: string; sceneId?: string; turns: number; label?: string; displayName?: string; name?: string
  /** zhin 第 58 批: structured name parts, the short key and the account's name. */
  scopeKind?: string; sceneLabel?: string; shortKey?: string; accountLabel?: string
}
export interface UsageAgentRow extends UsageTokens { agent: string; label?: string; kind?: string; turns?: number }
export interface UsagePurposeRow extends UsageTokens { purpose: string; label?: string; turns?: number }
export type UsageTotals = UsageTokens & { turns: number; cacheShare: number; cacheShareByCall?: { p50: number; p90: number }; claimsWithoutToolCall?: number }
export interface UsagePoint extends UsageTokens { bucketStart: number; byModel: Record<string, number>; byAgent?: Record<string, number> }
export interface UsageStats {
  range: { since: number; until: number; bucket: UsageBucket; timeZone?: string }
  totals: UsageTotals
  byModel: UsageModelRow[]
  bySession: UsageSessionRow[]
  series: UsagePoint[]
  /** `<provider>/<model>` → display name. */
  modelLabels?: Record<string, string>
  segments: { history: number; fixed: number; user: number }
  filesRead?: number
  malformedLines?: number
  /** Services that likely do not support or pass through prompt caching (#1250); absent from older Hosts. */
  promptCacheHints?: unknown[]
  /** zhin 第 58 批 (`schemaVersion: 2`); all optional here. */
  schemaVersion?: number
  byAgent?: UsageAgentRow[]
  byPurpose?: UsagePurposeRow[]
  previous?: { since: number; until: number; truncated?: boolean; totals: UsageTotals }
  sessionsTotal?: number
  othersTotals?: UsageTokens & { sessions: number; turns: number }
  /** Set by `mergeUsageModels`: series key → service name. */
  modelServices?: Record<string, string>
}
export interface PromptCacheNotice { key: string; name: string; text: string }
export function promptCacheNotices(stats: unknown, locale?: Locale): { hints: PromptCacheNotice[]; missed: boolean } | null
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
export function isOpaqueProviderId(provider: unknown): boolean
export function usageProviderLabel(row: { provider?: string; providerLabel?: string; serviceLabel?: string } | null | undefined, locale?: Locale): string
export function usageModelLabel(row: UsageModelRow, modelLabels?: Record<string, string> | null, locale?: Locale): string
export function mergeUsageModels(stats: UsageStats, locale?: Locale): UsageStats
export function usageModelIds(row: UsageModelRow | null | undefined): string[]
export function usageSessionLabel(row: Pick<UsageSessionRow, 'sessionKey'> & Partial<UsageSessionRow>, locale?: Locale): string
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
export function usageModelIdGroups(row: UsageModelRow | null | undefined): Array<{ kind: 'keys' | 'services'; ids: string[] }>
export function usageSessionShortKey(row: Pick<UsageSessionRow, 'sessionKey'> & Partial<UsageSessionRow>): string
export function usageSessionNames(rows: Array<Pick<UsageSessionRow, 'sessionKey'> & Partial<UsageSessionRow>>, locale?: Locale): Map<string, { name: string; qualifier: string }>
export function totalTokens(row: Partial<UsageTokens> | null | undefined): number
export function previousUsageInput(input: UsageInput): UsageInput | null
export function hostPreviousTotals(stats: unknown): UsageTotals | null
export type UsageDelta = { kind: 'change'; ratio: number } | { kind: 'new' } | { kind: 'same' }
export function usageDelta(current: number, previous: number | undefined, options?: { points?: boolean }): UsageDelta | null
export function isNotableDelta(delta: UsageDelta | null, options?: { points?: boolean }): boolean
export function formatDelta(delta: UsageDelta | null, locale?: Locale, options?: { points?: boolean }): string
export function usageAgentLabel(row: Partial<UsageAgentRow> | null | undefined, locale?: Locale): string
export function usagePurposeLabel(row: Partial<UsagePurposeRow> | null | undefined, locale?: Locale): string
export interface UsageCapabilities {
  schemaVersion: number
  agents: UsageAgentRow[]
  purposes: UsagePurposeRow[]
  agentSeries: boolean
  others: { sessions: number; total: number; totals: UsageTokens & { sessions: number; turns: number } } | null
}
export function usageCapabilities(stats: unknown): UsageCapabilities
export interface UsageServiceGroup extends UsageTokens {
  key: string; name: string; models: UsageModelRow[]; cacheWriteTokens: number; claimsWithoutToolCall: number; share: number; driverLabel: string; providerIds: string[]
}
export function usageServiceGroups(byModel: UsageModelRow[], locale?: Locale): UsageServiceGroup[]
export function usageTrendSeries(stats: UsageStats, dimension: 'model' | 'service' | 'agent', locale?: Locale): UsagePoint[]
export function topSeriesKeys(series: UsagePoint[], limit?: number): string[]
export function seriesKeys(series: UsagePoint[]): string[]
