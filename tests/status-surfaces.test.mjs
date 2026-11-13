import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  APPLY_BASIS_COPY, APPLY_OUTCOME_COPY, IDLE_RESTART, MASKED_VALUE, RESTART_TIMEOUT_MS, applyOutcomeCopy, applyOutcomeTone,
  APPLY_NOTE_COPY, canonicalJson, outcomeFromAccessWrite, outcomeFromChatRoleWrite, outcomeFromScheduleWrite, recordReadBack, runReadBack, outcomeFromConfigSave, outcomeFromEnvSave, outcomeFromFeatureWrite, outcomeFromPluginSwitch, readBackMismatch,
  restartElapsedSeconds, restartInProgress, restartObservedBack, restartReducer, schemaSecretAt,
} from '../console-ui/src/components/apply-outcome-model.mjs'
import { createRestartTracker } from '../console-ui/src/components/restart-tracker.mjs'
import { RECEIPT_COPY, readSubmitResult, receiptBlocksActions, receiptReducer, receiptSettled } from '../console-ui/src/components/action-receipt-model.mjs'
import { SLOW_LOADING_COPY, SLOW_LOADING_MS, STATUS_COPY, loadingIsSlow, loadingSeconds, statusTone } from '../console-ui/src/components/status-state-model.mjs'
import {
  CONNECTING_GRACE_MS, EVENT_STREAM_REASON_COPY, classifyEventStreamReply, clearEventStreamFailure, connectionIndicatorView,
  getEventStreamFailure, isEventStreamUrl, reportEventStreamReply,
} from '../console-ui/src/utils/event-stream-status.mjs'
import {
  CLOCK_SKEW_LIMIT_MS, SELF_CHECK_IDS, checkAuthReply, checkClockSkew, checkEventStreamReply, checkHealthReply, checkMixedContent,
  checkWebSocketOutcome, runSelfChecks, runWebSocketCheck, selfCheckCopy, selfCheckDetail, selfCheckSocketUrl, selfCheckSummary,
} from '../console-ui/src/pages/ops/self-check-model.mjs'
import { envReadBackMismatch } from '../console-ui/src/pages/env-editor-model.mjs'
import { bindingKeys, roleReadBackView, userReadBackView } from '../console-ui/src/pages/access/access-model.mjs'
import { chatRoleReadBack } from '../console-ui/src/scope/chat-roles-model.mjs'
import { featureReadBackMismatch } from '../console-ui/src/pages/features/feature-scope-model.mjs'
import { ambientSaveOutcome, ambientRestartOutcome } from '../console-ui/src/pages/ambient-engagement-model.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

const application = (groups, revision = 'r2') => ({
  operationId: 'op1', sourceRevision: revision, saved: true, generation: 3, applicationRevision: 1,
  groups: groups.map(([id, status, reasonCode]) => ({ id, paths: [[id]], effect: status === 'restart-pending' ? 'restart-process' : 'in-place', status, dependsOn: [], ...(reasonCode ? { reasonCode } : {}) })),
})

// ---------------------------------------------------------------- outcomes

test('a config save outcome is read from the application groups the Host returned', () => {
  assert.deepEqual(outcomeFromConfigSave({ revision: 'r2', application: application([['ai', 'applied']]) }), { kind: 'applied', basis: 'application' })
  const restart = outcomeFromConfigSave({ revision: 'r2', restartRequired: true, application: application([['http', 'restart-pending']]) })
  assert.equal(restart.kind, 'restart'); assert.equal(restart.basis, 'application'); assert.equal(restart.partial, undefined)
  assert.deepEqual(restart.groups, [{ id: 'http', status: 'restart-pending' }])
  const partial = outcomeFromConfigSave({ revision: 'r2', application: application([['ai', 'applied'], ['http', 'restart-pending']]) })
  assert.deepEqual([partial.kind, partial.partial], ['restart', true], 'part applied, the rest waits for a restart')
  const failed = outcomeFromConfigSave({ revision: 'r2', application: application([['ai', 'applied'], ['qq', 'failed', 'endpoint:login']]) })
  assert.equal(failed.kind, 'failed'); assert.equal(failed.unconfirmed, undefined)
  assert.deepEqual(failed.groups, [{ id: 'qq', status: 'failed', reasonCode: 'endpoint:login' }])
  assert.equal(outcomeFromConfigSave({ revision: 'r2', application: application([['x', 'blocked']]) }).kind, 'failed')
  assert.equal(outcomeFromConfigSave({ revision: 'r2', applicationError: 'invalid' }).kind, 'failed')
})

test('a config save the Host could not confirm is never reported as applied', () => {
  for (const result of [
    { revision: 'r2', applicationError: 'unconfirmed' },
    { revision: 'r2', application: application([['ai', 'unknown']]) },
    { revision: 'r2', application: application([['ai', 'applied']], 'r1') },
    { revision: 'r2', applicationError: 'superseded' },
  ]) {
    const value = outcomeFromConfigSave(result)
    assert.equal(value.kind, 'failed', JSON.stringify(result))
    assert.equal(value.unconfirmed, true)
    assert.ok(value.reason)
  }
  // A Host without the apply protocol: only its restart flag speaks; without it nothing is claimed.
  assert.deepEqual(outcomeFromConfigSave({ success: true, revision: 'r2', restartRequired: true }), { kind: 'restart', basis: 'restart-flag' })
  const legacy = outcomeFromConfigSave({ success: true, revision: 'r2', restartRequired: false })
  assert.deepEqual([legacy.kind, legacy.unconfirmed], ['failed', true])
})

