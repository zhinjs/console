import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
// The published SDK the site is locked to (@zhin.js/client ~1.1.32): its real transport and error classes.
import { ConsoleTransport } from '../node_modules/@zhin.js/client/dist/transport/console-transport.js'
import { ConsoleTransportError, MessageError } from '../node_modules/@zhin.js/client/dist/transport/types.js'
import { capturingFetch, requestWithCapture } from '../console-ui/src/utils/rpc-reply-capture.mjs'
import { outcomeUnknown, statusFromError } from '../console-ui/src/components/status-state-model.mjs'
import { receiptReducer } from '../console-ui/src/components/action-receipt-model.mjs'
import { deliveryAfterError } from '../console-ui/src/pages/endpoint-detail/chat-workspace-model.mjs'

globalThis.localStorage ??= { getItem: key => (key === 'zhin_api_base' ? 'https://host.invalid' : null), setItem() {}, removeItem() {} }

const json = (status, body, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/** The SDK transport over a fake network, its fetch wrapped like `console-client.ts` does. */
function transport(reply, timeout = 10_000) {
  return new ConsoleTransport({ fetch: capturingFetch(async (input, init) => reply(input, init)), requestTimeout: timeout })
}

async function failure(t, request = { type: 'feature.set-enabled' }) {
  try {
    await requestWithCapture(() => t.sendRequest(request))
  } catch (error) {
    return error
  }
  assert.fail('the request should fail')
}

const submitting = { phase: 'submitting', plan: { title: 'x' } }

test('the published SDK keeps the Host code but loses lockedBy, requestOutcome, the status and Retry-After (what the Console has to work around)', async () => {
  // Since @zhin.js/client 1.1.32 the SDK reads `code` / `errors` / `missingEnv` into `details`; the rest still needs the capture.
  const plain = new ConsoleTransport({ fetch: async () => json(503, { success: false, code: 'instance_unavailable', requestOutcome: 'not-dispatched', lockedBy: 'adapter', error: '不可用' }, { 'retry-after': '7' }) })
  const error = await plain.sendRequest({ type: 'feature.set-enabled' }).catch(caught => caught)
  assert.ok(error instanceof ConsoleTransportError)
  assert.deepEqual([error.code, error.message, error.details], ['SERVER_ERROR', '不可用', { serverCode: 'instance_unavailable' }])
})

test('a timeout, a network failure and an unreadable reply are 结果未知 / 断连, never 未执行', async () => {
  // AbortSignal.timeout fires inside the SDK: a real TimeoutError wrapped in MessageError.
  const slow = transport((_input, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason))), 20)
  // AbortSignal.timeout's timer does not keep Node alive on its own.
  const keepAlive = setInterval(() => {}, 1000)
  const timedOut = await failure(slow).finally(() => clearInterval(keepAlive))
  assert.ok(timedOut instanceof MessageError)
  assert.equal(timedOut.originalError.name, 'TimeoutError')
  assert.equal(statusFromError(timedOut).kind, 'unknown')
  assert.equal(receiptReducer(submitting, { type: 'reject', error: timedOut }).phase, 'unknown')
  assert.equal(deliveryAfterError(timedOut), 'unknown', 'a chat message that may have gone out is not offered for resending')

  const offline = await failure(transport(() => { throw new TypeError('Failed to fetch') }))
  assert.equal(statusFromError(offline).kind, 'disconnected')
  assert.equal(outcomeUnknown(statusFromError(offline)), true)
  assert.equal(receiptReducer(submitting, { type: 'reject', error: offline }).phase, 'unknown')

  const proxyPage = await failure(transport(() => new Response('<html>Bad Gateway</html>', { status: 502 })))
  assert.equal(proxyPage.code, 'MESSAGE_ERROR')
  assert.deepEqual([proxyPage.details.httpStatus, proxyPage.details.transport], [502, 'invalid-response'])
  assert.equal(statusFromError(proxyPage).kind, 'unknown')
  // An SDK error that never reached the capture (e.g. a newer SDK) still reads from originalError.
  assert.equal(statusFromError(new MessageError('REST request failed', new DOMException('aborted', 'TimeoutError'))).kind, 'unknown')
  assert.equal(statusFromError(new MessageError('REST request failed', new TypeError('Failed to fetch'))).kind, 'disconnected')
  assert.equal(statusFromError(new MessageError('REST request failed', new SyntaxError('Unexpected token <'))).kind, 'unknown')

  const refused = await failure(transport(() => new Response('Forbidden', { status: 403 })))
  assert.equal(statusFromError(refused).kind, 'forbidden', 'a 4xx page was refused before anything ran')
  assert.equal(receiptReducer(submitting, { type: 'reject', error: refused }).phase, 'failed')
})

