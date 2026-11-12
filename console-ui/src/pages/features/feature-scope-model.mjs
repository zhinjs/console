/**
 * The 功能 tab of an object page (ADR 0050 / 0052 / 0055): one row per plugin with its effective
 * state, the level that decided it, whether this level overrides it and which level locks it; and,
 * expanded, every field with its inherited value, this level's override, the effective value and
 * its source. Pure helpers on top of `feature.list` / `feature.get`; the panel renders them.
 */
import { containsRedacted, featureFieldRows, fieldSource, parseConversationKey } from './feature-model.mjs'
import { scopeHref } from '../../scope/scope-tree.mjs'

/** Row filters of the 功能 tab, in display order (labels are authored in the panel). */
export const FEATURE_ROW_FILTERS = Object.freeze(['all', 'overridden', 'disabled', 'locked'])

const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)

/** The level directly above an override level (`feature.get` target for 继承值); null for 全局. */
export function parentFeatureTarget(level, key) {
  if (level === 'adapter') return { level: 'global' }
  if (level === 'endpoint') {
    const alias = typeof key === 'string' ? key.split('/')[0] : ''
    return alias ? { level: 'adapter', key: alias } : null
  }
  if (level === 'conversation') {
    const ref = parseConversationKey(key)
    return ref ? { level: 'endpoint', key: `${ref.adapter}/${ref.endpoint}` } : null
  }
  return null
}

/** Whether the level stores its own switch (an explicit `enabled`, or off while nothing above locks it). */
export function switchOverridden(detail) {
  if (!detail || detail.level === 'global') return false
  if (Object.hasOwn(detail.values ?? {}, 'enabled')) return true
  return detail.sources?.['/enabled'] === detail.level || (detail.enabled === false && !detail.lockedBy)
}

/**
 * Level that decided the effective on / off state: the locking level, the level `sources` names for
 * `/enabled`, this level when it stores the switch, else 全局 (the default everybody inherits).
 */
export function featureStateSource(detail) {
  if (!detail) return null
  if (detail.lockedBy) return detail.lockedBy
  const named = detail.sources?.['/enabled']
  if (named) return named
  return switchOverridden(detail) ? detail.level : 'global'
}

/** Effective state of a plugin at a level. */
export function featureState(detail) {
  if (!detail) return 'unknown'
  if (detail.lockedBy) return 'locked'
  return detail.enabled ? 'enabled' : 'disabled'
}

/**
 * One row of the 功能 tab. `detail` is the plugin's `feature.get` at this level (null while it loads
 * or when it failed). `configurable`: the plugin declares fields at this level (otherwise only the
 * switch is offered).
 */
export function featureLevelRow(feature, detail, level) {
  // `enabled` is the switch, not a field, when a Host stores it beside the overrides.
  const fields = detail ? featureFieldRows(detail, feature.conversationFields).filter(row => row.name !== 'enabled' || row.schema) : []
  const fieldOverrides = fields.filter(row => row.overridden).length
  const ownSwitch = switchOverridden(detail)
  return {
    plugin: feature.plugin,
    displayName: feature.displayName ?? feature.plugin,
    state: featureState(detail),
    ...(detail?.lockedBy ? { lockedBy: detail.lockedBy } : {}),
    stateSource: featureStateSource(detail),
    switchOverridden: ownSwitch,
    fieldOverrides,
    overriddenHere: ownSwitch || fieldOverrides > 0,
    configurable: Array.isArray(feature.levels) && feature.levels.includes(level),
    editableFields: fields.filter(row => row.editable).length,
    fields,
  }
}

/** Rows that pass a filter (`FEATURE_ROW_FILTERS`) and a name / id search. */
export function filterFeatureRows(rows, filter = 'all', query = '') {
  const text = typeof query === 'string' ? query.trim().toLowerCase() : ''
  return rows.filter(row => {
    if (filter === 'overridden' && !row.overriddenHere) return false
    if (filter === 'disabled' && row.state !== 'disabled') return false
    if (filter === 'locked' && row.state !== 'locked') return false
    return !text || row.plugin.toLowerCase().includes(text) || row.displayName.toLowerCase().includes(text)
  })
}

/** Counts for the filter buttons. */
export function featureRowCounts(rows) {
  return {
    all: rows.length,
    overridden: rows.filter(row => row.overriddenHere).length,
    disabled: rows.filter(row => row.state === 'disabled').length,
    locked: rows.filter(row => row.state === 'locked').length,
  }
}

/**
 * Object page of the level that locks a plugin (its 功能 tab), from the scope being viewed:
 * 全局 → `/scope?tab=features`, 适配器 → the scope's adapter, 账号 → the scope's account.
 */
export function featureLockHref(lockedBy, scope) {
  if (lockedBy === 'adapter' && scope?.adapter) return scopeHref({ adapter: scope.adapter }, 'features')
  if (lockedBy === 'endpoint' && scope?.adapter && scope.endpoint) return scopeHref({ adapter: scope.adapter, endpoint: scope.endpoint }, 'features')
  return scopeHref({}, 'features')
}

