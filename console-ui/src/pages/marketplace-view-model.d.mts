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

export interface InstalledPackage { instanceKeys: string[]; version: string | null }
export type InstalledPackages = ReadonlyMap<string, InstalledPackage>
export function readInstalledPackages(body: unknown): InstalledPackages | null
export type MarketplacePluginStatus =
  | { kind: 'update'; current: string; latest: string; version: string; instanceKey: string | null; instanceCount: number }
  | { kind: 'installed'; version: string | null; instanceKey: string | null; instanceCount: number }
  | { kind: 'not-installed' | 'unknown'; version: null; instanceKey: null; instanceCount: 0 }
export function marketplacePluginStatus(name: string, installed: InstalledPackages | null, updates: readonly UpdateCandidate[]): MarketplacePluginStatus
export function pluginManageUrl(packageName: string, instanceKey?: string | null): string
export function pluginConfigUrl(instanceKey: string): string
export function installedFromPackageList(list: { packages: readonly { name: string; installedVersion: string | null; dependencyType?: string }[] } | null | undefined): InstalledPackages | null
export interface InstallFollowUp { kind: 'configure' | 'features' | 'detail' | 'welcome'; to: string }
export function installFollowUps(input: { phase?: string; operation?: string | null; packageName?: string | null; instanceKey?: string | null; welcomePackage?: string | null }): InstallFollowUp[]