test('feature overrides apply on the next message (features.md 生效方式); the gateway switch is applied by its restart', () => {
  for (const level of ['adapter', 'endpoint', 'conversation']) assert.deepEqual(outcomeFromFeatureWrite({ status: 'saved' }, level), { kind: 'next-message', basis: 'apply-table' })
  assert.deepEqual(outcomeFromFeatureWrite({ status: 'saved', restartRequired: true }, 'adapter'), { kind: 'restart', basis: 'restart-flag' })
  assert.deepEqual(outcomeFromFeatureWrite({ status: 'unchanged' }, 'endpoint'), { kind: 'applied', basis: 'unchanged' })
  for (const status of ['conflict', 'invalid', 'locked']) assert.equal(outcomeFromFeatureWrite({ status }, 'adapter'), null)
  assert.equal(outcomeFromFeatureWrite({ status: 'saved' }, 'global'), null, 'the global level is the gateway transaction')
  assert.deepEqual(outcomeFromPluginSwitch({ status: 'saved', restartRequired: true }), { kind: 'applied', basis: 'gateway-transaction' })
  assert.deepEqual(outcomeFromPluginSwitch({ status: 'unchanged' }), { kind: 'applied', basis: 'unchanged' })
  assert.deepEqual([outcomeFromPluginSwitch({ status: 'saved', restartRequired: false }).kind, outcomeFromPluginSwitch({ status: 'saved', restartRequired: false }).unconfirmed], ['failed', true])
  assert.deepEqual(outcomeFromEnvSave(), { kind: 'restart', basis: 'env-file' })
})

test('every outcome, basis and reason has copy, English and a tone', () => {
  for (const copy of Object.values(APPLY_OUTCOME_COPY)) for (const text of [copy.title, copy.description]) assert.ok(Object.hasOwn(englishMessages, text), text)
  for (const text of Object.values(APPLY_BASIS_COPY)) assert.ok(Object.hasOwn(englishMessages, text), text)
  const reasons = [
    outcomeFromConfigSave({ revision: 'r2', applicationError: 'unconfirmed' }), outcomeFromConfigSave({ revision: 'r2', applicationError: 'invalid' }),
    outcomeFromConfigSave({ revision: 'r2', applicationError: 'superseded' }), outcomeFromConfigSave({ revision: 'r2', restartRequired: false }),
    outcomeFromConfigSave({ revision: 'r2', application: application([['x', 'blocked']]) }), outcomeFromConfigSave({ revision: 'r2', application: application([['x', 'failed']]) }),
    outcomeFromPluginSwitch({ status: 'saved' }),
  ]
  for (const value of reasons) assert.ok(Object.hasOwn(englishMessages, value.reason), value.reason)
  assert.equal(applyOutcomeCopy({ kind: 'failed', unconfirmed: true }), APPLY_OUTCOME_COPY.unconfirmed)
  assert.deepEqual(['applied', 'next-message', 'restart', 'failed'].map(kind => applyOutcomeTone({ kind })), ['success', 'success', 'warning', 'destructive'])
})

// ---------------------------------------------------------------- read-back

test('a read-back is compared by value: key order and dropped undefined members do not count', () => {
  assert.equal(canonicalJson({ b: 1, a: { d: undefined, c: [1] } }), '{"a":{"c":[1]},"b":1}')
  assert.equal(readBackMismatch({ a: 1, b: { c: 2, d: undefined } }, { b: { c: 2 }, a: 1 }), null)
  assert.deepEqual(readBackMismatch({ a: 1, b: { c: 2 } }, { a: 1, b: { c: 3 } }), { path: 'b.c', submitted: '2', readBack: '3' })
  assert.deepEqual(readBackMismatch({ list: [1, 2] }, { list: [1] }), { path: 'list.1', submitted: '2', readBack: null })
  assert.deepEqual(readBackMismatch({ name: 'bot' }, {}), { path: 'name', submitted: '"bot"', readBack: null })
})

test('a mismatch never shows a secret: secret-looking keys and schema secrets keep only their length', () => {
  const byName = readBackMismatch({ endpoint: { token: 'abcdef' } }, { endpoint: { token: 'xyz' } })
  assert.deepEqual(byName, { path: 'endpoint.token', submitted: `${MASKED_VALUE} (6)`, readBack: `${MASKED_VALUE} (3)`, masked: true })
  const schema = { type: 'object', object: { account: { type: 'object', object: { cookie: { type: 'string' }, appSecretValue: { type: 'string', secret: true } } } } }
  assert.equal(schemaSecretAt(schema, ['account', 'appSecretValue']), true)
  assert.equal(schemaSecretAt(schema, ['account', 'name']), false)
  assert.equal(schemaSecretAt({ type: 'object', secret: true }, ['anything']), true, 'a secret object hides its members')
  const bySchema = readBackMismatch({ account: { appSecretValue: 'aa' } }, { account: { appSecretValue: 'bb' } }, { isSecret: path => schemaSecretAt(schema, path) })
  assert.equal(bySchema.masked, true)
  assert.doesNotMatch(JSON.stringify(bySchema), /aa|bb/)
})

test('env read-back ignores formatting, masks secrets and reports a changed value', () => {
  assert.equal(envReadBackMismatch('A=1\nB=2\n', 'A=1\n\n# note\nB="2"\n'), null)
  assert.deepEqual(envReadBackMismatch('A=1\nB=2\n', 'A=1\nB=3\n'), { path: 'B', submitted: '"2"', readBack: '"3"' })
  const secret = envReadBackMismatch('BOT_TOKEN=abcd\n', 'BOT_TOKEN=efgh\n')
  assert.equal(secret.masked, true)
  assert.doesNotMatch(JSON.stringify(secret), /abcd|efgh/)
  assert.deepEqual(envReadBackMismatch('A=1\n', ''), { path: 'A', submitted: '"1"', readBack: null })
})

