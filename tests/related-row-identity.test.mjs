import assert from 'node:assert/strict'
import test from 'node:test'
import { relatedPrimaryKeys, relatedRowIdentity } from '../console-ui/src/pages/database/related-row-identity.mjs'

test('composite identity includes every declared key and uses original values', () => {
  const keys = relatedPrimaryKeys({ tenant: { primary: true }, record_key: { primary: true }, message: {} })
  assert.deepEqual(keys, ['tenant', 'record_key'])
  const original = { tenant: 'same', record_key: 'one', message: 'before' }
  assert.deepEqual(relatedRowIdentity(keys, original), { tenant: 'same', record_key: 'one' })
  assert.notDeepEqual(relatedRowIdentity(keys, original), relatedRowIdentity(keys, { ...original, record_key: 'two' }))
  assert.deepEqual(relatedRowIdentity(['id'], { id: 0 }), { id: 0 })
})

test('missing metadata or any missing key cannot produce a broad update/delete condition', () => {
  assert.deepEqual(relatedPrimaryKeys(), [])
  assert.deepEqual(relatedPrimaryKeys({ name: {} }), [])
  assert.throws(() => relatedRowIdentity([], { name: 'same' }), /未声明主键/)
  for (const row of [{ tenant: 'same' }, { tenant: 'same', record_key: null }]) assert.throws(() => relatedRowIdentity(['tenant', 'record_key'], row), /缺少主键/)
})
