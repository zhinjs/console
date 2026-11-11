export type MarketplaceListView = 'loading' | 'error' | 'empty' | 'results'
export function marketplaceListView(input: { loading: boolean; error: string | null | undefined; count: number }): MarketplaceListView
export function isCardActivationKey(key: string): boolean

export interface UpdateCandidate { name: string; current: string; latest: string }
export type UpdateCheckOutcome = { error: unknown } | { ok: boolean; status?: number; body: unknown }
export type UpdateCheckResult =
  | { kind: 'available'; updates: UpdateCandidate[] }
  | { kind: 'current'; updates: [] }
  | { kind: 'failed'; updates: []; reason: string }
export function classifyUpdateCheck(outcome: UpdateCheckOutcome, locale?: 'zh-CN' | 'en'): UpdateCheckResult
export function updateCheckFeedback(result: UpdateCheckResult, locale?: 'zh-CN' | 'en'): { variant: 'success' | 'info' | 'error'; description: string }
