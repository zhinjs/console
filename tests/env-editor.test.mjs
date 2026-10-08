import assert from 'node:assert/strict'
import test from 'node:test'
import { maskEnvContent, envEditorAccess } from '../console-ui/src/pages/env-editor-model.mjs'
import { createFileDraftSessions } from '../console-ui/src/pages/files/draft-session.mjs'
test('fake env fixture masks every secret character without changing the underlying draft', () => {
  const fixture = 'BOT_TOKEN=fake-testing-token\nPORT=18181\nSECRET=${EXTERNAL}\n'
  const rendered = maskEnvContent(fixture)
  assert.equal(rendered.includes('fake-testing-token'), false)
  assert.equal(rendered.includes('PORT=18181'), true)
  assert.equal(rendered.includes('SECRET=${EXTERNAL}'), true)
  assert.equal(fixture.includes('fake-testing-token'), true)
})
test('loading failure, masking, demo and pending save cannot edit; loaded dirty content may save while masked', () => {
  const ready = { loaded: true, readOnly: false, saving: false, masked: false, dirty: true }
  assert.deepEqual(envEditorAccess(ready), { canEdit: true, canSave: true })
  for (const patch of [{ loaded: false }, { readOnly: true }, { saving: true }]) {
    assert.deepEqual(envEditorAccess({ ...ready, ...patch }), { canEdit: false, canSave: false })
  }
  assert.deepEqual(envEditorAccess({ ...ready, masked: true }), { canEdit: false, canSave: true })
  assert.equal(envEditorAccess({ ...ready, dirty: false }).canSave, false)
})
test('fake env tab drafts survive tab switches and isolate Host clients', () => {
  const sessions = createFileDraftSessions(), host = {}, otherHost = {}
  const session = sessions.get(host)
  session.drafts.set('.env', { content: 'PORT=12', originalContent: 'PORT=11' })
  session.selected = '.env.development'
  session.drafts.set('.env.development', { content: 'PORT=22', originalContent: 'PORT=21' })
  assert.equal(sessions.get(host).drafts.get('.env').content, 'PORT=12')
  assert.equal(sessions.get(otherHost).drafts.size, 0)
})

test('multiline secrets are masked throughout while line endings and ordinary values remain intact', () => {
  for (const quote of ['"', "'", '`']) {
    const fixture = `export PRIVATE_KEY=${quote}fake-first\r\nfake-second\r\nfake-last${quote}\r\nPORT=18181\r\n`
    const rendered = maskEnvContent(fixture)
    assert.equal(/fake-(first|second|last)/.test(rendered), false)
    assert.equal(rendered.split('\r\n').length, fixture.split('\r\n').length)
    assert.ok(rendered.endsWith('PORT=18181\r\n'))
  }
  const ordinary = 'DESCRIPTION="first\nTOKEN=ordinary-text\nlast"\nPORT=18181'
  assert.equal(maskEnvContent(ordinary), ordinary)
})
test('only a complete variable reference is visible and escaped quotes do not end a secret early', () => {
  assert.equal(maskEnvContent('TOKEN=${EXTERNAL}'), 'TOKEN=${EXTERNAL}')
  assert.equal(maskEnvContent('TOKEN=${EXTERNAL}-fake-secret').includes('fake-secret'), false)
  const fixture = String.raw`TOKEN="fake\"first` + '\nfake-second"\nPORT=18181'
  assert.equal(maskEnvContent(fixture).includes('fake-second'), false)
  assert.ok(maskEnvContent(fixture).endsWith('PORT=18181'))
})