test('feature read-back reports what feature.get shows instead of the submitted change', () => {
  const detail = { enabled: true, values: { greeting: 'hi' } }
  assert.equal(featureReadBackMismatch(detail, { kind: 'set', field: 'greeting', value: 'hi' }), null)
  assert.deepEqual(featureReadBackMismatch(detail, { kind: 'set', field: 'greeting', value: 'hello' }), { path: 'greeting', submitted: '"hello"', readBack: '"hi"' })
  assert.deepEqual(featureReadBackMismatch(detail, { kind: 'enabled', enabled: false }), { path: 'enabled', submitted: 'false', readBack: 'true' })
  assert.deepEqual(featureReadBackMismatch(detail, { kind: 'remove', field: 'greeting' }), { path: 'greeting', submitted: null, readBack: '"hi"' })
  // A secret override comes back redacted: its presence is all that can be confirmed.
  assert.equal(featureReadBackMismatch({ values: { key: '[redacted]' } }, { kind: 'set', field: 'key', value: 'secret-value' }), null)
})

test('ambient settings compare what the save wrote with what the re-read holds', () => {
  const submitted = { behavior: 'join', groupScope: 'some', groups: ['qq:1'], maxPerHour: 3 }
  const saved = { status: 'saved', revision: 'r2', application: application([['ai', 'applied']]) }
  const same = ambientSaveOutcome(saved, submitted, { settings: { ...submitted } })
  assert.deepEqual([same.outcome.kind, same.mismatch, same.unverified], ['applied', null, false])
  const differs = ambientSaveOutcome(saved, submitted, { settings: { ...submitted, maxPerHour: 6 } })
  assert.deepEqual(differs.mismatch, { path: 'ai.trigger.ambient.maxPerHour', submitted: '3', readBack: '6' })
  // Off clears the list: the draft's remembered groups are not part of what was written.
  assert.equal(ambientSaveOutcome(saved, { ...submitted, behavior: 'off' }, { settings: { behavior: 'off', groupScope: 'all', groups: [], maxPerHour: 6 } }).mismatch, null)
  assert.equal(ambientSaveOutcome(saved, submitted, null).unverified, true)
  assert.equal(ambientRestartOutcome(null), null)
  assert.equal(ambientRestartOutcome({ revision: 'r2', application: { application: application([['ai', 'applied']]) } }).kind, 'applied')
})

// ---------------------------------------------------------------- receipts

test('a receipt carries the apply outcome, and a read-back mismatch is its own non-success phase', () => {
  const apply = { kind: 'next-message', basis: 'apply-table' }
  assert.deepEqual(readSubmitResult({ status: 'saved', apply }), { phase: 'succeeded', items: [], apply })
  const mismatch = { path: 'greeting', submitted: '"a"', readBack: '"b"' }
  const state = readSubmitResult({ status: 'saved', apply, mismatch })
  assert.equal(state.phase, 'mismatch'); assert.deepEqual(state.mismatch, mismatch); assert.equal(state.apply, undefined, 'no outcome next to a mismatch')
  assert.equal(receiptSettled(state), true)
  assert.equal(receiptBlocksActions(state), false, 'the user may edit and save again')
  assert.ok(Object.hasOwn(englishMessages, RECEIPT_COPY.mismatch))
  // A verified unknown outcome keeps the outcome the check reported.
  let receipt = receiptReducer(undefined, { type: 'prepare', plan: { title: 'x' } })
  receipt = receiptReducer(receipt, { type: 'confirm', now: 1 })
  receipt = receiptReducer(receipt, { type: 'reject', error: Object.assign(new Error('timeout'), { details: { transport: 'timeout' } }) })
  assert.equal(receipt.phase, 'unknown')
  receipt = receiptReducer(receiptReducer(receipt, { type: 'verify' }), { type: 'verified', value: { applied: true, apply } })
  assert.deepEqual([receipt.phase, receipt.verified, receipt.apply], ['succeeded', true, apply])
})

// ---------------------------------------------------------------- restart

test('restart progress: sent → waiting → back only once the run changed, or after it was seen down', () => {
  let state = restartReducer(IDLE_RESTART, { type: 'start', now: 1_000 })
  assert.equal(state.phase, 'requesting'); assert.equal(restartInProgress(state), true)
  assert.equal(restartReducer(state, { type: 'start', now: 2_000 }), state, 'no second restart')
  state = restartReducer(state, { type: 'sent', before: { state: 'running', generation: 1 } })
  assert.equal(state.phase, 'waiting')
  state = restartReducer(state, { type: 'observe', status: { state: 'running', generation: 1 }, probeOk: true, connected: true, now: 3_000 })
  assert.equal(state.phase, 'waiting', 'the same run answering is the old instance')
  state = restartReducer(state, { type: 'observe', status: { state: 'starting', generation: 2 }, probeOk: false, now: 4_000 })
  assert.deepEqual([state.phase, state.sawDown], ['waiting', true])
  state = restartReducer(state, { type: 'observe', status: { state: 'running', generation: 2 }, probeOk: true, now: 9_500 })
  assert.equal(state.phase, 'back')
  assert.equal(restartElapsedSeconds(state, 99_999), 8, 'the elapsed time freezes when it settled')
  assert.equal(restartReducer(state, { type: 'dismiss' }).phase, 'idle')

  // Without run facts: seen down (stream dropped), then answering again.
  let bare = restartReducer(restartReducer(IDLE_RESTART, { type: 'start', now: 0 }), { type: 'sent' })
  bare = restartReducer(bare, { type: 'observe', probeOk: true, connected: true, now: 1_000 })
  assert.equal(bare.phase, 'waiting', 'answering without having been down proves nothing')
  bare = restartReducer(bare, { type: 'observe', connected: false, now: 2_000 })
  bare = restartReducer(bare, { type: 'observe', probeOk: true, connected: true, now: 3_000 })
  assert.equal(bare.phase, 'back')
  assert.equal(restartObservedBack({ sawDown: true }, { probeOk: true, status: { state: 'starting' } }), false)
})

