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

const LOCKS = ['global', 'adapter', 'endpoint']

function readLock(value) {
  return LOCKS.includes(value) ? value : undefined
}

/**
 * A write the Host refused because a higher level disabled the plugin (409 `locked`). The
 * transport only keeps the error text, so `lockedBy` is recovered from it when present.
 * Returns `{ lockedBy? }` or null.
 */
export function featureLockError(error) {
  const code = isRecord(error) ? error.code : undefined
  const message = error instanceof Error ? error.message : String(error ?? '')
  if (code !== 'locked' && !/\blocked\b|lockedBy|锁定|已在\s*(全局|适配器|账号)\S*\s*禁用/i.test(message)) return null
  const named = /lockedBy["'\s:=]+["']?(global|adapter|endpoint)/i.exec(message)?.[1]
    ?? /\b(?:locked|disabled) (?:by|at) (?:the )?(global|adapter|endpoint)\b/i.exec(message)?.[1]
  // Chinese Host messages name the level: 已在全局 / 适配器 / 账号禁用.
  const zh = /已在\s*(?:(全局)|(适配器)|(账号))/.exec(message)
  const lockedBy = readLock(isRecord(error) ? error.lockedBy : undefined)
    ?? readLock(named?.toLowerCase())
    ?? (zh ? LOCKS[zh.slice(1).findIndex(Boolean)] : undefined)
  return lockedBy ? { lockedBy } : {}
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
  const lockedBy = readLock(value.lockedBy)
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
    const counts = readConversationCounts(row.conversationOverrides)
    return { plugin: row.plugin, ...(typeof row.displayName === 'string' && row.displayName ? { displayName: row.displayName } : {}), global, adapters: cells,
      ...(counts ? { conversationOverrides: counts } : {}) }
  })
  const counts = readConversationCounts(payload.conversationOverrides)
  return { revision: typeof payload.revision === 'string' ? payload.revision : '', adapters, endpoints, rows, ...(counts ? { conversationOverrides: counts } : {}) }
}

/**
 * Optional `conversationOverrides: { [alias]: { [endpointId]: number } }` (ADR 0055) on the matrix
 * and on its rows: how many conversations of an endpoint store overrides. Absent on older Hosts.
 */
function readConversationCounts(value) {
  if (!isRecord(value)) return undefined
  const counts = {}
  for (const [alias, byEndpoint] of Object.entries(value)) {
    if (!isRecord(byEndpoint)) continue
    for (const [endpoint, count] of Object.entries(byEndpoint)) {
      if (!Number.isInteger(count) || count < 0) continue
      ;(counts[alias] ??= {})[endpoint] = count
    }
  }
  return counts
}

/** Endpoints of one alias with at least one overriding conversation, ordered by endpoint id. */
export function conversationOverrideCounts(counts, alias) {
  const byEndpoint = isRecord(counts) && isRecord(counts[alias]) ? counts[alias] : {}
  return Object.entries(byEndpoint)
    .filter(([, count]) => Number.isInteger(count) && count > 0)
    .map(([endpoint, count]) => ({ endpoint, count }))
    .sort((a, b) => a.endpoint.localeCompare(b.endpoint))
}

