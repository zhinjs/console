import assert from 'node:assert/strict'
import test from 'node:test'
import { draftForModelId } from '../console-ui/src/pages/inference/model.mjs'

// #64 `model-edit-id-resets-capabilities`: changing the model ID while editing cleared protocol, kinds,
// inputs, streaming and tool calling without a word, and all had to be picked again before saving.
const defaults = id => ({ id, protocol: '', kinds: [] })
const native = { id: 'native', protocol: 'chat', kinds: ['language'], input: ['text', 'image'], streaming: true, toolCalling: true }

test('a new ID replacing a catalog model starts from that declaration and names it', () => {
  const { draft, inherited } = draftForModelId('native-2', { replaced: native, defaults })
  assert.deepEqual(draft, { ...native, id: 'native-2' })
  assert.equal(inherited, 'native')
  draft.input.push('audio')
  assert.deepEqual(native.input, ['text', 'image'], 'the catalog declaration is not shared')
})

test('an existing draft keeps its edits; nothing to carry over falls back to the defaults', () => {
  const edited = { ...native, id: 'native-2', streaming: false }
  assert.deepEqual(draftForModelId('native-23', { previous: edited, replaced: native, defaults }), { draft: { ...edited, id: 'native-23' }, inherited: null })
  assert.deepEqual(draftForModelId('fresh', { defaults }), { draft: { id: 'fresh', protocol: '', kinds: [] }, inherited: null })
  assert.deepEqual(draftForModelId('native', { replaced: native, defaults }).inherited, null, 'the same ID is not a replacement')
})
