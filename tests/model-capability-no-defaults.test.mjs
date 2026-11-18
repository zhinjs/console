import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { languageInputMissing, withModelKind, withModelProtocol } from '../console-ui/src/pages/inference/model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `model-capability-no-defaults`: ticking 「语言模型」 left every input type unticked, so a language
// model with no input could be saved; a protocol with a single kind still needed that kind ticked by hand.
const read = path => readFileSync(new URL(`../console-ui/src/pages/inference/${path}`, import.meta.url), 'utf8')
const google = { modelContracts: [
  { protocol: 'google-generate-content', kinds: ['language', 'decision'] },
  { protocol: 'google-imagen', kinds: ['image'] },
  { protocol: 'google-chat-only', kinds: ['language'] },
] }

test('ticking 「语言模型」 ticks 「文字」 when no input is declared yet', () => {
  const draft = { id: 'gemini-x', protocol: 'google-generate-content', kinds: [] }
  assert.deepEqual(withModelKind(draft, 'language', true), { ...draft, kinds: ['language'], input: ['text'] })
  // An input already chosen is kept; other kinds do not add one; unticking only removes the kind.
  assert.deepEqual(withModelKind({ ...draft, input: ['image'] }, 'language', true).input, ['image'])
  assert.equal(withModelKind(draft, 'decision', true).input, undefined)
  assert.deepEqual(withModelKind({ ...draft, kinds: ['language', 'decision'], input: ['text'] }, 'language', false), { ...draft, kinds: ['decision'], input: ['text'] })
  assert.deepEqual(withModelKind({ ...draft, kinds: ['language'] }, 'language', true).kinds, ['language'], 'no duplicate kind')
})

test('a protocol whose contract has a single kind selects it; several kinds stay for the user', () => {
  const draft = { id: 'm', protocol: '', kinds: ['decision'], input: ['audio'] }
  assert.deepEqual(withModelProtocol(draft, 'google-imagen', google), { id: 'm', protocol: 'google-imagen', kinds: ['image'] })
  assert.deepEqual(withModelProtocol(draft, 'google-chat-only', google), { id: 'm', protocol: 'google-chat-only', kinds: ['language'], input: ['text'] })
  assert.deepEqual(withModelProtocol(draft, 'google-generate-content', google), { id: 'm', protocol: 'google-generate-content', kinds: [] })
  assert.deepEqual(withModelProtocol(draft, '', google), { id: 'm', protocol: '', kinds: [] })
})

test('a declared language model without any input cannot be saved', () => {
  assert.equal(languageInputMissing({ id: 'm', protocol: 'p', kinds: ['language'], input: [] }), true, 'every input unticked')
  assert.equal(languageInputMissing({ id: 'm', protocol: 'p', kinds: ['language'] }), false, 'a catalog declaration without `input` still saves')
  assert.equal(languageInputMissing({ id: 'm', protocol: 'p', kinds: ['language'], input: ['text'] }), false)
  assert.equal(languageInputMissing({ id: 'm', protocol: 'p', kinds: ['image'] }), false)
  assert.equal(languageInputMissing(null), false)
  const profiles = read('Profiles.tsx')
  // Only the declaration being written is checked: catalog entries from the service keep saving as before.
  assert.match(profiles, /if \(modelDraft && languageInputMissing\(modelDraft\)\) \{ setFormError\(i18n\.t\("语言模型至少要选一种输入类型。"\)\); return \}/)
  assert.notEqual(translate('en', '语言模型至少要选一种输入类型。'), '语言模型至少要选一种输入类型。')
})

test('the capability form uses the defaults', () => {
  const form = read('ModelCapabilities.tsx')
  assert.match(form, /onChange\(withModelProtocol\(value, protocol, driver\)\)/)
  assert.match(form, /onChange\(withModelKind\(value, kind, checked === true\)\)/)
  assert.doesNotMatch(form, /onChange\(\{ id: value\.id, protocol, kinds: \[\] \}\)/)
  // A new model on a driver with one contract starts with that protocol and, when it has one kind, that kind.
  assert.match(read('Profiles.tsx'), /driver\?\.modelContracts\.length === 1 \? withModelProtocol\(\{ id, protocol: '', kinds: \[\] \}, driver\.modelContracts\[0\]\.protocol, driver\)/)
})
