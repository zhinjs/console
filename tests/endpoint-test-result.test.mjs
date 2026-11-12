import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import * as model from '../console-ui/src/pages/endpoint-test-result-model.mjs'

const { readEndpointTestResult, endpointTestError, endpointTestPresentation } = model

test('connection test keeps the structured reachable result instead of a pre-joined string', () => {
  assert.deepEqual(readEndpointTestResult({ reachable: true, connected: true, status: 'online', latencyMs: 24, message: 'Endpoint 已连接' }),
    { ok: true, connected: true, status: 'online', latencyMs: 24, message: 'Endpoint 已连接' })
  const offline = readEndpointTestResult({ reachable: false, connected: false, latencyMs: 3, message: 'Endpoint 当前离线' })
  assert.equal(offline.ok, false)
  assert.equal(offline.message, 'Endpoint 当前离线')
  // Missing or malformed reachability is never reported as a success.
  for (const payload of [undefined, null, {}, { reachable: 'true' }, { message: 'ok' }]) assert.equal(readEndpointTestResult(payload).ok, false)
  assert.equal(readEndpointTestResult({ connected: true }).ok, true)
  assert.equal(readEndpointTestResult({ reachable: true, latencyMs: -1 }).latencyMs, undefined)
  assert.deepEqual(endpointTestError('测试失败：timeout'), { ok: false, message: '测试失败：timeout' })
})

test('successful and failed tests present different tones, roles and reasons', () => {
  const ok = endpointTestPresentation({ ok: true, latencyMs: 24, message: 'Endpoint 已连接' })
  assert.deepEqual(ok, { tone: 'success', role: 'status', label: '连接正常', reason: undefined, latencyText: '24 ms', detail: 'Endpoint 已连接 · 24 ms' })
  const failed = endpointTestPresentation({ ok: false, latencyMs: 5, message: 'Endpoint 当前离线' })
  assert.equal(failed.tone, 'error')
  assert.equal(failed.role, 'alert')
  assert.equal(failed.label, '连接失败')
  assert.equal(failed.reason, 'Endpoint 当前离线')
  assert.equal(failed.detail, 'Endpoint 当前离线 · 5 ms')
  assert.equal(endpointTestPresentation({ ok: false }).reason, '连接异常')
  // The host reports "connected" but not online: the reason must not read like success.
  const degraded = endpointTestPresentation({ ok: false, connected: true, status: 'pending', message: 'Endpoint 已连接' })
  assert.equal(degraded.reason, '已连接，但运行状态为 pending')
  assert.equal(endpointTestPresentation({ ok: false, message: 'Endpoint 当前离线' }, 'en').label, 'Connection failed')
  assert.equal(endpointTestPresentation({ ok: true }, 'en').label, 'Connected')
})

// The connection test lives in the 接入 tab only (the chat workspace no longer repeats it).
test('the account 接入 tab announces test results and labels the running state', async () => {
  const list = await readFile(new URL('../console-ui/src/pages/scope/endpoint-access.tsx', import.meta.url), 'utf8')
  assert.match(list, /endpointTestPresentation\(/)
  assert.match(list, /role=\{presentation\.role\}/)
  assert.match(list, /i18n\.t\('测试中…'\)/)
  assert.doesNotMatch(list, /测速中/)
})
