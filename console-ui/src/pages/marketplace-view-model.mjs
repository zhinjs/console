import { translate } from '../i18n/locale.mjs'
import { featureGlobalHref } from '../console-routes.mjs'
import { scopeHref } from '../scope/scope-tree.mjs'
import { instanceKeyFromPackage } from './ops/gateway-model.mjs'
import { welcomeReturnUrl } from './welcome-use-case-model.mjs'

/**
 * Which part of the plugin list area is shown.
 * A failed search is never presented as "no plugins found": the empty state asks the user
 * to change filters, which does not help when the request itself failed.
 */
export function marketplaceListView({ loading, error, count }) {
  if (loading) return 'loading'
  if (error) return 'error'
  return count > 0 ? 'results' : 'empty'
}

/** Enter and Space activate a card that acts as a button (same keys as a native button). */
export function isCardActivationKey(key) {
  return key === 'Enter' || key === ' ' || key === 'Spacebar'
}

function hasUpdate(item) {
  return Boolean(item && typeof item === 'object' && item.name && item.current && item.latest && item.current !== item.latest)
}

function failure(reason, locale) {
  return { kind: 'failed', updates: [], reason: reason || translate(locale, "未知错误") }
}

/**
 * Classify a finished update check.
 * `outcome` is either `{ error }` for a thrown request, or `{ ok, status, body }` for a response
 * (`body` is the parsed JSON, or null when it could not be parsed).
 */
export function classifyUpdateCheck(outcome, locale = 'zh-CN') {
  if (!outcome || 'error' in outcome) {
    const error = outcome?.error
    if (error instanceof Error && error.message) return failure(error.message, locale)
    return failure(typeof error === 'string' ? error : '', locale)
  }
  const body = outcome.body
  const bodyError = body && typeof body === 'object' && typeof body.error === 'string' ? body.error : ''
  if (!outcome.ok) return failure(bodyError || `HTTP ${outcome.status ?? '?'}`, locale)
  if (!body || typeof body !== 'object' || body.success !== true) return failure(bodyError || translate(locale, "数据格式错误"), locale)
  if (!Array.isArray(body.data)) return failure(translate(locale, "数据格式错误"), locale)
  const updates = body.data.filter(hasUpdate)
  return updates.length > 0 ? { kind: 'available', updates } : { kind: 'current', updates: [] }
}

/** Toast copy for a classified update check. */
export function updateCheckFeedback(result, locale = 'zh-CN') {
  if (result.kind === 'available') {
    return { variant: 'info', description: translate(locale, "发现 {0} 个可更新插件", [result.updates.length]) }
  }
  if (result.kind === 'current') {
    return { variant: 'success', description: translate(locale, "已是最新，没有可更新的插件") }
  }
  return { variant: 'error', description: translate(locale, "检查失败：{0}", [result.reason]) }
}

function text(value) {
  return typeof value === 'string' && value ? value : ''
}

/**
 * Installed plugin packages from `GET /api/plugins` (the list behind the /plugins page).
 * Each item carries `packageName` and `instanceKey` (the Host's managed plugin list); one package may
 * back several instances. Returns `packageName → { instanceKeys, version }`, or null when the list
 * could not be read — callers must then show no install status rather than "not installed".
 * Declared instances whose package the Host reports as missing (`management.installed === false`)
 * are not counted as installed.
 */
export function readInstalledPackages(body) {
  if (!body || typeof body !== 'object' || body.success !== true || !Array.isArray(body.data)) return null
  const index = new Map()
  for (const item of body.data) {
    if (!item || typeof item !== 'object') continue
    const management = item.management && typeof item.management === 'object' ? item.management : null
    const packageName = text(item.packageName) || text(management?.packageName)
    const instanceKey = text(item.instanceKey) || text(management?.instanceKey) || text(item.name)
    if (!packageName || !instanceKey || management?.installed === false) continue
    const entry = index.get(packageName) ?? { instanceKeys: [], version: null }
    if (!entry.instanceKeys.includes(instanceKey)) entry.instanceKeys.push(instanceKey)
    entry.version ??= text(management?.version) || text(item.version) || null
    index.set(packageName, entry)
  }
  return index
}

/**
 * What the marketplace knows about a package on this Host.
 * `update` comes only from a finished update check; `unknown` means the installed list is unavailable.
 */
export function marketplacePluginStatus(name, installed, updates) {
  const entry = installed?.get(name) ?? null
  const instanceKey = entry?.instanceKeys[0] ?? null
  const instanceCount = entry?.instanceKeys.length ?? 0
  const update = Array.isArray(updates) ? updates.find(item => item?.name === name && hasUpdate(item)) : undefined
  if (update) return { kind: 'update', current: update.current, latest: update.latest, version: update.current, instanceKey, instanceCount }
  if (entry) return { kind: 'installed', version: entry.version, instanceKey, instanceCount }
  return { kind: installed ? 'not-installed' : 'unknown', version: null, instanceKey: null, instanceCount: 0 }
}

/**
 * The local plugin detail page, which holds the update action (`gateway.packages.plan` → confirm → `gateway.packages.update`).
 * The Host resolves `/api/plugins/:name` by instance key or package name, so the package name works when
 * the instance is not known.
 */
export function pluginManageUrl(packageName, instanceKey) {
  return `/plugins/${encodeURIComponent(instanceKey || packageName)}`
}

/** A plugin's global feature configuration (ADR 0052). */
export function pluginConfigUrl(instanceKey) {
  return featureGlobalHref(instanceKey)
}

/**
 * Installed packages from the gateway (`gateway.packages.list`, read with `readPackageList`), for
 * when the instance cannot answer `/api/plugins`. Instance keys are the gateway's default for the
 * package name; only packages present in node_modules count.
 */
export function installedFromPackageList(list) {
  if (!list || !Array.isArray(list.packages)) return null
  const index = new Map()
  for (const item of list.packages) {
    if (!item || typeof item.name !== 'string' || !item.installedVersion || item.dependencyType === 'devDependencies') continue
    index.set(item.name, { instanceKeys: [instanceKeyFromPackage(item.name)], version: item.installedVersion })
  }
  return index
}

/**
 * Where to go after an install from the marketplace (安装后闭环). Nothing before the install
 * settled; `partial` (needs configuration) only offers the declaration form shown inline, so no
 * configuration link is guessed; `succeeded` links the plugin's configuration, the feature tab
 * of the object tree and the plugin detail page (plus the welcome flow when it asked for this package).
 */
export function installFollowUps({ phase, operation, packageName, instanceKey, welcomePackage } = {}) {
  if (operation !== 'install' || !packageName) return []
  if (phase !== 'succeeded') return []
  const key = instanceKey || instanceKeyFromPackage(packageName)
  const links = [
    { kind: 'configure', to: featureGlobalHref(key) },
    { kind: 'features', to: scopeHref({}, 'features') },
    { kind: 'detail', to: pluginManageUrl(packageName, key) },
  ]
  if (welcomePackage && welcomePackage === packageName) links.unshift({ kind: 'welcome', to: welcomeReturnUrl(key) })
  return links
}
