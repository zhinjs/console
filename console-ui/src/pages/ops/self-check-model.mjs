/**
 * 连接自检 (`/ops/self-check`): checks that run in the browser against the Host the Console is
 * signed in to, for the "stuck on 正在连接" cases behind reverse proxies and containers. No new
 * Host route or RPC: it reads what already exists —
 *
 * - `api`        GET `{apiBase}/pub/health` (unauthenticated gateway liveness) is reachable
 * - `base-path`  that answer is the gateway's JSON, not a proxy's HTML page or another service
 * - `mixed`      an https Console does not talk to an http Host (browsers block it)
 * - `clock`      the browser clock agrees with the Host's (`timestamp` of the same health reply)
 * - `auth`       GET `{apiBase}/api/auth/me` accepts the current credential
 * - `events`     GET `{apiBase}/api/events` answers as an event stream (SSE: proxy buffering)
 * - `websocket`  a WebSocket upgrade to the Console terminal endpoint goes through
 *                (`/api/console/terminal`, `auth: 'protocol'`: an invalid ticket is answered with
 *                close 4401 *after* the upgrade, which proves the upgrade works)
 *
 * Each check: `{ id, status: 'pass' | 'fail' | 'warn' | 'skip', detail?, values? }`. Copy (title,
 * explanation, fix hint) comes from {@link selfCheckCopy} / {@link selfCheckDetail}. `runSelfChecks(deps)` takes the network
 * (`fetch`, `WebSocket`) and the page facts, so tests drive it without a Host.
 */

export const SELF_CHECK_IDS = Object.freeze(['api', 'base-path', 'mixed', 'clock', 'auth', 'events', 'websocket'])

/** Clock drift (ms) beyond which sessions and log times go wrong. */
export const CLOCK_SKEW_LIMIT_MS = 60_000
export const SELF_CHECK_TIMEOUT_MS = 8_000
/** Close codes the terminal endpoint uses after a successful upgrade (TERMINAL_CLOSE_CODES). */
const TERMINAL_UPGRADED_CODES = new Set([1000, 1011, 4400, 4401, 4403, 4429])

/**
 * Title, what the check means and how to fix a failure, through `t` (i18n `t` or `translate`).
 */
export function selfCheckCopy(id, t) {
  switch (id) {
    case 'api': return Object.freeze({
      title: t('Host 地址可以访问'),
      explain: t('浏览器直接请求 Host 的健康检查接口 /pub/health。'),
      fix: t('确认 Host 已启动（zhin status）、API 地址填写正确；Console 与 Host 不同源时，Host 的 corsOrigins 需要包含当前 Console 地址。'),
    })
    case 'base-path': return Object.freeze({
      title: t('路径前缀一致'),
      explain: t('健康检查应由管理网关以 JSON 答复；收到网页或别的内容，说明反向代理把路径转给了别的服务。'),
      fix: t('让反向代理把 API 地址下的整个路径（含 /pub、/api）原样转给 Host；API 地址要带上代理的路径前缀，例如 https://example.com/zhin。'),
    })
    case 'mixed': return Object.freeze({
      title: t('没有混合内容'),
      explain: t('HTTPS 页面里的 Console 不能请求 HTTP 的 Host，浏览器会直接拦截。'),
      fix: t('给 Host 配置 HTTPS（例如放到同一个 HTTPS 反向代理后面），或用 HTTP 打开 Console。'),
    })
    case 'clock': return Object.freeze({
      title: t('时钟一致'),
      explain: t('比较浏览器时间与 Host 的时间；相差太多会让登录过期、日志与回执的时间错乱。'),
      fix: t('同步 Host 或本机的系统时间（例如开启 NTP / chrony）。'),
    })
    case 'auth': return Object.freeze({
      title: t('登录状态有效'),
      explain: t('用当前保存的凭据请求 /api/auth/me。'),
      fix: t('重新登录；如果用的是 API 令牌，确认它没有被吊销或过期。'),
    })
    case 'events': return Object.freeze({
      title: t('实时事件流可用'),
      explain: t('Console 用 /api/events（Server-Sent Events）接收新消息、日志和状态；代理缓冲或改写会让它一直「连接中」。'),
      fix: t('nginx：location 里加 proxy_buffering off; proxy_cache off; proxy_read_timeout 1h; 并使用 proxy_http_version 1.1。'),
    })
    case 'websocket': return Object.freeze({
      title: t('WebSocket 升级可用'),
      explain: t('用一个无效票据连接终端的 WebSocket 接口：升级成功后 Host 会以 4401 关闭，这说明代理放行了 Upgrade。审计日志里会记一条 terminal.denied，这是正常的。'),
      fix: t('nginx：proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade";（Caddy、Traefik 默认支持）。'),
    })
    default: return Object.freeze({ title: id, explain: '', fix: '' })
  }
}