/** Global rows stay authoritative for names; a matrix adds adapter columns. */
export function mergeFeatureMatrix(globalRows, matrix) {
  if (!matrix) return { revision: '', adapters: [], endpoints: {}, rows: globalRows.map(row => ({ ...row, adapters: {} })) }
  const byPlugin = new Map(matrix.rows.map(row => [row.plugin, row]))
  const rows = globalRows.map(row => {
    const remote = byPlugin.get(row.plugin)
    return remote
      ? { ...row, global: remote.global, adapters: remote.adapters, ...(remote.conversationOverrides ? { conversationOverrides: remote.conversationOverrides } : {}) }
      : { ...row, adapters: {} }
  })
  // Nested Plugin instances (`parent/child`) are matrix rows the plugin list does not show.
  const known = new Set(globalRows.map(row => row.plugin))
  for (const remote of matrix.rows) {
    if (known.has(remote.plugin)) continue
    rows.push({ plugin: remote.plugin, name: remote.displayName ?? remote.plugin, description: '', hasSchema: false, global: remote.global, adapters: remote.adapters,
      ...(remote.conversationOverrides ? { conversationOverrides: remote.conversationOverrides } : {}) })
  }
  return { revision: matrix.revision ?? '', adapters: matrix.adapters, endpoints: matrix.endpoints ?? {}, rows,
    ...(matrix.conversationOverrides ? { conversationOverrides: matrix.conversationOverrides } : {}) }
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

const LEVELS = ['global', 'adapter', 'endpoint', 'conversation']
const OVERRIDE_LEVELS = ['adapter', 'endpoint', 'conversation']
const LEVEL_RANK = { global: 0, adapter: 1, endpoint: 2, conversation: 3 }

function stringList(value) {
  return Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string' && item))] : undefined
}

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
      ...(stringList(item.conversationFields) ? { conversationFields: stringList(item.conversationFields) } : {}),
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
    ...(readLock(payload.lockedBy) ? { lockedBy: readLock(payload.lockedBy) } : {}),
    ...(stringList(payload.conversationFields) ? { conversationFields: stringList(payload.conversationFields) } : {}),
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

const SOURCE_BADGE = { global: 'global', adapter: 'adapter', endpoint: 'endpoint', conversation: 'here' }

/**
 * One row per field on an override level: editable fields come from the level-narrowed schema;
 * other effective fields (global-only, ADR 0052) are listed read-only. On the conversation level
 * only `conversationFields` are editable (ADR 0055 §2).
 */
export function featureFieldRows(detail, conversationFields) {
  const properties = isRecord(detail.schema?.properties) ? detail.schema.properties : {}
  // The Host already narrows the schema to the level; a known `conversationFields` list narrows again.
  const allowed = detail.level === 'conversation' ? (conversationFields ?? detail.conversationFields ?? null) : null
  const editable = Object.keys(properties).filter(name => allowed === null || allowed.includes(name))
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
      badge: overridden || source === detail.level ? 'here' : source ? SOURCE_BADGE[source] : 'unset',
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
  if (!OVERRIDE_LEVELS.includes(level)) throw new Error('Overrides exist only below the global level')
  if (value === undefined) throw new Error('An override needs a value')
  if (containsRedacted(value)) throw new Error('A masked value cannot be saved')
  return { type: 'feature.set-override', plugin, level, key, patch: { [field]: value }, ...(revision ? { expectedRevision: revision } : {}) }
}

/** `feature.remove-override` body; without `field` the whole level entry is removed. */
export function removeOverrideRequest({ plugin, level, key, field, revision }) {
  if (!OVERRIDE_LEVELS.includes(level)) throw new Error('Overrides exist only below the global level')
  return { type: 'feature.remove-override', plugin, level, key, ...(field ? { paths: [[field]] } : {}), ...(revision ? { expectedRevision: revision } : {}) }
}

/**
 * `feature.set-enabled` body. A level whose plugin is disabled higher up is locked: it can be
 * neither enabled nor disabled there (ADR 0050 §4 / 0055 §4), so a locked target never builds one.
 */
export function setEnabledRequest({ plugin, level, key, enabled, revision, lockedBy }) {
  if (!LEVELS.includes(level)) throw new Error('Unknown feature level')
  if (lockedBy) throw new Error(`The plugin is disabled at the ${lockedBy} level`)
  return { type: 'feature.set-enabled', plugin, level, ...(level === 'global' ? {} : { key }), enabled: enabled === true, ...(revision ? { expectedRevision: revision } : {}) }
}

/** Validates a `feature.*` write result (`saved` / `unchanged` / `conflict` / `invalid`). */
export function readFeatureWriteResult(payload) {
  if (!isRecord(payload) || !['saved', 'unchanged', 'conflict', 'invalid', 'locked'].includes(payload.status)) throw new Error('Invalid feature write response')
  return {
    status: payload.status,
    ...(readLock(payload.lockedBy) ? { lockedBy: readLock(payload.lockedBy) } : {}),
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

/**
 * Top-down lock (ADR 0050 §4 / 0055 §4): the highest level above `level` that disables the
 * plugin, or undefined. `states` holds each level's own enabled state (missing = enabled).
 */
export function lockFor(states, level) {
  const rank = LEVEL_RANK[level]
  if (rank === undefined) throw new Error('Unknown feature level')
  return LOCKS.find(upper => LEVEL_RANK[upper] < rank && states?.[upper] === false)
}

/** Switch state on a level: a locked switch is off and inert whatever the level stores. */
export function featureSwitchState({ enabled, lockedBy }, canToggle, pending = false) {
  const locked = !!lockedBy
  return { checked: !locked && enabled === true, disabled: locked || canToggle !== true || pending === true, locked }
}

export const CONVERSATION_KINDS = Object.freeze(['group', 'private', 'channel'])

// Mirrors `@zhin.js/console-protocol` feature.ts (ADR 0055 §1 / §6).
const CONVERSATION_ALIAS = /^[a-z0-9][a-z0-9-]*$/u
const CONVERSATION_ENDPOINT_ID = /^[^/~\0]{1,128}$/u
// eslint-disable-next-line no-control-regex
const CONVERSATION_CONTROL = /[\u0000-\u001f\u007f]/u
export const CONVERSATION_ID_MAX_LENGTH = 256

/** `%` -> `%25`, `/` -> `%2F`; nothing else changes. */
export function escapeConversationId(id) {
  return id.replaceAll('%', '%25').replaceAll('/', '%2F')
}

/** Inverse of {@link escapeConversationId}; undefined for any other `%` sequence. */
export function unescapeConversationId(escaped) {
  if (/%(?!25|2[fF])/u.test(escaped) || escaped.includes('/')) return undefined
  return escaped.replace(/%2[fF]|%25/gu, match => match === '%25' ? '%' : '/')
}

/** Resolution key `<alias>/<endpointId>/<kind>:<escaped id>`; throws on an invalid reference. */
export function conversationKey({ adapter, endpoint, kind, id }) {
  if (typeof adapter !== 'string' || !CONVERSATION_ALIAS.test(adapter)) throw new Error('Conversation key adapter must be an instance alias')
  if (typeof endpoint !== 'string' || !CONVERSATION_ENDPOINT_ID.test(endpoint)) throw new Error('Conversation key endpoint id is invalid')
  if (!CONVERSATION_KINDS.includes(kind)) throw new Error('Conversation kind must be group, private or channel')
  if (typeof id !== 'string' || !id || id.length > CONVERSATION_ID_MAX_LENGTH || CONVERSATION_CONTROL.test(id)) throw new Error('Conversation id is invalid')
  return `${adapter}/${endpoint}/${kind}:${escapeConversationId(id)}`
}

/** Parses a conversation key (canonical form only); null when it is not one. */
export function parseConversationKey(key) {
  if (typeof key !== 'string') return null
  const first = key.indexOf('/')
  const second = first < 0 ? -1 : key.indexOf('/', first + 1)
  if (first <= 0 || second < 0) return null
  const rest = key.slice(second + 1)
  const colon = rest.indexOf(':')
  if (colon <= 0) return null
  const id = unescapeConversationId(rest.slice(colon + 1))
  if (id === undefined) return null
  const ref = { adapter: key.slice(0, first), endpoint: key.slice(first + 1, second), kind: rest.slice(0, colon), id }
  try {
    return conversationKey(ref) === key ? ref : null
  } catch {
    return null
  }
}

/** URL segment of a conversation inside an endpoint (`<kind>:<id>`, before URI encoding). */
export function conversationSegment(kind, id) {
  return `${kind}:${id}`
}

export function parseConversationSegment(segment) {
  if (typeof segment !== 'string') return null
  const colon = segment.indexOf(':')
  const kind = segment.slice(0, colon)
  const id = segment.slice(colon + 1)
  return colon > 0 && CONVERSATION_KINDS.includes(kind) && id ? { kind, id } : null
}

/** `feature.conversations` body (ADR 0055 §6); empty filters are left out. */
export function conversationsRequest({ plugin, adapter, endpoint, query, cursor, limit } = {}) {
  const body = { type: 'feature.conversations' }
  for (const [name, value] of Object.entries({ plugin, adapter, endpoint, cursor })) if (typeof value === 'string' && value) body[name] = value
  if (typeof query === 'string' && query.trim()) body.query = query.trim()
  if (Number.isInteger(limit) && limit > 0) body.limit = limit
  return body
}

/**
 * One `feature.conversations` entry: `{ key, adapter, endpointId, kind, id, name?, hasOverrides,
 * overrides: [{ plugin, enabled?: false, fields, revision, updatedAt, updatedBy? }], lastActiveAt? }`.
 * The key is authoritative; an entry whose key does not parse is dropped.
 */
function readConversationItem(item) {
  if (!isRecord(item) || typeof item.key !== 'string') return null
  const parsed = parseConversationKey(item.key)
  if (!parsed) return null
  const overrides = Array.isArray(item.overrides)
    ? item.overrides.filter(entry => isRecord(entry) && typeof entry.plugin === 'string' && entry.plugin)
      .map(entry => ({
        plugin: entry.plugin,
        disabled: entry.enabled === false,
        fields: stringList(entry.fields) ?? [],
        ...(typeof entry.updatedAt === 'number' ? { updatedAt: entry.updatedAt } : {}),
        ...(typeof entry.updatedBy === 'string' && entry.updatedBy ? { updatedBy: entry.updatedBy } : {}),
      }))
    : undefined
  return {
    key: item.key, adapter: parsed.adapter, endpoint: parsed.endpoint, kind: parsed.kind, id: parsed.id,
    ...(typeof item.name === 'string' && item.name ? { name: item.name } : {}),
    hasOverrides: item.hasOverrides === true || !!overrides?.length,
    ...(overrides ? { overrides } : {}),
    // Plugins overriding this conversation; null when the Host does not list them.
    overrideCount: overrides ? overrides.length : null,
    ...(typeof item.lastActiveAt === 'number' ? { lastActiveAt: item.lastActiveAt } : {}),
  }
}

/**
 * Validates a `feature.conversations` page: `{ conversations, nextCursor?, recentAvailable }`.
 * Malformed entries are dropped.
 */
export function readConversationPage(payload) {
  if (!isRecord(payload) || !Array.isArray(payload.conversations)) throw new Error('Invalid feature.conversations response')
  return {
    items: payload.conversations.map(readConversationItem).filter(Boolean),
    ...(typeof payload.nextCursor === 'string' && payload.nextCursor ? { cursor: payload.nextCursor } : {}),
    recentAvailable: payload.recentAvailable === true,
  }
}

/** Appends a further page, keeping first-seen order and the newest copy of a repeated key. */
export function appendConversationPage(previous, page) {
  const byKey = new Map((previous?.items ?? []).map(item => [item.key, item]))
  for (const item of page.items) byKey.set(item.key, item)
  return { items: [...byKey.values()], ...(page.cursor ? { cursor: page.cursor } : {}), recentAvailable: page.recentAvailable === true }
}

/** The "only with overrides" filter. */
export function filterConversations(items, onlyOverridden) {
  return onlyOverridden ? items.filter(item => item.hasOverrides) : items
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
