/**
 * Pure helpers for the 功能 section (ADR 0052) on top of today's APIs, with the
 * `feature.*` RPC (ADR 0050 §8) treated as optional: older Hosts do not have it.
 */

/** How a failed `feature.*` call should be read. */
export function classifyFeatureRpcError(error) {
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (/unknown rpc type|unknown request type|not supported|unsupported rpc/i.test(message)) return 'unsupported'
  if (/\bHTTP 40[13]\b|forbidden|permission denied|not allowed|scope does not allow/i.test(message)) return 'forbidden'
  // The Host's `feature.*` denial reads `没有 <permission> 权限`.
  if (/没有\s*\S+\s*权限/.test(message)) return 'forbidden'
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
 * Validates a `feature.matrix` payload (ADR 0050 §8):
 * `{ revision, adapters: string[], endpoints: { [alias]: string[] }, rows: [{ plugin, displayName, global: Cell, adapters: { [alias]: Cell } }] }`
 * where Cell is `{ enabled, lockedBy?, overridden }`. Throws on anything else.
 */
export function readFeatureMatrix(payload) {
  if (!payload || !Array.isArray(payload.adapters) || !Array.isArray(payload.rows)) throw new Error('Invalid feature.matrix response')
  const adapters = payload.adapters.filter(item => typeof item === 'string' && item)
  const endpoints = {}
  for (const adapter of adapters) {
    const ids = isRecord(payload.endpoints) && Array.isArray(payload.endpoints[adapter]) ? payload.endpoints[adapter] : []
    endpoints[adapter] = ids.filter(id => typeof id === 'string' && id)
  }
  const rows = payload.rows.map(row => {
    if (!row || typeof row.plugin !== 'string' || !row.plugin) throw new Error('Invalid feature.matrix row')
    const global = readCell(row.global)
    if (!global) throw new Error('Invalid feature.matrix cell')
    const cells = {}
    for (const adapter of adapters) {
      const cell = readCell(row.adapters?.[adapter])
      if (cell) cells[adapter] = cell
    }
    return { plugin: row.plugin, ...(typeof row.displayName === 'string' && row.displayName ? { displayName: row.displayName } : {}), global, adapters: cells }
  })
  return { revision: typeof payload.revision === 'string' ? payload.revision : '', adapters, endpoints, rows }
}

/** Global rows stay authoritative for names; a matrix adds adapter columns. */
export function mergeFeatureMatrix(globalRows, matrix) {
  if (!matrix) return { revision: '', adapters: [], endpoints: {}, rows: globalRows.map(row => ({ ...row, adapters: {} })) }
  const byPlugin = new Map(matrix.rows.map(row => [row.plugin, row]))
  const rows = globalRows.map(row => {
    const remote = byPlugin.get(row.plugin)
    return remote ? { ...row, global: remote.global, adapters: remote.adapters } : { ...row, adapters: {} }
  })
  // Nested Plugin instances (`parent/child`) are matrix rows the plugin list does not show.
  const known = new Set(globalRows.map(row => row.plugin))
  for (const remote of matrix.rows) {
    if (known.has(remote.plugin)) continue
    rows.push({ plugin: remote.plugin, name: remote.displayName ?? remote.plugin, description: '', hasSchema: false, global: remote.global, adapters: remote.adapters })
  }
  return { revision: matrix.revision ?? '', adapters: matrix.adapters, endpoints: matrix.endpoints ?? {}, rows }
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

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

const LEVELS = ['global', 'adapter', 'endpoint']
const LEVEL_RANK = { global: 0, adapter: 1, endpoint: 2 }

function readLevels(value) {
  const levels = Array.isArray(value) ? LEVELS.filter(level => value.includes(level)) : []
  return levels.length ? levels : ['global']
}

/** Validates `feature.list`: `{ revision, features: [{ plugin, displayName, levels, hasSchema, globalEnabled, adapter? }] }`. */
export function readFeatureList(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.features)) throw new Error('Invalid feature.list response')
  const features = payload.features.map(item => {
    if (!isRecord(item) || typeof item.plugin !== 'string' || !item.plugin) throw new Error('Invalid feature.list entry')
    return {
      plugin: item.plugin,
      displayName: typeof item.displayName === 'string' && item.displayName ? item.displayName : item.plugin,
      levels: readLevels(item.levels),
      hasSchema: item.hasSchema === true,
      globalEnabled: item.globalEnabled !== false,
      adapter: item.adapter === true,
    }
  })
  return { revision: typeof payload.revision === 'string' ? payload.revision : '', features }
}

