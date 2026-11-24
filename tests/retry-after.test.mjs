import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { parseRetryAfterMs, parseRetryAfterSeconds } from '../console-ui/src/utils/retry-after.mjs'
import { retryAfterSecondsFrom, readMcpTestResponse } from '../console-ui/src/pages/introspection/mcp-status-model.mjs'
import { retryAfterSeconds } from '../console-ui/src/utils/console-auth-model.mjs'
import { readGatewayReply } from '../console-ui/src/pages/ops/gateway-model.mjs'
import { readIamReply } from '../console-ui/src/pages/access/iam-request.mjs'

const NOW = Date.parse('2026-11-11T00:00:00Z')
const SAMPLES = ['120', '1.5', '.5', '5.', '+5', ' 7 ', '0', '-5', '1e3', '0x10', 'soon', '', '   ', '5', '2026', 'Wed, 11 Nov 2026 00:01:00 GMT', 'Tue, 10 Nov 2026 00:00:00 GMT', '+Wed, 11 Nov 2026 00:01:00 GMT', null, undefined, 12]

test('Retry-After is parsed strictly: delta-seconds or an HTTP date, nothing else (console#124)', () => {
  assert.equal(parseRetryAfterMs('120', NOW), 120_000)
  assert.equal(parseRetryAfterMs('1.5', NOW), 1_500)
  assert.equal(parseRetryAfterMs('.5', NOW), 500)
  assert.equal(parseRetryAfterMs('5.', NOW), 5_000)
  assert.equal(parseRetryAfterMs('+5', NOW), 5_000)
  assert.equal(parseRetryAfterMs('Wed, 11 Nov 2026 00:01:00 GMT', NOW), 60_000)
  assert.equal(parseRetryAfterMs('Tue, 10 Nov 2026 00:00:00 GMT', NOW), 0, 'a date in the past is now')
  // `Date.parse('5')` is a year in V8 and `Number('1e3')` is 1000: neither is a Retry-After.
  for (const bad of ['-5', '1e3', '0x10', 'soon', '', '   ', '+Wed, 11 Nov 2026 00:01:00 GMT', null, undefined, 12]) {
    assert.equal(parseRetryAfterMs(bad, NOW), undefined, String(bad))
  }
  assert.equal(parseRetryAfterMs('2026', NOW), 2_026_000, 'digits are seconds, never a year')
  assert.equal(parseRetryAfterSeconds('1.5', NOW), 2)
  assert.equal(parseRetryAfterSeconds('0', NOW), 0)
})

test('the Console parser agrees with parseRetryAfterMs of @zhin.js/plugin-runtime when it is installed', async t => {
  const runtime = new URL('../node_modules/.pnpm/node_modules/@zhin.js/plugin-runtime/lib/retry.js', import.meta.url)
  if (!existsSync(runtime)) return t.skip('@zhin.js/plugin-runtime is not in the virtual store')
  const { parseRetryAfterMs: reference } = await import(runtime.href)
  for (const value of SAMPLES) assert.equal(parseRetryAfterMs(value, NOW), reference(value, NOW), JSON.stringify(value))
})

test('every Retry-After reader uses the strict parser', () => {
  // MCP 测试连接 (console#124) and the login / setup replies: at least one second, null when malformed.
  assert.equal(retryAfterSecondsFrom('1.5', NOW), 2)
  assert.equal(retryAfterSecondsFrom('0', NOW), 1)
  for (const bad of ['-5', '1e3', '5x', 'soon']) {
    assert.equal(retryAfterSecondsFrom(bad, NOW), null, bad)
    assert.equal(retryAfterSeconds(bad, undefined, NOW), null, bad)
  }
  assert.equal(readMcpTestResponse({ status: 429, body: {}, retryAfter: '1e3', now: NOW }).retryAfterSec, null)
  assert.equal(readMcpTestResponse({ status: 429, body: {}, retryAfter: 'Wed, 11 Nov 2026 00:00:30 GMT', now: NOW }).retryAfterSec, 30)
  // Gateway and IAM replies: a positive number of seconds or nothing.
  const t = (message, values = []) => message.replace(/\{(\d+)\}/gu, (_, index) => String(values[Number(index)]))
  const busy = { success: false, code: 'database_busy', error: 'busy' }
  const gateway = header => { try { readGatewayReply(503, busy, t, header) } catch (error) { return error.retryAfter } }
  const iam = header => { try { readIamReply(503, busy, t, header) } catch (error) { return error.retryAfter } }
  assert.equal(gateway('2.5'), 3)
  assert.equal(iam('2.5'), 3)
  for (const bad of ['1e3', '-1', '0']) {
    assert.equal(gateway(bad), undefined, bad)
    assert.equal(iam(bad), undefined, bad)
  }
})