test('restart progress times out with what to check, and may keep waiting; a refused restart is failed', () => {
  let state = restartReducer(restartReducer(IDLE_RESTART, { type: 'start', now: 0 }), { type: 'sent', before: { state: 'running', pid: 5 } })
  state = restartReducer(state, { type: 'tick', now: RESTART_TIMEOUT_MS - 1 })
  assert.equal(state.phase, 'waiting')
  state = restartReducer(state, { type: 'tick', now: RESTART_TIMEOUT_MS })
  assert.equal(state.phase, 'timeout'); assert.deepEqual(state.before, { state: 'running', pid: 5 })
  assert.equal(restartReducer(state, { type: 'keep-waiting', now: 100_000 }).phase, 'waiting')
  assert.equal(restartReducer(state, { type: 'keep-waiting', now: 100_000 }).before.pid, 5)
  const refused = restartReducer(restartReducer(IDLE_RESTART, { type: 'start', now: 0 }), { type: 'refused', error: new Error('没有 ops.restart 权限') })
  assert.deepEqual([refused.phase, refused.reason], ['failed', '没有 ops.restart 权限'])
  assert.equal(restartReducer(restartReducer(IDLE_RESTART, { type: 'start', now: 0 }), { type: 'dismiss' }).phase, 'requesting', 'a running restart cannot be dismissed')
})

test('the restart tracker reads the run facts, sends once, polls and settles; a lost answer still waits', async () => {
  const timers = []
  let now = 0
  let status = { state: 'running', generation: 1 }
  let probe = true
  const sent = []
  const deps = {
    request: async () => { sent.push('system:restart') },
    readStatus: async () => status,
    probe: async () => probe,
    isConnected: () => true,
    mayHaveRun: error => error.message === 'timeout',
    now: () => now,
    setTimer: fn => { timers.push(fn); return timers.length },
    clearTimer() {},
  }
  const tracker = createRestartTracker(deps)
  const seen = []
  tracker.subscribe(() => seen.push(tracker.get().phase))
  await tracker.start()
  await tracker.start()
  assert.deepEqual(sent, ['system:restart'], 'one restart')
  assert.equal(tracker.get().phase, 'waiting')
  status = { state: 'running', generation: 2 }; now = 4_000
  timers.at(-1)()
  for (let i = 0; i < 10; i++) await Promise.resolve()
  assert.equal(tracker.get().phase, 'back')
  assert.deepEqual(seen, ['requesting', 'waiting', 'back'])

  const lost = createRestartTracker({ ...deps, request: async () => { throw new Error('timeout') } })
  await lost.start()
  assert.equal(lost.get().phase, 'waiting', 'no trustworthy answer: the restart may have run')
  const refused = createRestartTracker({ ...deps, request: async () => { throw new Error('forbidden') } })
  await refused.start()
  assert.deepEqual([refused.get().phase, refused.get().reason], ['failed', 'forbidden'])
  probe = false
})

// ---------------------------------------------------------------- slow loading

test('a load is slow after 8 seconds and says why it may be stuck', () => {
  assert.equal(SLOW_LOADING_MS, 8_000)
  assert.equal(loadingIsSlow(1_000, 8_999), false)
  assert.equal(loadingIsSlow(1_000, 9_000), true)
  assert.equal(loadingIsSlow(undefined, 9_000), false)
  assert.equal(loadingSeconds(1_000, 12_500), 11)
  assert.equal(statusTone('loading'), 'muted')
  for (const text of [STATUS_COPY.loading.title, STATUS_COPY.loading.description, SLOW_LOADING_COPY.title, SLOW_LOADING_COPY.description, ...SLOW_LOADING_COPY.causes]) {
    assert.ok(Object.hasOwn(englishMessages, text), text)
  }
  assert.equal(SLOW_LOADING_COPY.causes.length, 3, 'gateway, WebSocket / event stream, reverse-proxy path')
  const status = readFileSync(new URL('../console-ui/src/components/StatusState.tsx', import.meta.url), 'utf8')
  assert.match(status, /CONSOLE_PATHS\.opsSelfCheck/, '仍在加载… links to the self-check')
})

// ---------------------------------------------------------------- connection indicator

test('the connection indicator stays hidden while connected and during a short first connect', () => {
  assert.equal(connectionIndicatorView({ state: 'connected' }), null)
  assert.equal(connectionIndicatorView({ state: 'connecting', since: 0, now: CONNECTING_GRACE_MS - 1 }), null)
  assert.deepEqual(connectionIndicatorView({ state: 'connecting', since: 0, now: CONNECTING_GRACE_MS }), { kind: 'connecting' })
  assert.deepEqual(connectionIndicatorView({ state: 'connecting', ever: true, since: 0, now: 1 }), { kind: 'reconnecting' }, 'between reconnect attempts')
  assert.deepEqual(connectionIndicatorView({ state: 'reconnecting', failure: { reason: 'gateway', status: 502, at: 1 } }), { kind: 'reconnecting', reason: { code: 'gateway', status: 502 } })
  assert.deepEqual(connectionIndicatorView({ state: 'error', failure: { reason: 'network', at: 1 } }), { kind: 'disconnected', reason: { code: 'network' } })
})

