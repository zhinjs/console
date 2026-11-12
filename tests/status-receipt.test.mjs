import test from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_INSTANCE_RETRY_SECONDS, STATUS_COPY, STATUS_KINDS, outcomeUnknown, serverCodeOf, statusFromError, statusTone,
} from '../console-ui/src/components/status-state-model.mjs'
import { IDLE_RECEIPT, RECEIPT_COPY, readSubmitResult, receiptCanSubmit, receiptReducer } from '../console-ui/src/components/action-receipt-model.mjs'
import {
  clearInstanceAvailability, getInstanceAvailability, isGatewayOwnedRequest, nextRetrySeconds, rearmInstanceRetry, reportHttpReply,
  reportRequestFailure, reportRequestSuccess, secondsUntilRetry, subscribeInstanceAvailability,
} from '../console-ui/src/utils/instance-availability.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

/** A ConsoleTransportError of the newer SDK: Host code in `details.serverCode`, transport code in `code`. */
const transportError = (message, serverCode, extra = {}) => Object.assign(new Error(message), { name: 'ConsoleTransportError', code: 'SERVER_ERROR', details: { ...(serverCode ? { serverCode } : {}), ...extra } })

test('every status kind has translated copy and a tone', () => {
  for (const kind of STATUS_KINDS) {
    assert.ok(STATUS_COPY[kind], kind)
    for (const text of [STATUS_COPY[kind].title, STATUS_COPY[kind].description]) assert.ok(Object.hasOwn(englishMessages, text), `${kind}: ${text}`)
    assert.ok(['destructive', 'warning', 'muted'].includes(statusTone(kind)))
  }
})

test('the Host code wins over the text; transport codes are not Host codes', () => {
  assert.equal(serverCodeOf(transportError('x', 'invalid_input')), 'invalid_input')
  assert.equal(serverCodeOf(Object.assign(new Error('x'), { code: 'SERVER_ERROR' })), undefined)
  assert.equal(serverCodeOf({ code: 'locked', lockedBy: 'adapter' }), 'locked', 'a Host error body')
  assert.equal(serverCodeOf('text'), undefined)
})

test('409 locked carries the level that disabled the feature, from the body, details or the text', () => {
  assert.deepEqual(statusFromError({ code: 'locked', lockedBy: 'global', error: '已被全局层停用' }), { kind: 'locked', message: '已被全局层停用', serverCode: 'locked', lockedBy: 'global' })
  assert.equal(statusFromError(transportError('nope', 'locked', { lockedBy: 'endpoint' })).lockedBy, 'endpoint')
  assert.equal(statusFromError(new Error('feature is locked (lockedBy: adapter)')).lockedBy, 'adapter')
  assert.equal(statusFromError(new Error('该功能已在账号禁用')).lockedBy, 'endpoint')
  assert.equal(statusFromError(transportError('x', 'locked')).lockedBy, undefined)
})

test('409 conflict, 503 database_busy and the gateway instance errors are told apart', () => {
  assert.equal(statusFromError(transportError('revision mismatch', 'conflict')).kind, 'conflict')
  assert.equal(statusFromError(new Error('配置修订冲突，请重新读取后再保存')).kind, 'conflict')
  const busy = statusFromError(transportError('数据库正忙，请 3 秒后重试', 'database_busy'))
  assert.deepEqual([busy.kind, busy.retryAfterSeconds], ['database-busy', 3])
  assert.equal(statusFromError(new Error('数据库正忙，请稍后重试')).kind, 'database-busy', 'older SDKs keep only the text')

  const down = statusFromError(transportError('The Zhin instance is not running', 'instance_unavailable', { retryAfter: 7, requestOutcome: 'not-dispatched' }))
  assert.deepEqual([down.kind, down.instance, down.outcome, down.retryAfterSeconds], ['instance-unavailable', 'unavailable', 'not-dispatched', 7])
  assert.equal(outcomeUnknown(down), false, 'a request that never reached the instance may be sent again')
  const slow = statusFromError(transportError('The instance did not answer in time', 'instance_timeout'))
  assert.deepEqual([slow.kind, slow.instance, slow.outcome, slow.retryAfterSeconds], ['instance-unavailable', 'timeout', 'unknown', DEFAULT_INSTANCE_RETRY_SECONDS])
  assert.equal(outcomeUnknown(slow), true, 'a timed-out write may have run')
  assert.equal(statusFromError(new Error('The instance failed to answer')).instance, 'error')
  assert.equal(statusFromError(new Error('The instance is overloaded')).instance, 'error')
  assert.equal(statusFromError(new Error('The Zhin instance is not running')).kind, 'instance-unavailable', 'older SDKs keep only the text')
})

