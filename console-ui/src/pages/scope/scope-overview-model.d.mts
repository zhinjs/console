import type { ConversationItem } from '../features/feature-model.mjs'

export interface OverviewEndpoint {
  readonly name: string
  readonly adapter: string
  readonly connected: boolean
  readonly status?: 'online' | 'offline'
  readonly pendingLogin?: boolean
  readonly transportState?: string
  readonly pendingRequestCount?: number
  readonly pendingNoticeCount?: number
}
export interface OverviewLoginTask { readonly id: string; readonly adapter: string; readonly endpointKey: string; readonly type?: string }
export interface AdapterOverviewItem {
  readonly adapter: string
  readonly accounts: number
  readonly online: number
  readonly pending: number
  readonly waitingLogin: number
  readonly configuredOnly: readonly string[]
}
export type AccountFilter = 'all' | 'online' | 'waiting' | 'offline'
export type EndpointAccessState<E extends OverviewEndpoint = OverviewEndpoint> =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly error: unknown }
  | { readonly kind: 'listed'; readonly endpoint: E; readonly siblings: number }
  | { readonly kind: 'unlisted'; readonly siblings: number }
export interface OnboardingPlatform { readonly id: string; readonly title: string; readonly badge: string; readonly desc: string; readonly to: string }

export function adapterOverview(endpoints?: readonly OverviewEndpoint[], options?: { tasks?: readonly OverviewLoginTask[]; known?: Readonly<Record<string, readonly string[]>> }): AdapterOverviewItem[]
export function overviewTotals(adapters: readonly AdapterOverviewItem[]): { adapters: number; accounts: number; online: number; pending: number; waitingLogin: number }
export function loginTasksFor<T extends OverviewLoginTask>(tasks: readonly T[] | undefined, adapter: string, endpoint?: string): T[]
export const ACCOUNT_FILTERS: readonly AccountFilter[]
export const ACCOUNT_FILTER_LABELS: Readonly<Record<AccountFilter, string>>
export function accountStatus(endpoint: OverviewEndpoint, tasks?: readonly OverviewLoginTask[]): Exclude<AccountFilter, 'all'>
export function filterAccounts<E extends OverviewEndpoint>(endpoints: readonly E[] | undefined, options?: { filter?: AccountFilter; query?: string; tasks?: readonly OverviewLoginTask[] }): E[]
export function accountCounts(endpoints?: readonly OverviewEndpoint[], tasks?: readonly OverviewLoginTask[]): Record<AccountFilter, number>
export function endpointAccessState<E extends OverviewEndpoint>(list: { loaded?: boolean; error?: unknown; endpoints?: readonly E[] }, adapter: string, endpoint: string): EndpointAccessState<E>
export function conversationHighlights(items?: readonly ConversationItem[], limit?: number): { overridden: ConversationItem[]; recent: ConversationItem[]; total: number }
export const ONBOARDING_PLATFORMS: readonly OnboardingPlatform[]
export function platformLabel(adapter: string): string
export function ambientSettingsHref(scope: { kind?: string; adapter?: string; endpoint?: string; id?: string } | null | undefined): string | null
