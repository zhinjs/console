import type { Locale } from '../../i18n/locale.mjs'

export type AttentionSeverity = 'danger' | 'warning' | 'info'

export interface AttentionItem {
  readonly id: string
  /** State fingerprint: 「忽略」 lasts until it changes. */
  readonly revision: string
  readonly kind: string
  readonly severity: AttentionSeverity
  readonly title: string
  readonly detail: string
  readonly subject?: Readonly<Record<string, unknown>>
  /** ISO time, or null when the source has none (Console-derived items). */
  readonly since: string | null
  readonly action: { readonly label: string; readonly path: string }
  readonly source: string
}

export interface AttentionList {
  readonly items: readonly AttentionItem[]
  readonly generatedAt: string | null
  readonly unavailable: readonly string[]
}

/** Instance state from the gateway's `/pub/health`. */
export interface AttentionInstanceHealth {
  readonly state: string
  readonly ready: boolean
}

export interface AttentionLoad extends AttentionList {
  /**
   * `fallback`: the Host has no `attention.list`; the items are the Console's own derivation.
   * `instance-not-ready`: the instance is not running and ready yet (`instance`); no items.
   */
  readonly mode: 'host' | 'fallback' | 'instance-not-ready'
  readonly instance?: AttentionInstanceHealth
}

export interface AttentionFallbackInput {
  readonly stats?: { readonly endpoints?: { readonly total?: number; readonly online?: number } } | null
  readonly hostError?: string | null
  readonly errorLogs?: number | null
  readonly warningLogs?: number | null
  readonly logReadError?: string | null
  readonly mcpServices?: number | null
  readonly connectedMcp?: number | null
}

export interface AttentionPrefs {
  /** id → snoozed until (ms). */
  readonly snoozed: Readonly<Record<string, number>>
  /** id → the ignored revision. */
  readonly ignored: Readonly<Record<string, string>>
}

export const ATTENTION_RPC: 'attention.list'
export const ATTENTION_PATH: '/attention'
export const ATTENTION_SEVERITIES: readonly AttentionSeverity[]
export const ATTENTION_SNOOZE_MS: number
export const ATTENTION_REFRESH_MS: number
export const ATTENTION_NOT_READY_REFRESH_MS: number
export const ATTENTION_PUSH_DEBOUNCE_MS: number
export const DASHBOARD_ATTENTION_LIMIT: number
export const ATTENTION_STORAGE_PREFIX: string
export const ATTENTION_PREFS_LIMIT: number

export function normalizeAttentionItem(raw: unknown): AttentionItem | null
export function compareAttention(a: AttentionItem, b: AttentionItem): number
export function sortAttention(items?: readonly AttentionItem[]): AttentionItem[]
export function normalizeAttentionList(raw: unknown): AttentionList
export function isAttentionUnsupported(error: unknown): boolean
export function deriveFallbackAttention(input?: AttentionFallbackInput, locale?: Locale): AttentionItem[]
export function isAttentionInstanceUnavailable(error: unknown): boolean
export function normalizeInstanceHealth(raw: unknown): AttentionInstanceHealth | null
export function isInstanceReady(instance: AttentionInstanceHealth | null | undefined): boolean
export function attentionInstanceNotice(instance: AttentionInstanceHealth | null | undefined, locale?: Locale): {
  readonly title: string
  readonly detail: string
  readonly starting: boolean
}
export function loadAttention(options: {
  readonly request: (request: { readonly type: string; readonly data: { readonly locale: Locale } }) => Promise<unknown>
  readonly loadFallback: () => Promise<AttentionFallbackInput>
  /** The gateway's `/pub/health` `instance` (null / rejection: unknown). */
  readonly readInstanceHealth?: () => Promise<unknown>
  readonly locale?: Locale
  readonly now?: () => number
}): Promise<AttentionLoad>

export function emptyAttentionPrefs(): AttentionPrefs
export function attentionStorageKey(apiBase: string | null | undefined, userId?: string | null): string
export function readAttentionPrefs(storage: Pick<Storage, 'getItem'> | null | undefined, key: string): AttentionPrefs
export function writeAttentionPrefs(storage: Pick<Storage, 'setItem'> | null | undefined, key: string, prefs: AttentionPrefs): boolean
export function snoozeAttention(prefs: AttentionPrefs, item: AttentionItem, now?: number): AttentionPrefs
export function ignoreAttention(prefs: AttentionPrefs, item: AttentionItem): AttentionPrefs
export function restoreAttention(prefs: AttentionPrefs, id: string): AttentionPrefs
export function pruneAttentionPrefs(prefs: AttentionPrefs, items?: readonly AttentionItem[], now?: number): AttentionPrefs
export function samePrefs(a: AttentionPrefs, b: AttentionPrefs): boolean
export function partitionAttention(items?: readonly AttentionItem[], prefs?: AttentionPrefs, now?: number): {
  readonly active: AttentionItem[]
  readonly snoozed: AttentionItem[]
  readonly ignored: AttentionItem[]
}
export function attentionBadgeCount(active?: readonly AttentionItem[]): number
export function groupAttention(items?: readonly AttentionItem[]): { readonly severity: AttentionSeverity; readonly items: AttentionItem[] }[]
export function attentionSeverityLabel(severity: AttentionSeverity, locale?: Locale): string
export function formatAttentionSince(since: string | null | undefined, now?: number, locale?: Locale): string | null
export function createDebouncer(fn: () => void, ms: number, timers?: Pick<typeof globalThis, 'setTimeout' | 'clearTimeout'>): {
  trigger(): void
  cancel(): void
  readonly pending: boolean
}
