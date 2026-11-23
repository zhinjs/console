/**
 * Configuration drift of an adapter's accounts (zhinjs/zhin#1250 `console-configured-endpoint-no-enable`):
 * `zhin.config.yml` accounts versus the persisted (managed) accounts, and the two ways to settle a
 * difference — import the file's account into the managed accounts (`endpoint-import`) or write the
 * managed accounts back into the file (`endpoint-writeback`). Read with `endpoint-drift`. Pure.
 */
import { resolveConsoleRpcPermission } from '@zhin.js/console-protocol'
import { hasConsolePermission, GLOBAL_TARGET } from '../../utils/console-access.mjs'
import { translate } from '../../i18n/locale.mjs'

/**
 * Adapter account methods contributed by `defineAdapterConsoleRpc` (`plugin.<pluginId>.<method>`).
 * `@zhin.js/console-protocol` exports no constants for plugin methods — only its permission table
 * knows these names — so they are listed here once and checked against that table in the tests
 * (`resolveConsoleRpcPermission` must classify each of them).
 */
export const ADAPTER_CONFIG_RPC = Object.freeze({
  DRIFT: 'endpoint-drift',
  IMPORT: 'endpoint-import',
  WRITEBACK: 'endpoint-writeback',
})

const KINDS = new Set(['config_only', 'snapshot_only', 'changed'])
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.trim() ? value.trim() : null
const revisionOf = value => value === null || (Number.isSafeInteger(value) && value >= 0) ? value : undefined

/**
 * `endpoint-drift` → `{ authority, revision, generation, canImport, canWriteback, entries, unverified }`;
 * null when the reply is not one (the Console then shows nothing, as before).
 */
export function readConfigDrift(data) {
  if (!isRecord(data) || (data.authority !== 'snapshot' && data.authority !== 'config') || !Array.isArray(data.entries)) return null
  const revision = revisionOf(data.revision)
  if (revision === undefined) return null
  const entries = []
  for (const entry of data.entries) {
    if (!isRecord(entry) || !text(entry.id) || !KINDS.has(entry.kind)) continue
    const fields = Array.isArray(entry.fields)
      ? entry.fields.filter(field => isRecord(field) && text(field.path)).map(field => ({ path: field.path.trim(), sensitive: field.sensitive === true }))
      : []
    entries.push({
      id: entry.id.trim(), kind: entry.kind, ...(text(entry.instanceId) ? { instanceId: entry.instanceId.trim() } : {}), fields,
      // zhinjs/zhin#1250 第 88 批: an account added in the Console that the file never had. Optional: older Hosts omit it.
      ...(entry.kind === 'snapshot_only' && entry.origin === 'console' ? { origin: 'console' } : {}),
    })
  }
  const unverified = Array.isArray(data.unverified)
    ? data.unverified.filter(item => isRecord(item) && text(item.id) && Array.isArray(item.paths))
      .map(item => ({ id: item.id.trim(), paths: item.paths.filter(path => typeof path === 'string' && path) }))
    : []
  return {
    authority: data.authority,
    revision,
    generation: Number.isSafeInteger(data.generation) ? data.generation : null,
    canImport: data.canImport === true,
    canWriteback: data.canWriteback === true,
    entries,
    unverified,
  }
}

/** `plugin.<pluginId>.<method>`, the RPC type the Host's permission table classifies. */
export function adapterConfigRpcType(pluginId, method) {
  return `plugin.${pluginId}.${method}`
}

/**
 * Whether the signed-in user may call this RPC, by the protocol's permission table
 * (`resolveConsoleRpcPermission`): its permission at its target, plus every `alsoRequires`
 * permission held globally. `missing` lists what is lacking (shown in the no-permission state).
 */
