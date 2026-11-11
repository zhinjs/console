import test from 'node:test'
import assert from 'node:assert/strict'

const model = await import('../console-ui/src/pages/endpoint-detail/composer-draft-model.mjs')
const { conversationSelectionKey, readComposerDraft, writeComposerDraft, isImeComposing, shouldSubmitOnEnter } = model

const group = (id, extra = {}) => ({ type: 'channel', channelType: 'group', id, name: `群 ${id}`, ...extra })

test('conversation draft key identifies the exact conversation, not its display name', () => {
  assert.equal(conversationSelectionKey(null), null)
  assert.equal(conversationSelectionKey({ type: 'requests' }), null)
  assert.equal(conversationSelectionKey({ type: 'notices' }), null)
  assert.equal(conversationSelectionKey(group('1')), conversationSelectionKey({ ...group('1'), name: '改名后' }))
  assert.notEqual(conversationSelectionKey(group('1')), conversationSelectionKey(group('2')))
  assert.notEqual(conversationSelectionKey(group('1')), conversationSelectionKey({ ...group('1'), channelType: 'private' }))
  const channel = { type: 'channel', channelType: 'channel', id: 'c', name: 'c' }
  assert.notEqual(conversationSelectionKey({ ...channel, parent: { type: 'guild', id: 'g1' } }), conversationSelectionKey({ ...channel, parent: { type: 'guild', id: 'g2' } }))
  assert.notEqual(conversationSelectionKey({ ...channel, threadId: 't1' }), conversationSelectionKey(channel))
})

test('drafts are stored and restored per conversation and empty drafts are dropped', () => {
  const a = conversationSelectionKey(group('a')), b = conversationSelectionKey(group('b'))
  let drafts = {}
  drafts = writeComposerDraft(drafts, a, '发给 A')
  assert.equal(readComposerDraft(drafts, a, ''), '发给 A')
  assert.equal(readComposerDraft(drafts, b, ''), '', 'another conversation never sees the draft')
  drafts = writeComposerDraft(drafts, b, '发给 B')
  assert.equal(readComposerDraft(drafts, a, ''), '发给 A')
  assert.equal(readComposerDraft(drafts, b, ''), '发给 B')
  const same = writeComposerDraft(drafts, a, '发给 A')
  assert.strictEqual(same, drafts, 'unchanged writes keep identity')
  drafts = writeComposerDraft(drafts, a, '')
  assert.equal(Object.hasOwn(drafts, a), false)
  assert.equal(readComposerDraft(drafts, a, 'fallback'), 'fallback')
  assert.strictEqual(writeComposerDraft(drafts, null, 'x'), drafts, 'no conversation means nothing is stored')
  assert.equal(readComposerDraft(drafts, null, ''), '')
  const extras = writeComposerDraft({}, a, { attachments: [] }, value => value.attachments.length === 0)
  assert.deepEqual(extras, {})
})

test('Enter while an input method is composing never submits', () => {
  assert.equal(isImeComposing({ key: 'Enter', nativeEvent: { isComposing: true } }), true)
  assert.equal(isImeComposing({ key: 'Enter', isComposing: true }), true)
  assert.equal(isImeComposing({ key: 'Process', keyCode: 229 }), true)
  assert.equal(isImeComposing({ key: 'Enter', nativeEvent: { keyCode: 229 } }), true)
  assert.equal(isImeComposing({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: false } }), false)
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', keyCode: 13, nativeEvent: { isComposing: true } }), false)
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', keyCode: 229 }), false)
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', keyCode: 13, nativeEvent: {} }), true)
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true, keyCode: 13 }), false, 'Shift+Enter inserts a line break')
  assert.equal(shouldSubmitOnEnter({ key: 'Enter', shiftKey: true, keyCode: 13 }, { allowShift: true }), true)
  assert.equal(shouldSubmitOnEnter({ key: 'a', keyCode: 65 }), false)
})

test('after a send only the sent attachments and references are cleared', () => {
  const { EMPTY_COMPOSER_EXTRAS, isEmptyComposerExtras, clearSentComposerExtras } = model
  assert.equal(isEmptyComposerExtras(EMPTY_COMPOSER_EXTRAS), true)
  assert.equal(isEmptyComposerExtras({ ...EMPTY_COMPOSER_EXTRAS, mediaUrl: 'x' }), false)
  const quote = { id: 'q' }, image = { id: 'img' }, late = { id: 'late' }
  const sent = { ...EMPTY_COMPOSER_EXTRAS, attachments: [image], quote, mediaPanel: 'image' }
  assert.equal(isEmptyComposerExtras(clearSentComposerExtras(sent, sent)), true)
  const current = { ...sent, attachments: [image, late], forward: null }
  assert.deepEqual(clearSentComposerExtras(current, sent), { attachments: [late], quote: null, forward: null, mediaPanel: null, mediaUrl: '' })
  const otherQuote = { id: 'q2' }
  assert.equal(clearSentComposerExtras({ ...current, quote: otherQuote }, sent).quote, otherQuote, 'a quote picked during the send is kept')
})
