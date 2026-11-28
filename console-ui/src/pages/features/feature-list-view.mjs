/**
 * What the feature list shows (#64 `feature-matrix-error-false-empty`): rows once there are any; while
 * reading, the skeleton; a failed read with nothing listed is `failed` (the page shows the error state,
 * not 「还没有功能」); only a read that succeeded with no plugins is `empty`.
 */
export function featureListView({ loading, error, hasRows }) {
  if (hasRows) return 'list'
  if (loading) return 'loading'
  return error ? 'failed' : 'empty'
}

/**
 * The error for a failed `/api/plugins` read, carrying the HTTP status and the Host's `code` so
 * `statusFromError` can tell 无权限 / 需要新版 Host / 实例不可用 apart. `body` is the parsed error body
 * (or null); its `error` text is kept as the message for 技术详情. `retryAfter` is the `Retry-After`
 * header, when the gateway sent one (seconds), so 实例不可用 suggests the gateway's delay.
 */
export function pluginListReadError(status, body, t, retryAfter = null) {
  const reason = body && typeof body.error === 'string' && body.error ? body.error : ''
  const message = status === 403 ? t('当前身份无权读取插件列表') : reason || t('插件读取失败（HTTP {0}）', [status])
  const serverCode = body && typeof body.code === 'string' && body.code ? body.code : undefined
  const seconds = Number(retryAfter)
  return Object.assign(new Error(message), { details: {
    httpStatus: status,
    ...(serverCode ? { serverCode } : {}),
    ...(retryAfter !== null && Number.isFinite(seconds) && seconds > 0 ? { retryAfter: seconds } : {}),
  } })
}
