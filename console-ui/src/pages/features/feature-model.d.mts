export type FeatureRpcFailure = 'unsupported' | 'forbidden' | 'error'
export type FeatureProbeStatus = 'available' | 'unsupported' | 'forbidden'
export type FeatureLevel = 'global' | 'adapter' | 'endpoint' | 'conversation'
export type FeatureOverrideLevel = 'adapter' | 'endpoint' | 'conversation'
export type FeatureLock = 'global' | 'adapter' | 'endpoint'
export type ConversationKind = 'group' | 'private' | 'channel'
/** `{ [alias]: { [endpointId]: number of conversations with overrides } }` (ADR 0055, optional). */
export type ConversationOverrideCounts = Readonly<Record<string, Readonly<Record<string, number>>>>
export interface FeatureCell { readonly enabled: boolean; readonly overridden: boolean; readonly lockedBy?: FeatureLock }
export interface GlobalFeatureRow {
  readonly plugin: string
  readonly name: string
  readonly description: string
  readonly hasSchema: boolean
  readonly global: FeatureCell
}
export interface FeatureMatrixRow extends GlobalFeatureRow {
  readonly adapters: Readonly<Record<string, FeatureCell>>
  readonly conversationOverrides?: ConversationOverrideCounts
}
export interface FeatureMatrix {
  readonly revision: string
  readonly adapters: readonly string[]
  readonly endpoints: Readonly<Record<string, readonly string[]>>
  readonly rows: ReadonlyArray<{ plugin: string; displayName?: string; global: FeatureCell; adapters: Readonly<Record<string, FeatureCell>>; conversationOverrides?: ConversationOverrideCounts }>
  readonly conversationOverrides?: ConversationOverrideCounts
}
export interface MergedFeatureMatrix {
  readonly revision: string
  readonly adapters: readonly string[]
  readonly endpoints: Readonly<Record<string, readonly string[]>>
  readonly rows: FeatureMatrixRow[]
  readonly conversationOverrides?: ConversationOverrideCounts
}
export interface AdapterSummary { readonly adapter: string; readonly accounts: number; readonly online: number; readonly pending: number }
export interface FeatureSummary {
  readonly plugin: string
  readonly displayName: string
  readonly levels: readonly FeatureLevel[]
  readonly hasSchema: boolean
  readonly globalEnabled: boolean
  readonly adapter: boolean
  /** Fields editable on the conversation level (ADR 0055 §2); absent means switch only. */
  readonly conversationFields?: readonly string[]
}
export interface FeatureList { readonly revision: string; readonly features: FeatureSummary[] }
export interface FeatureDetail {
  readonly revision: string
  readonly plugin: string
  readonly level: FeatureLevel
  readonly key?: string
  readonly levels: readonly FeatureLevel[]
  readonly schema: Readonly<Record<string, unknown>> | null
  readonly values: Readonly<Record<string, unknown>>
  readonly effective: Readonly<Record<string, unknown>>
  readonly sources: Readonly<Record<string, FeatureLevel>>
  readonly enabled: boolean
  readonly lockedBy?: FeatureLock
  readonly conversationFields?: readonly string[]
  /** False when conversation overrides are kept in memory only (lost on restart). */
  readonly persistent?: boolean
}
export interface FeatureFieldRow {
  readonly name: string
  readonly editable: boolean
  readonly schema: Readonly<Record<string, unknown>> | null
  readonly overridden: boolean
  readonly source: FeatureLevel | null
  readonly badge: 'here' | 'endpoint' | 'adapter' | 'global' | 'unset'
  readonly effective: unknown
  readonly stored: unknown
}
export interface FeatureWriteResult {
  readonly status: 'saved' | 'unchanged' | 'conflict' | 'invalid' | 'locked'
  readonly lockedBy?: FeatureLock
  readonly revision: string
  readonly message: string
  readonly restartRequired: boolean
  readonly warnings: ReadonlyArray<{ code: string; path: string; message: string }>
  readonly errors: ReadonlyArray<{ path: string; message: string }>
  /** Conversation level: false when the write is kept in memory and lost on restart. */
  readonly persistent?: boolean
}
export interface FeatureRpcBody { readonly type: string; readonly [key: string]: unknown }
export interface ConversationRef { readonly adapter: string; readonly endpoint: string; readonly kind: ConversationKind; readonly id: string }
export interface ConversationOverrideSummary {
  readonly plugin: string
  /** The conversation switches the plugin off. */
  readonly disabled: boolean
  readonly fields: readonly string[]
  readonly updatedAt?: number
  readonly updatedBy?: string
}
export interface ConversationItem extends ConversationRef {
  readonly key: string
  readonly name?: string
  readonly hasOverrides: boolean
  readonly overrides?: readonly ConversationOverrideSummary[]
  readonly overrideCount: number | null
  readonly lastActiveAt?: number
}
export interface ConversationPage { readonly items: ConversationItem[]; readonly cursor?: string; readonly recentAvailable: boolean; readonly persistent?: boolean }
export interface ConversationQuery {
  readonly plugin?: string; readonly adapter?: string; readonly endpoint?: string
  readonly query?: string; readonly cursor?: string; readonly limit?: number
}

