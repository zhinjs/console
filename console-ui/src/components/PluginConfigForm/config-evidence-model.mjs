import { translate } from '../../i18n/locale.mjs'
import { parseConfigDocument } from './source-model.mjs'
import { validateManagementState } from '../../pages/plugin-management-model.mjs'

/** A form may edit a Host section; only formal plugin instances use plugin apply. */
export function isManagedConfigInstance(snapshot, name, locale = 'zh-CN') {
  if (!snapshot?.source) return false
  try {
    const document = parseConfigDocument(snapshot.source, snapshot.format, locale)
    const plugins = document?.plugins
    return Boolean(document?.configVersion === 2 && plugins && typeof plugins === 'object' && !Array.isArray(plugins)
      && typeof plugins[name] === 'string' && Object.hasOwn(plugins, name))
  } catch { return false }
}
export function configEvidenceMatches(state, instanceKey, revision, locale = 'zh-CN') {
  try { validateManagementState(state, instanceKey, locale) } catch { return false }
  return Boolean(revision && state.revision === revision && state.declared)
}
export function configurationSaveSummary(result, locale = 'zh-CN') {
  if (result?.success !== true || typeof result.revision !== 'string' || !result.revision) throw new Error(translate(locale, "Host 未提供完整保存回执，请刷新核对；不要自动重试。"))
  if (result.restartRequired === true) return translate(locale, "配置已保存；Host 配置变化需要重启进程，尚未确认生效。")
  if (result.restartRequired === false) return translate(locale, "配置已保存；当前运行是否一致须另行核对。")
  return translate(locale, "配置已保存；Host 未提供重启判断，请另行核对运行证据。")
}

// Opaque authenticated connection scopes separate Hosts and credential changes. Only
// operation identity is retained: never configuration, credentials or server errors.
function pendingKey(scope, instanceKey) { return `zhin:config-application:${encodeURIComponent(scope)}:${encodeURIComponent(instanceKey)}` }
function storageOrDefault(storage) { return storage ?? globalThis.sessionStorage }
function validPending(value, scope, instanceKey) {
  return value && value.scope === scope && value.instanceKey === instanceKey
    && ['packageName', 'version', 'revision', 'projectRevision'].every(key => typeof value[key] === 'string' && value[key].trim())
}
export function readPendingConfigApplication(scope, instanceKey, storage) {
  try {
    const store = storageOrDefault(storage)
    if (!store) return { status: 'unavailable' }
    const raw = store.getItem(pendingKey(scope, instanceKey))
    if (raw === null) return { status: 'none' }
    const pending = JSON.parse(raw)
    return validPending(pending, scope, instanceKey) ? { status: 'pending', pending } : { status: 'unavailable' }
  } catch { return { status: 'unavailable' } }
}
export function rememberConfigApplication(scope, state, storage, locale = 'zh-CN') {
  validateManagementState(state, undefined, locale)
  const pending = { scope, instanceKey: state.instanceKey, packageName: state.packageName, version: state.version,
    revision: state.revision, projectRevision: state.projectRevision }
  if (!validPending(pending, scope, state.instanceKey)) throw Error(translate(locale, "应用申请缺少可核对的版本证据"))
  const store = storageOrDefault(storage)
  if (!store) throw Error(translate(locale, "无法保留待确认申请，请恢复浏览器会话存储后再申请"))
  store.setItem(pendingKey(scope, state.instanceKey), JSON.stringify(pending))
  return pending
}
export function forgetConfigApplication(scope, instanceKey, storage) {
  try { storageOrDefault(storage)?.removeItem(pendingKey(scope, instanceKey)) } catch { /* Retaining the guard only requires another read after remount. */ }
}
export function configApplicationConfirmed(state, pending) {
  return Boolean(pending && state.instanceKey === pending.instanceKey && state.packageName === pending.packageName
    && state.version === pending.version && state.revision === pending.revision && state.published
    && !state.restartRequired && state.generation !== null)
}
