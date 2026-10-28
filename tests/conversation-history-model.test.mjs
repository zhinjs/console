import test from 'node:test'
import assert from 'node:assert/strict'
import { conversationHistoryQuery, readConversationHistory, prependConversationHistory, conversationHistoryFailure } from '../console-ui/src/pages/conversation-history-model.mjs'

const conversation = { endpoint: { adapter: 'root/icqq', id: 'canonical-account' }, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' }
const created = (sequence, overrides = {}) => ({ sequence, type: 'message.created', timestamp: 1_700_000_000_000 + sequence,
  message: { ref: { conversation, id: `msg-${sequence}` }, timestamp: 1_700_000_000_000 + sequence,
    segments: [{ type: 'text', data: { text: `message-${sequence}` } }], ...overrides } })
const response = (items, hasMore = false, extra = {}) => ({ success: true, data: { conversation, items, hasMore, nextBeforeSequence: hasMore ? items[0]?.sequence : null, ...extra } })

test('history pages preserve full canonical identities, full text, actor absence and safe media without deriving a physical conversation from an alias', () => {
  const text = '长正文'.repeat(8000) + 'COMPLETE_TAIL'
  const items = [created(1, { segments: [{ type: 'text', data: { text } }, { type: 'image', data: { media: { kind: 'url', value: 'https://assets.example/image.png' } } }] }),
    created(2, { actor: { id: 'unknown', displayName: 'Unknown sender' } })]
  const page = readConversationHistory(response(items))
  assert.deepEqual(page.conversation, conversation)
  assert.equal(page.items[0].message.actor, undefined)
  assert.equal(page.items[0].message.segments[0].data.text, text)
  assert.equal(page.items[0].message.segments[1].data.media.value, 'https://assets.example/image.png')
  assert.equal(page.items[1].message.actor.id, 'unknown')
  const query = new URL(conversationHistoryQuery('icqq:alias:channel:room:percent%literal'), 'https://console.example')
  assert.equal(query.searchParams.get('sessionKey'), 'icqq:alias:channel:room:percent%literal')
  assert.equal(query.searchParams.has('beforeSequence'), false)
  assert.equal(query.searchParams.has('limit'), false)
})

test('all 50 events advance the exclusive cursor, including pages without visible messages', () => {
  const events = Array.from({ length: 50 }, (_, index) => ({ sequence: index + 51, type: 'member.joined', timestamp: 1_700_000_000_000 }))
  const recent = readConversationHistory(response(events, true))
  assert.equal(recent.items.length, 50)
  assert.equal(recent.nextBeforeSequence, 51)
  const earlier = readConversationHistory(response([created(1)]), recent.conversation, recent.nextBeforeSequence)
  const merged = prependConversationHistory(recent, earlier)
  assert.deepEqual(merged.items.map(item => item.sequence), [1, ...events.map(item => item.sequence)])
  assert.equal(merged.hasMore, false)
  assert.equal(new URL(conversationHistoryQuery('alias', 51), 'https://console.example').searchParams.get('beforeSequence'), '51')
})

test('message references, recalls and subsequent pages cannot cross account, parent or thread identity', () => {
  const page = readConversationHistory(response([created(4)], true))
  for (const other of [
    { ...conversation, endpoint: { ...conversation.endpoint, id: 'another' } },
    { ...conversation, parent: { ...conversation.parent, id: 'another' } },
    { ...conversation, threadId: 'another' }, { ...conversation, parent: undefined },
  ]) {
    assert.throws(() => readConversationHistory(response([created(1)], false, { conversation: other }), page.conversation, 4))
    assert.throws(() => readConversationHistory(response([created(1, { ref: { conversation: other, id: 'm' } })])))
    assert.throws(() => readConversationHistory(response([{ sequence: 1, type: 'message.recalled', timestamp: 1_700_000_000_000, messageRef: { conversation: other, id: 'm' } }])))
  }
  const recalls = readConversationHistory(response([{ sequence: 1, type: 'message.recalled', timestamp: 1_700_000_000_000 },
    { sequence: 2, type: 'message.recalled', timestamp: 1_700_000_000_000, messageRef: { conversation, id: 'not-loaded' } }]))
  assert.equal(recalls.items.length, 2)
})

test('malformed pages, duplicate/out-of-order events, inclusive or non-progressing cursors fail without skipping records', () => {
  for (const body of [
    { success: false, data: [] }, response([created(1), created(1)]), response([created(2), created(1)]),
    response(Array.from({ length: 51 }, (_, index) => created(index))),
    response([], true), response([created(1)], true, { nextBeforeSequence: 2 }),
    response([created(1)], false, { nextBeforeSequence: 1 }),
    response([created(1, { actor: { displayName: 'missing id' } })]),
    response([created(1, { segments: 'not segments' })]), response([created(1, { timestamp: Infinity })]),
  ]) assert.throws(() => readConversationHistory(body))
  assert.throws(() => readConversationHistory(response([created(5)]), conversation, 5))
  assert.throws(() => readConversationHistory(response([created(6)]), conversation, 5))
})

test('no recorded history is distinguished from an older unsupported Host, ambiguity, unavailable storage and permission errors', () => {
  assert.equal(conversationHistoryFailure(404, { code: 'history_not_recorded' }).message, '尚无可读取的聊天记录。')
  assert.match(conversationHistoryFailure(404, null).message, /Host 尚不支持/)
  assert.match(conversationHistoryFailure(409, { code: 'conversation_ambiguous' }).message, /无法准确读取/)
  assert.equal(conversationHistoryFailure(503, { code: 'history_unavailable' }).kind, '503')
  assert.match(conversationHistoryFailure(403, null).message, /无权读取/)
  assert.match(conversationHistoryFailure(400, null).message, /分页参数无效/)
})
