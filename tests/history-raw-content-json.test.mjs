import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { expandRawContentSegments } from '../console-ui/src/pages/conversation-history-model.mjs'

// #64 `history-raw-content-json`: in Sandbox →「对话与轨迹」→「对话」 an image reply (a QR code) was shown as
// `{"$content":"zhin.raw-content/1","payload":{"type":"image","data":{"url":"data:image/png;base64,…"}}}`
// with screens of base64, while the chat view showed the image.
const image = { type: 'image', data: { url: 'data:image/png;base64,iVBORw0KGgo=' } }
const envelope = payload => ({ $content: 'zhin.raw-content/1', payload })

test('a text segment holding a raw-content envelope becomes the segments it wraps', () => {
  assert.deepEqual(expandRawContentSegments([{ type: 'text', data: { text: JSON.stringify(envelope(image)) } }]), [image])
  assert.deepEqual(expandRawContentSegments([{ type: 'text', data: { text: ` ${JSON.stringify(envelope([image, { type: 'text', data: { text: '扫码登录' } }]))}\n` } }]),
    [image, { type: 'text', data: { text: '扫码登录' } }])
  // A string payload is text; an envelope inside an envelope is unwrapped too.
  assert.deepEqual(expandRawContentSegments([{ type: 'text', data: { text: JSON.stringify(envelope('你好')) } }]), [{ type: 'text', data: { text: '你好' } }])
  assert.deepEqual(expandRawContentSegments([{ type: 'text', data: { text: JSON.stringify(envelope(envelope(image))) } }]), [image])
})

test('a segment whose data is the envelope is unwrapped as well', () => {
  assert.deepEqual(expandRawContentSegments([{ type: 'raw', data: envelope(image) }]), [image])
})

test('everything else is left exactly as it was', () => {
  const plain = [
    { type: 'text', data: { text: '普通消息' } },
    { type: 'text', data: { text: '{"not":"an envelope"}' } },
    { type: 'text', data: { text: '{broken json' } },
    { type: 'text', data: { text: JSON.stringify(envelope({ unknown: true })) } },
    image,
  ]
  assert.deepEqual(expandRawContentSegments(plain), plain)
  assert.deepEqual(expandRawContentSegments([]), [])
})

test('the history view renders the expanded segments', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/ConversationHistory.tsx', import.meta.url), 'utf8')
  assert.match(source, /<MessageBody content=\{expandRawContentSegments\(message\.segments\)\} \/>/)
})