test('permission, install, support, configuration, connection and unknown outcomes', () => {
  assert.equal(statusFromError(new Error('HTTP 403')).kind, 'forbidden')
  assert.equal(statusFromError(new Error('没有 feature.configure 权限')).kind, 'forbidden')
  assert.equal(statusFromError(transportError('nope', 'forbidden')).kind, 'forbidden')
  assert.equal(statusFromError(transportError('x', 'not_installed')).kind, 'not-installed')
  assert.equal(statusFromError(new Error('Unknown RPC type: chat-roles.list')).kind, 'unsupported')
  const needs = statusFromError(transportError('x', undefined, { needsConfiguration: [{ name: 'p' }], missingEnv: ['TOKEN'] }))
  assert.deepEqual([needs.kind, needs.missingEnv], ['needs-configuration', ['TOKEN']])
  assert.equal(statusFromError(Object.assign(new Error('REST request failed'), { code: 'CONNECTION_ERROR' })).kind, 'disconnected')
  assert.equal(statusFromError(new TypeError('Failed to fetch')).kind, 'disconnected')
  assert.equal(statusFromError(new Error('The operation timed out')).kind, 'unknown')
  assert.equal(outcomeUnknown(statusFromError(new Error('Failed to fetch'))), true)
  assert.equal(statusFromError(new Error('boom')).kind, 'error')
  assert.equal(statusFromError(undefined).kind, 'error')
})

const plan = { title: '授予 admin', changes: ['qq / 1 → admin'] }

test('a receipt goes 准备 → 确认 → 提交 → 成功, never submits twice and cannot be cancelled mid-flight', () => {
  let state = receiptReducer(IDLE_RECEIPT, { type: 'prepare', plan })
  assert.equal(state.phase, 'prepared')
  assert.equal(receiptCanSubmit(state), true)
  state = receiptReducer(state, { type: 'confirm', now: 1 })
  assert.equal(state.phase, 'submitting')
  assert.equal(receiptCanSubmit(state), false)
  assert.equal(receiptReducer(state, { type: 'submit' }), state, 'a second submit is ignored')
  assert.equal(receiptReducer(state, { type: 'cancel' }), state, 'an in-flight request cannot be abandoned silently')
  assert.equal(receiptReducer(state, { type: 'prepare', plan }), state)
  state = receiptReducer(state, { type: 'resolve', value: { status: 'saved' }, now: 2 })
  assert.equal(state.phase, 'succeeded')
  assert.equal(receiptReducer(state, { type: 'reset' }).phase, 'idle')
  for (const phase of Object.keys(RECEIPT_COPY)) assert.ok(Object.hasOwn(englishMessages, RECEIPT_COPY[phase]), phase)
})

test('a danger plan asks once more before submitting', () => {
  let state = receiptReducer(IDLE_RECEIPT, { type: 'prepare', plan: { ...plan, danger: true } })
  state = receiptReducer(state, { type: 'confirm' })
  assert.equal(state.phase, 'confirming')
  assert.equal(receiptReducer(state, { type: 'cancel' }).phase, 'idle')
  state = receiptReducer(state, { type: 'submit' })
  assert.equal(state.phase, 'submitting')
})

test('results: partial failure, Host refusal, unchanged and unknown', () => {
  assert.equal(readSubmitResult(undefined).phase, 'succeeded')
  assert.equal(readSubmitResult({ status: 'unchanged' }).unchanged, true)
  const partial = readSubmitResult({ items: [{ label: 'a', ok: true }, { label: 'b', ok: false, message: 'x' }] })
  assert.deepEqual([partial.phase, partial.items.length], ['partial', 2])
  assert.equal(readSubmitResult({ items: [{ label: 'a', ok: false }] }).phase, 'failed')
  assert.deepEqual(readSubmitResult({ status: 'conflict', message: 'stale' }).status, { kind: 'conflict', message: 'stale' })
  assert.equal(readSubmitResult({ status: 'invalid' }).phase, 'failed')
  assert.equal(readSubmitResult({ status: 'unknown' }).phase, 'unknown')
})

