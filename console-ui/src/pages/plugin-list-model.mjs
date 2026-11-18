import { translate } from '../i18n/locale.mjs'
import { validateManagementState } from './plugin-management-model.mjs'
export function validatePluginList(payload, locale = 'zh-CN') {
  if (!payload || payload.success !== true || !Array.isArray(payload.data)) throw new Error(translate(locale, "插件列表格式无效"))
  for (const plugin of payload.data) {
    if (!plugin || typeof plugin.name !== 'string' || !plugin.name || !['active', 'inactive'].includes(plugin.status) || !Array.isArray(plugin.features)) throw new Error(translate(locale, "插件信息格式无效"))
    if (plugin.management) validateManagementState(plugin.management, plugin.instanceKey, locale)
    for (const feature of plugin.features) {
      if (!feature || typeof feature.name !== 'string' || !Number.isSafeInteger(feature.count) || feature.count < 0) throw new Error(translate(locale, "插件能力格式无效"))
    }
  }
  return payload.data
}

const CATALOG_PLUGINS = new Set(['adapter', 'ai', 'market'])
const clean = value => typeof value === 'string' && value ? value : ''

/**
 * Health of one instance plugin for the 插件 list (安装与健康状态, not 开没开):
 * - `healthy`  当前代已应用（或旧 Host 只报告已加载）
 * - `pending`  需要处理：缺配置、降级、等待应用、依赖失败或状态读取失败
 * - `inactive` 未加载 / 已停用
 */
export function pluginHealth(plugin) {
  const m = plugin?.management
  if (plugin?.managementError) return 'pending'
  if (m) {
    if (m.disabled) return 'inactive'
    if (m.status === 'enabled' && m.published) return 'healthy'
    if (['missing-config', 'degraded', 'pending-restart', 'declared', 'installed'].includes(m.status) || m.dependencies === 'failed' || !m.published) return 'pending'
    return 'inactive'
  }
  return plugin?.status === 'active' ? 'healthy' : 'inactive'
}

/**
 * Rows of the 插件 list: every instance plugin (`/api/plugins`), plus catalog packages the
 * gateway installed (`gateway.packages.list`) that no instance plugin uses yet (`undeclared`:
 * installed, waiting for its first configuration). When the instance cannot answer, `plugins` is
 * null and the gateway packages are listed as `unreported`.
 */
