import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { modelEntryView } from '../console-ui/src/pages/inference/model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `model-add-empty-catalog`: adding a model on an account whose service has no built-in catalog
// showed a picker holding only 「选择模型」; typing an ID took finding the small 「输入模型 ID」 button.
const source = readFileSync(new URL('../console-ui/src/pages/inference/Profiles.tsx', import.meta.url), 'utf8')

test('with nothing in the catalog the model field is a text input with a hint, not an empty picker', () => {
  assert.deepEqual(modelEntryView({ choiceCount: 0, discovery: true }), { input: true, canToggle: false, hint: 'discoverable' })
  assert.deepEqual(modelEntryView({ choiceCount: 0, discovery: false }), { input: true, canToggle: false, hint: 'manual-only' })
  assert.deepEqual(modelEntryView({ choiceCount: 0, discovery: true, discovered: true }), { input: true, canToggle: false, hint: 'none-returned' })
  // Manual entry chosen earlier does not matter: there is no catalog to go back to.
  assert.deepEqual(modelEntryView({ choiceCount: 0, manualEntry: true }), { input: true, canToggle: false, hint: 'manual-only' })
})

test('a catalog keeps the picker and the switch to manual entry; editing keeps its text input', () => {
  assert.deepEqual(modelEntryView({ choiceCount: 3, discovery: true }), { input: false, canToggle: true, hint: null })
  assert.deepEqual(modelEntryView({ choiceCount: 3, manualEntry: true }), { input: true, canToggle: true, hint: null })
  assert.deepEqual(modelEntryView({ editing: true, choiceCount: 0 }), { input: true, canToggle: true, hint: null })
})

test('the dialog follows the view and says each hint in both languages', () => {
  assert.match(source, /modelEntryView\(\{ editing: !!profile, manualEntry, choiceCount: choices\.length, discovery: driver\?\.discovery === true, discovered \}\)/)
  assert.match(source, /\{entry\.input \? \(/)
  assert.doesNotMatch(source, /\{manualEntry \|\| profile \? \(/, 'the old condition showed the empty picker')
  assert.match(source, /\{entry\.canToggle \? <Button/)
  assert.match(source, /setDiscovered\(true\)/, 'an empty discovery result says so')
  assert.match(source, /setDiscovered\(false\)/, 'another account starts over')
  for (const text of ['这个服务没有内置模型目录，可以从服务读取，或者手填模型 ID。', '这个服务没有内置模型目录，请手填模型 ID。', '服务没有返回任何模型，请手填模型 ID。']) {
    assert.ok(source.includes(`i18n.t("${text}")`), text)
    assert.notEqual(translate('en', text), text, `${text} has an English entry`)
  }
})
