import test from 'node:test'
import assert from 'node:assert/strict'
import { readTraceTurns, readTraceDetail, readTraceRequest, traceUsage, formatTraceMetric, turnsForMessage, traceQuery, promptContent } from '../console-ui/src/pages/conversation-trace-model.mjs'

const session = 'icqq:alias:channel:room'
const conversation = { endpoint: { adapter: 'root/icqq', id: 'bot-id' }, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' }
const turn = { turn_id: 'turn-1', session_key: session, started_at: 1234, model_calls: 1, tool_calls: 0, total_tokens: 120, termination: { status: 'completed' }, origin: { kind: 'im', conversation, messageId: 'message' } }
const call = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120, cache_read_tokens: 60, cache_write_tokens: 0, reasoning_tokens: 5, reported: { input: true, output: true, totalTokens: true, cacheRead: true, cacheWrite: true, reasoning: true } }
const wrap = data => ({ success: true, data })

test('usage preserves reported zero, missing values and partial sums without counting cache or reasoning twice', () => {
  const all = traceUsage([{ usage_calls: [call, { ...call, prompt_tokens: 40, completion_tokens: 10, total_tokens: 50 }] }])
  assert.deepEqual(all.totalTokens, { value: 170, partial: false })
  assert.deepEqual(all.cacheWrite, { value: 0, partial: false })
  const partial = traceUsage([{ usage_calls: [call, { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0, reported: { input: false, output: false, totalTokens: false } }] }])
  assert.equal(formatTraceMetric(partial.input), '≥ 100')
  assert.equal(formatTraceMetric(traceUsage([{ usage_calls: [{ prompt_tokens: 0 }] }]).input), '—')
  assert.equal(formatTraceMetric(traceUsage([{ usage_calls: [{ prompt_tokens: 0, reported: { input: true } }] }]).input), '0')
  assert.equal(formatTraceMetric(traceUsage([{ total_tokens: 42 }]).totalTokens), '42')
  assert.equal(formatTraceMetric(traceUsage([{ total_tokens: 0 }]).totalTokens), '—')
})

test('flattened usage_calls is the only aggregate, even when nested traces and totals are also present', () => {
  const result = traceUsage([{ usage_calls: [call, call], total_tokens: 120, subagents: [{ usage_calls: [call] }] }])
  assert.equal(result.input.value, 200)
  assert.equal(result.totalTokens.value, 240)
})

test('message association requires the exact canonical endpoint, parent, topic and message ID', () => {
  assert.deepEqual(turnsForMessage([turn], { conversation, id: 'message' }), [turn])
  for (const other of [{ ...conversation, threadId: 'other' }, { ...conversation, parent: undefined }, { ...conversation, endpoint: { ...conversation.endpoint, id: 'other' } }]) {
    assert.deepEqual(turnsForMessage([turn], { conversation: other, id: 'message' }), [])
  }
  assert.deepEqual(turnsForMessage([{ ...turn, origin: undefined }], { conversation, id: 'message' }), [])
  assert.deepEqual(turnsForMessage([turn], { conversation, id: 'same-time-different-message' }), [])
})

test('lists reject different sessions, duplicate turns, and unbound physical conversations', () => {
  assert.equal(readTraceTurns(wrap([turn]), session, 'zh-CN', conversation)[0], turn)
  assert.throws(() => readTraceTurns(wrap([turn]), 'another-session'))
  assert.throws(() => readTraceTurns(wrap([turn, turn]), session))
  assert.throws(() => readTraceTurns(wrap([{ ...turn, origin: undefined }]), session, 'zh-CN', conversation))
  assert.throws(() => readTraceTurns(wrap([turn]), session, 'zh-CN', { ...conversation, threadId: 'other' }))
  const query = new URL(traceQuery('turns', session, undefined, undefined, conversation), 'https://fixture')
  assert.deepEqual(JSON.parse(query.searchParams.get('conversation')), conversation)
})

test('request identities and usage request_id must match; captured text is never reconstructed', () => {
  const request = { request_id: 'r1', index: 2, started_at: 123, status: 'completed', body_status: 'recorded', body: { system: '  first\nlast\n', messages: [{ role: 'user', content: 'Current' }], tools: [] } }
  const payload = wrap({ session_key: session, turn_id: 'turn-1', request, usage: { ...call, request_id: 'r1' } })
  assert.equal(readTraceRequest(payload, session, 'turn-1', 'r1').body.system, '  first\nlast\n')
  assert.throws(() => readTraceRequest(payload, session, 'turn-2', 'r1'))
  assert.throws(() => readTraceRequest(payload, session, 'turn-1', 'r2'))
  assert.throws(() => readTraceRequest(wrap({ ...payload.data, usage: { ...call, request_id: 'wrong' } }), session, 'turn-1', 'r1'))
  const old = readTraceRequest(wrap({ session_key: session, turn_id: 'turn-1', request: { ...request, body_status: 'unsupported', body: undefined } }), session, 'turn-1', 'r1')
  assert.equal(old.body, undefined)
  assert.equal(promptContent([{ type: 'text', text: '  full text\n' }, { type: 'image', omitted: 'media' }]), '  full text\n\n\n{\n  "type": "image",\n  "omitted": "media"\n}')
})

test('turn details must belong to both the selected turn and canonical conversation', () => {
  const detail = { ...turn, model_calls: [call], tool_calls: [], subagents: [] }
  assert.equal(readTraceDetail(wrap(detail), session, 'turn-1', 'zh-CN', conversation), detail)
  assert.throws(() => readTraceDetail(wrap(detail), session, 'different'))
  assert.throws(() => readTraceDetail(wrap(detail), session, 'turn-1', 'zh-CN', { ...conversation, threadId: 'different' }))
})
