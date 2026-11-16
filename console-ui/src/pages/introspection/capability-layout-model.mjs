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

/**
 * The package a source file belongs to, for items whose Host gives no `owner` / `plugin` (only the
 * file path): the last `node_modules/<name>` or `node_modules/@scope/<name>` in the path
 * (pnpm's `.pnpm/<flattened>/node_modules/@zhin.js/plugin-60s/...` → `@zhin.js/plugin-60s`), else
 * the folder under a `plugins/` directory (`./plugins/weather/index.ts` → `weather`). Empty when the
 * path names neither, so the caller keeps the path itself.
 */
export function packageFromSource(source) {
  if (typeof source !== 'string') return ''
  const parts = source.replace(/\\/gu, '/').split('/').filter(Boolean)
  const last = parts.lastIndexOf('node_modules')
  if (last >= 0 && last + 1 < parts.length) {
    const name = parts[last + 1]
    if (name.startsWith('@')) return last + 2 < parts.length ? `${name}/${parts[last + 2]}` : ''
    return name.startsWith('.') ? '' : name
  }
  const plugins = parts.lastIndexOf('plugins')
  if (plugins >= 0 && plugins + 2 < parts.length) return parts[plugins + 1]
  return ''
}

const ownerText = value => (typeof value === 'string' && value.trim() ? value.trim() : '')

/**
 * Who provides an item, for the plugin pills and the inspector: `owner`, then `plugin`, then the
 * package named by `source` (with the path kept for a tooltip), then the raw `source`, `adapter` or
 * `provider`. `{ name: '' }` when nothing names it.
 *
 * @returns {{ name: string, path?: string }}
 */
export function capabilityOwner(item) {
  const direct = ownerText(item?.owner) || ownerText(item?.plugin)
  if (direct) return { name: direct }
  const source = ownerText(item?.source)
  if (source) {
    const name = packageFromSource(source)
    return name && name !== source ? { name, path: source } : { name: source }
  }
  return { name: ownerText(item?.adapter) || ownerText(item?.provider) }
}
