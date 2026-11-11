export declare const CAPABILITY_DETAIL_SHEET_QUERY: string

export declare function capabilityCountSummary(input: {
  pageCount: number
  visibleCount: number
  total?: number
  ownerFilter?: string
}): { count: number; pageOnly: boolean; ownerCountsPageOnly: boolean }
