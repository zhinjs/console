import { translate } from '../i18n/locale.mjs'

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
