import { endpointTransportLabel } from '@zhin.js/console-protocol'

const TRANSPORT_STATES = new Set(['idle', 'connecting', 'open', 'reconnecting', 'closed', 'stopped', 'unknown'])

/** A disconnected account is not proof that its runtime was deliberately stopped. */
export function endpointLifecycleLabel(endpoint) {
  if (endpoint.pendingLogin) return '等待登录'
  if (endpoint.status === 'online') return '运行中'
  if (endpoint.transportState === 'stopped') return '已停止'
  if (endpoint.transportState === 'connecting') return '连接中'
  if (endpoint.transportState === 'reconnecting') return '重连中'
  return '离线'
}

/**
 * The 传输 fact of an account (zhinjs/zhin#1250 `endpoint-transport-raw-state`): the Host's readable
 * `transportLabel` first — in English the same table's English text for a known `transportState` —
 * and the raw `transportState` as the fallback on Hosts that send no label. Null without either.
 * `raw` is the machine state (kept as a hover hint), `labeled` says whether readable text is shown.
 */
export function endpointTransportText(endpoint, locale = 'zh-CN') {
  const raw = typeof endpoint?.transportState === 'string' && endpoint.transportState ? endpoint.transportState : null
  const label = typeof endpoint?.transportLabel === 'string' && endpoint.transportLabel.trim() ? endpoint.transportLabel.trim() : null
  if (!label) return raw ? { text: raw, raw, labeled: false } : null
  if (locale === 'en' && raw && TRANSPORT_STATES.has(raw)) return { text: endpointTransportLabel(raw, 'en'), raw, labeled: true }
  return { text: label, raw, labeled: true }
}
