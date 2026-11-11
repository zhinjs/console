import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  TERMINAL_CLOSE_CODES, clampTerminalSize, createTerminalConnection, endReasonMessage, parseServerControl, readTerminalTargets, reasonForClose,
  terminalHttpError, terminalPaths, terminalSocketUrl,
} from '../console-ui/src/pages/ops/terminal-model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)
const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')

test('paths and the socket URL follow ADR 0051 and switch to ws(s)', () => {
  assert.deepEqual({ ...terminalPaths() }, { targets: '/api/console/terminal/targets', tickets: '/api/console/terminal/tickets', socket: '/api/console/terminal' })
  assert.equal(terminalPaths('/gw/').socket, '/gw/console/terminal')
  assert.equal(terminalSocketUrl('https://host.example:8443/', 'a+b/c'), 'wss://host.example:8443/api/console/terminal?ticket=a%2Bb%2Fc')
  assert.equal(terminalSocketUrl('http://127.0.0.1:8086', 't'), 'ws://127.0.0.1:8086/api/console/terminal?ticket=t')
  assert.equal(terminalSocketUrl('', 't', '/api', { href: 'https://console.example/ops/terminal' }), 'wss://console.example/api/console/terminal?ticket=t')
})

test('targets are read defensively and keep the unavailable reason', () => {
  assert.deepEqual(readTerminalTargets([
    { id: 'local', kind: 'local', label: '本机 Shell', available: true },
    { id: 'build-box', kind: 'ssh', label: 'build-box', available: false, reason: '缺少 ssh2' },
    { id: '', kind: 'ssh' }, null, 'x',
  ]), [
    { id: 'local', kind: 'local', label: '本机 Shell', available: true },
    { id: 'build-box', kind: 'ssh', label: 'build-box', available: false, reason: '缺少 ssh2' },
  ])
  assert.deepEqual(readTerminalTargets({ data: [{ id: 'x', available: 1 }] }), [{ id: 'x', kind: 'local', label: 'x', available: false }])
  assert.deepEqual(readTerminalTargets(null), [])
})

test('sizes are clamped to the server range and control frames parsed', () => {
  assert.equal(clampTerminalSize(0), 1)
  assert.equal(clampTerminalSize(5000), 1000)
  assert.equal(clampTerminalSize('nope'), 80)
  assert.equal(clampTerminalSize(120.7), 120)
  assert.deepEqual(parseServerControl('{"type":"exit","reason":"idle-timeout","code":null}'), { type: 'exit', reason: 'idle-timeout', code: null })
  assert.equal(parseServerControl('not json'), null)
  assert.equal(parseServerControl('[1]'), null)
})

test('close codes map to end reasons with localized messages', () => {
  assert.equal(reasonForClose(TERMINAL_CLOSE_CODES.invalidTicket), 'invalid-ticket')
  assert.equal(reasonForClose(TERMINAL_CLOSE_CODES.forbidden, 'forbidden'), 'forbidden')
  assert.equal(reasonForClose(TERMINAL_CLOSE_CODES.forbidden, 'disabled'), 'disabled')
  assert.equal(reasonForClose(TERMINAL_CLOSE_CODES.tooManySessions), 'too-many-sessions')
  assert.equal(reasonForClose(TERMINAL_CLOSE_CODES.startFailed), 'start-failed')
  assert.equal(reasonForClose(1006), 'error')
  assert.equal(reasonForClose(1000, 'revoked'), 'revoked')
  for (const reason of ['process-exit', 'idle-timeout', 'revoked', 'disabled', 'disconnect', 'invalid-ticket', 'forbidden', 'too-many-sessions', 'start-failed', 'error', 'other']) {
    assert.match(endReasonMessage(reason, zh), /[㐀-鿿]/u, reason)
    assert.doesNotMatch(endReasonMessage(reason, en), /[㐀-鿿]/u, reason)
  }
  assert.notEqual(endReasonMessage('revoked', zh), endReasonMessage('idle-timeout', zh))
})