test('event stream replies are classified into a reason the user can act on', () => {
  assert.equal(isEventStreamUrl('https://h/api/events?runtimeId=1'), true)
  assert.equal(isEventStreamUrl('https://h/zhin/api/events/history?after=2'), true)
  assert.equal(isEventStreamUrl('https://h/api/console/request'), false)
  assert.equal(classifyEventStreamReply({ status: 200, contentType: 'text/event-stream; charset=utf-8' }, '/api/events'), null)
  assert.equal(classifyEventStreamReply({ status: 200, contentType: 'application/json' }, '/api/events/history'), null, 'history is JSON')
  assert.deepEqual(classifyEventStreamReply({ status: 200, contentType: 'text/html' }, '/api/events'), { reason: 'not-event-stream', status: 200 })
  assert.deepEqual(classifyEventStreamReply({ status: 404 }), { reason: 'not-found', status: 404 })
  assert.deepEqual(classifyEventStreamReply({ status: 401 }), { reason: 'unauthorized', status: 401 })
  assert.deepEqual(classifyEventStreamReply({ status: 503 }), { reason: 'gateway', status: 503 })
  assert.deepEqual(classifyEventStreamReply({ status: 500 }), { reason: 'http', status: 500 })
  assert.deepEqual(classifyEventStreamReply({ error: new TypeError('Failed to fetch') }), { reason: 'network' })
  assert.equal(classifyEventStreamReply({ error: Object.assign(new Error('x'), { name: 'AbortError' }) }), null, 'our own abort is not a failure')
  clearEventStreamFailure()
  reportEventStreamReply({ status: 502 }, '/api/events', 5)
  assert.deepEqual(getEventStreamFailure(), { reason: 'gateway', status: 502, at: 5 })
  reportEventStreamReply({ status: 200, contentType: 'text/event-stream' }, '/api/events')
  assert.equal(getEventStreamFailure(), null, 'a healthy reply clears the reason')
  for (const text of Object.values(EVENT_STREAM_REASON_COPY)) assert.ok(Object.hasOwn(englishMessages, text), text)
  const shell = readFileSync(new URL('../console-ui/src/layouts/dashboard.tsx', import.meta.url), 'utf8')
  assert.match(shell, /<ConnectionIndicator \/>/, 'the top bar shows it')
})

// ---------------------------------------------------------------- self-check

test('self-check: mixed content, health / base path, clock and sign-in readings', () => {
  assert.equal(checkMixedContent('https:', 'http://bot.example:8086').status, 'fail')
  assert.equal(checkMixedContent('https:', 'http://127.0.0.1:8086').status, 'warn', 'browsers allow loopback')
  assert.equal(checkMixedContent('https:', 'https://bot.example').status, 'pass')
  assert.equal(checkMixedContent('http:', 'not a url').status, 'skip')

  const gateway = { status: 200, contentType: 'application/json; charset=utf-8', body: { success: true, status: 'ok', timestamp: '2026-11-13T00:00:00.000Z' } }
  assert.deepEqual(checkHealthReply(gateway).map(check => check.status), ['pass', 'pass'])
  assert.deepEqual(checkHealthReply({ status: 200, contentType: 'text/html', body: undefined }).map(check => [check.id, check.status, check.detail]), [['api', 'pass', 'http-status'], ['base-path', 'fail', 'not-json']])
  assert.deepEqual(checkHealthReply({ status: 404, contentType: 'text/html' }).map(check => check.status), ['pass', 'fail'], 'reachable, but the path lands elsewhere')
  assert.deepEqual(checkHealthReply({ status: 200, contentType: 'application/json', body: { ok: true } })[1].detail, 'not-gateway')
  assert.deepEqual(checkHealthReply({ error: new TypeError('Failed to fetch') }).map(check => check.status), ['fail', 'skip'])
  assert.deepEqual(checkHealthReply({ status: 502 }).map(check => check.status), ['fail', 'skip'])

  const server = Date.parse('2026-11-13T00:00:00.000Z')
  assert.equal(checkClockSkew('2026-11-13T00:00:00.000Z', server - 200, server + 200).status, 'pass')
  const ahead = checkClockSkew('2026-11-13T00:00:00.000Z', server + CLOCK_SKEW_LIMIT_MS + 5_000, server + CLOCK_SKEW_LIMIT_MS + 5_000)
  assert.deepEqual([ahead.status, ahead.detail, ahead.values], ['fail', 'skew-ahead', ['65']])
  assert.equal(checkClockSkew('2026-11-13T00:00:00.000Z', server - 120_000, server - 120_000).detail, 'skew-behind')
  assert.equal(checkClockSkew(undefined, 1, 2).status, 'skip')

  assert.deepEqual([checkAuthReply({ status: 200, body: { success: true, data: { kind: 'user', user: { id: 'u', username: 'alice' } } } }).status, checkAuthReply({ status: 200, body: { data: { kind: 'user', user: { username: 'alice' } } } }).values], ['pass', ['alice']])
  assert.equal(checkAuthReply({ status: 200, body: { data: { kind: 'anonymous' } } }).status, 'fail')
  assert.equal(checkAuthReply({ status: 401 }).detail, 'auth-rejected')
  assert.equal(checkAuthReply({ status: 401 }, false).detail, 'no-credential')
  assert.equal(checkAuthReply({ status: 404 }).status, 'pass', 'older Hosts have no accounts')
})

