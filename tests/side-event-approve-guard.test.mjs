// #64 `side-event-approve-guard`: 系统 → 请求's 同意 / 拒绝 had no in-flight state and no receipt — two clicks sent two
// approvals, and a timeout read 「操作失败：<English>」 with the buttons enabled again. 标记已处理 (requests and notices)
// did the same. Each item now writes through its own useActionReceipt (persistKey); an unknown outcome offers only
// 「刷新待处理列表」, a read of the pending list.
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { receiptBlocksActions, receiptReducer } from '../console-ui/src/components/action-receipt-model.mjs'
import { createReceiptStore } from '../console-ui/src/components/action-receipt-store.mjs'
import {
  noticeActionHandlers, noticeReceiptKey, requestActionBody, requestActionHandlers, requestActionPayload, requestReceiptKey,
} from '../console-ui/src/pages/endpoint-detail/side-event-action-model.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const RPC = { REQUEST_APPROVE: 'request.approve', REQUEST_REJECT: 'request.reject', REQUEST_CONSUMED: 'request.consumed', NOTICE_CONSUMED: 'notice.consumed' }
const source = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
const timeout = () => Object.assign(new Error('The instance did not answer in time'), { details: { httpStatus: 504, serverCode: 'instance_timeout', requestOutcome: 'unknown' } })
const friend = { platformRequestId: 'flag-1', id: 7, canAct: true, sender: { id: '10001', name: 'Alice' } }

function host(replies) {
  const calls = []
  return { calls, send: async body => { calls.push(body); const reply = replies[body.type]; if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(body) : reply } }
}

/** What PendingRequestActions does on a click: prepare → confirm (straight to submitting) → submit once. */
async function click(store, key, handlers, payload) {
  const before = store.get(key)
  if (receiptBlocksActions(before)) return before // the button is disabled; nothing is sent
  store.dispatch(key, { type: 'prepare', plan: { payload, title: 't' } })
  const submitting = store.dispatch(key, { type: 'confirm', now: 0 })
  assert.equal(submitting.phase, 'submitting')
  try { return store.dispatch(key, { type: 'resolve', value: await handlers.submit(submitting.plan) }) }
  catch (error) { return store.dispatch(key, { type: 'reject', error }) }
}

test('the RPC bodies and receipt keys of a request / notice action', () => {
  const approve = requestActionPayload('approve', 'icqq', 'bot1', friend)
  assert.deepEqual(approve, { action: 'approve', adapter: 'icqq', endpointKey: 'bot1', platformRequestId: 'flag-1', id: 7 })
  assert.deepEqual(requestActionBody(approve, RPC), { type: 'request.approve', adapter: 'icqq', endpointKey: 'bot1', platformRequestId: 'flag-1' })
  assert.deepEqual(requestActionBody(requestActionPayload('reject', 'icqq', 'bot1', friend), RPC).type, 'request.reject')
  assert.deepEqual(requestActionBody(requestActionPayload('consume', 'icqq', 'bot1', friend), RPC), { type: 'request.consumed', rowIds: [7] })
  assert.throws(() => requestActionBody(requestActionPayload('consume', 'icqq', 'bot1', { platformRequestId: 'x' }), RPC))
  assert.equal(requestReceiptKey('icqq', 'bot1', friend), 'side-event:request:icqq:bot1:platform:flag-1', 'one receipt per request')
  assert.notEqual(requestReceiptKey('icqq', 'bot1', friend), requestReceiptKey('icqq', 'bot1', { platformRequestId: 'flag-2' }))
  assert.equal(noticeReceiptKey('icqq', 'bot1', 3), 'side-event:notice:icqq:bot1:3')
})

test('a timed-out approval is 结果未知: the buttons stay blocked, a second click sends nothing, only the list is re-read', async () => {
  const store = createReceiptStore()
  const key = requestReceiptKey('icqq', 'bot1', friend)
  const server = host({ 'request.approve': timeout() })
  let pending = [{ platformRequestId: 'flag-1', id: 7 }]
  let reads = 0
  const handlers = requestActionHandlers({ send: server.send, reload: async () => { reads++; return pending }, rpc: RPC })
  let receipt = await click(store, key, handlers, requestActionPayload('approve', 'icqq', 'bot1', friend))
  assert.equal(receipt.phase, 'unknown')
  assert.equal(receipt.status.kind, 'instance-unavailable')
  assert.equal(receiptBlocksActions(receipt), true, '同意 / 拒绝 / 标记已处理 are disabled')
  // A second 同意, or 拒绝, while it is unknown: nothing is sent and the receipt is not replaced.
  await click(store, key, handlers, requestActionPayload('approve', 'icqq', 'bot1', friend))
  await click(store, key, handlers, requestActionPayload('reject', 'icqq', 'bot1', friend))
  assert.equal(store.dispatch(key, { type: 'reset' }).phase, 'unknown', 'cannot be closed')
  assert.deepEqual(server.calls.map(call => call.type), ['request.approve'], 'one approval on the wire')

  // 刷新待处理列表 while the request is still listed → not applied (未执行, verified): 放弃并重新开始 frees it.
  store.dispatch(key, { type: 'verify' })
  receipt = store.dispatch(key, { type: 'verified', value: await handlers.verify(receipt.plan) })
  assert.equal(receipt.phase, 'failed')
  assert.equal(receipt.verified, true)
  assert.equal(receipt.status.message, '刷新后这条请求仍在待处理列表里，这次操作没有生效。可以放弃后重新操作。', 'says what the re-read showed')
  assert.equal(reads, 1)
  assert.equal(store.dispatch(key, { type: 'reset' }).phase, 'idle')
  assert.deepEqual(server.calls.map(call => call.type), ['request.approve'], 'the check sent no write')

  // Another unknown, then the list no longer has it → applied.
  await click(store, key, handlers, requestActionPayload('approve', 'icqq', 'bot1', friend))
  pending = []
  store.dispatch(key, { type: 'verify' })
  receipt = store.dispatch(key, { type: 'verified', value: await handlers.verify(store.get(key).plan) })
  assert.equal(receipt.phase, 'succeeded')
})

