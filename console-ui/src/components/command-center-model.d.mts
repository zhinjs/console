export interface RouteSearchHint { readonly description: string; readonly keywords: readonly string[] }
export const ROUTE_SEARCH_HINTS: Readonly<Record<string, RouteSearchHint>>
export const COMMAND_EXCLUDED_PATHS: readonly string[]
export function isCommandRoute(route: { path?: string; meta?: { commandPalette?: boolean; [key: string]: unknown } } | null | undefined): boolean
export function commandScore(
  target: { title: string; path: string; group: string; description: string; keywords?: readonly string[] },
  rawQuery: string,
): number
export interface PluginPageCommand {
  readonly path: string
  readonly plugin: string
  readonly packageName?: string
  readonly description?: string
  readonly keywords: readonly string[]
}
export function pluginPageCommand(
  route: { name?: string; meta?: Record<string, unknown> } | null | undefined,
  directory?: Readonly<Record<string, { name?: string; packageName?: string; description?: string }>>,
): PluginPageCommand | null
/** A search-only palette entry: listed only once the user types a query. */
export interface SearchOnlyTarget {
  readonly path: string
  readonly title: string
  readonly description: string
  readonly keywords: readonly string[]
  readonly kind: 'page'
  readonly searchOnly: true
}
type Translate = (message: string, values?: readonly unknown[]) => string
export function pluginSearchTargets(
  directory?: Readonly<Record<string, { name?: string; packageName?: string; description?: string }>>,
  t?: Translate,
  covered?: readonly string[],
): SearchOnlyTarget[]
export function commandName(pattern: unknown): string
export function commandSearchTargets(items?: readonly unknown[], t?: Translate): SearchOnlyTarget[]
