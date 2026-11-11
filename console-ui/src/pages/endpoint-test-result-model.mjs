import { translate } from '../i18n/locale.mjs'

/**
 * Normalize an `endpoint.test` response. Only an explicit `reachable: true`
 * (or, for older hosts without `reachable`, `connected: true`) counts as success.
 */
export function readEndpointTestResult(payload) {
  const data = payload && typeof payload === 'object' ? payload : {}
  const ok = typeof data.reachable === 'boolean'
    ? data.reachable
    : data.connected === true
  const result = { ok }
  if (typeof data.connected === 'boolean') result.connected = data.connected
  if (typeof data.status === 'string' && data.status) result.status = data.status
  if (typeof data.latencyMs === 'number' && Number.isFinite(data.latencyMs) && data.latencyMs >= 0) result.latencyMs = data.latencyMs
  if (typeof data.message === 'string' && data.message.trim()) result.message = data.message.trim()
  return result
}

/** The test request itself failed (transport error, timeout, …). */
export function endpointTestError(message) {
  return { ok: false, message }
}

export function endpointTestPresentation(result, locale = 'zh-CN') {
  const latencyText = typeof result.latencyMs === 'number' ? `${result.latencyMs} ms` : undefined
  if (result.ok) {
    return {
      tone: 'success',
      role: 'status',
      label: translate(locale, '连接正常'),
      reason: undefined,
      latencyText,
      detail: [result.message, latencyText].filter(Boolean).join(' · ') || undefined,
    }
  }
  const reason = result.connected === true && result.status && result.status !== 'online'
    ? translate(locale, '已连接，但运行状态为 {0}', [result.status])
    : result.message || translate(locale, '连接异常')
  return {
    tone: 'error',
    role: 'alert',
    label: translate(locale, '连接失败'),
    reason,
    latencyText,
    detail: [reason, latencyText].filter(Boolean).join(' · '),
  }
}
