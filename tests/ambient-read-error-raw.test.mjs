import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { describeReadFailure, isReadDenied } from '../console-ui/src/pages/ambient-engagement-model.mjs'
import { groupPickerView } from '../console-ui/src/pages/ambient-group-picker-model.mjs'

// #64 `ambient-read-error-raw`: 群聊插话 status / settings read failures pasted the Host's raw text into the
// StatusState description (「群聊插话状态读取失败：Unknown RPC type: …」), overriding the cause-based title and
// text, and a 403 `{ code: 'forbidden' }` on settings was not treated as 无权限.
const errorWith = (message, details) => Object.assign(new Error(message), details ? { details } : {})

test('the summary never carries the Host text; it stays in detail for 技术详情', () => {
  for (const raw of ['TypeError: Cannot read properties of undefined', 'Unknown RPC type: plugin.root.ambient', 'HTTP 502']) {
    const failure = describeReadFailure(new Error(raw), '群聊插话状态')
    assert.equal(failure.denied, false, raw)
    assert.doesNotMatch(failure.text, new RegExp(raw.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'u'), raw)
    assert.equal(failure.detail, raw)
  }
})

test('无权限 follows statusFromError, so a Host `forbidden` code or plain 「Forbidden」 is denied in both sections', () => {
  assert.equal(describeReadFailure(errorWith('Forbidden', { serverCode: 'forbidden' }), '群聊插话设置').denied, true)
  assert.equal(describeReadFailure('Forbidden', '群聊插话设置').denied, true)
  assert.equal(describeReadFailure(errorWith('request refused', { httpStatus: 403, transport: 'refused' }), '群聊插话状态').denied, true)
  assert.equal(describeReadFailure('Token scope does not allow this route', '群聊插话状态').denied, true, 'the old Host texts still count')
  assert.equal(describeReadFailure(new Error('Unknown RPC type: plugin.root.ambient'), '群聊插话状态').denied, false)
})

test('both sections hand the error to StatusState without a hand-made description', () => {
  const page = readFileSync(new URL('../console-ui/src/pages/ambient-engagement.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(page, /description=\{failure\.text\}/u)
  assert.equal((page.match(/<StatusState error=\{read\.error\} onRetry=/gu) ?? []).length, 2)
})

test('the group list in the settings section decides 无权限 the same way', () => {
  const forbidden = errorWith('Forbidden', { serverCode: 'forbidden' })
  assert.equal(isReadDenied(forbidden), true)
  assert.equal(groupPickerView({ loading: false, error: forbidden, catalog: null, query: '' }).kind, 'denied')
  assert.equal(groupPickerView({ loading: false, error: new Error('REST request failed'), catalog: null, query: '' }).kind, 'error')
  const page = readFileSync(new URL('../console-ui/src/pages/ambient-engagement.tsx', import.meta.url), 'utf8')
  assert.match(page, /if \(isReadDenied\(error\)\) return \{ denied: true \}/u, 'the status read treats a forbidden code as denied too')
})
