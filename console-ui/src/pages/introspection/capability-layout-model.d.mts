export declare const CAPABILITY_DETAIL_SHEET_QUERY: string

export declare function capabilityCountSummary(input: {
  pageCount: number
  visibleCount: number
  total?: number
  ownerFilter?: string
}): { count: number; pageOnly: boolean; ownerCountsPageOnly: boolean }
/** The package a source file path belongs to (`node_modules/@scope/name` or `plugins/<name>`); empty when none. */
export function packageFromSource(source: unknown): string
/** Who provides a capability item; `path` is the source file when the name was read from it. */
export function capabilityOwner(item: Readonly<Record<string, unknown>> | null | undefined): { name: string; path?: string }