/**
 * Features shown on an adapter / endpoint page: those declaring the level (ADR 0052), plus
 * Plugins without a configuration schema, which only have the three-level switch (ADR 0050 §2).
 * Adapter Plugins themselves are not features of their own accounts.
 */
export function featuresAtLevel(features, level) {
  return features.filter(feature => !feature.adapter && (feature.levels.includes(level) || !feature.hasSchema))
}

/** Validates `feature.get`. Throws on anything else. */
export function readFeatureDetail(payload) {
  if (!isRecord(payload) || typeof payload.plugin !== 'string' || !LEVELS.includes(payload.level)) throw new Error('Invalid feature.get response')
  const sources = {}
  if (isRecord(payload.sources)) for (const [path, level] of Object.entries(payload.sources)) if (LEVELS.includes(level)) sources[path] = level
  return {
    revision: typeof payload.revision === 'string' ? payload.revision : '',
    plugin: payload.plugin,
    level: payload.level,
    ...(typeof payload.key === 'string' && payload.key ? { key: payload.key } : {}),
    levels: readLevels(payload.levels),
    schema: isRecord(payload.schema) ? payload.schema : null,
    values: isRecord(payload.values) ? payload.values : {},
    effective: isRecord(payload.effective) ? payload.effective : {},
    sources,
    enabled: payload.enabled !== false,
    ...(payload.lockedBy === 'global' || payload.lockedBy === 'adapter' ? { lockedBy: payload.lockedBy } : {}),
  }
}

/** Gateway mask for secret values (`[redacted]`). */
export const REDACTED_VALUE = '[redacted]'

export function containsRedacted(value) {
  if (value === REDACTED_VALUE) return true
  if (Array.isArray(value)) return value.some(containsRedacted)
  if (isRecord(value)) return Object.values(value).some(containsRedacted)
  return false
}