test('HTTP failures of targets / tickets explain the disabled terminal and limits', () => {
  assert.equal(terminalHttpError(404, { success: false, code: 'not-found', error: '终端未启用' }, zh).kind, 'disabled')
  assert.match(terminalHttpError(404, null, zh).message, /console\.terminal\.enabled/u)
  assert.equal(terminalHttpError(403, null, zh).kind, 'forbidden')
  assert.deepEqual(terminalHttpError(429, { code: 'too-many-sessions', error: '终端会话已达上限（4）' }, zh), { kind: 'too-many-sessions', message: '终端会话已达上限（4）' })
  assert.deepEqual(terminalHttpError(409, { code: 'unavailable', error: '缺少 node-pty' }, zh), { kind: 'unavailable', message: '缺少 node-pty' })
  assert.equal(terminalHttpError(500, null, en).message, 'Request failed (HTTP 500)')
})

class FakeSocket {
  static instances = []
  constructor(url) {
    this.url = url
    this.readyState = 1
    this.sent = []
    this.closed = null
    FakeSocket.instances.push(this)
  }
  send(data) { this.sent.push(data) }
  close(code, reason) { this.closed = { code, reason }; this.readyState = 3; this.onclose?.({ code, reason }) }
  receive(data) { this.onmessage?.({ data }) }
  drop(code, reason = '') { this.readyState = 3; this.onclose?.({ code, reason }) }
}

function harness(overrides = {}) {
  FakeSocket.instances = []
  const events = { ready: [], output: [], errors: [], ends: [], tickets: [] }
  const intervals = []
  const connection = createTerminalConnection({
    requestTicket: async (target, cols, rows) => { events.tickets.push({ target, cols, rows }); return { ticket: 'secret-ticket' } },
    socketUrl: ticket => `ws://h/api/console/terminal?ticket=${ticket}`,
    WebSocket: FakeSocket,
    setInterval: (fn, ms) => { intervals.push({ fn, ms, cleared: false }); return intervals.length - 1 },
    clearInterval: id => { if (intervals[id]) intervals[id].cleared = true },
    onReady: info => events.ready.push(info),
    onOutput: bytes => events.output.push(new TextDecoder().decode(bytes)),
    onError: message => events.errors.push(message),
    onEnd: end => events.ends.push(end),
    ...overrides,
  }, zh)
  return { connection, events, intervals }
}

test('a session requests a ticket, opens the socket, exchanges binary io and resizes', async () => {
  const { connection, events, intervals } = harness()
  await connection.start('local', 0, 4000)
  assert.deepEqual(events.tickets, [{ target: 'local', cols: 1, rows: 1000 }])
  const socket = FakeSocket.instances[0]
  assert.equal(socket.binaryType, 'arraybuffer')
  assert.equal(connection.write('ls\r'), false, 'no input before ready')
  socket.receive(JSON.stringify({ type: 'ready', sessionId: 's1', target: 'local', kind: 'local', cols: 80, rows: 24 }))
  assert.equal(connection.state, 'ready')
  assert.equal(events.ready[0].sessionId, 's1')
  assert.equal(connection.write('ls\r'), true)
  assert.ok(socket.sent[0] instanceof Uint8Array, 'input is a binary frame')
  assert.equal(new TextDecoder().decode(socket.sent[0]), 'ls\r')
  connection.resize(132, 40)
  assert.deepEqual(JSON.parse(socket.sent[1]), { type: 'resize', cols: 132, rows: 40 })
  socket.receive(new TextEncoder().encode('hello').buffer)
  assert.deepEqual(events.output, ['hello'])
  intervals[0].fn()
  assert.deepEqual(JSON.parse(socket.sent[2]), { type: 'ping' })
  socket.receive(JSON.stringify({ type: 'pong' }))
  socket.receive(JSON.stringify({ type: 'exit', reason: 'process-exit', code: 0 }))
  socket.drop(1000, 'process-exit')
  assert.deepEqual(events.ends, [{ reason: 'process-exit', code: 0, message: endReasonMessage('process-exit', zh) }])
  assert.equal(intervals[0].cleared, true)
  assert.equal(connection.write('x'), false)
  await assert.rejects(connection.start('local', 80, 24), /single-use/u)
})

