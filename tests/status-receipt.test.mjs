import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  DEFAULT_INSTANCE_RETRY_SECONDS, STATUS_COPY, STATUS_KINDS, outcomeUnknown, serverCodeOf, statusFromError, statusTone,
} from '../console-ui/src/components/status-state-model.mjs'
import {
  CONFIRM_GUARD_MS, IDLE_RECEIPT, RECEIPT_COPY, readSubmitResult, receiptBlocksActions, receiptCanSubmit, receiptConfirmGuarded, receiptReducer,
} from '../console-ui/src/components/action-receipt-model.mjs'
import { createReceiptStore, sharedReceipts } from '../console-ui/src/components/action-receipt-store.mjs'
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
  state = receiptReducer(state, { type: 'confirm', now: 1000 })
  assert.equal(state.phase, 'confirming')
  assert.equal(receiptReducer(state, { type: 'cancel' }).phase, 'idle')
  state = receiptReducer(state, { type: 'submit', now: 1000 + CONFIRM_GUARD_MS })
  assert.equal(state.phase, 'submitting')
  assert.equal(state.confirmingAt, undefined)
})

test('a double click or a repeated Enter on 确认 cannot run through 确认执行', () => {
  const confirming = receiptReducer(receiptReducer(IDLE_RECEIPT, { type: 'prepare', plan: { ...plan, danger: true } }), { type: 'confirm', now: 1000 })
  assert.equal(confirming.confirmingAt, 1000)
  assert.equal(receiptConfirmGuarded(confirming, 1100), true)
  // The second click of a double click (or the auto-repeat of a held Enter) arrives right away.
  for (const at of [1000, 1050, 1000 + CONFIRM_GUARD_MS - 1]) assert.equal(receiptReducer(confirming, { type: 'submit', now: at }), confirming, `ignored at +${at - 1000}ms`)
  assert.equal(receiptConfirmGuarded(confirming, 1000 + CONFIRM_GUARD_MS), false)
  assert.equal(receiptReducer(confirming, { type: 'submit', now: 1000 + CONFIRM_GUARD_MS }).phase, 'submitting')

  // The component puts 取消 first (and focuses it) in the second step, with 确认执行 in 取消's old place.
  const source = readFileSync(new URL('../console-ui/src/components/ActionReceipt.tsx', import.meta.url), 'utf8')
  const step = source.slice(source.indexOf("state.phase === 'confirming' ? <>"), source.lastIndexOf("state.phase === 'unknown' ? ("))
  assert.ok(step.indexOf('data-receipt-cancel') > 0 && step.indexOf('data-receipt-cancel') < step.indexOf('data-receipt-execute'), '取消 comes before 确认执行')
  const prepared = source.slice(source.indexOf("state.phase === 'prepared' ? <>"), source.indexOf("state.phase === 'confirming' ? <>"))
  assert.ok(prepared.indexOf('key="confirm"') < prepared.indexOf('key="cancel"'), '确认 sits where 取消 will not be')
  assert.match(source, /querySelector<HTMLElement>\('\.console-receipt-actions \[data-receipt-cancel\]'\)/, 'entering the step focuses 取消')
  // The hook only sends what the reducer accepted, so a guarded confirm sends nothing.
  assert.match(source, /if \(next\.phase === 'submitting' && next\.plan\) run\(next\.plan\)/)
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

test('reads re-run once when the instance comes back, not on every success', async () => {
  const availability = await import('../console-ui/src/utils/instance-availability.mjs')
  availability.clearInstanceAvailability()
  let calls = 0
  const off = availability.onInstanceRecovered(() => { calls += 1 })
  availability.reportRequestSuccess('endpoint.list')
  assert.equal(calls, 0, 'no outage, nothing to recover from')
  availability.reportInstanceReading({ kind: 'instance-unavailable', instance: 'unavailable', retryAfterSeconds: 5 })
  availability.reportRequestSuccess('gateway.instance.status')
  assert.equal(calls, 0, 'a gateway-owned answer says nothing about the instance')
  availability.reportRequestSuccess('endpoint.list')
  assert.equal(calls, 1)
  availability.reportInstanceReading({ kind: 'instance-unavailable', instance: 'unavailable', retryAfterSeconds: 5 })
  availability.clearInstanceAvailability()
  assert.equal(calls, 2)
  off()
  const hook = readFileSync(new URL('../console-ui/src/hooks/use-console-read.ts', import.meta.url), 'utf8')
  assert.match(hook, /useInstanceRecovery\(/)
})

test('结果未知 cannot be prepared over, cancelled or closed; only a check leaves it, then 放弃并重新开始', () => {
  const submitting = receiptReducer(receiptReducer(IDLE_RECEIPT, { type: 'prepare', plan }), { type: 'confirm' })
  const unknown = receiptReducer(submitting, { type: 'reject', error: new Error('The instance did not answer in time') })
  assert.equal(unknown.phase, 'unknown')
  for (const type of ['prepare', 'reset', 'cancel', 'confirm', 'submit']) {
    assert.equal(receiptReducer(unknown, { type, plan: { title: 'again' } }), unknown, `${type} is ignored`)
  }
  assert.equal(receiptBlocksActions(unknown), true, 'the page keeps its write buttons closed')
  const notApplied = receiptReducer(receiptReducer(unknown, { type: 'verify' }), { type: 'verified', value: { applied: false } })
  assert.deepEqual([notApplied.phase, notApplied.verified], ['failed', true])
  assert.equal(receiptBlocksActions(notApplied), false)
  assert.equal(receiptReducer(notApplied, { type: 'reset' }).phase, 'idle', '放弃并重新开始')
  const source = readFileSync(new URL('../console-ui/src/components/ActionReceipt.tsx', import.meta.url), 'utf8')
  assert.match(source, /state\.phase !== 'unknown' \? \(\s*<Button variant="ghost" size="icon" className="console-receipt-close"/, 'no 关闭 while unknown')
  assert.match(source, /state\.phase === 'failed' && state\.verified \? \(\s*<Button[^>]*onClick=\{reset\}><RotateCcw \/>\{i18n\.t\('放弃并重新开始'\)\}/)
})

test('one busy rule for every write button: a waiting plan, a request in flight and an unknown outcome block', () => {
  const blocking = { prepared: true, confirming: true, submitting: true, verifying: true, unknown: true, idle: false, succeeded: false, partial: false, failed: false }
  for (const [phase, blocked] of Object.entries(blocking)) assert.equal(receiptBlocksActions({ phase }), blocked, phase)
  const pages = [
    'console-ui/src/pages/features/feature-level-panel.tsx', 'console-ui/src/pages/features/use-global-plugin-switch.ts',
    'console-ui/src/pages/scope/login-tasks.tsx', 'console-ui/src/pages/scope/login-flow-card.tsx', 'console-ui/src/pages/ops/instance.tsx', 'console-ui/src/pages/PackageAction.tsx',
    'console-ui/src/scope/ChatRolesPanel.tsx', 'console-ui/src/pages/access/tokens.tsx', 'console-ui/src/pages/access/users.tsx', 'console-ui/src/pages/account/index.tsx',
  ]
  for (const path of pages) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.match(source, /receiptBlocksActions\(receipt\.state\)/, path)
    assert.doesNotMatch(source, /receipt\.state\.phase !== 'idle' &&/, `${path}: no hand-written busy rule`)
  }
  // The marketplace keeps its install button hidden until the receipt is idle, and may still close
  // the dialog while nothing is in flight (the unknown receipt stays and shows in the next one).
  const market = readFileSync(new URL('../console-ui/src/pages/marketplace.tsx', import.meta.url), 'utf8')
  assert.match(market, /const actionIdle = receiptPhase === 'idle'/)
  assert.match(market, /if \(!open && packageAction\.inFlight\) return/)
  const action = readFileSync(new URL('../console-ui/src/pages/PackageAction.tsx', import.meta.url), 'utf8')
  assert.match(action, /if \(planning \|\| transaction\.running \|\| receiptBlocksActions\(receipt\.state\)\) return/, 'no new plan over an unknown outcome')
})

test('a receipt with a persist key outlives its tab: in flight and unknown outcomes come back after remounting', async () => {
  const store = createReceiptStore()
  const key = 'feature:adapter:qq:ai'
  let notified = 0
  const off = store.subscribe(key, () => { notified += 1 })
  const payload = { body: { type: 'feature.set-enabled' }, change: { kind: 'enabled', enabled: false } }
  store.dispatch(key, { type: 'prepare', plan: { ...plan, payload } })
  store.dispatch(key, { type: 'confirm', now: 1 })
  off() // the tab unmounts mid-request
  // The request settles into the store although nobody listens.
  store.dispatch(key, { type: 'reject', error: Object.assign(new Error('REST request failed'), { code: 'MESSAGE_ERROR', originalError: Object.assign(new Error('timeout'), { name: 'TimeoutError' }) }) })
  const restored = store.get(key)
  assert.equal(restored.phase, 'unknown', 'the remounted tab shows 结果未知, not an idle form')
  assert.deepEqual(restored.plan.payload, payload, 'what to check rides on the plan')
  assert.equal(receiptBlocksActions(restored), true)
  assert.ok(notified >= 2)
  store.dispatch(key, { type: 'verify' })
  store.dispatch(key, { type: 'verified', value: { applied: true } })
  store.dispatch(key, { type: 'reset' })
  assert.deepEqual(store.keys(), [], 'an idle receipt is not kept')
  assert.equal(store.get('other').phase, 'idle')
  assert.ok(sharedReceipts.get(key))

  const hook = readFileSync(new URL('../console-ui/src/components/ActionReceipt.tsx', import.meta.url), 'utf8')
  assert.match(hook, /const store = persistKey \? sharedReceipts : local\.current/)
  for (const [path, pattern] of [
    ['console-ui/src/pages/features/feature-level-panel.tsx', /persistKey: `feature:\$\{level\}:\$\{levelKey\}:\$\{feature\.plugin\}`/],
    // The global plugin switch (list, matrix and feature page share one receipt).
    ['console-ui/src/pages/features/use-global-plugin-switch.ts', /GLOBAL_SWITCH_RECEIPT_KEY = 'feature:global'[\s\S]*persistKey: GLOBAL_SWITCH_RECEIPT_KEY/],
    ['console-ui/src/scope/ChatRolesPanel.tsx', /persistKey: `chat-roles:\$\{key \?\? ''\}`/],
    ['console-ui/src/pages/scope/login-tasks.tsx', /persistKey: `login:\$\{task\.id\}`/],
    ['console-ui/src/pages/scope/login-flow-card.tsx', /persistKey: `login-flow:\$\{adapter\}:\$\{endpointKey\}`/],
  ]) {
    const source = readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.match(source, pattern, path)
    assert.match(source, /plan\.payload/, `${path}: submit / verify read the plan, not component refs`)
    assert.doesNotMatch(source, /pending(?:Action)?\.current/, `${path}: no component ref holds the write`)
  }
})

test('the banner clears when the gateway reports running, or when the instance itself refuses (403)', async () => {
  const { probeInstance, isGatewayOwnedRequest, GATEWAY_OWNED_RPC_TYPES } = await import('../console-ui/src/utils/instance-availability.mjs')
  const calls = []
  const answer = replies => async request => { calls.push(request.type); const reply = replies[request.type]; if (reply instanceof Error) throw reply; return reply }
  assert.equal(await probeInstance(answer({ 'gateway.instance.status': { state: 'running' } })), true, 'running: no instance request needed')
  assert.deepEqual(calls, ['gateway.instance.status'])
  assert.equal(await probeInstance(answer({ 'gateway.instance.status': { state: 'crashed' } })), false)
  // No status.view (gateway refuses), and no endpoint.view either: the instance's own 403 is an answer.
  const denied = transportError('没有 endpoint.view 权限', 'forbidden')
  assert.equal(await probeInstance(answer({ 'gateway.instance.status': transportError('denied', 'forbidden'), 'endpoint.list': denied })), true)
  assert.equal(await probeInstance(answer({ 'gateway.instance.status': transportError('denied', 'forbidden'), 'endpoint.list': transportError('The Zhin instance is not running', 'instance_unavailable') })), false)
  assert.equal(await probeInstance(answer({ 'gateway.instance.status': transportError('denied', 'forbidden'), 'endpoint.list': Object.assign(new Error('REST request failed'), { code: 'MESSAGE_ERROR', originalError: new TypeError('Failed to fetch') }) })), false)

  // The gateway-owned set comes from the protocol mirror: onboarding.update included.
  for (const type of ['onboarding.update', 'iam.bindings.set', 'gateway.plugins.declare', 'gateway.instance.status', 'gateway.anything-new', 'terminal.open']) assert.equal(isGatewayOwnedRequest(type), true, type)
  for (const type of ['endpoint.list', 'chat-roles.list', 'feature.get', 'auth.login', 'console.x']) assert.equal(isGatewayOwnedRequest(type), false, type)
  assert.ok(GATEWAY_OWNED_RPC_TYPES.includes('onboarding.update'))
  clearInstanceAvailability()
  reportRequestFailure('feature.list', transportError('The Zhin instance is not running', 'instance_unavailable'))
  assert.equal(reportRequestSuccess('onboarding.update'), false, 'the gateway answering onboarding says nothing about the instance')
  assert.ok(getInstanceAvailability())
  clearInstanceAvailability()

  const banner = readFileSync(new URL('../console-ui/src/components/InstanceUnavailableBanner.tsx', import.meta.url), 'utf8')
  assert.match(banner, /probeInstance\(requestConsole\)/)
  // Hidden tab: no countdown, no automatic probe; shown again: probe at once.
  assert.match(banner, /document\.addEventListener\('visibilitychange', listener\)/)
  assert.match(banner, /if \(!state \|\| !visible\) return/)
  assert.match(banner, /if \(visible && state && remaining === 0 && !probingRef\.current\) probe\(\)/)
  assert.match(banner, /const shown = visible && !wasVisible\.current[\s\S]*if \(shown && getInstanceAvailability\(\)\) probe\(\)/)
})
