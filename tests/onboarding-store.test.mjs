import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as model from '../console-ui/src/utils/console-auth-model.mjs'
import * as session from '../console-ui/src/utils/console-session.mjs'

const source = await readFile(new URL('../console-ui/src/utils/onboarding-store.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

function load(update) {
  const items = new Map(), sent = []
  const window = { localStorage: { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) } }
  const mocks = {
    './auth': { getApiBase: () => 'http://host' },
    './console-auth-api': { updateOnboarding: async (...args) => { sent.push(args); return update(...args) } },
    './console-auth-model.mjs': model, './console-session.mjs': session,
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', 'window', compiled)(name => mocks[name], module.exports, module, window)
  return { store: module.exports, items, sent }
}

test('a Host with onboarding.update records the step on the Host', async () => {
  session.resetConsoleSession()
  try {
    const { store, sent, items } = load(async () => ({ version: 1, steps: { ai: 'skipped' } }))
    store.beginOnboarding()
    assert.equal(items.size, 1, 'the Host reported nothing yet: the browser starts the flow')
    assert.deepEqual(await store.markOnboarding('ai', 'skipped'), { saved: 'host' })
    assert.deepEqual(sent, [['ai', 'skipped']])
    assert.deepEqual(session.currentOnboarding().steps, { ai: 'skipped' })
    assert.equal(items.size, 0, 'the browser copy is dropped once the Host tracks the flow')
  } finally { session.resetConsoleSession() }
})

test('a Host without the RPC keeps the progress in this browser; other failures change nothing', async () => {
  session.resetConsoleSession()
  try {
    const old = load(async () => { throw new Error('Unknown RPC type: onboarding.update') })
    old.store.beginOnboarding()
    assert.deepEqual(await old.store.markOnboarding('adapters', 'done'), { saved: 'local' })
    assert.equal(session.currentOnboarding().steps.adapters, 'done')
    assert.equal(JSON.parse(old.items.get('zhin.console.onboarding:http://host')).steps.adapters, 'done')
    const finished = await old.store.markOnboarding('finish', 'done')
    assert.deepEqual(finished, { saved: 'local' })
    assert.equal(model.onboardingComplete(session.currentOnboarding()), true)

    session.resetConsoleSession()
    session.setHostOnboarding({ version: 1, steps: { ai: 'pending' } })
    const denied = load(async () => { throw new Error('缺少权限 plugin.manage') })
    const result = await denied.store.markOnboarding('ai', 'done')
    assert.ok('error' in result)
    assert.equal(session.currentOnboarding().steps.ai, 'pending')
    denied.store.beginOnboarding()
    assert.equal(denied.items.size, 0, 'a Host that reports onboarding owns it')
  } finally { session.resetConsoleSession() }
})
