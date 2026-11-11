import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildMessageFeed,
  hourlyMessageActivity,
  messagePreview,
  messageRecords,
  replyLatencySeconds,
  summarizeMessages,
} from '../console-ui/src/pages/dashboard-activity-model.mjs'

const HOUR = 3_600_000
const NOW = Date.UTC(2026, 10, 11, 12, 30)
const endpoint = { id: 'sandbox\u0000sandbox-bot', adapter: 'sandbox' }
let nextId = 1
function message(direction, { at, kind = 'private', id = 'sandbox-user', text = 'hi', sender, type = 'message.receive' } = {}) {
  return {
    runtimeId: 'rt', eventId: nextId++, type, timestamp: at,
    data: {
      direction, adapter: 'sandbox', endpointKey: 'sandbox-bot', channelType: kind, channelId: id,
      conversation: { endpoint, kind, id }, content: text, timestamp: at,
      ...(direction === 'inbound' ? { sender: sender ?? { id: 'u1', name: '青禾' } } : {}),
    },
  }
}

test('previews read strings, segment arrays and non-text placeholders without throwing', () => {
  assert.equal(messagePreview('whoami'), 'whoami')
  assert.equal(messagePreview([{ type: 'at', data: { name: 'Zhin' } }, { type: 'text', data: { text: '帮我总结' } }]), '@Zhin 帮我总结')
  assert.equal(messagePreview([{ type: 'image', data: { url: 'x' } }]), '[图片]')
  assert.equal(messagePreview([{ type: 'image', data: {} }], { image: '[Image]', audio: '', video: '', file: '', sticker: '' }), '[Image]')
  assert.equal(messagePreview([{ type: 'reply', data: { id: '1' } }, 'ok']), 'ok')
  assert.equal(messagePreview([{ type: 'poll', data: {} }]), '[poll]')
  assert.equal(messagePreview(null), '')
  assert.equal(messagePreview(42), '42')
})

test('records keep only message events, de-duplicate replayed envelopes and sort by time', () => {
  const inbound = message('inbound', { at: NOW - 1000 })
  const records = messageRecords([
    { runtimeId: 'rt', eventId: 99, type: 'hmr:reload', data: { generation: 1 }, timestamp: NOW },
    message('outbound', { at: NOW - 500, text: 'pong' }),
    inbound,
    inbound,
    { runtimeId: 'rt', eventId: 98, type: 'message.receive', data: { direction: 'sideways' }, timestamp: NOW },
  ])
  assert.deepEqual(records.map((record) => [record.direction, record.text]), [['inbound', 'hi'], ['outbound', 'pong']])
  assert.deepEqual(records[0].sender, { id: 'u1', name: '青禾' })
  assert.equal(records[1].sender, null)
  assert.equal(records[0].adapter, 'sandbox')
  assert.equal(records[0].kind, 'private')
})

test('hourly activity ends at the current hour and ignores messages outside the window', () => {
  const records = messageRecords([
    message('inbound', { at: NOW - 10 * 60_000 }),
    message('outbound', { at: NOW - 9 * 60_000 }),
    message('inbound', { at: NOW - 3 * HOUR }),
    message('inbound', { at: NOW - 30 * HOUR }),
    message('inbound', { at: NOW + HOUR }),
  ])
  const buckets = hourlyMessageActivity(records, NOW, 24)
  assert.equal(buckets.length, 24)
  assert.equal(buckets[23].start, Date.UTC(2026, 10, 11, 12))
  assert.deepEqual([buckets[23].inbound, buckets[23].outbound], [1, 1])
  assert.equal(buckets[20].inbound, 1)
  assert.equal(buckets.reduce((sum, bucket) => sum + bucket.inbound + bucket.outbound, 0), 3)
})

test('summaries count distinct conversations and senders since the cut-off', () => {
  const records = messageRecords([
    message('inbound', { at: NOW - 1000, sender: { id: 'u1', name: 'A' } }),
    message('inbound', { at: NOW - 900, kind: 'group', id: 'g1', sender: { id: 'u2', name: 'B' } }),
    message('inbound', { at: NOW - 800, kind: 'group', id: 'g1', sender: { id: 'u2', name: 'B' } }),
    message('outbound', { at: NOW - 700, kind: 'group', id: 'g1' }),
    message('inbound', { at: NOW - 30 * HOUR, sender: { id: 'u9', name: 'Old' } }),
  ])
  assert.deepEqual(summarizeMessages(records, NOW - 24 * HOUR), { inbound: 3, outbound: 1, conversations: 2, senders: 2 })
})

test('feed pairs replies with the inbound message they answer, even when the reply is journaled first', () => {
  const records = messageRecords([
    // Host order observed in practice: the command reply can precede the inbound record.
    message('outbound', { at: NOW - 5000, text: '实例: capabilities-bot' }),
    message('inbound', { at: NOW - 5200, text: 'whoami' }),
    message('inbound', { at: NOW - 4000, kind: 'group', id: 'g1', text: '大家好', sender: { id: 'u2', name: '栖迟' } }),
    message('inbound', { at: NOW - 3000, text: 'stats' }),
    message('outbound', { at: NOW - 2500, text: '=== 指令菜单 ===' }),
    message('outbound', { at: NOW - 10 * 60_000, kind: 'group', id: 'g9', text: '定时提醒' }),
  ])
  const feed = buildMessageFeed(records, 10)
  assert.deepEqual(feed.map((item) => item.text), ['stats', '大家好', 'whoami', '定时提醒'])
  assert.deepEqual(feed[0].replies.map((reply) => reply.text), ['=== 指令菜单 ==='])
  assert.deepEqual(feed[1].replies, [])
  assert.deepEqual(feed[2].replies.map((reply) => reply.text), ['实例: capabilities-bot'])
  assert.equal(feed[3].direction, 'outbound')
  assert.equal(replyLatencySeconds(feed[0]), 0.5)
  assert.equal(replyLatencySeconds(feed[1]), null)
  assert.equal(buildMessageFeed(records, 2).length, 2)
})

test('replies never pair across conversations or beyond the pairing window', () => {
  const records = messageRecords([
    message('inbound', { at: NOW - 10 * 60_000, text: 'old question' }),
    message('outbound', { at: NOW, text: 'late reply' }),
    message('inbound', { at: NOW - 1000, kind: 'group', id: 'g1', text: 'group question' }),
  ])
  const feed = buildMessageFeed(records)
  assert.equal(feed.find((item) => item.text === 'old question').replies.length, 0)
  assert.equal(feed.find((item) => item.text === 'group question').replies.length, 0)
  assert.equal(feed.find((item) => item.text === 'late reply').direction, 'outbound')
})