test('an unknown outcome only offers a read-only check, never a replay', () => {
  const submitting = receiptReducer(receiptReducer(IDLE_RECEIPT, { type: 'prepare', plan }), { type: 'confirm' })
  let state = receiptReducer(submitting, { type: 'reject', error: new Error('The instance did not answer in time') })
  assert.equal(state.phase, 'unknown')
  assert.equal(receiptCanSubmit(state), false)
  assert.equal(receiptReducer(state, { type: 'submit' }), state, 'the write is not replayed')
  assert.equal(receiptReducer(state, { type: 'confirm' }), state)
  state = receiptReducer(state, { type: 'verify' })
  assert.equal(state.phase, 'verifying')
  assert.equal(receiptReducer(state, { type: 'verified', value: { applied: undefined } }).phase, 'unknown', 'still unknown after an inconclusive check')
  assert.equal(receiptReducer(state, { type: 'verify-failed', error: new Error('x') }).phase, 'unknown')
  const confirmed = receiptReducer(state, { type: 'verified', value: { applied: true } })
  assert.deepEqual([confirmed.phase, confirmed.verified], ['succeeded', true])
  assert.equal(receiptReducer(state, { type: 'verified', value: { applied: false } }).phase, 'failed')
  // A refusal the Host answered is certain: not applied, and it may be prepared again.
  const refused = receiptReducer(submitting, { type: 'reject', error: transportError('denied', 'forbidden') })
  assert.deepEqual([refused.phase, refused.status.kind], ['failed', 'forbidden'])
  assert.equal(receiptReducer(refused, { type: 'prepare', plan }).phase, 'prepared')
  // The instance was down and never got the request: certain, too.
  const notDispatched = receiptReducer(submitting, { type: 'reject', error: transportError('The Zhin instance is not running', 'instance_unavailable') })
  assert.equal(notDispatched.phase, 'failed')
})

test('instance availability: instance failures raise the banner, gateway-owned replies never clear it', () => {
  clearInstanceAvailability()
  let notified = 0
  const stop = subscribeInstanceAvailability(() => { notified += 1 })
  try {
    assert.equal(isGatewayOwnedRequest('gateway.instance.status'), true)
    assert.equal(isGatewayOwnedRequest('iam.users.list'), true)
    assert.equal(isGatewayOwnedRequest('endpoint.list'), false)
    assert.equal(isGatewayOwnedRequest('chat-roles.list'), false)

    reportRequestFailure('endpoint.list', new Error('boom'), 1000)
    assert.equal(getInstanceAvailability(), null, 'other failures do not raise the banner')
    reportRequestFailure('gateway.instance.status', transportError('The Zhin instance is not running', 'instance_unavailable'), 1000)
    assert.equal(getInstanceAvailability(), null, 'a gateway-owned request says nothing about the instance')

    reportRequestFailure('endpoint.list', transportError('The Zhin instance is not running', 'instance_unavailable', { retryAfter: 4 }), 1000)
    const state = getInstanceAvailability()
    assert.deepEqual([state.instance, state.retryAfterSeconds, state.retryAt, state.since], ['unavailable', 4, 5000, 1000])
    assert.equal(secondsUntilRetry(state, 2000), 3)
    assert.equal(secondsUntilRetry(state, 9000), 0)
    assert.equal(reportRequestSuccess('iam.users.list'), false)
    assert.ok(getInstanceAvailability(), 'access control keeps working while the instance is down')

    rearmInstanceRetry(6000)
    assert.deepEqual([getInstanceAvailability().retryAfterSeconds, getInstanceAvailability().since], [8, 1000], 'a failed probe doubles the wait')
    assert.equal(nextRetrySeconds({ retryAfterSeconds: 40 }), 60)

    assert.equal(reportRequestSuccess('feature.list'), true)
    assert.equal(getInstanceAvailability(), null, 'any instance answer clears the banner')
    assert.ok(notified >= 3)
  } finally { stop(); clearInstanceAvailability() }
})

test('raw 502 / 503 / 504 replies with an instance code (apiFetch) raise the banner with their Retry-After', () => {
  clearInstanceAvailability()
  try {
    assert.equal(reportHttpReply({ status: 503, body: { code: 'database_busy' }, retryAfter: '2' }), false)
    assert.equal(reportHttpReply({ status: 500, body: { code: 'instance_error' } }), false)
    assert.equal(reportHttpReply({ status: 503, body: { success: false, code: 'instance_unavailable', requestOutcome: 'not-dispatched', error: 'The Zhin instance is not running' }, retryAfter: '9' }, 0), true)
    assert.deepEqual([getInstanceAvailability().instance, getInstanceAvailability().retryAfterSeconds], ['unavailable', 9])
    reportHttpReply({ status: 504, body: { code: 'instance_timeout' }, retryAfter: null }, 0)
    assert.deepEqual([getInstanceAvailability().instance, getInstanceAvailability().retryAfterSeconds, getInstanceAvailability().failures], ['timeout', DEFAULT_INSTANCE_RETRY_SECONDS, 2])
  } finally { clearInstanceAvailability() }
})