/** The detail line a check reports (`detail` + `values`), through `t`; null when it has none. */
export function selfCheckDetail(check, t) {
  const values = check?.values ?? []
  switch (check?.detail) {
    case 'http-status': return t('Host 答复 HTTP {0}。', values)
    case 'network': return t('请求没有得到答复（网络不可达、被 CORS 拦截或超时）。', values)
    case 'not-json': return t('收到的内容类型是 {0}，不是 JSON。', values)
    case 'not-gateway': return t('答复不是管理网关的健康检查格式。', values)
    case 'blocked-by-mixed': return t('页面是 HTTPS，Host 地址是 HTTP：{0}', values)
    case 'mixed-ok': return t('页面 {0}，Host {1}。', values)
    case 'loopback-http': return t('Host 是本机地址，浏览器通常允许；部署到其他机器时需要 HTTPS。', values)
    case 'skew-ok': return t('相差 {0} 秒。', values)
    case 'skew-ahead': return t('浏览器比 Host 快 {0} 秒。', values)
    case 'skew-behind': return t('浏览器比 Host 慢 {0} 秒。', values)
    case 'no-server-time': return t('Host 没有报告时间，无法比较。', values)
    case 'auth-user': return t('已登录：{0}。', values)
    case 'auth-token': return t('使用 API 令牌访问。', values)
    case 'auth-bootstrap': return t('使用初始化令牌访问。', values)
    case 'auth-anonymous': return t('Host 把当前请求当作匿名访问，没有登录。', values)
    case 'auth-legacy': return t('旧版 Host 没有账号接口，按令牌访问。', values)
    case 'auth-rejected': return t('凭据被拒绝（HTTP {0}）。', values)
    case 'no-credential': return t('当前没有保存凭据。', values)
    case 'events-ok': return t('收到事件流（{0}）。', values)
    case 'events-buffered': return t('收到事件流答复，但 {0} 秒内没有收到任何数据：可能被代理缓冲。', values)
    case 'events-instance-offline': return t('实例没有在运行，事件流暂时只发心跳；实例恢复后再检查一次。', values)
    case 'events-type': return t('答复的内容类型是 {0}，不是 text/event-stream。', values)
    case 'ws-upgraded': return t('升级成功，Host 以 {0} 关闭（预期）。', values)
    case 'ws-failed': return t('连接在升级前就失败了（关闭码 {0}）。', values)
    case 'ws-timeout': return t('{0} 秒内没有答复。', values)
    case 'ws-unavailable': return t('这个浏览器不支持 WebSocket。', values)
    case 'skipped-unreachable': return t('Host 不可达，先解决上面的问题。', values)
    default: return null
  }
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

function result(id, status, detail, values) {
  return Object.freeze({ id, status, ...(detail ? { detail } : {}), ...(values?.length ? { values: Object.freeze(values.map(String)) } : {}) })
}

function urlOf(base) {
  try { return new URL(base) } catch { return null }
}

function isLoopback(hostname) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]' || hostname === '::1' || hostname.endsWith('.localhost')
}

/** `mixed`: an https page calling an http, non-loopback Host is blocked by the browser. */
export function checkMixedContent(pageProtocol, apiBase) {
  const api = urlOf(apiBase)
  if (!api) return result('mixed', 'skip')
  if (pageProtocol === 'https:' && api.protocol === 'http:') {
    return isLoopback(api.hostname) ? result('mixed', 'warn', 'loopback-http') : result('mixed', 'fail', 'blocked-by-mixed', [api.origin])
  }
  return result('mixed', 'pass', 'mixed-ok', [pageProtocol.replace(':', ''), api.protocol.replace(':', '')])
}

/** `api` + `base-path` from one `/pub/health` reply (`{ status, contentType, body }` or `{ error }`). */
export function checkHealthReply(reply) {
  if (!reply || reply.error !== undefined) return [result('api', 'fail', 'network'), result('base-path', 'skip', 'skipped-unreachable')]
  const status = Number(reply.status)
  const type = String(reply.contentType ?? '').split(';')[0].trim() || '—'
  const json = /json/iu.test(type)
  const gateway = isRecord(reply.body) && reply.body.success === true && reply.body.status === 'ok'
  // A 404 or an HTML page means the path landed somewhere else: reachable, but the prefix is wrong.
  if (!(status >= 200 && status < 300)) {
    return [result('api', status === 404 ? 'pass' : 'fail', 'http-status', [status]), result('base-path', status === 404 ? 'fail' : 'skip', status === 404 ? 'http-status' : 'skipped-unreachable', [status])]
  }
  if (!json) return [result('api', 'pass', 'http-status', [status]), result('base-path', 'fail', 'not-json', [type])]
  if (!gateway) return [result('api', 'pass', 'http-status', [status]), result('base-path', 'fail', 'not-gateway')]
  return [result('api', 'pass', 'http-status', [status]), result('base-path', 'pass')]
}

