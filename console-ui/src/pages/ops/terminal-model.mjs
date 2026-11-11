/**
 * Console terminal client (ADR 0051): target listing, one-time ticket, WebSocket session.
 * Pure and injectable so tests drive it without a browser. Tickets are credentials: they are
 * never logged, never kept after the socket opens and never put into error messages.
 */

export const TERMINAL_CLOSE_CODES = Object.freeze({
  normal: 1000,
  abnormal: 1006,
  startFailed: 1011,
  badRequest: 4400,
  invalidTicket: 4401,
  forbidden: 4403,
  tooManySessions: 4429,
})

/** Keep-alive through proxies; does not count as input on the server. */
export const TERMINAL_PING_MS = 25_000
export const TERMINAL_MIN_SIZE = 1
export const TERMINAL_MAX_SIZE = 1000

export function terminalPaths(base = '/api') {
  const root = `${String(base).replace(/\/+$/u, '')}/console/terminal`
  return Object.freeze({ targets: `${root}/targets`, tickets: `${root}/tickets`, socket: root })
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

export function readTerminalTargets(value) {
  const list = Array.isArray(value) ? value : isRecord(value) && Array.isArray(value.data) ? value.data : []
  return list.filter(item => isRecord(item) && typeof item.id === 'string' && item.id).map(item => ({
    id: item.id,
    kind: item.kind === 'ssh' ? 'ssh' : 'local',
    label: typeof item.label === 'string' && item.label ? item.label : item.id,
    available: item.available === true,
    ...(typeof item.reason === 'string' && item.reason ? { reason: item.reason } : {}),
    // Only an explicit `true` marks an unverified host key; anything else is the safe default.
    ...(item.kind === 'ssh' && item.insecureHostKey === true ? { insecureHostKey: true } : {}),
  }))
}

/** SSH targets that skip host key verification need an explicit confirmation before connecting. */
export function terminalNeedsConfirmation(target) {
  return Boolean(target && target.kind === 'ssh' && target.insecureHostKey === true)
}

/** `ws(s)://host/api/console/terminal?ticket=…` from the Host API base (`http(s)://host`). */
export function terminalSocketUrl(apiBase, ticket, base = '/api', location = globalThis.location) {
  const url = new URL(terminalPaths(base).socket, apiBase ? `${String(apiBase).replace(/\/+$/u, '')}/` : location?.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  url.search = new URLSearchParams({ ticket }).toString()
  return url.toString()
}

export function clampTerminalSize(value) {
  const number = Math.floor(Number(value))
  if (!Number.isFinite(number)) return 80
  return Math.min(TERMINAL_MAX_SIZE, Math.max(TERMINAL_MIN_SIZE, number))
}

/** A server text frame as a control message, or null when it is not one. */
export function parseServerControl(text) {
  try {
    const value = JSON.parse(text)
    return isRecord(value) && typeof value.type === 'string' ? value : null
  } catch {
    return null
  }
}

/** Why a terminal session ended, for the banner over the terminal. */
export function endReasonMessage(reason, t) {
  switch (reason) {
    case 'process-exit': return t('Shell 已退出。')
    case 'idle-timeout': return t('长时间没有输入，会话已因空闲超时断开。')
    case 'revoked': return t('你的登录会话或权限已被吊销，终端已断开。')
    case 'disabled': return t('终端已在 Host 配置中关闭。')
    case 'disconnect': return t('连接已断开。')
    case 'invalid-ticket': return t('终端票据无效或已过期，请重新连接。')
    case 'forbidden': return t('需要 ops.terminal 权限才能使用终端。')
    case 'too-many-sessions': return t('终端会话数已达上限，请先关闭其他终端。')
    case 'start-failed': return t('终端无法启动。')
    case 'error': return t('连接异常中断。')
    default: return t('终端已断开。')
  }
}

/** End reason for a close without an `exit` control message. */
export function reasonForClose(code, closeReason = '') {
  switch (code) {
    case TERMINAL_CLOSE_CODES.invalidTicket: return 'invalid-ticket'
    case TERMINAL_CLOSE_CODES.forbidden: return closeReason === 'disabled' ? 'disabled' : 'forbidden'
    case TERMINAL_CLOSE_CODES.tooManySessions: return 'too-many-sessions'
    case TERMINAL_CLOSE_CODES.startFailed: return 'start-failed'
    case TERMINAL_CLOSE_CODES.normal: return closeReason || 'disconnect'
    default: return 'error'
  }
}

/** Localized message for a failed `targets` / `tickets` HTTP call. */
export function terminalHttpError(status, body, t) {
  const code = isRecord(body) && typeof body.code === 'string' ? body.code : ''
  const hostMessage = isRecord(body) && typeof body.error === 'string' ? body.error : ''
  if (status === 404 && (code === 'not-found' || !code)) return { kind: 'disabled', message: t('终端未启用：在 Host 配置中设置 console.terminal.enabled: true 后重启。') }
  if (status === 401) return { kind: 'unauthorized', message: t('登录已失效，请重新登录。') }
  if (status === 403) return { kind: 'forbidden', message: t('需要 ops.terminal 权限才能使用终端（初始化令牌不可用）。') }
  if (status === 429 || code === 'too-many-sessions') return { kind: 'too-many-sessions', message: hostMessage || t('终端会话数已达上限，请先关闭其他终端。') }
  if (status === 409 || code === 'unavailable') return { kind: 'unavailable', message: hostMessage || t('终端目标不可用。') }
  return { kind: 'failed', message: hostMessage || t('请求失败（HTTP {0}）', [status]) }
}

const encoder = new TextEncoder()

/**
 * One terminal session: ticket → WebSocket → ready → io → end. `deps`:
 * - `requestTicket(target, cols, rows)` resolves `{ ticket }` or rejects with an Error whose message is shown;
 * - `socketUrl(ticket)`; `WebSocket` constructor; optional `setInterval` / `clearInterval`;
 * - callbacks `onReady(info)`, `onOutput(Uint8Array)`, `onError(message)`, `onEnd({ reason, code, message })`.
 * `t` localizes end messages. A connection is single-use: reconnecting creates a new one.
 */
export function createTerminalConnection(deps, t) {
  const timers = { setInterval: deps.setInterval ?? globalThis.setInterval, clearInterval: deps.clearInterval ?? globalThis.clearInterval }
  let socket = null
  let ping = null
  let state = 'idle'
  let exit = null
  let disposed = false

  const finish = (reason, code = null, message) => {
    if (state === 'ended') return
    state = 'ended'
    if (ping !== null) timers.clearInterval(ping)
    ping = null
    deps.onEnd?.({ reason, code, message: message ?? endReasonMessage(reason, t) })
  }

  const send = data => {
    if (state !== 'ready' || !socket || socket.readyState !== 1) return false
    socket.send(data)
    return true
  }

  return {
    get state() { return state },
    async start(target, cols, rows) {
      if (state !== 'idle') throw new Error('terminal connection is single-use')
      state = 'connecting'
      let ticket
      try {
        ticket = (await deps.requestTicket(target, clampTerminalSize(cols), clampTerminalSize(rows))).ticket
      } catch (error) {
        finish('start-failed', null, error instanceof Error && error.message ? error.message : endReasonMessage('start-failed', t))
        return
      }
      if (disposed) { finish('disconnect'); return }
      socket = new deps.WebSocket(deps.socketUrl(ticket))
      ticket = undefined
      socket.binaryType = 'arraybuffer'
      socket.onmessage = event => {
        const { data } = event
        if (typeof data === 'string') {
          const control = parseServerControl(data)
          if (!control) return
          if (control.type === 'ready') {
            state = 'ready'
            ping = timers.setInterval(() => { send(JSON.stringify({ type: 'ping' })) }, TERMINAL_PING_MS)
            deps.onReady?.(control)
          } else if (control.type === 'exit') {
            exit = control
          } else if (control.type === 'error') {
            // A rejected start is followed by a close; remember the message for the banner.
            exit = exit ?? { error: control }
            deps.onError?.(typeof control.message === 'string' ? control.message : String(control.code))
          }
          return
        }
        const bytes = data instanceof ArrayBuffer ? new Uint8Array(data) : ArrayBuffer.isView(data) ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength) : null
        if (bytes) deps.onOutput?.(bytes)
      }
      socket.onclose = event => {
        if (exit && typeof exit.reason === 'string') {
          finish(exit.reason, typeof exit.code === 'number' ? exit.code : null)
          return
        }
        const reason = disposed ? 'disconnect' : reasonForClose(event?.code, event?.reason)
        const detail = exit?.error && typeof exit.error.message === 'string' ? exit.error.message : undefined
        finish(reason, null, detail && reason !== 'disconnect' ? `${endReasonMessage(reason, t)} ${detail}` : undefined)
      }
      socket.onerror = () => { /* followed by close */ }
    },
    /** Keyboard input or pasted text as one binary frame. */
    write(data) {
      return send(typeof data === 'string' ? encoder.encode(data) : data)
    },
    resize(cols, rows) {
      return send(JSON.stringify({ type: 'resize', cols: clampTerminalSize(cols), rows: clampTerminalSize(rows) }))
    },
    dispose() {
      disposed = true
      if (socket && socket.readyState <= 1) {
        try { socket.close(TERMINAL_CLOSE_CODES.normal, 'closed by user') } catch { /* already closing */ }
      }
      if (!socket) finish('disconnect')
    },
  }
}
