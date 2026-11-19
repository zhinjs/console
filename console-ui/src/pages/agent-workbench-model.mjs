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

const text = value => (typeof value === 'string' && value.trim() ? value.trim() : '')

/**
 * 「Provider · 模型」 of an Agent binding (zhinjs/zhin#1250 `agent-workbench-stale`). A newer Host adds
 * `effective: { provider?, serviceLabel?, model?, modelLabel?, profileLabel? }`, the binding that is
 * actually in force (from 「AI 与模型 → 用途」); older Hosts only send the configured `provider` /
 * `model`, which are empty when the Agent follows the purposes. `{ provider, model, source }` with
 * `source` `'effective' | 'configured' | 'default'`; empty strings mean 「默认」.
 */
export function bindingModel(binding) {
  const effective = binding?.effective && typeof binding.effective === 'object' ? binding.effective : null
  if (effective) {
    const provider = text(effective.serviceLabel) || text(effective.provider)
    const model = text(effective.modelLabel) || text(effective.profileLabel) || text(effective.model)
    if (provider || model) return { provider, model, source: 'effective' }
  }
  const provider = text(binding?.provider)
  const model = text(binding?.model)
  return { provider, model, source: provider || model ? 'configured' : 'default' }
}

/**
 * Recent Agent conversations: the ones opened in this browser first, then the sessions the Host's
 * turn traces saw (`usage-stats` → `bySession`, newest `lastAt` first when the Host reports it, else
 * most turns), without duplicates. A browser-opened key the traces also saw gets their details.
 * `[{ key, label, turns, lastAt, source: 'local' | 'trace', platform?, scopeKind?, sceneLabel? }]` —
 * `label` is the Host's own name (`displayName` / `label` / `name`); the shown name is
 * `sessionLabel` over the whole entry.
 */
export function recentAgentSessions(localKeys, traceSessions, limit = 6) {
  const out = []
  const seen = new Set()
  const rows = (Array.isArray(traceSessions) ? traceSessions : []).filter(row => row && typeof row.sessionKey === 'string' && row.sessionKey)
  const lastAt = row => (typeof row.lastAt === 'number' && Number.isFinite(row.lastAt) ? row.lastAt : null)
  const described = row => {
    if (!row) return {}
    const fields = { platform: text(row.platform), scopeKind: text(row.scopeKind), sceneLabel: text(row.sceneLabel) }
    return Object.fromEntries(Object.entries(fields).filter(([, value]) => value))
  }
  const entry = (key, row, source) => ({
    key,
    label: row ? text(row.label) || text(row.displayName) || text(row.name) : '',
    turns: row && typeof row.turns === 'number' ? row.turns : null,
    lastAt: row ? lastAt(row) : null,
    source,
    ...described(row),
  })
  const byKey = new Map(rows.map(row => [row.sessionKey, row]))
  for (const key of Array.isArray(localKeys) ? localKeys : []) {
    if (typeof key !== 'string' || !key || seen.has(key)) continue
    seen.add(key)
    out.push(entry(key, byKey.get(key), 'local'))
  }
  const ordered = [...rows].sort((a, b) => (lastAt(b) ?? -1) - (lastAt(a) ?? -1) || (b.turns ?? 0) - (a.turns ?? 0))
  for (const row of ordered) {
    if (seen.has(row.sessionKey)) continue
    seen.add(row.sessionKey)
    out.push(entry(row.sessionKey, row, 'trace'))
  }
  return out.slice(0, limit)
}
