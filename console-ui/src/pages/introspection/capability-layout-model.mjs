/**
 * Below 881px `.console-capability-workspace` collapses to one column (design-system.css
 * `@media (max-width: 880px)`), which pushes the inspector under the whole list. This query is that
 * same breakpoint, so on every width exactly one of the inline inspector or the detail sheet exists.
 */
export const CAPABILITY_DETAIL_SHEET_QUERY = '(max-width: 880px)'

/**
 * The introspection API paginates on the server (`paginateItems`) and only knows a text `filter`;
 * the plugin pills filter the rows of the current page. `total` is the server-side count after the
 * text filter, so it is the honest number when no plugin is selected. Any count derived from the
 * page rows is marked `pageOnly` whenever the server holds more rows than this page carries.
 *
 * @param {{ pageCount: number, visibleCount: number, total?: number, ownerFilter?: string }} input
 * @returns {{ count: number, pageOnly: boolean, ownerCountsPageOnly: boolean }}
 */
export function capabilityCountSummary({ pageCount, visibleCount, total, ownerFilter }) {
  const serverTotal = typeof total === 'number' && Number.isFinite(total) && total >= pageCount ? total : pageCount
  const partial = serverTotal > pageCount
  if (ownerFilter) return { count: visibleCount, pageOnly: partial, ownerCountsPageOnly: partial }
  return { count: serverTotal, pageOnly: false, ownerCountsPageOnly: partial }
}