test('self-check: the event stream and the WebSocket upgrade', () => {
  assert.equal(checkEventStreamReply({ status: 200, contentType: 'text/event-stream', firstChunk: true }).status, 'pass')
  assert.deepEqual([checkEventStreamReply({ status: 200, contentType: 'text/event-stream', firstChunk: false }).status, checkEventStreamReply({ status: 200, contentType: 'text/event-stream', firstChunk: false }).detail], ['warn', 'events-buffered'])
  assert.equal(checkEventStreamReply({ status: 200, contentType: 'text/event-stream', firstChunk: false }, 8, false).detail, 'events-instance-offline')
  assert.equal(checkEventStreamReply({ status: 200, contentType: 'text/html' }).detail, 'events-type')
  assert.equal(checkEventStreamReply({ status: 401 }).status, 'fail')
  // The terminal endpoint answers an invalid ticket after the upgrade (4401): that is the pass.
  assert.equal(checkWebSocketOutcome({ opened: true, code: 4401 }).status, 'pass')
  assert.equal(checkWebSocketOutcome({ opened: false, code: 4401 }).status, 'pass')
  assert.deepEqual([checkWebSocketOutcome({ opened: false, code: 1006 }).status, checkWebSocketOutcome({ opened: false, code: 1006 }).detail], ['fail', 'ws-failed'])
  assert.equal(checkWebSocketOutcome({ timeout: true }).status, 'fail')
  assert.equal(checkWebSocketOutcome({ unavailable: true }).status, 'skip')
  assert.equal(selfCheckSocketUrl('https://bot.example/zhin', 'https://console.zhin.dev/ops/self-check'), 'wss://bot.example/zhin/api/console/terminal?ticket=console-self-check')
  assert.equal(selfCheckSocketUrl('', 'http://127.0.0.1:8086/ops/self-check'), 'ws://127.0.0.1:8086/api/console/terminal?ticket=console-self-check')
})

function fakeResponse(status, contentType, body, chunks = []) {
  const queue = [...chunks]
  return {
    status,
    headers: { get: name => name.toLowerCase() === 'content-type' ? contentType : null },
    json: async () => { if (body === undefined) throw new SyntaxError('not json'); return body },
    body: { getReader: () => ({ read: async () => queue.length ? { done: false, value: queue.shift() } : new Promise(() => {}), cancel: async () => {} }), cancel: async () => {} },
  }
}

class FakeSocket {
  static closeCode = 4401
  constructor(url) { FakeSocket.url = url; queueMicrotask(() => { this.onopen?.(); this.onclose?.({ code: FakeSocket.closeCode }) }) }
  close() {}
}

test('runSelfChecks runs every check against existing routes only and reports each as it finishes', async () => {
  const requests = []
  const fetch = async (url, init) => {
    requests.push(String(url))
    if (String(url).endsWith('/pub/health')) return fakeResponse(200, 'application/json', { success: true, status: 'ok', timestamp: new Date(1_000).toISOString(), instance: { state: 'running', ready: true } })
    if (String(url).endsWith('/api/auth/me')) { assert.equal(init.headers.Authorization, 'Bearer t'); return fakeResponse(200, 'application/json', { success: true, data: { kind: 'user', user: { id: 'u1', username: 'alice' } } }) }
    if (String(url).endsWith('/api/events')) return fakeResponse(200, 'text/event-stream', undefined, [new Uint8Array([58, 10])])
    throw new Error(`unexpected ${url}`)
  }
  const seen = []
  const results = await runSelfChecks({
    fetch, WebSocket: FakeSocket, apiBase: 'https://bot.example/zhin/', pageHref: 'https://console.zhin.dev/ops/self-check', pageProtocol: 'https:',
    token: 't', now: () => 1_000, setTimer: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimer: id => clearTimeout(id),
  }, check => seen.push(check.id))
  assert.deepEqual(results.map(check => check.id), SELF_CHECK_IDS)
  // The WebSocket probe writes a terminal.denied audit entry: it only runs when asked for.
  assert.deepEqual(results.map(check => check.status), ['pass', 'pass', 'pass', 'pass', 'pass', 'pass', 'skip'])
  assert.equal(results.at(-1).detail, 'ws-on-demand')
  assert.equal(FakeSocket.url, undefined, 'no socket was opened')
  assert.deepEqual(requests, ['https://bot.example/zhin/pub/health', 'https://bot.example/zhin/api/auth/me', 'https://bot.example/zhin/api/events'])
  assert.equal(seen.length, SELF_CHECK_IDS.length)
  assert.deepEqual(selfCheckSummary(results), { status: 'pass', failed: 0, warned: 0 }, 'an unrun check is not a failure')
  const deps = { WebSocket: FakeSocket, apiBase: 'https://bot.example/zhin/', pageHref: 'https://console.zhin.dev/ops/self-check', setTimer: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimer: id => clearTimeout(id) }
  assert.deepEqual(await runWebSocketCheck(deps), { id: 'websocket', status: 'pass', detail: 'ws-upgraded', values: ['4401'] })
  assert.equal(FakeSocket.url, 'wss://bot.example/zhin/api/console/terminal?ticket=console-self-check')
  const all = await runSelfChecks({ ...deps, fetch, pageProtocol: 'https:', token: 't', now: () => 1_000, includeWebSocket: true })
  assert.equal(all.at(-1).status, 'pass', 'includeWebSocket runs it in the same pass')

  // An unreachable Host skips what depends on it instead of piling up failures.
  const down = await runSelfChecks({
    fetch: async () => { throw new TypeError('Failed to fetch') }, WebSocket: FakeSocket, apiBase: 'http://10.0.0.2:8086', pageHref: 'http://10.0.0.2:8086/', pageProtocol: 'http:',
    now: () => 0, setTimer: (fn, ms) => setTimeout(fn, Math.min(ms, 5)), clearTimer: id => clearTimeout(id),
  })
  assert.deepEqual(down.map(check => [check.id, check.status]), [['api', 'fail'], ['base-path', 'skip'], ['mixed', 'pass'], ['clock', 'skip'], ['auth', 'skip'], ['events', 'skip'], ['websocket', 'skip']])
  assert.deepEqual(selfCheckSummary(down), { status: 'fail', failed: 1, warned: 0 })
})

