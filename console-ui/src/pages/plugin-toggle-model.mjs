import { translate } from '../i18n/locale.mjs'

/** Number of chat accounts an adapter plugin reports, or null when it is not an adapter. */
function adapterAccounts(features) {
  if (!Array.isArray(features)) return null
  const adapter = features.find(feature => feature && feature.name === 'adapter')
  if (!adapter) return null
  return Number.isSafeInteger(adapter.count) && adapter.count > 0 ? adapter.count : 0
}

/** Confirmation copy shown before a plugin is disabled. Enabling never asks. */
export function disableConfirmation(plugin, locale = 'zh-CN') {
  const name = plugin?.name ?? ''
  const accounts = adapterAccounts(plugin?.features)
  const description = accounts === null
    ? translate(locale, "停用后该插件提供的命令、中间件等功能将不可用；如果它是适配器插件，对应的聊天账号会掉线。Host 可能需要重启来应用变更。")
    : accounts > 0
      ? translate(locale, "这是适配器插件，停用后它接入的 {0} 个聊天账号会掉线，无法收发消息。Host 可能需要重启来应用变更。", [accounts])
      : translate(locale, "这是适配器插件，停用后它接入的聊天账号会掉线，无法收发消息。Host 可能需要重启来应用变更。")
  return {
    title: translate(locale, "停用 {0}？", [name]),
    description,
    confirmLabel: translate(locale, "停用"),
    variant: 'destructive',
  }
}

function reason(error, locale) {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error) return error
  return translate(locale, "未知错误")
}

/**
 * Toast copy for a finished toggle.
 * `result` is the confirmed management state (null when polling timed out);
 * `rpcError` is the swallowed set-enabled rejection, which may only be a Host restart;
 * `error` is a failure thrown while confirming the result.
 */
export function toggleFeedback({ name, enabled, result, rpcError, error }, locale = 'zh-CN') {
  if (error !== undefined && error !== null) {
    return {
      variant: 'error',
      title: enabled ? translate(locale, "启用 {0} 失败", [name]) : translate(locale, "停用 {0} 失败", [name]),
      description: reason(error, locale),
    }
  }
  if (result) {
    return {
      variant: 'success',
      title: undefined,
      description: enabled
        ? translate(locale, "已启用 {0}：当前代已加载，平台上线与业务功能尚未验证。", [name])
        : translate(locale, "已停用 {0}。", [name]),
    }
  }
  return {
    variant: 'error',
    title: enabled ? translate(locale, "启用 {0} 的结果未确认", [name]) : translate(locale, "停用 {0} 的结果未确认", [name]),
    description: rpcError
      ? translate(locale, "Host 返回：{0}。插件状态在等待时间内没有变化，请刷新核对后再操作。", [reason(rpcError, locale)])
      : translate(locale, "等待 Host 恢复或状态变化超时，请刷新核对后再操作。"),
  }
}

/** Returns a new set with `key` added or removed, leaving the input untouched. */
export function withPendingToggle(pending, key, active) {
  const next = new Set(pending)
  if (active) next.add(key)
  else next.delete(key)
  return next
}