export function adapterConfigPermission(pluginId, method, payload, access) {
  const rule = resolveConsoleRpcPermission(adapterConfigRpcType(pluginId, method), payload ? { data: payload } : undefined)
  if (!rule) return { allowed: false, missing: [] }
  if (rule.kind !== 'exact') {
    const allowed = hasConsolePermission(rule.read, access, GLOBAL_TARGET)
    return { allowed, missing: allowed ? [] : [rule.read] }
  }
  const missing = []
  if (!hasConsolePermission(rule.permission, access, rule.target)) missing.push(rule.permission)
  for (const permission of rule.alsoRequires ?? []) if (!hasConsolePermission(permission, access, GLOBAL_TARGET)) missing.push(permission)
  return { allowed: missing.length === 0, missing }
}

/**
 * Body of `endpoint-import` for one account. Importing a new account (only in the file) names no
 * existing account, so the scope it needs is the adapter's (`id` is still sent: the Host needs it).
 */
export function importRequest(drift, id, start = false) {
  return {
    id,
    expectedRevision: drift.revision,
    ...(drift.generation !== null ? { expectedGeneration: drift.generation } : {}),
    start: start === true,
  }
}

/** Body of `endpoint-writeback` for the listed accounts. */
export function writebackRequest(drift, ids) {
  return { ids: [...ids], ...(drift.generation !== null ? { expectedGeneration: drift.generation } : {}) }
}

/**
 * What one drift entry offers: `import` for an account that differs from or is missing among the
 * managed accounts, `writeback` for a managed account the file lacks or describes differently —
 * each with the permission check, and only when the Host says it can (`canImport` / `canWriteback`).
 */
export function driftEntryActions(drift, entry, pluginId, access) {
  const actions = {}
  if (!drift || !entry || !pluginId) return actions
  if (drift.canImport && (entry.kind === 'config_only' || entry.kind === 'changed')) {
    // A new account is added at the adapter level; overwriting a saved one acts on that account.
    const payload = entry.kind === 'config_only' ? {} : { id: entry.id }
    actions.import = adapterConfigPermission(pluginId, ADAPTER_CONFIG_RPC.IMPORT, payload, access)
  }
  if (drift.canWriteback && (entry.kind === 'snapshot_only' || entry.kind === 'changed')) {
    actions.writeback = adapterConfigPermission(pluginId, ADAPTER_CONFIG_RPC.WRITEBACK, { ids: [entry.id] }, access)
  }
  return actions
}

/**
 * Whether an entry is a real divergence between the file and the saved accounts: everything but an
 * account added in the Console (`snapshot_only` + `origin: 'console'`), which runs as intended and can
 * still be written back. Mirrors `isEndpointConfigDivergence` of `@zhin.js/adapter` (#1250 第 88 批).
 */
export function isDriftDivergence(entry) {
  return !(entry?.kind === 'snapshot_only' && entry.origin === 'console')
}

export function driftKindLabel(kind, locale = 'zh-CN', origin) {
  return translate(locale, kind === 'config_only' ? '只在配置文件中'
    : kind === 'snapshot_only' ? origin === 'console' ? 'Console 新增' : '配置文件中没有'
      : kind === 'changed' ? '与配置文件不一致' : '状态未知')
}

/** Drift entries of one adapter that need a decision (an account only in the file is a table row of its own). */
export function driftRows(drift) {
  return drift ? drift.entries.filter(entry => entry.kind !== 'config_only') : []
}

/** Result text of a write-back: every account of the adapter reconnects; unset `${VAR}` names go to `.env`. */
export function writebackResultText(result, locale = 'zh-CN') {
  const variables = isRecord(result) && Array.isArray(result.placeholders)
    ? [...new Set(result.placeholders.map(item => isRecord(item) ? text(item.variable) : null).filter(Boolean))]
    : []
  return variables.length
    ? translate(locale, '已写回配置文件，该适配器的全部账号会随配置重载重新连接；请在 .env 中设置 {0}。', [variables.join(translate(locale, '、'))])
    : translate(locale, '已写回配置文件，该适配器的全部账号会随配置重载重新连接。')
}