/**
 * One field of an expanded row: `inherited` is what the level above provides (`known: false` while
 * the parent's `feature.get` is not loaded for an overridden field), `here` the value stored at this
 * level (null when it inherits), `effective` and `source` what applies. A masked secret is reported
 * as `masked`, never as a value.
 */
export function featureFieldView(row, parentDetail) {
  const inherited = !row.overridden
    ? { known: true, value: row.effective, source: row.source }
    : parentDetail
      ? { known: true, value: parentDetail.effective?.[row.name], source: fieldSource(parentDetail.sources, row.name) }
      : { known: false, value: undefined, source: null }
  return {
    name: row.name,
    editable: row.editable,
    overridden: row.overridden,
    inherited,
    here: row.overridden ? { value: row.stored } : null,
    effective: row.effective,
    source: row.source ?? null,
    masked: containsRedacted(row.effective) || containsRedacted(row.stored),
  }
}

/** Short display text of a value; `copy` holds the translated words for 未设置 and a masked secret (never shown). */
export function featureValueText(value, copy) {
  if (value === undefined) return copy.unset
  if (containsRedacted(value)) return copy.masked
  if (typeof value === 'string') return value
  const text = JSON.stringify(value)
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

/**
 * What a write did, for the receipt: `{ status, message? }` (`saved` / `unchanged` succeed,
 * `conflict` / `invalid` were not applied) or `{ locked: true, lockedBy?, message }` for a write the
 * Host refused because a higher level disables the plugin.
 */
export function featureReceiptOutcome(result) {
  if (!isRecord(result)) return { status: 'saved' }
  if (result.status === 'locked') return { locked: true, ...(result.lockedBy ? { lockedBy: result.lockedBy } : {}), message: result.message || 'locked' }
  if (result.status === 'conflict') return { status: 'conflict', message: result.message || 'conflict' }
  if (result.status === 'invalid') {
    const lines = [result.message, ...(Array.isArray(result.errors) ? result.errors.map(item => `${item.path}: ${item.message}`) : [])].filter(Boolean)
    return { status: 'invalid', message: lines.join('\n') || 'invalid' }
  }
  const warnings = Array.isArray(result.warnings) ? result.warnings.map(item => item.message).filter(Boolean) : []
  return { status: result.status === 'unchanged' ? 'unchanged' : 'saved', ...(warnings.length ? { message: warnings.join('\n') } : {}) }
}

function sameValue(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/**
 * Read-only check after an unknown outcome: whether a re-read `feature.get` shows the change.
 * `change`: `{ kind: 'enabled', enabled }`, `{ kind: 'set', field, value }`, `{ kind: 'remove', field }`
 * or `{ kind: 'clear' }`. Returns true / false (never re-sends anything).
 */
export function featureChangeApplied(detail, change) {
  if (!detail || !change) return false
  const values = detail.values ?? {}
  if (change.kind === 'enabled') return !detail.lockedBy && detail.enabled === change.enabled
  if (change.kind === 'set') return Object.hasOwn(values, change.field) && sameValue(values[change.field], change.value)
  if (change.kind === 'remove') return !Object.hasOwn(values, change.field)
  if (change.kind === 'clear') return Object.keys(values).length === 0 && !switchOverridden(detail)
  return false
}

/**
 * Rows of the global 功能 overview from the merged matrix (and `feature.list` levels when the Host
 * has it): the global switch, the declared levels, the adapters that override or switch the plugin
 * off, and the accounts whose conversations override it.
 */
export function globalFeatureOverview(matrixRows = [], adapters = [], features = null) {
  const byPlugin = new Map((features ?? []).map(feature => [feature.plugin, feature]))
  return matrixRows.map(row => {
    const feature = byPlugin.get(row.plugin)
    const below = adapters.flatMap(adapter => {
      const cell = row.adapters?.[adapter]
      if (!cell || cell.lockedBy) return []
      if (!cell.enabled) return [{ adapter, state: 'disabled' }]
      return cell.overridden ? [{ adapter, state: 'overridden' }] : []
    })
    const conversations = []
    for (const [adapter, byEndpoint] of Object.entries(isRecord(row.conversationOverrides) ? row.conversationOverrides : {})) {
      for (const [endpoint, count] of Object.entries(isRecord(byEndpoint) ? byEndpoint : {})) {
        if (Number.isInteger(count) && count > 0) conversations.push({ adapter, endpoint, count })
      }
    }
    conversations.sort((a, b) => a.adapter.localeCompare(b.adapter) || a.endpoint.localeCompare(b.endpoint))
    return {
      plugin: row.plugin,
      name: feature?.displayName ?? row.name ?? row.plugin,
      description: typeof row.description === 'string' ? row.description : '',
      enabled: row.global?.enabled !== false,
      levels: feature ? feature.levels : null,
      adapter: feature?.adapter === true,
      nested: row.plugin.includes('/'),
      below,
      conversations,
    }
  })
}

/** Counts above the global overview. */
export function globalFeatureCounts(rows) {
  return {
    total: rows.length,
    enabled: rows.filter(row => row.enabled).length,
    disabled: rows.filter(row => !row.enabled).length,
    customized: rows.filter(row => row.below.length || row.conversations.length).length,
  }
}