/**
 * `clock` from the health reply's ISO `timestamp`, the request's send and receive times: the
 * browser clock at the midpoint is compared with the Host's.
 */
export function checkClockSkew(serverTimestamp, sentAt, receivedAt) {
  const server = typeof serverTimestamp === 'string' ? Date.parse(serverTimestamp) : NaN
  if (!Number.isFinite(server) || !Number.isFinite(sentAt) || !Number.isFinite(receivedAt)) return result('clock', 'skip', 'no-server-time')
  const local = sentAt + (receivedAt - sentAt) / 2
  const skew = local - server
  const seconds = Math.round(Math.abs(skew) / 1000)
  if (Math.abs(skew) <= CLOCK_SKEW_LIMIT_MS) return result('clock', 'pass', 'skew-ok', [seconds])
  return result('clock', 'fail', skew > 0 ? 'skew-ahead' : 'skew-behind', [seconds])
}

/** `auth` from `/api/auth/me` (`{ status, body }` or `{ error }`); `hasCredential` false skips it. */
export function checkAuthReply(reply, hasCredential = true) {
  if (!reply || reply.error !== undefined) return result('auth', 'fail', 'network')
  const status = Number(reply.status)
  if (status === 404) return result('auth', 'pass', 'auth-legacy')
  if (status === 401 || status === 403) return result('auth', 'fail', hasCredential ? 'auth-rejected' : 'no-credential', [status])
  if (!(status >= 200 && status < 300)) return result('auth', 'fail', 'http-status', [status])
  const data = isRecord(reply.body) && isRecord(reply.body.data) ? reply.body.data : isRecord(reply.body) ? reply.body : {}
  if (data.kind === 'anonymous') return result('auth', 'fail', 'auth-anonymous')
  if (data.kind === 'api-token') return result('auth', 'pass', 'auth-token')
  if (data.kind === 'bootstrap') return result('auth', 'pass', 'auth-bootstrap')
  const user = isRecord(data.user) ? data.user : null
  return result('auth', 'pass', 'auth-user', [typeof user?.username === 'string' && user.username ? user.username : '—'])
}

/** `events` from the stream reply: `{ status, contentType, firstChunk: boolean }` or `{ error }`. */
export function checkEventStreamReply(reply, waitedSeconds = SELF_CHECK_TIMEOUT_MS / 1000, instanceReady = true) {
  if (!reply || reply.error !== undefined) return result('events', 'fail', 'network')
  const status = Number(reply.status)
  if (!(status >= 200 && status < 300)) return result('events', 'fail', 'http-status', [status])
  const type = String(reply.contentType ?? '').split(';')[0].trim() || '—'
  if (!/text\/event-stream/iu.test(type)) return result('events', 'fail', 'events-type', [type])
  // A stopped instance leaves a gateway-only stream that sends nothing but keepalives.
  if (!reply.firstChunk) return instanceReady ? result('events', 'warn', 'events-buffered', [waitedSeconds]) : result('events', 'warn', 'events-instance-offline')
  return result('events', 'pass', 'events-ok', [type])
}

/** `websocket` from how the probe socket ended: `{ opened, code }`, `{ timeout: true }` or `{ unavailable: true }`. */
export function checkWebSocketOutcome(outcome) {
  if (!outcome || outcome.unavailable) return result('websocket', 'skip', 'ws-unavailable')
  if (outcome.timeout) return result('websocket', 'fail', 'ws-timeout', [SELF_CHECK_TIMEOUT_MS / 1000])
  const code = Number(outcome.code)
  if (outcome.opened || TERMINAL_UPGRADED_CODES.has(code)) return result('websocket', 'pass', 'ws-upgraded', [Number.isFinite(code) ? code : 'open'])
  return result('websocket', 'fail', 'ws-failed', [Number.isFinite(code) ? code : '—'])
}

/** `ws(s)://…/api/console/terminal?ticket=…` for the probe, from the API base. */
export function selfCheckSocketUrl(apiBase, pageHref) {
  const url = new URL(`${String(apiBase || '').replace(/\/+$/u, '')}/api/console/terminal`, pageHref)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = new URLSearchParams({ ticket: 'console-self-check' }).toString()
  return url.href
}

async function readJson(response) {
  try { return await response.json() } catch { return undefined }
}