function pointerSegment(name) {
  return String(name).replace(/~/g, '~0').replace(/\//g, '~1')
}

/** Most specific level that set any leaf of a top-level field; null when nothing sets it. */
export function fieldSource(sources, name) {
  const path = `/${pointerSegment(name)}`
  let best = null
  for (const [pointer, level] of Object.entries(sources ?? {})) {
    if (pointer !== path && !pointer.startsWith(`${path}/`)) continue
    if (best === null || LEVEL_RANK[level] > LEVEL_RANK[best]) best = level
  }
  return best
}

/**
 * One row per field on an override level: editable fields come from the level-narrowed schema;
 * other effective fields (global-only, ADR 0052) are listed read-only.
 */
export function featureFieldRows(detail) {
  const properties = isRecord(detail.schema?.properties) ? detail.schema.properties : {}
  const editable = Object.keys(properties)
  const names = [...new Set([...editable, ...Object.keys(detail.values), ...Object.keys(detail.effective)])]
  return names.map(name => {
    const overridden = detail.level !== 'global' && Object.hasOwn(detail.values, name)
    const source = overridden ? detail.level : fieldSource(detail.sources, name)
    return {
      name,
      editable: editable.includes(name),
      schema: isRecord(properties[name]) ? properties[name] : null,
      overridden,
      source,
      badge: overridden ? 'here' : source === 'adapter' ? 'adapter' : source === 'global' ? 'global' : 'unset',
      effective: detail.effective[name],
      stored: detail.values[name],
    }
  })
}

/**
 * Starting value of an override editor: the stored override, else the inherited value. A masked
 * secret never becomes a draft (it would write the mask back).
 */
export function overrideDraftSeed(row) {
  const value = row.overridden ? row.stored : row.effective
  if (value === undefined || containsRedacted(value)) return undefined
  return structuredClone(value)
}

/** `feature.set-override` body for one top-level field. */
export function setOverrideRequest({ plugin, level, key, field, value, revision }) {
  if (level !== 'adapter' && level !== 'endpoint') throw new Error('Overrides exist only for adapter and endpoint levels')
  if (value === undefined) throw new Error('An override needs a value')
  if (containsRedacted(value)) throw new Error('A masked value cannot be saved')
  return { type: 'feature.set-override', plugin, level, key, patch: { [field]: value }, ...(revision ? { expectedRevision: revision } : {}) }
}

/** `feature.remove-override` body; without `field` the whole level entry is removed. */
export function removeOverrideRequest({ plugin, level, key, field, revision }) {
  if (level !== 'adapter' && level !== 'endpoint') throw new Error('Overrides exist only for adapter and endpoint levels')
  return { type: 'feature.remove-override', plugin, level, key, ...(field ? { paths: [[field]] } : {}), ...(revision ? { expectedRevision: revision } : {}) }
}

/** `feature.set-enabled` body. */
export function setEnabledRequest({ plugin, level, key, enabled, revision }) {
  if (!LEVELS.includes(level)) throw new Error('Unknown feature level')
  return { type: 'feature.set-enabled', plugin, level, ...(level === 'global' ? {} : { key }), enabled: enabled === true, ...(revision ? { expectedRevision: revision } : {}) }
}

/** Validates a `feature.*` write result (`saved` / `unchanged` / `conflict` / `invalid`). */
export function readFeatureWriteResult(payload) {
  if (!isRecord(payload) || !['saved', 'unchanged', 'conflict', 'invalid'].includes(payload.status)) throw new Error('Invalid feature write response')
  return {
    status: payload.status,
    revision: typeof payload.revision === 'string' ? payload.revision : '',
    message: typeof payload.message === 'string' ? payload.message : '',
    restartRequired: payload.restartRequired === true,
    warnings: Array.isArray(payload.warnings) ? payload.warnings.filter(isRecord).map(item => ({ code: String(item.code ?? ''), path: String(item.path ?? ''), message: String(item.message ?? '') })) : [],
    errors: Array.isArray(payload.errors) ? payload.errors.filter(isRecord).map(item => ({ path: String(item.path ?? ''), message: String(item.message ?? '') })) : [],
  }
}

/** Whether a cell's switch can be operated: locked cells and missing permission cannot. */
export function cellToggleable(cell, canToggle) {
  return !!cell && canToggle === true && !cell.lockedBy
}

/** Display state of one cell: enabled / disabled / locked by a higher level. */
export function cellState(cell) {
  if (!cell) return 'unknown'
  if (cell.lockedBy) return 'locked'
  return cell.enabled ? 'enabled' : 'disabled'
}

/**
 * `feature.get` returns plain JSON Schema; the Console field editor reads the ConsoleSchema
 * projection. Unknown constructs fall back to the JSON editor (`any`); the Host validates.
 */
export function jsonSchemaToField(schema) {
  if (!isRecord(schema)) return { type: 'any' }
  const base = {}
  if (typeof schema.title === 'string') base.title = schema.title
  if (typeof schema.description === 'string') base.description = schema.description
  if (Object.hasOwn(schema, 'default')) base.default = structuredClone(schema.default)
  if (schema.writeOnly === true || schema.format === 'password' || schema['x-zhin-secret'] === true || schema.secret === true) base.secret = true
  if (isRecord(schema['x-i18n'])) base['x-i18n'] = schema['x-i18n']
  if (Object.hasOwn(schema, 'const')) return { ...base, type: 'const', value: schema.const }
  if (Array.isArray(schema.enum) && schema.enum.length) {
    const first = schema.enum.find(value => value !== null)
    return { ...base, type: typeof first === 'number' ? 'number' : typeof first === 'boolean' ? 'boolean' : 'string', options: schema.enum.map(value => ({ label: String(value), value })) }
  }
  const branches = Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : null
  if (branches) return { ...base, type: 'union', list: branches.map(jsonSchemaToField) }
  const type = Array.isArray(schema.type) ? schema.type.find(item => item !== 'null') : schema.type
  switch (type) {
    case 'string':
      return { ...base, type: 'string', ...(typeof schema.pattern === 'string' ? { pattern: schema.pattern } : {}) }
    case 'integer':
    case 'number':
      return { ...base, type: 'number', ...(type === 'integer' ? { integer: true } : {}),
        ...(typeof schema.minimum === 'number' ? { min: schema.minimum } : {}), ...(typeof schema.maximum === 'number' ? { max: schema.maximum } : {}) }
    case 'boolean':
      return { ...base, type: 'boolean' }
    case 'array':
      return { ...base, type: 'list', inner: jsonSchemaToField(schema.items) }
    case 'object': {
      if (isRecord(schema.properties) && Object.keys(schema.properties).length) {
        const object = {}
        for (const [key, child] of Object.entries(schema.properties)) object[key] = { ...jsonSchemaToField(child), key }
        return { ...base, type: 'object', object }
      }
      if (isRecord(schema.additionalProperties)) return { ...base, type: 'dict', inner: jsonSchemaToField(schema.additionalProperties) }
      return { ...base, type: 'any' }
    }
    default:
      return { ...base, type: 'any' }
  }
}