test('revocation, idle timeout and rejected tickets end with their reasons', async () => {
  for (const reason of ['revoked', 'idle-timeout', 'disabled']) {
    const { connection, events } = harness()
    await connection.start('local', 80, 24)
    const socket = FakeSocket.instances[0]
    socket.receive(JSON.stringify({ type: 'ready', sessionId: 's', target: 'local', kind: 'local', cols: 80, rows: 24 }))
    socket.receive(JSON.stringify({ type: 'exit', reason, code: null }))
    socket.drop(1000, reason)
    assert.equal(events.ends[0].reason, reason)
  }
  const rejected = harness()
  await rejected.connection.start('local', 80, 24)
  const socket = FakeSocket.instances[0]
  socket.receive(JSON.stringify({ type: 'error', code: 'invalid-ticket', message: '终端票据无效或已过期' }))
  socket.drop(TERMINAL_CLOSE_CODES.invalidTicket, 'invalid-ticket')
  assert.equal(rejected.events.ends[0].reason, 'invalid-ticket')
  assert.deepEqual(rejected.events.errors, ['终端票据无效或已过期'])
  const lost = harness()
  await lost.connection.start('local', 80, 24)
  FakeSocket.instances[0].drop(1006)
  assert.equal(lost.events.ends[0].reason, 'error')
})

test('a failed ticket request ends the session without opening a socket and never leaks the ticket', async () => {
  const { connection, events } = harness({ requestTicket: async () => { throw new Error('终端会话已达上限（4）') } })
  await connection.start('local', 80, 24)
  assert.equal(FakeSocket.instances.length, 0)
  assert.deepEqual(events.ends, [{ reason: 'start-failed', code: null, message: '终端会话已达上限（4）' }])

  const ok = harness()
  await ok.connection.start('local', 80, 24)
  FakeSocket.instances[0].drop(1011, 'start-failed')
  assert.doesNotMatch(JSON.stringify(ok.events), /secret-ticket/u)
})

test('disposing closes the socket; disposing during the ticket request never opens one', async () => {
  const { connection, events } = harness()
  await connection.start('local', 80, 24)
  connection.dispose()
  assert.deepEqual(FakeSocket.instances[0].closed, { code: 1000, reason: 'closed by user' })
  assert.equal(events.ends[0].reason, 'disconnect')

  let release
  const slow = harness({ requestTicket: () => new Promise(resolve => { release = resolve }) })
  const started = slow.connection.start('local', 80, 24)
  slow.connection.dispose()
  release({ ticket: 'late' })
  await started
  assert.equal(FakeSocket.instances.length, 0)
  assert.equal(slow.events.ends.length, 1)
})

test('the terminal page uses xterm with the fit addon, tabs and reconnect, and never logs tickets', () => {
  const page = read('pages/ops/terminal.tsx')
  assert.match(page, /from '@xterm\/xterm'/u)
  assert.match(page, /from '@xterm\/addon-fit'/u)
  assert.match(page, /@xterm\/xterm\/css\/xterm\.css/u)
  assert.match(page, /role="tablist"/u)
  assert.match(page, /重新连接/u)
  assert.match(page, /attachCustomKeyEventHandler/u)
  for (const file of ['pages/ops/terminal.tsx', 'pages/ops/terminal-model.mjs']) {
    assert.doesNotMatch(read(file), /console\.(log|info|debug|warn|error)\(/u, `${file} does not log`)
  }
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
  const deps = { ...pkg.dependencies, ...pkg.devDependencies }
  assert.match(deps['@xterm/xterm'], /^\d+\.\d+\.\d+$/u, 'exact version')
  assert.match(deps['@xterm/addon-fit'], /^\d+\.\d+\.\d+$/u, 'exact version')
})
