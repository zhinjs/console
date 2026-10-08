import test from 'node:test'
import assert from 'node:assert/strict'
import { createWorkroomDraftSessions } from '../console-ui/src/pages/workroom-draft-session.mjs'

test('restored unpublished draft retains its original revision for conflict detection', () => {
  const sessions = createWorkroomDraftSessions(), host = {}
  const original = { catalog: { revision: 'original', workrooms: { alpha: { name: 'saved' } } }, drafts: [{ projectId: 'alpha', name: 'edited' }] }
  sessions.set(host, original)
  original.catalog.revision = 'external-new-version'
  original.drafts[0].name = 'mutated'
  assert.equal(sessions.get(host).catalog.revision, 'original')
  assert.equal(sessions.get(host).drafts[0].name, 'edited')
  assert.equal(sessions.hasUnsaved(host), true)
  sessions.clear(host)
  assert.equal(sessions.hasUnsaved(host), false)
})

test('drafts cannot leak into another Host connection or reconnect', () => {
  const sessions = createWorkroomDraftSessions(), hostA = {}, hostB = {}
  sessions.set(hostA, { catalog: { revision: 'a' }, drafts: ['a-draft'] })
  assert.equal(sessions.get(hostB), undefined)
  assert.equal(sessions.get({}), undefined)
  sessions.set(hostB, { catalog: { revision: 'b' }, drafts: ['b-draft'] })
  sessions.clear(hostA)
  assert.deepEqual(sessions.get(hostB).drafts, ['b-draft'])
})