export function pluginInventory(plugins, packageList) {
  const rows = []
  const packages = Array.isArray(packageList?.packages) ? packageList.packages : []
  const versionOf = name => packages.find(item => item.name === name)?.installedVersion ?? null
  const used = new Set()
  for (const plugin of Array.isArray(plugins) ? plugins : []) {
    const instanceKey = clean(plugin.instanceKey) || clean(plugin.management?.instanceKey) || plugin.name
    const packageName = clean(plugin.packageName) || clean(plugin.management?.packageName)
    if (packageName) used.add(packageName)
    rows.push({
      key: `plugin:${instanceKey}`, kind: 'plugin', name: plugin.name, instanceKey, packageName,
      description: clean(plugin.description), version: clean(plugin.management?.version) || clean(plugin.version) || (packageName ? versionOf(packageName) : null),
      health: pluginHealth(plugin), plugin,
    })
  }
  for (const item of packages) {
    if (!item?.name || used.has(item.name) || !item.installedVersion || item.dependencyType === 'devDependencies') continue
    if (Array.isArray(plugins) && !CATALOG_PLUGINS.has(item.catalog)) continue
    if (!Array.isArray(plugins) && !CATALOG_PLUGINS.has(item.catalog) && !/(^|\/)(zhin-|plugin-|adapter-)|^@zhin\.js\//u.test(item.name)) continue
    rows.push({
      key: `package:${item.name}`, kind: 'package', name: item.name, instanceKey: item.name, packageName: item.name, description: '',
      version: item.installedVersion, health: Array.isArray(plugins) ? 'undeclared' : 'unreported', plugin: null,
      ...(item.catalog ? { catalog: item.catalog } : {}),
    })
  }
  return rows
}

export function inventoryCounts(rows) {
  const counts = { all: rows.length, healthy: 0, pending: 0, inactive: 0 }
  for (const row of rows) {
    if (row.health === 'healthy') counts.healthy++
    else if (row.health === 'inactive') counts.inactive++
    // `unreported`: the instance cannot say yet; not counted as a problem of the plugin.
    else if (row.health !== 'unreported') counts.pending++
  }
  return counts
}

/** `all` / `healthy` / `pending` (pending, undeclared) / `inactive`; `unreported` rows only show under `all`. */
export function matchesHealthFilter(row, filter) {
  if (filter === 'healthy') return row.health === 'healthy'
  if (filter === 'inactive') return row.health === 'inactive'
  if (filter === 'pending') return row.health === 'pending' || row.health === 'undeclared'
  return true
}

/**
 * Type of one row for the 插件 table: 适配器 (a chat platform), AI, or 功能插件. Read from the
 * gateway catalog when the row came from it, else from the package or plugin name.
 */
export function pluginType(row) {
  if (row.catalog === 'adapter') return 'adapter'
  if (row.catalog === 'ai') return 'ai'
  const name = `${row.packageName || ''} ${row.name || ''}`.toLowerCase()
  if (/(^|[\s/])(@zhin\.js\/)?adapter-|(^|\s)adapter($|\s)/u.test(name)) return 'adapter'
  if (/(^|[\s/])(@zhin\.js\/)?(ai|agent)($|[\s-])/u.test(name)) return 'ai'
  return 'feature'
}

/**
 * Icon kind of one row (console#125): adapter / AI / function plugin when the row says so, null when
 * it cannot tell (a package row with no catalog type and no adapter / AI name) - then no icon is drawn.
 * Unlike pluginType there is no 功能插件 fallback for unknown package rows.
 */
export function pluginIconType(row) {
  const type = pluginType(row)
  if (type !== 'feature') return type
  return row.kind === 'plugin' ? 'feature' : null
}

/** Where the code comes from: 官方 (`@zhin.js/…`), npm (another package) or 本地 (no package: project plugin). */
export function pluginSource(row) {
  if (!row.packageName) return 'local'
  return row.packageName.startsWith('@zhin.js/') ? 'official' : 'npm'
}

const TYPE_ORDER = ['adapter', 'ai', 'feature']
const SOURCE_ORDER = ['official', 'npm', 'local']
// Problems first when sorting by state.
const HEALTH_ORDER = ['pending', 'undeclared', 'inactive', 'unreported', 'healthy']

function compareVersions(a, b) {
  const parts = value => String(value ?? '').split(/[.+-]/u).map(part => (/^\d+$/u.test(part) ? Number(part) : part))
  const left = parts(a), right = parts(b)
  for (let index = 0; index < Math.max(left.length, right.length); index++) {
    const x = left[index], y = right[index]
    if (x === y) continue
    if (x === undefined) return -1
    if (y === undefined) return 1
    if (typeof x === 'number' && typeof y === 'number') return x - y
    return String(x).localeCompare(String(y))
  }
  return 0
}

/** Rows sorted by `name` / `type` / `source` / `version` / `status`; ties keep name order. */
export function sortInventory(rows, key = 'name', direction = 'asc') {
  const byName = (a, b) => a.name.localeCompare(b.name)
  const compare = {
    name: byName,
    type: (a, b) => TYPE_ORDER.indexOf(pluginType(a)) - TYPE_ORDER.indexOf(pluginType(b)),
    source: (a, b) => SOURCE_ORDER.indexOf(pluginSource(a)) - SOURCE_ORDER.indexOf(pluginSource(b)),
    version: (a, b) => compareVersions(a.version, b.version),
    status: (a, b) => HEALTH_ORDER.indexOf(a.health) - HEALTH_ORDER.indexOf(b.health),
  }[key] ?? byName
  const sign = direction === 'desc' ? -1 : 1
  return [...rows].sort((a, b) => sign * compare(a, b) || byName(a, b))
}

/** Rows grouped by `type` or `source` in a fixed group order; `none` is one unnamed group. */
export function groupInventory(rows, by = 'none') {
  if (by !== 'type' && by !== 'source') return [{ key: 'all', rows }]
  const order = by === 'type' ? TYPE_ORDER : SOURCE_ORDER
  const of = by === 'type' ? pluginType : pluginSource
  return order.map(key => ({ key, rows: rows.filter(row => of(row) === key) })).filter(group => group.rows.length)
}

/** Only a plugin that needs attention carries a state label in the table; a healthy one shows none. */
export function needsStateLabel(row) {
  return row.health !== 'healthy'
}
