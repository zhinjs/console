export const INTROSPECTION_PAGE_SIZE = 100
export const INTROSPECTION_MAX_PAGES = 20

const items = envelope => Array.isArray(envelope?.items) ? envelope.items : []

/** The Host-reported total; a missing or inconsistent total falls back to what was received. */
export function introspectionTotal(envelope) {
  const received = items(envelope).length
  const total = envelope?.total
  return Number.isInteger(total) && total >= received ? total : received
}

/**
 * Reads every introspection page (the Host paginates with page/pageSize/total).
 * Stops at `maxPages`; `truncated` then tells the UI that only part was loaded.
 */
export async function fetchAllIntrospection(fetchPage, { pageSize = INTROSPECTION_PAGE_SIZE, maxPages = INTROSPECTION_MAX_PAGES } = {}) {
  const first = await fetchPage(1, pageSize)
  const all = [...items(first)]
  let total = introspectionTotal(first)
  for (let page = 2; all.length < total && page <= maxPages; page++) {
    const next = await fetchPage(page, pageSize)
    const batch = items(next)
    // The Host clamps an out-of-range page to the last one; never append it twice.
    if (!batch.length || (Number.isInteger(next?.page) && next.page !== page)) break
    all.push(...batch)
    total = Math.max(introspectionTotal(next), all.length)
  }
  total = Math.max(total, all.length)
  return { note: first?.note, items: all, total, truncated: all.length < total }
}
