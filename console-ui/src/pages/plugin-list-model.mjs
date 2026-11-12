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
 * Health of one instance plugin for the 插件管理 list (安装与健康状态, not 开没开):
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
 * Rows of the 插件管理 list: every instance plugin (`/api/plugins`), plus catalog packages the
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
