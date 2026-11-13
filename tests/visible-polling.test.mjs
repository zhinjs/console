import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { startVisiblePolling } from '../console-ui/src/hooks/visible-polling.mjs'

function fakeEnv(visibilityState) {
  const listeners = new Set(), ticks = [], cleared = []
  const document = { visibilityState, addEventListener: (type, fn) => { assert.equal(type, 'visibilitychange'); listeners.add(fn) }, removeEventListener: (_type, fn) => listeners.delete(fn) }
  return { document, listeners, ticks, cleared, setInterval: (fn, delay) => { ticks.push({ fn, delay }); return 7 }, clearInterval: id => cleared.push(id) }
}

test('a hidden tab skips interval ticks and refetches once when it becomes visible again', () => {
  const env = fakeEnv('visible'); let polls = 0
  const stop = startVisiblePolling(() => { polls++ }, 8000, env)
  assert.equal(env.ticks[0].delay, 8000)
  env.ticks[0].fn(); assert.equal(polls, 1)
  env.document.visibilityState = 'hidden'
  env.ticks[0].fn(); env.ticks[0].fn()
  for (const listener of env.listeners) listener()
  assert.equal(polls, 1, 'nothing is requested while hidden')
  env.document.visibilityState = 'visible'
  for (const listener of env.listeners) listener()
  assert.equal(polls, 2, 'returning to the tab refreshes immediately')
  stop()
  assert.deepEqual(env.cleared, [7]); assert.equal(env.listeners.size, 0)
})

test('polling still runs where there is no document', () => {
  let polls = 0; const ticks = []
  startVisiblePolling(() => { polls++ }, 10, { setInterval: fn => { ticks.push(fn); return 1 }, clearInterval() {} })()
  ticks[0](); assert.equal(polls, 1)
})

test('every recurring Host poll goes through the visibility-aware helper', () => {
  const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
  for (const path of ['pages/dashboard.tsx', 'pages/scope/login-tasks.tsx', 'pages/scope/use-login-flow.ts', 'pages/endpoint-detail/useEndpointConsole.tsx', 'pages/plugins.tsx', 'pages/useWelcomeInspection.ts', 'pages/workrooms.tsx']) {
    const source = read(path)
    assert.match(source, /startVisiblePolling\(/, path)
    assert.doesNotMatch(source, /setInterval\(/, path)
  }
})
