export const PLUGIN_OVERVIEW_TAB: 'overview'

export interface PluginPageIdentity { readonly plugin: string; readonly page: string }

/** What `navigation-taxonomy.ts` stores on a plugin page route as `meta.pluginTab`. */
export interface PluginTabMeta {
  /** `tab`: a tab of the plugin detail page; `adapter`: an adapter page that redirects to its object page. */
  readonly kind: 'tab' | 'adapter'
  readonly plugin: string
  readonly page: string
  /** Where the command palette opens the page. */
  readonly href: string
  readonly legacyPath: string
  readonly keywords: readonly string[]
  readonly description?: string
  readonly packageName?: string
  readonly pluginDescription?: string
  readonly adapterKey?: string
  /** The page hides itself from navigation: no tab, still reachable by path and from the palette. */
  readonly hidden?: boolean
}

export interface PluginPageDescriptor {
  readonly legacyPath: string
  readonly plugin: string | null
  readonly page: string | null
  readonly keywords: readonly string[]
  readonly section?: string
  readonly description?: string
  readonly packageName?: string
  readonly pluginDescription?: string
  readonly adapterKey?: string
}

export interface PluginDirectoryEntry { readonly name?: string; readonly packageName?: string; readonly description?: string }
export type PluginDirectory = Readonly<Record<string, PluginDirectoryEntry>>

export function pluginNameFromOwner(owner: unknown): string | null
export function pluginPageIdentity(route: unknown, owner?: unknown): PluginPageIdentity | null
export function pluginPagePath(plugin: string, page: string): string
export function pluginDetailPath(plugin: string): string
export function normalizePageKeywords(...values: unknown[]): string[]
export function describePluginPage(entry: unknown): PluginPageDescriptor | null
export function adapterPageHref(adapterKey: string): string
export function pluginTabsOf<T extends { path: string; meta?: Record<string, unknown> }>(routes: readonly T[] | null | undefined, names: string | readonly (string | null | undefined)[]): T[]
export function readPluginDirectory(body: unknown): PluginDirectory
export function setPluginDirectory(next: PluginDirectory | null | undefined): void
export function pluginDirectory(): PluginDirectory
export function subscribePluginDirectory(listener: () => void): () => void
export function warnIgnoredSection(path: string, section: string | undefined, logger?: { warn(message: string): void }): boolean
export function resetIgnoredSectionWarnings(): void
