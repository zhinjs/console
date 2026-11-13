/**
 * Why the Console's live event stream (`GET {base}/api/events`, SSE; history `…/events/history`) is
 * not connected. The SDK transport only says connected / not; the fetch it is given
 * (`console-client.ts`) reports each stream reply here, so the top bar can say 「已断开（原因）」.
 * Also the pure view of that indicator (`connectionIndicatorView`), shared with tests.
 */

let failure = null
const listeners = new Set()

const emit = () => { for (const listener of [...listeners]) listener() }

/** Whether a request URL is the event stream or its history (not RPCs). */
export function isEventStreamUrl(url) {
  try {
    const path = new URL(String(url), 'http://console.invalid').pathname
    return /\/events(?:\/history)?$/u.test(path)
  } catch {
    return false
  }
}

/**
 * Classifies one stream reply: `{ status, contentType }` of a response, or `{ error }` when the fetch
 * itself failed. Returns null for a healthy reply, else `{ reason, status? }`:
 * `unauthorized` (401/403) · `not-found` (404: proxy path) · `gateway` (502/503/504) · `http` ·
 * `not-event-stream` (2xx, but not `text/event-stream`, e.g. an HTML page from a proxy) · `network`.
 */
export function classifyEventStreamReply(reply, url = '') {
  if (!reply) return null
  if (reply.error !== undefined) {
    const name = reply.error && typeof reply.error === 'object' ? String(reply.error.name ?? '') : ''
    if (name === 'AbortError') return null
    return { reason: 'network' }
  }
  const status = Number(reply.status)
  if (status === 401 || status === 403) return { reason: 'unauthorized', status }
  if (status === 404) return { reason: 'not-found', status }
  if (status === 502 || status === 503 || status === 504) return { reason: 'gateway', status }
  if (!(status >= 200 && status < 300)) return { reason: 'http', status }
  const history = /\/history$/u.test(String(url).split('?')[0])
  const type = String(reply.contentType ?? '').toLowerCase()
  if (!history && type && !type.includes('text/event-stream')) return { reason: 'not-event-stream', status }
  return null
}

/** Records a stream reply (a healthy one clears the last failure). */
export function reportEventStreamReply(reply, url, now = Date.now()) {
  const next = classifyEventStreamReply(reply, url)
  if (!next && !failure) return
  failure = next ? Object.freeze({ ...next, at: now }) : null
  emit()
}

export function getEventStreamFailure() {
  return failure
}

export function subscribeEventStreamFailure(listener) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

/** Tests and sign-out: forget the last failure. */
export function clearEventStreamFailure() {
  if (!failure) return
  failure = null
  emit()
}

/** How long a first connection may take before the bar says 「连接中」. */
export const CONNECTING_GRACE_MS = 3_000

/** Authored reason copy per failure (displayed through i18n; `{0}` is the HTTP status). */
export const EVENT_STREAM_REASON_COPY = Object.freeze({
  unauthorized: '登录已失效或没有权限 (HTTP {0})',
  'not-found': '找不到事件流接口 (HTTP {0})，可能是反向代理路径不对',
  gateway: '网关暂时不可用 (HTTP {0})',
  http: '事件流请求失败 (HTTP {0})',
  'not-event-stream': '收到的不是事件流，可能被反向代理改写或缓冲',
  network: '网络不可达，或连接被代理 / 防火墙拦截',
})

/**
 * What the top bar shows for the event stream: null while connected (and during a short first
 * connect), else `{ kind: 'connecting' | 'reconnecting' | 'disconnected', reason? }`.
 * `state` is the SDK `ConnectionState` (`connected` / `connecting` / `reconnecting` / `error` /
 * `disconnected`); `ever` whether this transport was ever connected; `since` when it stopped being
 * connected (or was created).
 */
export function connectionIndicatorView({ state, failure: lastFailure, ever = false, since = 0, now = Date.now() } = {}) {
  if (state === 'connected') return null
  const reason = lastFailure ? Object.freeze({ code: lastFailure.reason, ...(lastFailure.status ? { status: lastFailure.status } : {}) }) : undefined
  const withReason = reason ? { reason } : {}
  if (state === 'error' || state === 'disconnected') return Object.freeze({ kind: 'disconnected', ...withReason })
  if (state === 'reconnecting' || ever || lastFailure) return Object.freeze({ kind: 'reconnecting', ...withReason })
  // A first connection that is merely slow: say so only after the grace period.
  return now - since >= CONNECTING_GRACE_MS ? Object.freeze({ kind: 'connecting' }) : null
}
