import test from 'node:test'
import assert from 'node:assert/strict'
import { readRendering, renderingLabels, readMessagePush, correlateChatRows, matchesMessageConversation } from '../console-ui/src/pages/endpoint-detail/rendering-diagnostics.mjs'
import { buildPreviewTarget, readPreviewEndpoints, readPreviewResponse, createPreviewRequestGate } from '../console-ui/src/pages/introspection/target-preview.mjs'
import { readEndpointIdentity } from '../console-ui/src/pages/endpoint-detail/endpoint-request.mjs'

const endpoint = { id: 'root/icqq\0adapter\0account', adapter: 'icqq' }
const conversation = { endpoint, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' }
const event = { direction: 'outbound', adapter: 'icqq', endpointKey: 'account', conversation, messageId: 'platform-1', content: '[image]', timestamp: 1, rendering: { forms: ['image'], fallbacks: [] } }

test('actual outbound SSE retains canonical identities, direction, platform message ID and final rendering facts', () => {
  const value = readMessagePush(event)
  assert.equal(value.outgoing, true); assert.equal(value.messageId, 'platform-1')
  assert.deepEqual(value.endpoint, endpoint); assert.deepEqual(value.parent, { type: 'guild', id: 'guild' }); assert.equal(value.threadId, 'topic')
  assert.deepEqual(value.rendering, { forms: ['image'], fallbacks: [] })
  assert.equal(readMessagePush({ ...event, direction: 'inbound' }).outgoing, false)
  assert.equal(readMessagePush({ ...event, conversation: undefined }), undefined)
})

test('invalid rendering cannot masquerade as successful no-fallback diagnosis', () => {
  assert.throws(() => readRendering({ forms: ['wrong'], fallbacks: [] }), /诊断/)
  assert.throws(() => readRendering({ forms: ['text'], fallbacks: ['wrong'] }), /诊断/)
  assert.equal(readMessagePush({ ...event, rendering: {} }).renderingError, '渲染诊断格式无效')
  assert.deepEqual(renderingLabels({ forms: ['text'], fallbacks: ['renderer_failed', 'interactive_text_policy'] }), { forms: ['文本'], fallbacks: ['截图渲染失败', '按钮按文本策略降级'] })
  assert.equal(readRendering(undefined), undefined)
})

test('local send and authoritative diagnostic correlate regardless of response ordering, without losing authored content', () => {
  const local = { id: 'local-1', endpoint, channelType: 'channel', channelId: 'room', parent: { type: 'guild', id: 'guild' }, threadId: 'topic', messageId: 'platform-1', outgoing: true, local: true, content: ['draft segments'], timestamp: 2 }
  const sent = { ...local, id: 'event-1', local: false, content: ['[image]'], rendering: event.rendering, timestamp: 1 }
  for (const rows of [[local, sent], [sent, local]]) {
    const merged = correlateChatRows(rows)
    assert.equal(merged.length, 1); assert.deepEqual(merged[0].rendering, event.rendering); assert.deepEqual(merged[0].content, local.content)
  }
  assert.equal(correlateChatRows([local, { ...sent, outgoing: false }]).length, 2)
  assert.equal(correlateChatRows([local, { ...sent, endpoint: { ...endpoint, id: 'other' } }]).length, 2)
  assert.equal(correlateChatRows([local, { ...sent, threadId: 'other' }]).length, 2)
  assert.equal(correlateChatRows([local, { ...sent, parent: { type: 'guild', id: 'other' } }]).length, 2)
  assert.equal(correlateChatRows(Array.from({ length: 600 }, (_, id) => ({ ...local, id: String(id), messageId: String(id), timestamp: id }))).length, 500)
})

test('conversation selection isolates parent and thread instead of merging a bare shared room ID', () => {
  const row = readMessagePush(event), selection = { type: 'channel', channelType: 'channel', id: 'room', parent: { type: 'guild', id: 'guild' }, threadId: 'topic' }
  assert.equal(matchesMessageConversation(row, selection), true)
  assert.equal(matchesMessageConversation(row, { ...selection, threadId: undefined }), false)
  assert.equal(matchesMessageConversation(row, { ...selection, parent: { type: 'guild', id: 'other' } }), false)
})

test('target preview uses the exact Host endpoint and validates complete optional parent/thread fields', () => {
  const endpoints = readPreviewEndpoints({ endpoints: [{ name: 'display label', connected: true, endpoint }] })
  assert.deepEqual(endpoints[0].endpoint, endpoint)
  assert.deepEqual(readPreviewEndpoints({ endpoints: [{ name: 'looks like id', adapter: 'icqq', connected: true }] }), [])
  assert.deepEqual(buildPreviewTarget(endpoint, { kind: 'channel', id: ' room ', parentKind: 'channel', parentId: 'guild', threadId: 'topic' }), conversation)
  assert.throws(() => buildPreviewTarget(undefined, { kind: 'private', id: 'room' }), /Endpoint/)
  assert.throws(() => buildPreviewTarget(endpoint, { kind: 'channel', id: 'room', parentKind: 'channel' }), /同时填写/)
  assert.throws(() => readEndpointIdentity({ id: 'account' }), /完整标识/)
})

test('author previews and target previews have separate declared contracts; empty component output remains valid', () => {
  assert.deepEqual(readPreviewResponse({ success: true, data: { output: null } }), { output: null, rendering: undefined, generation: undefined })
  assert.throws(() => readPreviewResponse({ success: true, data: { output: [] } }, conversation), /诊断/)
  assert.deepEqual(readPreviewResponse({ success: true, data: { output: ['preview'], rendering: event.rendering, generation: 5 } }, conversation), { output: ['preview'], rendering: event.rendering, generation: 5 })
})

test('cancel and selection change prevent even an abort-ignoring older response from publishing', async () => {
  const gate = createPreviewRequestGate(), first = gate.begin()
  let finish
  const old = new Promise(resolve => { finish = resolve }).then(output => first.current() ? output : 'discarded')
  const second = gate.begin()
  assert.equal(first.signal.aborted, true); assert.equal(first.current(), false)
  finish('old owner result'); assert.equal(await old, 'discarded'); assert.equal(second.current(), true)
  gate.cancel(); assert.equal(second.signal.aborted, true); assert.equal(second.current(), false)
})

test('canonical preview MediaRef base64 retains MIME and cannot expose Host local paths', async () => {
  const { pickMessageMediaRaw } = await import('../console-ui/src/pages/endpoint-detail/media-source.mjs')
  let legacyCalls = 0
  const legacy = (data) => { legacyCalls++; return data?.url }
  assert.equal(pickMessageMediaRaw({ media: { kind: 'base64', value: 'aGVsbG8=', mime_type: 'image/png' } }, legacy), 'data:image/png;base64,aGVsbG8=')
  assert.equal(pickMessageMediaRaw({ media: { kind: 'url', value: 'https://example.org/image.png' } }, legacy), 'https://example.org/image.png')
  assert.equal(pickMessageMediaRaw({ media: { kind: 'path', value: '/tmp/secret.png' }, url: 'https://example.org/fallback.png' }, legacy), undefined)
  assert.equal(pickMessageMediaRaw({ media: { kind: 'base64', value: 'aGVsbG8=' } }, legacy), undefined)
  assert.equal(pickMessageMediaRaw({ url: 'https://example.org/inbound.png' }, legacy), 'https://example.org/inbound.png')
  assert.equal(legacyCalls, 1)
})