/** Reads the first chunk of a stream within `ms` (true / false), then cancels it. */
async function firstChunk(response, ms, setTimer, clearTimer) {
  const reader = response.body?.getReader?.()
  if (!reader) return false
  let timer
  const timeout = new Promise(resolve => { timer = setTimer(() => resolve(false), ms) })
  try {
    return await Promise.race([reader.read().then(chunk => !chunk.done && (chunk.value?.length ?? 1) > 0), timeout])
  } catch {
    return false
  } finally {
    clearTimer(timer)
    try { await reader.cancel() } catch { /* already closed */ }
  }
}

function probeWebSocket(deps, url) {
  return new Promise(resolve => {
    if (typeof deps.WebSocket !== 'function') { resolve({ unavailable: true }); return }
    let socket
    let opened = false
    let settled = false
    const done = value => {
      if (settled) return
      settled = true
      deps.clearTimer(timer)
      try { socket?.close() } catch { /* closing */ }
      resolve(value)
    }
    const timer = deps.setTimer(() => done({ timeout: true }), SELF_CHECK_TIMEOUT_MS)
    try { socket = new deps.WebSocket(url) } catch { done({ opened: false, code: 1006 }); return }
    socket.onopen = () => { opened = true }
    socket.onclose = event => done({ opened, code: event?.code })
    socket.onerror = () => { /* the close event that follows carries the code */ }
  })
}

/**
 * Runs every check. `deps`: `{ fetch, WebSocket, apiBase, pageHref, pageProtocol, token, now,
 * setTimer, clearTimer }`. `onResult(check)` reports each check as it finishes. Resolves with the
 * results in {@link SELF_CHECK_IDS} order.
 */
export async function runSelfChecks(deps, onResult = () => {}) {
  const results = new Map()
  const report = check => { results.set(check.id, check); onResult(check) }
  const base = String(deps.apiBase || '').replace(/\/+$/u, '')
  const signal = () => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(SELF_CHECK_TIMEOUT_MS) : undefined)
  const auth = deps.token ? { Authorization: `Bearer ${deps.token}` } : {}

  report(checkMixedContent(deps.pageProtocol, base))

  let health
  const sentAt = deps.now()
  try {
    const response = await deps.fetch(`${base}/pub/health`, { signal: signal() })
    health = { status: response.status, contentType: response.headers.get('content-type'), body: await readJson(response) }
  } catch (error) {
    health = { error }
  }
  const receivedAt = deps.now()
  for (const check of checkHealthReply(health)) report(check)
  const reachable = results.get('api')?.status === 'pass'
  report(reachable && health.body ? checkClockSkew(health.body.timestamp, sentAt, receivedAt) : result('clock', 'skip', reachable ? 'no-server-time' : 'skipped-unreachable'))

  if (!reachable) {
    for (const id of ['auth', 'events', 'websocket']) report(result(id, 'skip', 'skipped-unreachable'))
  } else {
    try {
      const response = await deps.fetch(`${base}/api/auth/me`, { headers: auth, signal: signal() })
      report(checkAuthReply({ status: response.status, body: await readJson(response) }, Boolean(deps.token)))
    } catch (error) {
      report(checkAuthReply({ error }))
    }
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null
    const abort = deps.setTimer(() => controller?.abort(), SELF_CHECK_TIMEOUT_MS + 1000)
    try {
      const response = await deps.fetch(`${base}/api/events`, { headers: { Accept: 'text/event-stream', ...auth }, signal: controller?.signal })
      const contentType = response.headers.get('content-type')
      const ok = response.status >= 200 && response.status < 300 && /text\/event-stream/iu.test(contentType ?? '')
      const instanceReady = !(isRecord(health.body?.instance) && health.body.instance.ready === false)
      report(checkEventStreamReply({ status: response.status, contentType, firstChunk: ok ? await firstChunk(response, SELF_CHECK_TIMEOUT_MS, deps.setTimer, deps.clearTimer) : false }, SELF_CHECK_TIMEOUT_MS / 1000, instanceReady))
      if (!ok) { try { await response.body?.cancel?.() } catch { /* nothing to cancel */ } }
    } catch (error) {
      report(checkEventStreamReply({ error }))
    } finally {
      deps.clearTimer(abort)
      controller?.abort()
    }
    let socketUrl = null
    try { socketUrl = selfCheckSocketUrl(base, deps.pageHref) } catch { socketUrl = null }
    report(socketUrl ? checkWebSocketOutcome(await probeWebSocket(deps, socketUrl)) : result('websocket', 'skip', 'ws-unavailable'))
  }
  return SELF_CHECK_IDS.map(id => results.get(id)).filter(Boolean)
}

/** One line for the whole run: `{ status: 'pass' | 'warn' | 'fail', failed, warned }`. */
export function selfCheckSummary(results) {
  const failed = results.filter(check => check.status === 'fail').length
  const warned = results.filter(check => check.status === 'warn').length
  return Object.freeze({ status: failed ? 'fail' : warned ? 'warn' : 'pass', failed, warned })
}
