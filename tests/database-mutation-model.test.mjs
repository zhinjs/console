import assert from 'node:assert/strict'
import test from 'node:test'
import { createMutationGate, documentTarget, parseDocument, assertNewKey } from '../console-ui/src/pages/database/mutation-model.mjs'

test('pending writes reject same-tick duplicate operations and release after success or error', async () => {
  const gate = createMutationGate()
  let finish
  let calls = 0
  const first = gate.run(async () => { calls++; await new Promise(resolve => { finish = resolve }) })
  assert.equal(gate.pending, true)
  assert.equal(await gate.run(async () => { calls++ }), false)
  assert.equal(calls, 1)
  finish()
  assert.equal(await first, true)
  assert.equal(gate.pending, false)
  await assert.rejects(gate.run(async () => { throw new Error('storage failed') }))
  assert.equal(gate.pending, false)
  assert.equal(await gate.run(async () => { calls++ }), true)
})

test('document mutation refuses broad missing identities and non-object payloads', () => {
  for (const doc of [{}, { _id: null }, { _id: '' }, { _id: {} }]) assert.throws(() => documentTarget(doc))
  assert.deepEqual(documentTarget({ _id: 0 }), { _id: 0 })
  assert.deepEqual(documentTarget({ _id: 'doc-1' }), { _id: 'doc-1' })
  for (const text of ['null', '[]', '42']) assert.throws(() => parseDocument(text))
  assert.deepEqual(parseDocument('{"name":"sample"}'), { name: 'sample' })
})

test('new KV keys reject blank and existing values, including null values', () => {
  assert.throws(() => assertNewKey('  ', []))
  assert.throws(() => assertNewKey('existing', [{ key: 'existing', value: null }]))
  assert.doesNotThrow(() => assertNewKey('new', [{ key: 'existing' }]))
})
