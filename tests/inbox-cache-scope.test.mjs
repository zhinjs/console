import test from 'node:test'
import assert from 'node:assert/strict'
import { createInboxCacheAuthority, selectInboxCache } from '../console-ui/src/utils/inbox-cache-scope.mjs'

test('only the current host and credential identity reuse an opaque scope, with no credential returned', () => {
  let connection = { host: 'https://one.example/', credential: 'private-first-credential' }, serial = 0
  const authority = createInboxCacheAuthority(() => connection, () => `opaque-${++serial}`)
  const first = authority.current(); assert.equal(first, 'opaque-1'); assert.equal(authority.current(), first)
  assert.equal(JSON.stringify(first).includes('credential'), false)
  connection = { ...connection, host: 'https://two.example' }
  assert.equal(authority.active(first), false); const second = authority.current(); assert.equal(second, 'opaque-2')
  connection = { ...connection, credential: 'private-second-credential' }
  assert.equal(authority.active(second), false); assert.equal(authority.current(), 'opaque-3')
  connection = { ...connection, credential: '' }; assert.equal(authority.current(), undefined)
  connection = { host: 'https://one.example', credential: 'private-first-credential' }
  assert.equal(authority.current(), 'opaque-4'); assert.equal(authority.active(first), false)
})

test('cache reads fail closed without scope and do not hydrate legacy, other-host or other-identity rows', () => {
  const base = { adapter: 'icqq', endpoint_id: 'account', kind: 'message', updatedAt: 1 }
  const records = [{ ...base, scope: 'current' }, { ...base }, { ...base, scope: 'old-host' }, { ...base, scope: 'old-identity' }, { ...base, scope: 'current', endpoint_id: 'other' }]
  assert.deepEqual(selectInboxCache(records, undefined, 'icqq', 'account', 'message'), [])
  assert.deepEqual(selectInboxCache(records, 'current', 'icqq', 'account', 'message'), [records[0]])
  assert.deepEqual(selectInboxCache(records, 'current', 'icqq', 'account', 'request'), [])
})

test('current authenticated cache remains bounded and ordered without reintroducing old sessions on page reload', () => {
  const rows = Array.from({ length: 600 }, (_, updatedAt) => ({ scope: 'old-page', adapter: 'a', endpoint_id: 'b', kind: 'notice', updatedAt }))
  assert.equal(selectInboxCache(rows, 'old-page', 'a', 'b', 'notice').length, 500)
  assert.equal(selectInboxCache(rows, 'old-page', 'a', 'b', 'notice')[0].updatedAt, 599)
  assert.deepEqual(selectInboxCache(rows, 'new-page', 'a', 'b', 'notice'), [])
})