export function classifyFeatureRpcError(error: unknown): FeatureRpcFailure
export function featureProbeStatus(outcome: { ok: true } | { ok: false; error: unknown }): FeatureProbeStatus
export function globalFeatureRows(plugins: readonly unknown[]): GlobalFeatureRow[]
export function readFeatureMatrix(payload: unknown): FeatureMatrix
export function mergeFeatureMatrix(globalRows: readonly GlobalFeatureRow[], matrix: FeatureMatrix | null): MergedFeatureMatrix
export function summarizeAdapters(endpoints: readonly unknown[]): AdapterSummary[]
export function endpointsOfAdapter<T>(endpoints: readonly T[], adapter: string): T[]
export function readFeatureList(payload: unknown): FeatureList
export function featuresAtLevel(features: readonly FeatureSummary[], level: FeatureOverrideLevel): FeatureSummary[]
export function readFeatureDetail(payload: unknown): FeatureDetail
export const REDACTED_VALUE: '[redacted]'
export function containsRedacted(value: unknown): boolean
export function fieldSource(sources: Readonly<Record<string, FeatureLevel>> | undefined, name: string): FeatureLevel | null
export function featureFieldRows(detail: FeatureDetail, conversationFields?: readonly string[]): FeatureFieldRow[]
export function overrideDraftSeed(row: FeatureFieldRow): unknown
export function setOverrideRequest(input: { plugin: string; level: FeatureLevel; key: string; field: string; value: unknown; revision?: string }): FeatureRpcBody
export function removeOverrideRequest(input: { plugin: string; level: FeatureLevel; key: string; field?: string; revision?: string }): FeatureRpcBody
export function setEnabledRequest(input: { plugin: string; level: FeatureLevel; key?: string; enabled: boolean; revision?: string; lockedBy?: FeatureLock }): FeatureRpcBody
export function readFeatureWriteResult(payload: unknown): FeatureWriteResult
export function cellToggleable(cell: FeatureCell | null | undefined, canToggle: boolean): boolean
export function cellState(cell: FeatureCell | null | undefined): 'enabled' | 'disabled' | 'locked' | 'unknown'
export function jsonSchemaToField(schema: unknown): import('../../components/PluginConfigForm/types.js').SchemaField
export function featureLockError(error: unknown): { lockedBy?: FeatureLock } | null
export function conversationOverrideCounts(counts: ConversationOverrideCounts | undefined, alias: string): Array<{ endpoint: string; count: number }>
export function lockFor(states: Partial<Record<FeatureLevel, boolean>> | undefined, level: FeatureLevel): FeatureLock | undefined
export function featureSwitchState(state: { enabled: boolean; lockedBy?: FeatureLock }, canToggle: boolean, pending?: boolean): { checked: boolean; disabled: boolean; locked: boolean }
export const CONVERSATION_KINDS: readonly ConversationKind[]
export const CONVERSATION_ID_MAX_LENGTH: 256
export function escapeConversationId(id: string): string
export function unescapeConversationId(escaped: string): string | undefined
export function conversationKey(ref: ConversationRef): string
export function parseConversationKey(key: unknown): ConversationRef | null
export function conversationSegment(kind: ConversationKind, id: string): string
export function parseConversationSegment(segment: unknown): { kind: ConversationKind; id: string } | null
export function conversationsRequest(query?: ConversationQuery): FeatureRpcBody
export function readConversationPage(payload: unknown): ConversationPage
export function containsEnvironmentReference(value: unknown, depth?: number): boolean
export function appendConversationPage(previous: ConversationPage | null | undefined, page: ConversationPage): ConversationPage
export function filterConversations<T extends { hasOverrides: boolean }>(items: readonly T[], onlyOverridden: boolean): T[]
