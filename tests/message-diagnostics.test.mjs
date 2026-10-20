import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { diagnosticTarget, conversationDiagnosticTarget, diagnosticConversationKey, diagnosticQuery, readMessageDiagnostics,
  diagnosticLabel, diagnosticAdvice, createDiagnosticRequestGate, DIAGNOSTIC_RETENTION } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'
import { readMessagePush } from '../console-ui/src/pages/endpoint-detail/rendering-diagnostics.mjs'
import { readMessageHistory } from '../console-ui/src/pages/endpoint-detail/inbox-history-model.mjs'

const endpoint = { id: 'root/slack\0adapter\0bot-a', adapter: 'root/slack' }
const conversation = { endpoint, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'team' }, threadId: 'topic' }
const message = { outgoing: false, conversation, messageId: 'message-1' }
const target = diagnosticTarget(message)
const record = { id: 'diagnostic-1', generation: 3, conversation, messageId: 'message-1', startedAt: 100, endedAt: 120,
  status: 'completed', truncated: false, route: 'command', dispatchStatus: 'executed', steps: [{ stage: 'received', status: 'accepted', at: 100 }], deliveries: [] }
const response = (value = record) => ({ success: true, data: [value] })

test('a real current ImRuntime command fixture including handlers round-trips through the Console contract', async () => {
  // Captured from Core's real ImRuntime successful-command integration fixture, not a handwritten DTO.
  const fixture = JSON.parse(await readFile(new URL('./fixtures/message-diagnostics-command.json', import.meta.url), 'utf8'))
  const observed = fixture.data[0]
  const actualTarget = { conversation: observed.conversation, messageId: observed.messageId }
  const parsed = readMessageDiagnostics(fixture, actualTarget)
  assert.equal(parsed.length, 1)
  assert.deepEqual(parsed[0], observed)
  assert.ok(parsed[0].steps.some(step => step.stage === 'handlers' && step.status === 'started'))
  assert.ok(parsed[0].steps.some(step => step.stage === 'handlers' && step.status === 'completed'))
  assert.equal(parsed[0].route, 'command'); assert.equal(parsed[0].dispatchStatus, 'executed')
  assert.equal(parsed[0].deliveries[0].status, 'sent')
})

test('single-message query uses the original canonical identity and platform ID, never body/local IDs', () => {
  assert.equal(target.conversation, conversation)
  const query = new URLSearchParams(diagnosticQuery(target))
  assert.deepEqual(JSON.parse(query.get('conversation')), conversation)
  assert.equal(query.get('messageId'), 'message-1'); assert.equal(query.get('limit'), '10')
  assert.deepEqual([...query.keys()], ['conversation', 'messageId', 'limit'])
  for (const variant of [{ ...message, conversation: undefined }, { ...message, messageId: undefined, id: 'local-id', content: 'secret body' },
    { ...message, conversation: { ...conversation, endpoint: { id: 'looks-like-account' } } }, { ...message, outgoing: undefined },
    { ...message, outgoing: true }, { ...message, directionUnknown: true }, { ...message, local: true }]) assert.ok(diagnosticTarget(variant).reason)
})

test('conversation query retains exact account, parent and thread without broadening into an endpoint query', () => {
  const selection = { type: 'channel', channelType: 'channel', id: 'room', parent: { type: 'guild', id: 'team' }, threadId: 'topic' }
  const recent = conversationDiagnosticTarget(endpoint, selection)
  assert.deepEqual(recent.conversation, conversation)
  const query = new URLSearchParams(diagnosticQuery(recent))
  assert.equal(query.get('limit'), '50'); assert.equal(query.has('messageId'), false)
  assert.deepEqual(JSON.parse(query.get('conversation')), conversation)
  assert.ok(conversationDiagnosticTarget(undefined, selection).reason)
  assert.ok(conversationDiagnosticTarget(endpoint, { ...selection, parent: { type: 'unknown', id: 'team' } }).reason)
})

test('response isolation rejects another account, adapter, room, parent, thread or platform message ID', () => {
  const variants = [
    { ...conversation, endpoint: { ...endpoint, id: `${endpoint.id}-other` } },
    { ...conversation, endpoint: { ...endpoint, adapter: 'root/other' } },
    { ...conversation, id: 'other' }, { ...conversation, kind: 'group' },
    { ...conversation, parent: { kind: 'channel', id: 'other' } },
    { ...conversation, parent: { kind: 'group', id: 'team' } }, { ...conversation, parent: undefined },
    { ...conversation, threadId: 'other' }, { ...conversation, threadId: undefined },
  ]
  for (const other of variants) {
    assert.notEqual(diagnosticConversationKey(other), diagnosticConversationKey(conversation))
    assert.throws(() => readMessageDiagnostics(response({ ...record, conversation: other }), target), /身份/)
  }
  assert.throws(() => readMessageDiagnostics(response({ ...record, messageId: 'other' }), target), /身份/)
})

