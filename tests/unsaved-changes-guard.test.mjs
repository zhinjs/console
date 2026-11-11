import test from 'node:test'
import assert from 'node:assert/strict'
import { setOwnerDirty, guardedNavigationTarget, installUnsavedChangesGuard } from '../console-ui/src/utils/unsaved-changes-guard.mjs'

const plain = { defaultPrevented: false, button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false }
const here = { href: 'https://console.test/config?plugin=a' }

test('dirty owners only change identity when an owner actually changes state', () => {
  const empty = new Set()
  assert.equal(setOwnerDirty(empty, 'a', false), empty)
  const one = setOwnerDirty(empty, 'a', true)
  assert.deepEqual([...one], ['a']); assert.equal(empty.size, 0)
  assert.equal(setOwnerDirty(one, 'a', true), one)
  const two = setOwnerDirty(one, 'b', true)
  assert.deepEqual([...setOwnerDirty(two, 'a', false)], ['b'])
})

test('only plain same-origin clicks that leave the current page are guarded', () => {
  assert.equal(guardedNavigationTarget({ href: '/logs?level=warn#top' }, plain, here), '/logs?level=warn#top')
  assert.equal(guardedNavigationTarget({ href: 'https://console.test/files' }, plain, here), '/files')
  assert.equal(guardedNavigationTarget({ href: '/config?plugin=b' }, plain, here), null, 'switching inside settings keeps the page and its drafts')
  assert.equal(guardedNavigationTarget({ href: '#section' }, plain, here), null)
  assert.equal(guardedNavigationTarget({ href: 'https://elsewhere.test/' }, plain, here), null)
  assert.equal(guardedNavigationTarget({ href: '/files', target: '_blank' }, plain, here), null)
  assert.equal(guardedNavigationTarget({ href: '/files', target: '_self' }, plain, here), '/files')
  assert.equal(guardedNavigationTarget({ href: '/files', download: true }, plain, here), null)
  for (const key of ['metaKey', 'ctrlKey', 'shiftKey', 'altKey']) assert.equal(guardedNavigationTarget({ href: '/files' }, { ...plain, [key]: true }, here), null)
  assert.equal(guardedNavigationTarget({ href: '/files' }, { ...plain, button: 1 }, here), null)
  assert.equal(guardedNavigationTarget({ href: '/files' }, { ...plain, defaultPrevented: true }, here), null)
  assert.equal(guardedNavigationTarget(null, plain, here), null)
})

function fakeView() {
  const listeners = new Map()
  return {
    location: here, listeners,
    addEventListener(type, fn, capture = false) { listeners.set(`${type}:${capture}`, fn) },
    removeEventListener(type, fn, capture = false) { if (listeners.get(`${type}:${capture}`) === fn) listeners.delete(`${type}:${capture}`) },
  }
}
function anchorClick(href, extra = {}) {
  const anchor = { getAttribute: name => name === 'href' ? href : null, hasAttribute: () => false }
  const event = { ...plain, ...extra, prevented: 0, stopped: 0, target: { closest: selector => (assert.equal(selector, 'a[href]'), anchor) },
    preventDefault() { this.prevented++; this.defaultPrevented = true }, stopPropagation() { this.stopped++ } }
  return event
}
const flush = () => new Promise(resolve => setImmediate(resolve))

test('installed guard warns on unload and confirms in-app navigation before leaving', async () => {
  const view = fakeView(), navigated = [], answers = []
  const uninstall = installUnsavedChangesGuard({ view, navigate: path => navigated.push(path),
    confirmLeave: () => new Promise(resolve => answers.push(resolve)) })
  const unload = { returnValue: undefined, prevented: false, preventDefault() { this.prevented = true } }
  view.listeners.get('beforeunload:false')(unload)
  assert.equal(unload.prevented, true); assert.equal(unload.returnValue, '')

  const click = view.listeners.get('click:true')
  assert.ok(click, 'link clicks are captured before the router handles them')
  const first = anchorClick('/logs'); click(first)
  assert.equal(first.prevented, 1); assert.equal(first.stopped, 1); assert.equal(answers.length, 1)
  const repeat = anchorClick('/files'); click(repeat)
  assert.equal(repeat.prevented, 1); assert.equal(answers.length, 1, 'a pending confirmation is not stacked')
  answers[0](false); await flush()
  assert.deepEqual(navigated, [], 'cancel keeps the user on the page')
  click(anchorClick('/files')); answers[1](true); await flush()
  assert.deepEqual(navigated, ['/files'])

  const inside = anchorClick('/config?plugin=b'); click(inside)
  assert.equal(inside.prevented, 0); assert.equal(answers.length, 2)

  uninstall()
  assert.equal(view.listeners.size, 0, 'a clean page no longer blocks unload or navigation')
})
