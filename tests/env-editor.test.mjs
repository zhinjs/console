import assert from 'node:assert/strict'
import test from 'node:test'
import {
  maskEnvContent, envEditorAccess, parseEnvRows, maskEnvValue, updateEnvRow, removeEnvRow, appendEnvRow,
  validateEnvRow, diffEnvContent, applyEnvChanges, envReadBackMismatch, ENV_MASK_CHAR,
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

// ---- masking Hosts (zhinjs/zhin#1250) ----
import * as maskedModel from '../console-ui/src/pages/env-editor-model.mjs'
const RUN = ENV_MASK_CHAR.repeat(8)
const MASKED_VIEW = { format: 'masked', file: '.env', lines: [], content: '', variables: [
  { key: 'A', masked: RUN, hasValue: true }, { key: 'B', masked: `ab${RUN}yz`, hasValue: true, isReference: true },
] }

test('env:get replies are told apart: masked view vs an older Host returning the file', () => {
  const masked = maskedModel.readEnvReply(MASKED_VIEW)
  assert.equal(masked.kind, 'masked')
  assert.deepEqual(masked.view.variables.map(v => v.key), ['A', 'B'])
  assert.equal(masked.view.variables[1].isReference, true)
  assert.deepEqual(maskedModel.readEnvReply({ content: 'A=1' }), { kind: 'legacy', content: 'A=1' })
  assert.deepEqual(maskedModel.readEnvReply(null), { kind: 'legacy', content: '' })
})

test('values typed here are masked by the Host rule and mask placeholders are recognised', () => {
  assert.equal(maskedModel.maskEnvDisplay(''), '')
  assert.equal(maskedModel.maskEnvDisplay('12345678'), RUN)
  assert.equal(maskedModel.maskEnvDisplay('123456789'), RUN)
  assert.equal(maskedModel.maskEnvDisplay('1234567890123456'), `12${RUN}56`)
  for (const value of [RUN, `ab${RUN}yz`, '●', '"●●"']) assert.equal(maskedModel.isEnvMaskPlaceholder(value), true, value)
  for (const value of ['plain', 'a●b', '']) assert.equal(maskedModel.isEnvMaskPlaceholder(value), false, value)
})

test('pending changes: set replaces, deleting an added key drops it, rows follow the changes', () => {
  let changes = maskedModel.setEnvChange([], 'A', '1')
  changes = maskedModel.setEnvChange(changes, 'A', '2')
  changes = maskedModel.setEnvChange(changes, 'NEW', 'x')
  changes = maskedModel.deleteEnvChange(MASKED_VIEW, changes, 'B')
  assert.deepEqual(changes, [{ key: 'A', value: '2' }, { key: 'NEW', value: 'x' }, { key: 'B', delete: true }])
  assert.deepEqual(maskedModel.maskedEnvRows(MASKED_VIEW, changes).map(row => [row.key, row.pending]), [['A', '2'], ['NEW', 'x']])
  assert.deepEqual(maskedModel.deleteEnvChange(MASKED_VIEW, changes, 'NEW'), [{ key: 'A', value: '2' }, { key: 'B', delete: true }])
})

test('masked rows validate like the Host: placeholders, duplicates and line injection are refused', () => {
  const check = (row, original = null) => maskedModel.validateMaskedEnvRow(MASKED_VIEW, [], row, original)
  assert.equal(check({ key: 'C', value: `ab${RUN}yz` }), 'value-masked')
  assert.equal(check({ key: 'A', value: '1' }), 'key-duplicate')
  assert.equal(check({ key: 'A', value: '1' }, 'A'), null)
  assert.equal(check({ key: 'C', value: '1\nINJECTED=1' }), 'value-multiline')
  assert.equal(check({ key: 'C', value: '"1"\nINJECTED=1' }), 'value-multiline')
  assert.equal(check({ key: 'C', value: '"line 1\nline 2"' }), null)
  assert.equal(check({ key: 'bad key', value: '1' }), 'key-invalid')
})

test('read-back after a per-key save checks presence only and never shows values', () => {
  const changes = [{ key: 'A', value: 'fake-new' }, { key: 'GONE', delete: true }]
  assert.equal(maskedModel.maskedEnvReadBackMismatch(changes, MASKED_VIEW), null)
  const missing = maskedModel.maskedEnvReadBackMismatch([{ key: 'C', value: 'fake-new-value' }], MASKED_VIEW)
  assert.equal(missing.path, 'C'); assert.equal(missing.masked, true)
  assert.doesNotMatch(JSON.stringify(missing), /fake-new/)
  assert.equal(maskedModel.maskedEnvReadBackMismatch([{ key: 'A', delete: true }], MASKED_VIEW).path, 'A')
})

// ---- the Host's masking rule (zhinjs/zhin#1250, `@zhin.js/console-protocol` `maskConsoleEnvValue`) ----

test('masking matches the Host: under 16 characters only the mask, longer ones 2 + mask + 2, by characters', () => {
  const { maskEnvValueAsRead: mask, ENV_MASK_REVEAL_MIN_LENGTH, ENV_MASK_RUN } = maskedModel
  assert.equal(ENV_MASK_REVEAL_MIN_LENGTH, 16)
  assert.equal(ENV_MASK_RUN, 8)
  // The Host's own test vectors (packages/console/protocol/tests/env.test.ts).
  assert.equal(mask(''), '')
  assert.equal(mask('1'), RUN)
  assert.equal(mask('12345678'), RUN)
  assert.equal(mask('123456789'), RUN)
  assert.equal(mask('123456789012345'), RUN)
  assert.equal(mask('1234567890123456'), `12${RUN}56`)
  assert.equal(mask('sk-fake-0123456789abcdef'), `sk${RUN}ef`)
  assert.equal(mask('密钥密钥密钥密钥密钥'), RUN)
  assert.equal(mask('密钥'.repeat(8)), `密钥${RUN}密钥`)
  assert.equal(mask('😀'.repeat(16)), `😀😀${RUN}😀😀`, 'characters, not UTF-16 units')
})

test('the mask never tells the length: every masked form has a fixed width', () => {
  const widths = new Set()
  for (const length of [1, 2, 8, 15]) widths.add(maskedModel.maskEnvDisplay('x'.repeat(length)))
  assert.deepEqual([...widths], [RUN])
  const long = [16, 17, 64, 900].map(length => maskedModel.maskEnvDisplay('y'.repeat(length)))
  assert.equal(new Set(long).size, 1)
  // The legacy editor and its whole-file display use the same rule.
  assert.equal(maskEnvValue('fake-bot-token'), RUN)
  assert.equal(maskEnvValue('x'.repeat(900)), maskEnvValue('x'.repeat(16)))
  assert.equal(maskEnvContent('BOT_TOKEN=abc\nAPI_TOKEN=abcdefghijklmn\n'), `BOT_TOKEN=${RUN}\nAPI_TOKEN=${RUN}\n`)
  for (const quote of ['"', "'", '`']) {
    const masked = maskEnvContent(`PRIVATE_KEY=${quote}a\nbb\n${'c'.repeat(40)}${quote}\nPORT=1`)
    assert.equal(masked, `PRIVATE_KEY=${RUN}\n${RUN}\n${RUN}\nPORT=1`)
  }
})

test('values are masked as dotenv reads them, quotes and inline comments handled like the Host', () => {
  // [as written after KEY=, as dotenv 17 reads it] — checked against dotenv's own parse.
  const cases = [
    ['new-plain', 'new-plain'],
    ['"new quoted"', 'new quoted'],
    ["'new single'", 'new single'],
    ['`bt`', 'bt'],
    ['"new\nmulti"', 'new\nmulti'],
    ['"esc\\nline"', 'esc\nline'],
    ["'esc\\nline'", 'esc\\nline'],
    ['  spaced  ', 'spaced'],
    [' "  padded quoted value  " ', '  padded quoted value  '],
    ['value # inline comment', 'value'],
    ['"ok" # c', 'ok'],
    ['p#ss', 'p'],
    ['"x"zz', '"x"zz'],
    ['"unterminated', '"unterminated'],
    ["'it''s'", "it''s"],
    ["it's", "it's"],
    ['"a\\"b"', 'a\\"b'],
    ['${A}', '${A}'],
    ['"fake-first\r\nfake-second\r\nfake-last"', 'fake-first\nfake-second\nfake-last'],
    ['', ''],
  ]
  for (const [raw, read] of cases) {
    assert.equal(maskedModel.envValueAsRead(raw), read, JSON.stringify(raw))
    assert.equal(maskedModel.maskEnvDisplay(raw), maskedModel.maskEnvValueAsRead(read), JSON.stringify(raw))
  }
  // Quotes are not counted: a 14-character secret in quotes stays fully masked.
  assert.equal(maskedModel.maskEnvDisplay('"fake-bot-token"'), RUN)
  assert.equal(maskedModel.maskEnvDisplay('"sk-fake-0123456789abcdef"'), `sk${RUN}ef`)
  assert.equal(maskedModel.maskEnvDisplay("'sk-fake-0123456789abcdef'"), `sk${RUN}ef`)
  assert.equal(maskedModel.maskEnvDisplay('sk-fake-0123456789abcdef # rotated'), `sk${RUN}ef`)
  // A row added here with only quotes or a comment has no value, like the Host's `hasValue`.
  const rows = maskedModel.maskedEnvRows({ file: '.env', variables: [] }, [{ key: 'Q', value: '""' }, { key: 'R', value: '"sk-fake-0123456789abcdef"' }])
  assert.deepEqual(rows.map(row => [row.key, row.masked, row.hasValue, 'length' in row]), [['Q', '', false, false], ['R', `sk${RUN}ef`, true, false]])
})

test('a length sent by an older Host is not kept; placeholders follow the Host rule everywhere', () => {
  const reply = maskedModel.readEnvReply({ format: 'masked', file: '.env', lines: [], content: '', variables: [{ key: 'A', masked: RUN, length: 3, hasValue: true }] })
  assert.equal('length' in reply.view.variables[0], false)
  // The Host's own placeholder vectors.
  for (const value of [RUN, `sk${RUN}ef`, '●', '●●', '"●●"', ' ●●●● ', 'prefix●●●suffix']) assert.equal(maskedModel.isEnvMaskPlaceholder(value), true, value)
  for (const value of ['', 'plain', 'a●b', '●a', '${TOKEN}']) assert.equal(maskedModel.isEnvMaskPlaceholder(value), false, value)
  // The legacy editor refuses a partially masked value too (it holds a run of mask characters).
  assert.equal(validateEnvRow(FIXTURE, { key: 'BOT_TOKEN', value: `sk${RUN}ef` }, 'BOT_TOKEN'), 'value-masked')
  assert.throws(() => applyEnvChanges(FIXTURE, [{ type: 'set', key: 'BOT_TOKEN', value: `sk${RUN}ef` }]), /masked placeholder/)
})

test('a secret read back differently is shown by the Host mask, never with its length', () => {
  const mismatch = envReadBackMismatch('BOT_TOKEN=fake-new-token-0123456789\n', 'BOT_TOKEN=fake-old\n')
  assert.deepEqual(mismatch, { path: 'BOT_TOKEN', submitted: `fa${RUN}89`, readBack: RUN, masked: true })
  assert.deepEqual(envReadBackMismatch('API_TOKEN=x\n', ''), { path: 'API_TOKEN', submitted: RUN, readBack: null, masked: true })
  assert.deepEqual(envReadBackMismatch('PORT=1\n', 'PORT=2\n'), { path: 'PORT', submitted: '"1"', readBack: '"2"' })
})

test('the Console masks with the published Host rule (`@zhin.js/console-protocol`), not a copy of it', async () => {
  const protocol = await import('@zhin.js/console-protocol')
  assert.equal(maskedModel.ENV_MASK_CHAR, protocol.ENV_MASK_CHAR)
  assert.equal(maskedModel.ENV_MASK_RUN, protocol.ENV_MASK_RUN)
  assert.equal(maskedModel.ENV_MASK_REVEAL_MIN_LENGTH, protocol.ENV_MASK_REVEAL_MIN_LENGTH)
  for (const value of ['', 'a', '123456789012345', '1234567890123456', '😀'.repeat(16), `ab${RUN}yz`]) {
    assert.equal(maskedModel.maskEnvValueAsRead(value), protocol.maskConsoleEnvValue(value), value)
  }
  for (const value of [RUN, `ab${RUN}yz`, '●', '"●●"', ' ●● ', 'plain', 'a●b', '']) {
    assert.equal(maskedModel.isEnvMaskPlaceholder(value), protocol.isConsoleEnvMaskPlaceholder(value), value)
  }
  // Non-string input (an absent value) is still safe: the empty mask, not a thrown error.
  assert.equal(maskedModel.maskEnvValueAsRead(undefined), '')
  assert.equal(maskedModel.isEnvMaskPlaceholder(undefined), false)
})
