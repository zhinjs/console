import type { Locale } from '../i18n/locale.mjs'

export const REPLAY_PERMISSION: 'decisions:read'
export const REPLAY_LIST_METHOD: 'decisions'
export const REPLAY_TURN_METHOD: 'decision-turn'
export const REPLAY_EXPORT_METHOD: 'decisions-export'
export const REPLAY_PAGE_SIZE: number
export const REPLAY_EXPORT_MAX_PAGES: number
export const REPLAY_KINDS: readonly string[]
export const REPLAY_OUTCOMES: readonly string[]

export interface ReplayRow {
  id: string
  ts: number
  turn_id: string
  instance_id: string
  platform: string
  scene_id: string
  user_id: string | null
  kind: string
  outcome: string
  reason_code: string
  reason_detail: string | null
  payload: Record<string, unknown>
  actor: string
  actor_id: string | null
}
export interface ReplayList { persistent: boolean; items: ReplayRow[]; nextBefore: number | null }
export interface ReplayTurn { persistent: boolean; turnId: string; startedAt: number; endedAt: number; truncated: boolean; events: ReplayRow[] }
export interface ReplayWindow { since: number; until: number }
export interface ReplayExportPage {
  table: 'ai_decision_events'
  exportedAt: number
  persistent: boolean
  window: ReplayWindow
  filters: Record<string, unknown>
  count: number
  nextSince: number | null
  events: ReplayRow[]
}
export interface ReplayExport { table: 'ai_decision_events'; exportedAt: number; window: ReplayWindow; filters: Record<string, unknown>; count: number; events: ReplayRow[] }
export interface ReplayRowView {
  id: string
  at: number
  turnId: string
  where: string
  kind: string
  outcome: string
  outcomeCode: string
  reason: string
  code: string
  detail: string | null
}
export interface ReplayFilterInput { platform?: string; sceneId?: string; kind?: string; outcome?: string }

export function validateReplayList(data: unknown, locale?: Locale): ReplayList
export function validateReplayTurn(data: unknown, locale?: Locale): ReplayTurn
export function validateReplayExportPage(data: unknown, locale?: Locale): ReplayExportPage
export function kindLabel(kind: string, locale?: Locale): string
export function outcomeLabel(outcome: string, locale?: Locale): string
export function reasonLabel(code: string, locale?: Locale): string
export function describeReplayRow(row: ReplayRow, locale?: Locale): ReplayRowView
export function buildReplayFilter(filter: ReplayFilterInput): Record<string, string>
export const EXPORT_WINDOWS: ReadonlyArray<{ readonly value: string; readonly label: string; readonly ms: number }>
export function exportWindow(value: string, now?: number): ReplayWindow
export function collectReplayExport(
  call: (input: Record<string, unknown>) => Promise<unknown>,
  window: ReplayWindow,
  filter?: Record<string, unknown>,
  locale?: Locale,
): Promise<ReplayExport>
export function exportFileName(window: ReplayWindow): string
export function isPermissionDenied(error: unknown): boolean
