import test from 'node:test'
import assert from 'node:assert/strict'
import { createFileDraftSessions } from '../console-ui/src/pages/files/draft-session.mjs'
test('navigation restores drafts and selected file in the same Host session without crossing connections', () => {
  const sessions = createFileDraftSessions()
  const a = {}, b = {}
  const current = sessions.get(a)
  current.selected = 'fixture.ts'
  current.drafts.set('fixture.ts', { content: 'edited', originalContent: 'original' })
  assert.equal(sessions.get(a), current)
  assert.equal(sessions.get(a).selected, 'fixture.ts')
  assert.equal(sessions.get(a).drafts.get('fixture.ts').content, 'edited')
  assert.equal(sessions.hasUnsaved(a), true)
  assert.equal(sessions.hasUnsaved(b), false)
  assert.equal(sessions.get(b).selected, null)
  current.drafts.delete('fixture.ts')
  assert.equal(sessions.hasUnsaved(a), false)
})