test('a failed re-read keeps the outcome unknown; a read that cannot tell does too', async () => {
  const store = createReceiptStore()
  const key = requestReceiptKey('icqq', 'bot1', friend)
  const server = host({ 'request.approve': timeout() })
  const failing = requestActionHandlers({ send: server.send, reload: async () => { throw timeout() }, rpc: RPC })
  await click(store, key, failing, requestActionPayload('approve', 'icqq', 'bot1', friend))
  store.dispatch(key, { type: 'verify' })
  let receipt
  try { await failing.verify(store.get(key).plan) } catch (error) { receipt = store.dispatch(key, { type: 'verify-failed', error }) }
  assert.equal(receipt.phase, 'unknown')
  const stale = requestActionHandlers({ send: server.send, reload: async () => null, rpc: RPC })
  assert.deepEqual(await stale.verify(store.get(key).plan), { applied: undefined })
  store.dispatch(key, { type: 'verify' })
  assert.equal(store.dispatch(key, { type: 'verified', value: { applied: undefined } }).phase, 'unknown')
})

test('a refusal is 未执行 with its classified reason and frees the buttons; a success settles', async () => {
  const store = createReceiptStore()
  const key = requestReceiptKey('icqq', 'bot1', friend)
  const refused = Object.assign(new Error('Forbidden'), { status: 403, details: { httpStatus: 403 } })
  const handlers = requestActionHandlers({ send: host({ 'request.reject': refused }).send, reload: async () => [], rpc: RPC })
  let receipt = await click(store, key, handlers, requestActionPayload('reject', 'icqq', 'bot1', friend))
  assert.equal(receipt.phase, 'failed')
  assert.equal(receipt.status.kind, 'forbidden', 'shown as 无权限 by statusFromError, not 「操作失败：Forbidden」')
  assert.equal(receiptBlocksActions(receipt), false)
  store.dispatch(key, { type: 'reset' })
  const ok = requestActionHandlers({ send: host({ 'request.consumed': { ok: true } }).send, reload: async () => [], rpc: RPC })
  receipt = await click(store, key, ok, requestActionPayload('consume', 'icqq', 'bot1', friend))
  assert.equal(receipt.phase, 'succeeded')
})

test('标记已读 of a notice is held the same way', async () => {
  const store = createReceiptStore()
  const key = noticeReceiptKey('icqq', 'bot1', 3)
  const server = host({ 'notice.consumed': timeout() })
  const handlers = noticeActionHandlers({ send: server.send, reload: async () => [], rpc: RPC })
  const receipt = await click(store, key, handlers, { id: 3 })
  assert.equal(receipt.phase, 'unknown')
  await click(store, key, handlers, { id: 3 })
  assert.deepEqual(server.calls, [{ type: 'notice.consumed', rowIds: [3] }])
  store.dispatch(key, { type: 'verify' })
  assert.equal(store.dispatch(key, { type: 'verified', value: await handlers.verify(receipt.plan) }).phase, 'succeeded')
})

test('the page renders the receipt per item; no unguarded approve / 操作失败 text remains', () => {
  const page = source('pages/endpoint-detail/index.tsx')
  assert.doesNotMatch(page, /approve\(|dismissRequest\(|dismissNotice\(|actionError|操作失败：/)
  assert.match(page, /<PendingRequestActions adapter=\{adapter\} endpointKey=\{endpointId\} request=\{r\} reload=\{reloadPendingRequests\} onDone=\{forgetRequest\} \/>/)
  assert.match(page, /<NoticeReadAction adapter=\{adapter\} endpointKey=\{endpointId\} id=\{n\.id\} reload=\{reloadUnreadNotices\} onDone=\{forgetNotice\} \/>/)
  const actions = source('pages/endpoint-detail/side-event-actions.tsx')
  assert.match(actions, /persistKey: requestReceiptKey\(adapter, endpointKey, request\)/)
  assert.match(actions, /const blocked = receiptBlocksActions\(receipt\.state\)/)
  for (const label of ['同意', '拒绝']) assert.match(actions, new RegExp(`disabled=\\{blocked\\} onClick=\\{\\(\\) => act\\('(?:approve|reject)'\\)\\}>\\{i18n\\.t\\('${label}'\\)\\}`))
  assert.match(actions, /disabled=\{blocked \|\| request\.id === undefined\} onClick=\{\(\) => act\('consume'\)\}/)
  assert.match(actions, /verifyLabel=\{i18n\.t\('刷新待处理列表'\)\}/)
  const hook = source('pages/endpoint-detail/useEndpointConsole.tsx')
  assert.match(hook, /const reloadPendingRequests = useCallback\(\(\) => loadRequestsFromServer\(\{ strict: true \}\)/)
  assert.match(source('components/ActionReceipt.tsx'), /\{verifyLabel \?\? i18n\.t\('核对当前状态'\)\}/)
  for (const key of ['刷新后这条请求仍在待处理列表里，这次操作没有生效。可以放弃后重新操作。', '刷新后这条请求已不在待处理列表里。', '刷新后这条通知仍是未读，这次操作没有生效。可以放弃后重新操作。', '刷新后这条通知已不在未读列表里。', '同意 {0} 的请求', '拒绝 {0} 的请求', '把 {0} 的请求标记为已处理', '刷新待处理列表', '把这条通知标记为已读', '刷新通知列表']) assert.ok(Object.hasOwn(englishMessages, key), key)
})
