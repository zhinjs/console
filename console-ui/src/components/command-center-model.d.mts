export interface RouteSearchHint { readonly description: string; readonly keywords: readonly string[] }
export const ROUTE_SEARCH_HINTS: Readonly<Record<string, RouteSearchHint>>
export const COMMAND_EXCLUDED_PATHS: readonly string[]
export function isCommandRoute(route: { path?: string; meta?: { commandPalette?: boolean; [key: string]: unknown } } | null | undefined): boolean
export function commandScore(
  target: { title: string; path: string; group: string; description: string; keywords?: readonly string[] },
  rawQuery: string,
): number
