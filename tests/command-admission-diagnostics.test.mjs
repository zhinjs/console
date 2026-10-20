import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { readMessageDiagnostics, diagnosticAdvice, diagnosticLabel } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'
const fixture = JSON.parse(await readFile(new URL('./fixtures/message-diagnostics-command.json', import.meta.url), 'utf8'))
const original = fixture.data[0]
const target = { conversation: original.conversation, messageId: original.messageId }
const parse = (fields = {}) => readMessageDiagnostics({ success: true, data: [{ ...original, dispatchStatus: 'limited',
  steps: [{ stage: 'dispatch', status: 'limited', at: original.startedAt }], ...fields }] }, target)[0]

test('limited is a command admission result, preserving full identity and bounded facts', () => {
  const value = parse({ limit: { reason: 'cooldown', retryAfterMs: 1501, body: 'must-not-copy' } })
  assert.equal(diagnosticLabel(value.dispatchStatus), '指令执行受限')
  assert.deepEqual(value.conversation, target.conversation)
  assert.deepEqual(value.limit, { reason: 'cooldown', retryAfterMs: 1501 })
  assert.ok(diagnosticAdvice(value).some(text => text.includes('记录产生时剩余约 2 秒') && text.includes('不会自动重放')))
})
test('busy has no fabricated completion time and does not become permission or delivery failure', () => {
  const advice = diagnosticAdvice(parse({ limit: { reason: 'busy' }, deliveries: [] })).join('\n')
  assert.match(advice, /完成时间未知/u)
  assert.doesNotMatch(advice, /剩余|秒后|权限规则|未被平台受理/u)
  assert.ok(diagnosticAdvice(parse({ deliveries: [] })).some(text => text.includes('不会自动重放')))
})
test('all trusted-context refusal reasons remain actionable without inventing retries', () => {
  for (const reason of ['capacity', 'operation_unavailable', 'identity_unavailable', 'service_unavailable']) {
    const value = parse({ limit: { reason } })
    assert.equal(value.limit.reason, reason)
    assert.ok(diagnosticAdvice(value).length > 0)
  }
})
test('rejects invalid limit contracts without weakening prior diagnostic identity guards', () => {
  for (const limit of [null, [], { reason: 'unknown' }, { reason: 'busy', retryAfterMs: 10 },
    ...[0, -1, 1.5, Infinity, 86_400_001].map(retryAfterMs => ({ reason: 'cooldown', retryAfterMs }))]) {
    assert.throws(() => parse({ limit }), /准入/u)
  }
  assert.throws(() => parse({ dispatchStatus: 'executed', limit: { reason: 'cooldown' } }), /准入/u)
  assert.throws(() => parse({ conversation: { ...original.conversation, threadId: 'other-thread' } }), /身份/u)
})

test('a real ImRuntime busy record round-trips with handlers, final reply and no fabricated ETA', async () => {
  const body = JSON.parse(await readFile(new URL('./fixtures/message-diagnostics-admission-busy.json', import.meta.url), 'utf8'))
  const item = body.data[0]
  const [value] = readMessageDiagnostics(body, { conversation: item.conversation, messageId: item.messageId })
  assert.equal(value.dispatchStatus, 'limited')
  assert.deepEqual(value.limit, { reason: 'busy' })
  assert.ok(value.steps.some(step => step.stage === 'handlers' && step.status === 'completed'))
  assert.ok(value.deliveries.every(delivery => delivery.status === 'sent'))
  assert.ok(diagnosticAdvice(value).some(text => text.includes('完成时间未知')))
})
