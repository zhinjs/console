import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as guardModel from '../console-ui/src/utils/unsaved-changes-guard.mjs'
const { setOwnerDirty, leavesCurrentPage, createBlockedNavigationHandler, installUnloadGuard } = guardModel

const require = createRequire(import.meta.url)
const flush = () => new Promise(resolve => setImmediate(resolve))

test('dirty owners only change identity when an owner actually changes state', () => {
  const empty = new Set()
  assert.equal(setOwnerDirty(empty, 'a', false), empty)
  const one = setOwnerDirty(empty, 'a', true)
  assert.deepEqual([...one], ['a']); assert.equal(empty.size, 0)
  assert.equal(setOwnerDirty(one, 'a', true), one)
  const two = setOwnerDirty(one, 'b', true)
  assert.deepEqual([...setOwnerDirty(two, 'a', false)], ['b'])
})

test('only navigations that change the page are guarded', () => {
  const here = { pathname: '/config', search: '?plugin=a', hash: '' }
  assert.equal(leavesCurrentPage(here, { pathname: '/logs', search: '?level=warn', hash: '#top' }), true)
  assert.equal(leavesCurrentPage(here, { pathname: '/config', search: '?plugin=b', hash: '' }), false, 'switching inside settings keeps the page and its drafts')
  assert.equal(leavesCurrentPage(here, { pathname: '/config', search: '?plugin=a', hash: '#section' }), false)
  assert.equal(leavesCurrentPage(here, null), false)
})

function fakeBlocker() {
  const blocker = { state: 'blocked', proceeded: 0, resets: 0, proceed() { this.proceeded++ }, reset() { this.resets++ } }
  return blocker
}

test('a blocked navigation asks once, then proceeds or resets', async () => {
  const answers = []
  const settle = createBlockedNavigationHandler(() => new Promise(resolve => answers.push(resolve)))
  settle({ state: 'unblocked' }); await flush()
  assert.equal(answers.length, 0, 'nothing to ask while unblocked')

  const back = fakeBlocker()
  settle(back); settle(back); await flush()
  assert.equal(answers.length, 1, 'a pending confirmation is not stacked')
  answers[0](false); await flush()
  assert.deepEqual([back.proceeded, back.resets], [0, 1], 'cancel keeps the user on the page')

  const palette = fakeBlocker()
  settle(palette); await flush(); answers[1](true); await flush()
  assert.deepEqual([palette.proceeded, palette.resets], [1, 0])

  const failing = fakeBlocker()
  createBlockedNavigationHandler(() => Promise.reject(new Error('closed')))(failing); await flush()
  assert.deepEqual([failing.proceeded, failing.resets], [0, 1], 'a failed confirmation stays on the page')
})

test('the unload guard warns on refresh/close until uninstalled', () => {
  const listeners = new Map()
  const view = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type) } }
  const uninstall = installUnloadGuard(view)
  const unload = { returnValue: undefined, prevented: false, preventDefault() { this.prevented = true } }
  listeners.get('beforeunload')(unload)
  assert.equal(unload.prevented, true); assert.equal(unload.returnValue, '')
  uninstall()
  assert.equal(listeners.size, 0)
})

/** Runs the production hook with a minimal hook runtime and a fake data-router blocker. */
async function loadHook() {
  const source = await readFile(new URL('../console-ui/src/utils/useUnsavedChangesGuard.tsx', import.meta.url), 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const slots = []; let cursor = 0; const effects = []
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const react = {
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() }) } },
  }
  const router = { shouldBlock: null, blocker: { state: 'unblocked' } }
  const asked = []
  const listeners = new Map()
  globalThis.window = { addEventListener: (type, fn) => listeners.set(type, fn), removeEventListener: (type, fn) => { if (listeners.get(type) === fn) listeners.delete(type) } }
  const mocks = {
    react, './unsaved-changes-guard.mjs': guardModel,
    'react-router-dom': { useBlocker: fn => { router.shouldBlock = fn; return router.blocker } },
    '../components/confirm-dialog': { useConfirm: () => ({ confirm: opts => new Promise(resolve => asked.push({ opts, resolve })), ConfirmDialog: 'dialog' }) },
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
  const render = active => { cursor = 0; const value = module.exports.useUnsavedChangesGuard(active); effects.splice(0).forEach(run => run()); return value }
  return { render, router, asked, listeners }
}

test('the guard blocks back/forward and navigate() through the data router, not only link clicks', async () => {
  const { render, router, asked, listeners } = await loadHook()
  const config = { pathname: '/config' }
  assert.equal(render(false), 'dialog')
  assert.equal(router.shouldBlock({ currentLocation: config, nextLocation: { pathname: '/logs' }, historyAction: 'POP' }), false, 'a clean page never blocks')
  assert.equal(listeners.size, 0)

  render(true)
  assert.ok(listeners.has('beforeunload'), 'dirty page warns on refresh/close')
  assert.equal(router.shouldBlock({ currentLocation: config, nextLocation: { pathname: '/logs' }, historyAction: 'POP' }), true, 'browser back is blocked')
  assert.equal(router.shouldBlock({ currentLocation: config, nextLocation: { pathname: '/files' }, historyAction: 'PUSH' }), true, 'command palette navigate() is blocked')
  assert.equal(router.shouldBlock({ currentLocation: config, nextLocation: { pathname: '/config' }, historyAction: 'PUSH' }), false)

  const blocked = fakeBlocker(); router.blocker = blocked
  render(true); await flush()
  assert.equal(asked.length, 1)
  assert.equal(asked[0].opts.variant, 'destructive')
  asked[0].resolve(true); await flush()
  assert.equal(blocked.proceeded, 1)

  router.blocker = { state: 'unblocked' }
  render(false)
  assert.equal(listeners.size, 0, 'saved page no longer blocks unload')
  delete globalThis.window
})

test('the app mounts a data router so useBlocker is available', async () => {
  const main = await readFile(new URL('../client/main.tsx', import.meta.url), 'utf8')
  assert.match(main, /createBrowserRouter\(/)
  assert.match(main, /<RouterProvider router=\{router\} \/>/)
  assert.doesNotMatch(main, /<BrowserRouter\b/)
})
