import assert from 'node:assert/strict'
import test from 'node:test'
import {
  maskEnvContent, envEditorAccess, parseEnvRows, maskEnvValue, updateEnvRow, removeEnvRow, appendEnvRow,
  validateEnvRow, diffEnvContent, applyEnvChanges, ENV_MASK_CHAR,
} from '../console-ui/src/pages/env-editor-model.mjs'
import { createFileDraftSessions } from '../console-ui/src/pages/files/draft-session.mjs'
test('fake env fixture masks every secret character without changing the underlying draft', () => {
  const fixture = 'BOT_TOKEN=fake-testing-token\nPORT=18181\nSECRET=${EXTERNAL}\n'
  const rendered = maskEnvContent(fixture)
  assert.equal(rendered.includes('fake-testing-token'), false)
  assert.equal(rendered.includes('PORT=18181'), true)
  assert.equal(rendered.includes('SECRET=${EXTERNAL}'), true)
  assert.equal(fixture.includes('fake-testing-token'), true)
})
test('loading failure, demo and pending save cannot edit; an open row editor blocks saving', () => {
  const ready = { loaded: true, readOnly: false, saving: false, dirty: true }
  assert.deepEqual(envEditorAccess(ready), { canEdit: true, canSave: true })
  for (const patch of [{ loaded: false }, { readOnly: true }, { saving: true }]) {
    assert.deepEqual(envEditorAccess({ ...ready, ...patch }), { canEdit: false, canSave: false })
  }
  assert.deepEqual(envEditorAccess({ ...ready, editing: true }), { canEdit: true, canSave: false })
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

const FIXTURE = '# comment\r\nexport BOT_TOKEN=fake-bot-token\r\nPRIVATE_KEY="fake-first\r\nfake-last"\r\n\r\nPORT = 18181\r\nREF_TOKEN=${EXTERNAL}\r\n'

test('rows list each variable with secret detection; comments, spacing and line endings round-trip untouched', () => {
  const rows = parseEnvRows(FIXTURE)
  assert.deepEqual(rows.map(r => [r.key, r.secret]), [['BOT_TOKEN', true], ['PRIVATE_KEY', true], ['PORT', false], ['REF_TOKEN', false]])
  assert.equal(rows[1].value, '"fake-first\r\nfake-last"')
  assert.equal(maskEnvValue(rows[0].value).includes('fake'), false)
  assert.equal(updateEnvRow(FIXTURE, 'PORT', { key: 'PORT', value: '18181' }), FIXTURE)
  assert.equal(updateEnvRow(FIXTURE, 'PORT', { key: 'PORT', value: '1' }), FIXTURE.replace('PORT = 18181', 'PORT = 1'))
  assert.equal(removeEnvRow(FIXTURE, 'PRIVATE_KEY'), FIXTURE.replace('PRIVATE_KEY="fake-first\r\nfake-last"\r\n', ''))
  assert.equal(appendEnvRow('A=1', { key: 'B', value: '2' }), 'A=1\nB=2\n')
  assert.equal(appendEnvRow(FIXTURE, { key: 'B', value: '2' }), FIXTURE + 'B=2\r\n')
})

test('only changed keys are submitted and every untouched secret is copied byte for byte from the fresh file', () => {
  const draft = appendEnvRow(removeEnvRow(updateEnvRow(FIXTURE, 'PORT', { key: 'PORT', value: '9090' }), 'REF_TOKEN'), { key: 'NEW', value: 'x' })
  const changes = diffEnvContent(FIXTURE, draft)
  assert.deepEqual(changes, [{ type: 'set', key: 'PORT', value: '9090' }, { type: 'set', key: 'NEW', value: 'x' }, { type: 'delete', key: 'REF_TOKEN' }])
  // The page displays masks, but those never become draft text: the saved file keeps the secrets.
  const saved = applyEnvChanges(FIXTURE, changes)
  assert.ok(saved.includes('export BOT_TOKEN=fake-bot-token\r\n'))
  assert.ok(saved.includes('PRIVATE_KEY="fake-first\r\nfake-last"\r\n'))
  assert.equal(saved.includes(ENV_MASK_CHAR), false)
  assert.equal(saved, '# comment\r\nexport BOT_TOKEN=fake-bot-token\r\nPRIVATE_KEY="fake-first\r\nfake-last"\r\n\r\nPORT = 9090\r\nNEW=x\r\n')
  // A secret rotated on the Host after loading is not overwritten by an unrelated edit.
  const rotated = FIXTURE.replace('fake-bot-token', 'rotated-token')
  assert.ok(applyEnvChanges(rotated, changes).includes('BOT_TOKEN=rotated-token'))
  assert.deepEqual(diffEnvContent(FIXTURE, FIXTURE), [])
})

test('a masked placeholder can never be applied or written as a value', () => {
  const masked = maskEnvValue('fake-bot-token')
  assert.equal(validateEnvRow(FIXTURE, { key: 'BOT_TOKEN', value: masked }, 'BOT_TOKEN'), 'value-masked')
  assert.throws(() => applyEnvChanges(FIXTURE, [{ type: 'set', key: 'BOT_TOKEN', value: masked }]), /masked placeholder/)
  // The legacy whole-file display mask must not leak into a save either.
  assert.throws(() => applyEnvChanges(FIXTURE, diffEnvContent(FIXTURE, maskEnvContent(FIXTURE))), /masked placeholder/)
})

test('row validation rejects empty, malformed, duplicate names and unquoted multi-line values', () => {
  assert.equal(validateEnvRow(FIXTURE, { key: ' ', value: '1' }, null), 'key-required')
  assert.equal(validateEnvRow(FIXTURE, { key: 'BAD KEY', value: '1' }, null), 'key-invalid')
  assert.equal(validateEnvRow(FIXTURE, { key: 'PORT', value: '1' }, null), 'key-duplicate')
  assert.equal(validateEnvRow(FIXTURE, { key: 'PORT', value: '1' }, 'PORT'), null)
  assert.equal(validateEnvRow(FIXTURE, { key: 'NOTE', value: 'a\nb' }, null), 'value-multiline')
  assert.equal(validateEnvRow(FIXTURE, { key: 'NOTE', value: '"a\nb"' }, null), null)
})

test('a key assigned twice is one row whose edit and delete apply to every assignment', () => {
  const twice = 'A=1\nB=2\nA=3\n'
  assert.deepEqual(parseEnvRows(twice), [{ key: 'A', value: '3', secret: false }, { key: 'B', value: '2', secret: false }])
  assert.equal(updateEnvRow(twice, 'A', { key: 'A', value: '9' }), 'A=9\nB=2\nA=9\n')
  assert.equal(removeEnvRow(twice, 'A'), 'B=2\n')
  assert.equal(applyEnvChanges(twice, diffEnvContent(twice, updateEnvRow(twice, 'A', { key: 'A', value: '9' }))), 'A=9\nB=2\nA=9\n')
})
