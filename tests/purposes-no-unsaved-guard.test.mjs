import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { purposesDirty } from '../console-ui/src/pages/inference/model.mjs'

// #64 `purposes-no-unsaved-guard`: 用途 is one big form whose only 保存 is at the top. After changing an
// adapter's model further down nothing showed there were unsaved changes (保存 looked the same either
// way), and leaving the page, switching to 模型 or reloading dropped the edit without a word.
const read = path => readFileSync(new URL(`../console-ui/src/pages/inference/${path}`, import.meta.url), 'utf8')
const original = {
  defaults: { chat: 'a', chatFallbacks: ['b'], summary: 'a', perception: { profile: 'v' } },
  decisions: { skills: { profile: 'd', mode: 'on' } },
  agents: { planner: 'a' },
  agentFallbacks: {},
  adapters: { sandbox: { chat: 'b' } },
  endpoints: {},
  scenes: {},
}

test('a draft equal to what was read is clean, whatever order or empty containers it has', () => {
  assert.equal(purposesDirty(structuredClone(original), original), false)
  const reordered = { scenes: {}, endpoints: {}, adapters: { sandbox: { chat: 'b' } }, agentFallbacks: {}, agents: { planner: 'a' }, decisions: { skills: { mode: 'on', profile: 'd' } }, defaults: { perception: { profile: 'v' }, summary: 'a', chatFallbacks: ['b'], chat: 'a' } }
  assert.equal(purposesDirty(reordered, original), false)
})

test('changing an adapter, a default, a decision or removing an override makes it dirty', () => {
  const edit = change => { const draft = structuredClone(original); change(draft); return purposesDirty(draft, original) }
  assert.equal(edit(d => { d.adapters.sandbox.chat = 'a' }), true)
  assert.equal(edit(d => { d.adapters.qq = { chat: 'a' } }), true)
  assert.equal(edit(d => { delete d.adapters.sandbox }), true)
  assert.equal(edit(d => { d.defaults.chat = 'b' }), true)
  assert.equal(edit(d => { d.defaults.chatFallbacks = [] }), true)
  assert.equal(edit(d => { d.decisions.skills.mode = 'off' }), true)
  // Without fallback support the chains are not sent, so editing one alone changes nothing saved.
  const draft = structuredClone(original); draft.defaults.chatFallbacks = []
  assert.equal(purposesDirty(draft, original, { fallbacks: false }), false)
})

test('用途 shows unsaved changes, saves only with changes, and asks before they are lost', () => {
  const purposes = read('Purposes.tsx')
  assert.match(purposes, /const dirty = purposesDirty\(draft, view\.purposes!, \{ fallbacks \}\) \|\| judgeDirty/)
  assert.match(purposes, /const leaveConfirmation = useUnsavedChangesGuard\(dirty\)/)
  assert.match(purposes, /disabled=\{disabled \|\| !dirty\}/)
  assert.match(purposes, /\{dirty \? <span[^>]*role="status"[^>]*>\{i18n\.t\("有未保存的修改"\)\}<\/span> : null\}/)
  assert.match(purposes, /useEffect\(\(\) => \{ onDirtyChange\?\.\(dirty\) \}, \[dirty\]\)/)
  // Switching tabs unmounts 用途 (and its draft): Workspace asks first.
  const workspace = read('Workspace.tsx')
  assert.match(workspace, /if \(tab === 'purposes' && next !== 'purposes' && purposesDirty && !\(await confirm\(/)
  assert.match(workspace, /<Purposes management=\{m\} focus=\{[^}]+\} onDirtyChange=\{setPurposesDirty\} \/>/)
})