test('every self-check title, explanation, fix and detail has English copy', () => {
  const t = (message, values) => translate('en', message, values)
  const zh = (message, values) => translate('zh-CN', message, values)
  for (const id of SELF_CHECK_IDS) {
    const english = selfCheckCopy(id, t)
    const chinese = selfCheckCopy(id, zh)
    for (const key of ['title', 'explain', 'fix']) {
      assert.ok(chinese[key] && Object.hasOwn(englishMessages, chinese[key]), `${id}.${key}`)
      assert.equal(english[key], englishMessages[chinese[key]])
    }
  }
  const details = ['http-status', 'network', 'not-json', 'not-gateway', 'blocked-by-mixed', 'mixed-ok', 'loopback-http', 'skew-ok', 'skew-ahead', 'skew-behind',
    'no-server-time', 'auth-user', 'auth-token', 'auth-bootstrap', 'auth-anonymous', 'auth-legacy', 'auth-rejected', 'no-credential', 'events-ok', 'events-buffered',
    'events-instance-offline', 'events-type', 'ws-upgraded', 'ws-failed', 'ws-timeout', 'ws-unavailable', 'ws-on-demand', 'skipped-unreachable']
  for (const detail of details) {
    const text = selfCheckDetail({ detail, values: ['1', '2'] }, zh)
    assert.ok(text, detail)
    assert.doesNotMatch(selfCheckDetail({ detail, values: ['1', '2'] }, t), /[㐀-鿿]/u, `${detail} reads English`)
  }
  assert.equal(selfCheckDetail({ detail: 'nope' }, t), null)
})

test('the self-check page is a 运维 route every principal may open, linked from the slow state and the indicator', async () => {
  const { CONSOLE_PATHS } = await import('../console-ui/src/console-routes.mjs')
  const { ROUTE_PERMISSIONS, canSeeRoute } = await import('../console-ui/src/navigation-sections.mjs')
  assert.equal(CONSOLE_PATHS.opsSelfCheck, '/ops/self-check')
  assert.deepEqual(ROUTE_PERMISSIONS['/ops/self-check'], [])
  assert.equal(canSeeRoute({ path: '/ops/self-check', meta: { group: '运维' } }, { unrestricted: false, permissions: [] }), true)
  const shell = readFileSync(new URL('../console-ui/src/registerBuiltinShell.tsx', import.meta.url), 'utf8')
  assert.match(shell, /path: P\.opsSelfCheck, name: '连接自检'/u)
  const indicator = readFileSync(new URL('../console-ui/src/components/ConnectionIndicator.tsx', import.meta.url), 'utf8')
  assert.match(indicator, /CONSOLE_PATHS\.opsSelfCheck/)
  // No new Host route or RPC: only the existing public health route, /auth/me, the event stream and the terminal socket.
  const model = readFileSync(new URL('../console-ui/src/pages/ops/self-check-model.mjs', import.meta.url), 'utf8')
  assert.deepEqual([...model.matchAll(/`\$\{base\}(\/[a-z/]+)`/gu)].map(match => match[1]), ['/pub/health', '/api/auth/me', '/api/events'])
})

// ---------------------------------------------------------------- access control, schedules, chat roles