test('the Host code, lockedBy, requestOutcome and Retry-After reach statusFromError', async () => {
  const locked = await failure(transport(() => json(409, { success: false, code: 'locked', lockedBy: 'adapter', error: '已被适配器层停用，下级开关已锁定' })))
  assert.ok(locked instanceof ConsoleTransportError, 'the SDK error object is kept')
  assert.deepEqual([statusFromError(locked).kind, statusFromError(locked).lockedBy], ['locked', 'adapter'])

  const down = await failure(transport(() => json(503, { success: false, code: 'instance_unavailable', requestOutcome: 'not-dispatched', state: 'stopped', error: 'The Zhin instance is not running' }, { 'retry-after': '7' })))
  const reading = statusFromError(down)
  assert.deepEqual([reading.kind, reading.instance, reading.outcome, reading.retryAfterSeconds], ['instance-unavailable', 'unavailable', 'not-dispatched', 7])
  assert.equal(receiptReducer(submitting, { type: 'reject', error: down }).phase, 'failed', 'never dispatched: certainly not applied')

  const overloaded = await failure(transport(() => json(502, { success: false, code: 'instance_error', requestOutcome: 'not-dispatched', error: 'The instance is overloaded' }, { 'retry-after': '2' })))
  assert.deepEqual([statusFromError(overloaded).outcome, statusFromError(overloaded).retryAfterSeconds], ['not-dispatched', 2])
  const midway = await failure(transport(() => json(502, { success: false, code: 'instance_error', requestOutcome: 'unknown', error: 'The instance failed to answer' })))
  assert.equal(receiptReducer(submitting, { type: 'reject', error: midway }).phase, 'unknown')

  const conflict = await failure(transport(() => json(409, { success: false, code: 'conflict', error: '开关已被修改，请刷新后再试（revision 不一致，未覆盖）' })))
  assert.equal(statusFromError(conflict).kind, 'conflict')
  const busy = await failure(transport(() => json(503, { success: false, code: 'database_busy', error: '数据库正忙' }, { 'retry-after': '3' })))
  assert.deepEqual([statusFromError(busy).kind, statusFromError(busy).retryAfterSeconds], ['database-busy', 3])
  const config = await failure(transport(() => json(400, { success: false, code: 'invalid_input', error: 'bad', missingEnv: ['TOKEN'], needsConfiguration: [{ name: 'p' }] })))
  assert.deepEqual(statusFromError(config).missingEnv, ['TOKEN'])
})

test('only the RPC fetch takes the capture, and a success is not parsed twice', async () => {
  let parsed = 0
  const t = transport(() => { const response = json(200, { success: true, data: { ok: 1 } }); const clone = response.clone.bind(response); response.clone = () => { const copy = clone(); const read = copy.json.bind(copy); copy.json = () => { parsed += 1; return read() }; return copy }; return response })
  assert.deepEqual(await requestWithCapture(() => t.sendRequest({ type: 'endpoint.list' })), { ok: 1 })
  assert.equal(parsed, 0)
  const passthrough = capturingFetch(async input => new Response(String(input)))
  assert.equal(await (await passthrough('https://host.invalid/api/events')).text(), 'https://host.invalid/api/events')
  const rpc = readFileSync(new URL('../console-ui/src/utils/console-rpc.ts', import.meta.url), 'utf8')
  assert.match(rpc, /requestWithCapture\(\(\) => transport\.sendRequest<T>\(request\)\)/)
  const client = readFileSync(new URL('../console-ui/src/utils/console-client.ts', import.meta.url), 'utf8')
  assert.match(client, /transportConfig: \{ fetch: capturingFetch\(transportFetch\) \}/)
})

test('upstream "HTTP 502 Bad Gateway" text is not an instance failure; the reviewer cases', async () => {
  const { reportRequestFailure, getInstanceAvailability, clearInstanceAvailability } = await import('../console-ui/src/utils/instance-availability.mjs')
  clearInstanceAvailability()
  const upstream = reportRequestFailure('endpoint.test', new ConsoleTransportError('连接测试失败：HTTP 502 Bad Gateway', 'SERVER_ERROR'))
  assert.equal(upstream.kind, 'error')
  assert.equal(getInstanceAvailability(), null, 'no banner for a platform the instance called')
  for (const text of ['HTTP 504 Gateway Timeout', 'upstream HTTP 503 instance of x']) assert.notEqual(statusFromError(new ConsoleTransportError(text, 'SERVER_ERROR')).kind, 'instance-unavailable', text)
  // Texts of the backend's conflict replies (the SDK keeps only the text).
  for (const text of ['会话覆盖已被其他地方修改，请刷新后重试', '配置已被其他地方修改，未保存。请刷新后重试。', '群规已被修改，请刷新后再试（revision 不一致，未覆盖）']) {
    assert.equal(statusFromError(new ConsoleTransportError(text, 'SERVER_ERROR')).kind, 'conflict', text)
  }
  assert.equal(statusFromError(new ConsoleTransportError('The instance is overloaded', 'SERVER_ERROR')).outcome, 'not-dispatched', 'the gateway says it never dispatched')
  assert.equal(statusFromError(new ConsoleTransportError('The instance failed to answer', 'SERVER_ERROR')).outcome, 'unknown')
  clearInstanceAvailability()
})

test('a failed Console SQL statement keeps the server SQLSTATE (restricted account, ADR 0059)', async () => {
  const t = transport(() => json(400, { success: false, error: 'permission denied for schema public', data: { sqlState: '42501' } }))
  const error = await failure(t, { type: 'db:execute', sql: 'CREATE TABLE t (a int)' })
  assert.equal(error.details.sqlState, '42501')
  assert.equal(error.details.dataCode, undefined)
})
