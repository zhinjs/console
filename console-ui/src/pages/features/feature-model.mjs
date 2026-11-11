/**
 * Pure helpers for the 功能 section (ADR 0052) on top of today's APIs, with the
 * `feature.*` RPC (ADR 0050 §8) treated as optional: older Hosts do not have it.
 */

/** How a failed `feature.*` call should be read. */
export function classifyFeatureRpcError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/unknown rpc type|unknown request type|not supported|unsupported rpc/i.test(message)) return 'unsupported'
  if (/\bHTTP 40[13]\b|forbidden|permission denied|not allowed|scope does not allow/i.test(message)) return 'forbidden'
  return 'error'
}

/**
 * Capability probe result: any answer that is not "this RPC does not exist" means the Host
 * knows `feature.*` (a validation error for a probe without a plugin still proves support).
 */
export function featureProbeStatus(outcome) {
  if (outcome.ok) return 'available'
  const kind = classifyFeatureRpcError(outcome.error)
  return kind === 'error' ? 'available' : kind
}

function pluginEnabled(plugin) {
  const management = plugin.management
  if (management) return !management.disabled && String(management.status) !== 'disabled'
  return plugin.status === 'active'
}

/** The 全局 column from `/api/plugins` rows (existing enable state). */
export function globalFeatureRows(plugins) {
  return plugins
    .filter(plugin => plugin && typeof plugin.name === 'string' && plugin.name)
    .map(plugin => {
      const key = typeof plugin.instanceKey === 'string' && plugin.instanceKey ? plugin.instanceKey : plugin.name
      return {
        plugin: key,
        name: plugin.name,
        description: typeof plugin.description === 'string' ? plugin.description : '',
        hasSchema: plugin.config?.hasSchema === true,
        global: { enabled: pluginEnabled(plugin), overridden: false },
      }
    })
    .sort((a, b) => a.plugin.localeCompare(b.plugin))
}

function readCell(value) {
  if (!value || typeof value !== 'object' || typeof value.enabled !== 'boolean') return null
  const lockedBy = value.lockedBy === 'global' || value.lockedBy === 'adapter' ? value.lockedBy : undefined
  return { enabled: value.enabled, overridden: value.overridden === true, ...(lockedBy ? { lockedBy } : {}) }
}

/**
 * Validates a `feature.matrix` payload. Expected (phase B contract):
 * `{ adapters: string[], rows: [{ plugin, global: Cell, adapters: { [adapter]: Cell } }] }`
 * where Cell is `{ enabled, lockedBy?, overridden }`. Throws on anything else.
 */
export function readFeatureMatrix(payload) {
  if (!payload || !Array.isArray(payload.adapters) || !Array.isArray(payload.rows)) throw new Error('Invalid feature.matrix response')
  const adapters = payload.adapters.filter(item => typeof item === 'string' && item)
  const rows = payload.rows.map(row => {
    if (!row || typeof row.plugin !== 'string' || !row.plugin) throw new Error('Invalid feature.matrix row')
    const global = readCell(row.global)
    if (!global) throw new Error('Invalid feature.matrix cell')
    const cells = {}
    for (const adapter of adapters) {
      const cell = readCell(row.adapters?.[adapter])
      if (cell) cells[adapter] = cell
    }
    return { plugin: row.plugin, global, adapters: cells }
  })
  return { adapters, rows }
}

/** Global rows stay authoritative for names; a matrix adds adapter columns. */
export function mergeFeatureMatrix(globalRows, matrix) {
  if (!matrix) return { adapters: [], rows: globalRows.map(row => ({ ...row, adapters: {} })) }
  const byPlugin = new Map(matrix.rows.map(row => [row.plugin, row]))
  const rows = globalRows.map(row => {
    const remote = byPlugin.get(row.plugin)
    return remote ? { ...row, global: remote.global, adapters: remote.adapters } : { ...row, adapters: {} }
  })
  return { adapters: matrix.adapters, rows }
}

/** Adapter instances with account and online counts, from `endpoint.list`. */
export function summarizeAdapters(endpoints) {
  const byAdapter = new Map()
  for (const endpoint of endpoints) {
    const adapter = endpoint?.endpoint?.adapter ?? endpoint?.adapter
    if (typeof adapter !== 'string' || !adapter) continue
    const entry = byAdapter.get(adapter) ?? { adapter, accounts: 0, online: 0, pending: 0 }
    entry.accounts += 1
    if (endpoint.connected === true || endpoint.status === 'online') entry.online += 1
    entry.pending += (endpoint.pendingRequestCount ?? 0) + (endpoint.pendingNoticeCount ?? 0)
    byAdapter.set(adapter, entry)
  }
  return [...byAdapter.values()].sort((a, b) => a.adapter.localeCompare(b.adapter))
}

export function endpointsOfAdapter(endpoints, adapter) {
  return endpoints.filter(endpoint => (endpoint?.endpoint?.adapter ?? endpoint?.adapter) === adapter)
}

/** Display state of one cell: enabled / disabled / locked by a higher level. */
export function cellState(cell) {
  if (!cell) return 'unknown'
  if (cell.lockedBy) return 'locked'
  return cell.enabled ? 'enabled' : 'disabled'
}
