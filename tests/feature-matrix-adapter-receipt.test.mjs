import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { adapterSwitchHandlers, adapterSwitchPayload, featureReceiptKey } from '../console-ui/src/pages/features/adapter-switch-model.mjs'
import { receiptBlocksActions, receiptReducer } from '../console-ui/src/components/action-receipt-model.mjs'

// #64 `feature-matrix-adapter-receipt`: an adapter cell of /features answered an unknown outcome with a
// 「保存失败」 toast and released the switch, so a second click sent `feature.set-enabled` again.
const source = path => readFileSync(new URL(`../console-ui/src/pages/features/${path}`, import.meta.url), 'utf8')
const timeout = () => Object.assign(new Error('The instance did not answer in time'), { details: { httpStatus: 504, serverCode: 'instance_timeout', requestOutcome: 'unknown' } })

function host(replies) {
  const calls = []
  return { calls, request: async body => { calls.push(body); const reply = replies[body.type]; if (reply instanceof Error) throw reply; return typeof reply === 'function' ? reply(body) : reply } }
}

/** Drives the receipt reducer the way useActionReceipt does: prepare → confirm (→ confirm again for danger) → submit. */
async function run(handlers, payload, danger = false) {
  let receipt = receiptReducer(undefined, { type: 'prepare', plan: { payload, title: 't', danger } })
  receipt = receiptReducer(receipt, { type: 'confirm', now: 0 })
  if (danger) receipt = receiptReducer(receipt, { type: 'submit', now: 10_000 })
  assert.equal(receipt.phase, 'submitting')
  try { return receiptReducer(receipt, { type: 'resolve', value: await handlers.submit(receipt.plan) }) }
  catch (error) { return receiptReducer(receipt, { type: 'reject', error }) }
}

test('an unknown outcome keeps the cell blocked and offers only a read-only check; nothing is sent twice', async () => {
  const fake = host({ 'feature.set-enabled': timeout(), 'feature.get': { plugin: 'repeater', level: 'adapter', key: 'icqq', revision: 'r2', levels: ['global', 'adapter'], schema: null, values: {}, effective: {}, sources: {}, enabled: false } })
  let reloads = 0
  const handlers = adapterSwitchHandlers({ plugin: 'repeater', adapter: 'icqq', request: fake.request, reload: () => { reloads++ } })
  let receipt = await run(handlers, adapterSwitchPayload({ plugin: 'repeater', adapter: 'icqq', enabled: false, revision: 'r1' }), true)
  assert.equal(receipt.phase, 'unknown', '结果未知, not 保存失败')
  assert.equal(receiptBlocksActions(receipt), true, 'the switch stays disabled')
  assert.equal(receiptReducer(receipt, { type: 'prepare', plan: { payload: {}, title: 'again' } }), receipt, 'a new click cannot replace it')
  assert.deepEqual(fake.calls.map(call => call.type), ['feature.set-enabled'])
  assert.deepEqual(fake.calls[0], { type: 'feature.set-enabled', plugin: 'repeater', level: 'adapter', key: 'icqq', enabled: false, expectedRevision: 'r1' })
  assert.equal(reloads, 1)
  // 核对当前状态: reads feature.get only, and settles the receipt from what it shows.
  receipt = receiptReducer(receipt, { type: 'verify' })
  receipt = receiptReducer(receipt, { type: 'verified', value: await handlers.verify(receipt.plan) })
  assert.equal(receipt.phase, 'succeeded')
  assert.deepEqual(fake.calls.map(call => call.type), ['feature.set-enabled', 'feature.get'])
  assert.deepEqual(fake.calls[1], { type: 'feature.get', plugin: 'repeater', level: 'adapter', key: 'icqq' })
})

test('a refusal is 未执行 and frees the switch; a saved write is read back', async () => {
  const refused = Object.assign(new Error('Forbidden'), { status: 403, details: { httpStatus: 403 } })
  let handlers = adapterSwitchHandlers({ plugin: 'rss', adapter: 'qq', request: host({ 'feature.set-enabled': refused }).request, reload: () => {} })
  let receipt = await run(handlers, adapterSwitchPayload({ plugin: 'rss', adapter: 'qq', enabled: true }))
  assert.equal(receipt.phase, 'failed')
  assert.equal(receiptBlocksActions(receipt), false)

  const fake = host({
    'feature.set-enabled': { status: 'saved', revision: 'r3', restartRequired: false, warnings: [] },
    'feature.get': { plugin: 'rss', level: 'adapter', key: 'qq', revision: 'r3', levels: ['global', 'adapter'], schema: null, values: {}, effective: {}, sources: {}, enabled: true },
  })
  handlers = adapterSwitchHandlers({ plugin: 'rss', adapter: 'qq', request: fake.request, reload: () => {} })
  receipt = await run(handlers, adapterSwitchPayload({ plugin: 'rss', adapter: 'qq', enabled: true }))
  assert.equal(receipt.phase, 'succeeded')
  assert.equal(receipt.mismatch, undefined)
  assert.deepEqual(fake.calls.map(call => call.type), ['feature.set-enabled', 'feature.get'])
})

test('the matrix and the adapter 功能 tab share one receipt per plugin and adapter', () => {
  assert.equal(featureReceiptKey('adapter', 'icqq', 'repeater'), 'feature:adapter:icqq:repeater')
  const matrix = source('feature-matrix.tsx')
  assert.match(matrix, /persistKey: featureReceiptKey\('adapter', adapter, plugin\)/)
  assert.match(matrix, /canToggle=\{canToggle && !busy\}/, 'blocked while a write is in flight or unknown')
  assert.doesNotMatch(matrix, /useFeatureWriter/, 'no toast-only writer')
  assert.match(source('feature-level-panel.tsx'), /persistKey: featureReceiptKey\(level, levelKey, feature\.plugin\)/)
  assert.doesNotMatch(source('use-feature-data.ts'), /toast\.error\(error instanceof Error \? error\.message : String\(error\), i18n\.t\("保存失败"\)\)/)
})