test('strict parser keeps only operational fields and rejects malformed or over-limit records', () => {
  const parsed = readMessageDiagnostics(response({ ...record, body: 'secret', exception: { token: 'secret' } }), target)[0]
  assert.equal(Object.hasOwn(parsed, 'body'), false); assert.equal(Object.hasOwn(parsed, 'exception'), false)
  for (const other of [{ ...record, status: 'success' }, { ...record, generation: -1 }, { ...record, truncated: undefined },
    { ...record, route: 'made-up' }, { ...record, steps: Array(33).fill(record.steps[0]) },
    { ...record, steps: [{ stage: 'prompt', status: 'accepted', at: 100 }] },
    { ...record, deliveries: [{ conversation, status: 'unknown' }] },
    { ...record, deliveries: [{ conversation, status: 'failed', failureCode: 'raw exception text' }] }]) assert.throws(() => readMessageDiagnostics(response(other), target))
  assert.throws(() => readMessageDiagnostics({ success: true, data: Array(11).fill(record) }, target))
  assert.throws(() => readMessageDiagnostics({ success: false, data: [] }, target))
})

test('empty retention and missing IDs in recent conversation records are explicit, not evidence of success', () => {
  assert.deepEqual(readMessageDiagnostics({ success: true, data: [] }, target), [])
  assert.match(DIAGNOSTIC_RETENTION, /15 分钟/); assert.match(DIAGNOSTIC_RETENTION, /500/); assert.match(DIAGNOSTIC_RETENTION, /不代表/)
  const recent = { conversation }
  assert.equal(readMessageDiagnostics(response({ ...record, messageId: undefined }), recent)[0].messageId, undefined)
  assert.equal(readMessageDiagnostics(response({ ...record, truncated: true }), target)[0].truncated, true)
})

test('actual deliveries retain their own destination and rendering; unknown advises verification without retry', () => {
  const destination = { ...conversation, id: 'another-room', threadId: undefined }
  const value = { ...record, deliveries: [{ conversation: destination, status: 'failed', failureCode: 'delivery_unconfirmed', deliveryUnknown: true,
    rendering: { forms: ['text'], fallbacks: ['renderer_failed'] } }] }
  const parsed = readMessageDiagnostics(response(value), target)[0]
  assert.deepEqual(parsed.deliveries[0].conversation, destination)
  assert.deepEqual(parsed.deliveries[0].rendering, value.deliveries[0].rendering)
  assert.match(diagnosticAdvice(parsed).join(' '), /先到实际目标会话核实/)
  assert.match(diagnosticAdvice(parsed).join(' '), /不会自动重试/)
  assert.equal(diagnosticLabel('sent'), '平台已受理')
  assert.equal(diagnosticLabel('member'), '协作成员 Bot')
  assert.equal(diagnosticLabel('handlers'), '消息事件处理器')
})

test('Agent handoff, processing and middleware failures have actionable non-completion language', () => {
  assert.match(diagnosticAdvice({ ...record, route: 'agent' }).join(' '), /不代表 Agent 已完成/)
  assert.match(diagnosticAdvice({ ...record, status: 'processing' }).join(' '), /手动刷新/)
  assert.match(diagnosticAdvice({ ...record, status: 'failed', steps: [{ stage: 'middleware', status: 'failed', at: 100 }] }).join(' '), /入站中间件执行失败/)
  assert.match(diagnosticAdvice({ ...record, status: 'failed', steps: [{ stage: 'middleware', status: 'entered', at: 100 }] }).join(' '), /异常也可能来自下游/)
  assert.match(diagnosticAdvice({ ...record, status: 'failed', steps: [{ stage: 'handlers', status: 'started', at: 100 }] }).join(' '), /handler 插件/)
  assert.match(diagnosticAdvice({ ...record, deliveries: [{ conversation, status: 'failed', failureCode: 'outbound_middleware_failed' }] }).join(' '), /出站中间件执行失败/)
})

test('a closed or superseded request cannot publish even if the underlying request ignores abort', async () => {
  const gate = createDiagnosticRequestGate(), first = gate.begin()
  let resolveOld
  const old = new Promise(resolve => { resolveOld = resolve }).then(value => first.current() ? value : 'discarded')
  const second = gate.begin()
  assert.equal(first.signal.aborted, true); assert.equal(first.current(), false)
  resolveOld('old Host result'); assert.equal(await old, 'discarded')
  assert.equal(second.current(), true)
  gate.cancel(); assert.equal(second.signal.aborted, true); assert.equal(second.current(), false)
})

test('request ownership reads the current opaque connection scope even before React receives the change event', () => {
  let scope = 'connection-a'
  const gate = createDiagnosticRequestGate(() => scope), first = gate.begin()
  assert.equal(first.current(), true)
  scope = 'connection-b'
  assert.equal(first.current(), false)
  const second = gate.begin(); assert.equal(second.current(), true)
  scope = undefined; assert.equal(second.current(), false)
})

test('live/cache push and history preserve the original canonical conversation without reconstructing display identity', () => {
  const event = { direction: 'inbound', conversation, messageId: 'message-1', content: 'body', timestamp: 100 }
  assert.equal(readMessagePush(event).conversation, conversation)
  assert.deepEqual(readMessagePush(JSON.parse(JSON.stringify(event))).conversation, conversation)
  const rows = readMessageHistory({ inboxEnabled: true, messages: [{ id: 1, platformMessageId: 'message-1', sender: { id: 'user' }, content: 'body', raw: null,
    timestamp: 100, direction: 'inbound', conversation, channel: { id: 'room', type: 'channel', parent: { type: 'guild', id: 'team' } } }] })
  assert.equal(rows[0].conversation, conversation)
})
