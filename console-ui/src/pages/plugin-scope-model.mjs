/**
 * 「这个插件在哪开了、对谁开放」 summaries for the plugin pages. The switches themselves live in
 * the object tree (全局 ─ 适配器 ─ 账号 ─ 会话, ADR 0050 / 0055); the plugin detail and the
 * runtime capability view only summarise them from `feature.matrix` and link there.
 *
 * Pure: shared by the pages and the tests.
 */
import { scopeHref } from '../scope/scope-tree.mjs'
import { featureGlobalHref } from '../console-routes.mjs'

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** The matrix row of one plugin instance (`plugin` is the instance key / path). */
export function matrixRowOf(matrix, plugin) {
  return (matrix?.rows ?? []).find(row => row.plugin === plugin) ?? null
}

/**
 * Where a plugin is switched on: the global switch, each adapter (enabled / own override / locked),
 * conversation override counts per account, and the links into the object tree.
 * Returns null when the matrix has no row for the plugin (unknown, not "off everywhere").
 */
export function pluginScopeSummary(matrix, plugin) {
  const row = matrixRowOf(matrix, plugin)
  if (!row) return null
  const globalEnabled = row.global?.enabled === true
  const adapters = (matrix.adapters ?? []).map(alias => {
    const cell = isRecord(row.adapters) ? row.adapters[alias] : undefined
    return {
      alias,
      enabled: cell ? cell.enabled === true : null,
      overridden: cell?.overridden === true,
      ...(cell?.lockedBy ? { lockedBy: cell.lockedBy } : {}),
      accounts: (matrix.endpoints?.[alias] ?? []).length,
      href: scopeHref({ adapter: alias }, 'features'),
    }
  })
  const conversations = []
  const counts = isRecord(row.conversationOverrides) ? row.conversationOverrides : {}
  for (const [alias, perEndpoint] of Object.entries(counts)) {
    if (!isRecord(perEndpoint)) continue
    for (const [endpoint, count] of Object.entries(perEndpoint)) {
      if (Number.isSafeInteger(count) && count > 0) conversations.push({ alias, endpoint, count, href: scopeHref({ adapter: alias, endpoint }, 'features') })
    }
  }
  conversations.sort((a, b) => b.count - a.count || a.alias.localeCompare(b.alias) || a.endpoint.localeCompare(b.endpoint))
  return {
    plugin,
    global: { enabled: globalEnabled, overridden: row.global?.overridden === true, href: featureGlobalHref(plugin) },
    adapters,
    conversations,
    totals: {
      adaptersOn: adapters.filter(item => item.enabled === true).length,
      adaptersOff: adapters.filter(item => item.enabled === false).length,
      adapterOverrides: adapters.filter(item => item.overridden).length,
      conversationOverrides: conversations.reduce((sum, item) => sum + item.count, 0),
    },
    matrixHref: scopeHref({}, 'features'),
  }
}

/** One line for list rows: 「全局开 · 2/3 个适配器开 · 4 个会话覆盖」 (authored copy through `t`). */
export function scopeSummaryLine(summary, t) {
  if (!summary) return t('开关状态未知')
  if (!summary.global.enabled) return t('全局已停用')
  const parts = [t('全局开启')]
  const known = summary.totals.adaptersOn + summary.totals.adaptersOff
  if (known) parts.push(t('{0}/{1} 个适配器开启', [summary.totals.adaptersOn, known]))
  if (summary.totals.conversationOverrides) parts.push(t('{0} 个会话有覆盖', [summary.totals.conversationOverrides]))
  return parts.join(' · ')
}

export const PLUGIN_PERMISSION_LEVELS = Object.freeze(['read', 'operate', 'manage'])
/** Catalog permission that grants every plugin permission of a level (ADR 0049 amendment 2026-11-11). */
export const PLUGIN_LEVEL_PERMISSIONS = Object.freeze({ read: 'plugin.perms.read', operate: 'plugin.perms.operate', manage: 'plugin.perms.manage' })

const READ_ACTIONS = new Set(['read', 'view'])
const MANAGE_ACTIONS = new Set(['approve', 'manage', 'admin', 'write', 'config'])

/** Level of a plugin permission without a declared one (same suffix rule as the Host). */
export function inferredPermissionLevel(permission) {
  const action = String(permission ?? '').slice(String(permission ?? '').indexOf(':') + 1).split('.').pop() ?? ''
  if (READ_ACTIONS.has(action)) return 'read'
  if (MANAGE_ACTIONS.has(action)) return 'manage'
  return 'operate'
}

/**
 * The permissions one plugin declared, grouped by level (`iam.roles.list` → `pluginPermissions`,
 * read with `readPluginPermissionCatalog`). `plugin` matches the permission prefix; the instance
 * key and the package's base name are both tried.
 */
export function pluginPermissionGroups(catalog, names) {
  const wanted = new Set((Array.isArray(names) ? names : [names]).filter(Boolean).map(String))
  const groups = Object.fromEntries(PLUGIN_PERMISSION_LEVELS.map(level => [level, []]))
  for (const entry of catalog ?? []) {
    const prefix = String(entry.permission ?? '').split(':')[0]
    if (!wanted.has(entry.plugin) && !wanted.has(prefix)) continue
    const level = PLUGIN_PERMISSION_LEVELS.includes(entry.level) ? entry.level : inferredPermissionLevel(entry.permission)
    groups[level].push({ permission: entry.permission, ...(entry.description ? { description: entry.description } : {}), declared: PLUGIN_PERMISSION_LEVELS.includes(entry.level) })
  }
  for (const level of PLUGIN_PERMISSION_LEVELS) groups[level].sort((a, b) => a.permission.localeCompare(b.permission))
  return PLUGIN_PERMISSION_LEVELS.map(level => ({ level, catalogPermission: PLUGIN_LEVEL_PERMISSIONS[level], permissions: groups[level] }))
}

/** An instance path (`rss`, `rss/child`): file paths, URLs and package names are not. */
const INSTANCE_PATH = /^[a-z0-9][a-z0-9_-]*(?:\/[a-z0-9][a-z0-9_-]*)*$/u

/**
 * The plugin instance that provides a runtime capability row (introspection). Rows name it as
 * `plugin` (commands), `owner` (`root/rss`, `root/rss/child`) or `source`; the root plugin and
 * unknown owners give null.
 */
export function capabilityPlugin(row) {
  if (!isRecord(row)) return null
  for (const value of [row.plugin, row.owner, row.source]) {
    if (typeof value !== 'string' || !value) continue
    const path = value.startsWith('root/') ? value.slice(5) : value === 'root' ? '' : value
    if (!INSTANCE_PATH.test(path)) continue
    return path
  }
  return null
}

/** Unique providing plugins of a page of rows, in first-seen order. */
export function capabilityPlugins(rows) {
  const seen = []
  for (const row of rows ?? []) {
    const plugin = capabilityPlugin(row)
    if (plugin && !seen.includes(plugin)) seen.push(plugin)
  }
  return seen
}