test('access control, schedules and chat roles end in an outcome whose basis names the Host code that makes it true', () => {
  assert.deepEqual(outcomeFromAccessWrite(), { kind: 'applied', basis: 'per-request' })
  assert.deepEqual(outcomeFromAccessWrite({ secret: true }), { kind: 'applied', basis: 'per-request', note: 'secret' })
  assert.deepEqual(outcomeFromScheduleWrite(), { kind: 'applied', basis: 'scheduler' })
  assert.deepEqual(outcomeFromChatRoleWrite(), { kind: 'next-message', basis: 'chat-roles' })
  // Access control and schedules do not touch the instance: their 已生效 says what applied.
  for (const value of [outcomeFromAccessWrite(), outcomeFromScheduleWrite()]) {
    const copy = applyOutcomeCopy(value)
    assert.equal(copy.title, APPLY_OUTCOME_COPY.applied.title)
    assert.notEqual(copy.description, APPLY_OUTCOME_COPY.applied.description)
    assert.ok(Object.hasOwn(englishMessages, copy.description), copy.description)
  }
  assert.match(APPLY_BASIS_COPY['per-request'], /#principal/u)
  assert.match(APPLY_BASIS_COPY.scheduler, /addJob \/ pauseJob \/ resumeJob \/ removeJob/u)
  assert.match(APPLY_BASIS_COPY['chat-roles'], /effectiveRoles/u)
  // .env: the runtime classifies an environment change as restart-pending and keeps the old layers.
  assert.match(APPLY_BASIS_COPY['env-file'], /planRuntimeInputs/u)
  assert.match(APPLY_BASIS_COPY['env-file'], /restart-pending/u)
  assert.match(APPLY_BASIS_COPY['env-file'], /environment-host-consumers/u)
  for (const text of [...Object.values(APPLY_BASIS_COPY), ...Object.values(APPLY_NOTE_COPY)]) assert.ok(Object.hasOwn(englishMessages, text), text)
})

test('a record read back from a fresh list: present and equal, gone, or the difference', async () => {
  assert.equal(recordReadBack({ name: 'ci', userId: 'u1', extra: 1 }, { name: 'ci', userId: 'u1' }), null)
  assert.deepEqual(recordReadBack({ name: 'ci', enabled: true }, { enabled: false }), { path: 'enabled', submitted: 'false', readBack: 'true' })
  assert.deepEqual(recordReadBack(null, { name: 'ci' }), { path: 'exists', submitted: 'true', readBack: 'false' })
  assert.equal(recordReadBack(null, null), null, 'a deleted record is gone')
  assert.deepEqual(recordReadBack({ id: 'x' }, null), { path: 'exists', submitted: 'false', readBack: 'true' })
  assert.deepEqual(await runReadBack(async () => null), { mismatch: null, unverified: false })
  assert.deepEqual(await runReadBack(async () => { throw new Error('offline') }), { mismatch: null, unverified: true }, 'a failed read is never a match')
})

test('users and roles are checked on what the save wrote; passwords never appear', () => {
  const user = { id: 'u1', username: 'alice', displayName: 'Alice', disabled: false, passwordChangedAt: 5, bindings: [
    { role: 'operator', scope: { kind: 'adapter', key: 'qq' } }, { role: 'viewer', scope: { kind: 'global' } }] }
  assert.deepEqual(bindingKeys(user.bindings), ['operator@adapter:qq', 'viewer@global'])
  const view = userReadBackView(user)
  assert.deepEqual(view, { username: 'alice', displayName: 'Alice', disabled: false, bindings: ['operator@adapter:qq', 'viewer@global'], passwordChangedAt: 5 })
  assert.equal(recordReadBack(view, { bindings: bindingKeys([...user.bindings].reverse()) }), null, 'binding order does not matter')
  assert.deepEqual(recordReadBack(view, { displayName: 'Alicia' }), { path: 'displayName', submitted: '"Alicia"', readBack: '"Alice"' })
  assert.equal(userReadBackView(null), null)
  const role = { id: 'r', name: 'ops', description: 'Ops', permissions: ['b', 'a'] }
  assert.equal(recordReadBack(roleReadBackView(role), { description: 'Ops', permissions: ['a', 'b'] }), null)
  assert.deepEqual(recordReadBack(roleReadBackView(role), { description: 'Ops', permissions: ['a'] }), { path: 'permissions.1', submitted: null, readBack: '"b"' })
  // A password reset is checked by its change time only.
  assert.equal(recordReadBack({ passwordChanged: 9 > 5 }, { passwordChanged: true }), null)
})

test('chat role grants are read back from the stored list at this scope', () => {
  const scope = { adapter: 'qq', endpoint: 'bot' }
  const entries = [{ key: 'qq/bot', source: 'grant', adapter: 'qq', userId: '10001', role: 'admin' }]
  assert.equal(chatRoleReadBack(entries, scope, { adapter: 'qq', userId: '10001', role: 'admin' }, 'grant'), null)
  assert.deepEqual(chatRoleReadBack(entries, scope, { adapter: 'qq', userId: '10001', role: 'owner' }, 'grant'), { path: 'role', submitted: '"owner"', readBack: '"admin"' })
  assert.deepEqual(chatRoleReadBack(entries, scope, { adapter: 'qq', userId: '10001' }, 'revoke'), { path: 'role', submitted: null, readBack: '"admin"' })
  assert.equal(chatRoleReadBack([], scope, { adapter: 'qq', userId: '10001' }, 'revoke'), null)
})

test('every access-control, personal, schedule and chat-role save point reports its outcome instead of a toast', () => {
  const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
  const expectations = {
    'pages/access/users.tsx': [/outcomeFromAccessWrite\(\)/u, /USERS_DISABLE[\s\S]*apply: outcomeFromAccessWrite/u, /已创建 \{0\}/u, /已更新 \{0\} 的显示名/u, /已更新 \{0\} 的角色/u, /已重置 \{0\} 的密码/u, /已删除 \{0\}/u, /\{saved\.element\}/u],
    'pages/access/roles.tsx': [/outcomeFromAccessWrite\(\)/u, /roleReadBackView/u, /\{saved\.element\}/u],
    'pages/access/tokens.tsx': [/TOKENS_REVOKE[\s\S]*apply: outcomeFromAccessWrite/u, /outcomeFromAccessWrite\(\{ secret: true \}\)/u, /\{saved\.element\}/u],
    'pages/account/index.tsx': [/changeOwnPassword[\s\S]*outcomeFromAccessWrite\(\{ secret: true \}\)/u, /revokeOwnToken[\s\S]*apply: outcomeFromAccessWrite/u, /\{savedToken\.element\}/u],
    'scope/ChatRolesPanel.tsx': [/apply: outcomeFromChatRoleWrite\(\)/u, /chatRoleReadBack/u],
    'pages/cron.tsx': [/CRON_ADD[\s\S]*outcomeFromScheduleWrite/u, /CRON_REMOVE[\s\S]*outcomeFromScheduleWrite/u, /\{saved\.element\}/u],
  }
  for (const [path, patterns] of Object.entries(expectations)) {
    const source = read(path)
    for (const pattern of patterns) assert.match(source, pattern, `${path}: ${pattern}`)
    assert.doesNotMatch(source, /toast\.success\(/u, `${path} no longer ends a save with a toast`)
  }
})
