import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as model from '../console-ui/src/pages/welcome-use-case-model.mjs'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'
import { createDiagnosticRequestGate } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'

const fixture = JSON.parse(await readFile(new URL('./fixtures/welcome-flow-provider.json', import.meta.url), 'utf8'))
const source = await readFile(new URL('../console-ui/src/pages/useWelcomeInspection.ts', import.meta.url), 'utf8')
function runtime() {
  const slots = []; let cursor = 0, dirty = false, effects = [], run, value
  const same = (a, b) => a && b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]))
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(v, slots[i])) { slots[i] = v; dirty = true } }] },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() }) } },
  }
  return { hooks, mount(fn) { run = fn; return this.render() },
    render(flush = true) { let n = 0; do { assert.ok(++n < 40); dirty = false; cursor = 0; value = run(); if (flush) { const pending = effects; effects = []; pending.forEach(fn => fn()) } } while (flush && dirty); return value },
    async settle() { for (let n = 0; n < 15; n++) { await Promise.resolve(); if (dirty || effects.length) this.render() }; return value },
    unmount() { for (const slot of slots) slot?.cleanup?.() }, get value() { return value },
  }
}
function setup() {
  const rt = runtime(), calls = [], timers = new Map(); let timerId = 0, connection = { host: 'host-a', credential: 'user-a' }, nextScope = 0
  const scopes = createInboxCacheAuthority(() => connection, () => `opaque-${++nextScope}`)
  const args = { instanceKey: fixture.applied.instanceKey, packageName: fixture.applied.packageName, target: structuredClone(fixture.target) }
  const mocks = {
    react: rt.hooks,
    '../utils/console-rpc': { requestConsole: input => new Promise((resolve, reject) => calls.push({ input, scope: scopes.current(), resolve, reject, answered: false })) },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => scopes.current() },
    '../utils/inbox-cache': { getInboxCacheScope: () => scopes.current(), isInboxCacheScopeActive: scope => scopes.active(scope) },
    './endpoint-detail/message-diagnostics.mjs': { createDiagnosticRequestGate }, './welcome-use-case-model.mjs': model,
  }
  const module = { exports: {} }, code = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText
  new Function('require', 'exports', 'module', 'setInterval', 'clearInterval', code)(name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name] }, module.exports, module,
    fn => { const id = ++timerId; timers.set(id, fn); return id }, id => timers.delete(id))
  rt.mount(() => module.exports.useWelcomeInspection(args.instanceKey, args.packageName, args.target))
  return { rt, args, calls, scopes, timers,
    switchHost() { connection = { host: 'host-b', credential: 'user-a' } }, switchCredential() { connection = { host: 'host-a', credential: 'user-b' } }, logout() { connection = undefined },
    answer({ scope = scopes.current(), state = fixture.applied, plan = fixture.plan, source = fixture.source, fail } = {}) {
      for (const call of calls.filter(item => !item.answered && item.scope === scope)) {
        call.answered = true
        if (fail) call.reject(new Error('Host unavailable'))
        else call.resolve(call.input.type === 'plugin:inspect' ? state : call.input.type === 'plugin:plan-verification' ? plan : source)
      }
    },
  }
}
async function loaded(f) { f.answer(); await f.rt.settle(); assert.ok(f.rt.value.evidence); return f.rt.value }
async function confirmed(f) { await loaded(f); const pending = f.rt.value.confirmObserved(); f.answer(); assert.equal(await pending, true); await f.rt.settle(); assert.ok(f.rt.value.manualRecord) }

test('production hook reads real Host fixture and records only an explicitly requested human observation', async () => {
  const f = setup(); await confirmed(f)
  assert.ok(Number.isFinite(f.rt.value.manualRecord.at))
  assert.ok(f.calls.every(call => ['plugin:inspect', 'plugin:plan-verification', 'config:get-source'].includes(call.input.type)))
  assert.equal(f.calls.some(call => call.input.type === 'plugin:verify'), false)
  assert.doesNotMatch(JSON.stringify(f.rt.value), /欢迎测试成员/)
  f.rt.unmount(); assert.equal(f.timers.size, 0)
})

for (const action of ['switchHost', 'switchCredential', 'logout']) test(`human record and stale callback are blocked before effects after ${action}`, async () => {
  const f = setup(); await confirmed(f); const previous = f.rt.value, count = f.calls.length
  f[action](); const current = f.rt.render(false)
  assert.equal(current.manualRecord, null); assert.equal(current.evidence, undefined)
  assert.equal(await previous.confirmObserved(), false); assert.equal(f.calls.length, count)
  f.rt.unmount()
})

test('target changes during confirmation cannot attach the observation to the new target', async () => {
  const f = setup(); await loaded(f)
  const pending = f.rt.value.confirmObserved()
  f.args.target = { ...fixture.target, threadId: 'different-thread' }; f.rt.render(false)
  f.answer(); assert.equal(await pending, false); await f.rt.settle()
  assert.equal(f.rt.value.manualRecord, null); f.rt.unmount()
})

test('changing target away and back does not revive a prior human confirmation', async () => {
  const f = setup(); await confirmed(f)
  f.args.target = { ...fixture.target, threadId: 'different-thread' }; f.rt.render()
  f.args.target = fixture.target; f.rt.render(); assert.equal(f.rt.value.manualRecord, null); f.rt.unmount()
})

test('in-flight target A to B to A cannot revive an earlier confirmation even before effects', async () => {
  const f = setup(); await loaded(f)
  const pending = f.rt.value.confirmObserved()
  f.args.target = { ...fixture.target, threadId: 'intermediate-thread' }; f.rt.render(false)
  f.args.target = fixture.target; f.rt.render(false)
  f.answer(); assert.equal(await pending, false); await f.rt.settle()
  assert.equal(f.rt.value.manualRecord, null); f.rt.unmount()
})

test('failed read clears prior confirmation instead of retaining a green result', async () => {
  const f = setup(); await confirmed(f)
  const pending = f.rt.value.refresh(); f.rt.render(); assert.equal(f.rt.value.manualRecord, null)
  f.answer({ fail: true }); await pending; await f.rt.settle()
  assert.equal(f.rt.value.manualRecord, null); assert.equal(f.rt.value.evidence, undefined); assert.match(f.rt.value.error, /unavailable/); f.rt.unmount()
})

test('same generation after Host restart invalidates the record through the real plan incarnation field', async () => {
  const f = setup(); await confirmed(f)
  const pending = f.rt.value.refresh(); f.answer({ plan: { ...fixture.plan, checkRevision: 'different-host-incarnation' } })
  await pending; await f.rt.settle(); assert.equal(f.rt.value.manualRecord, null); f.rt.unmount()
})

test('file/project changes between observation and recheck refuse the confirmation', async () => {
  const f = setup(); await loaded(f); const pending = f.rt.value.confirmObserved()
  f.answer({ state: { ...fixture.applied, revision: 'changed-file', projectRevision: 'changed-project' },
    plan: { ...fixture.plan, projectRevision: 'changed-project' }, source: { ...fixture.source, revision: 'changed-file' } })
  assert.equal(await pending, false); await f.rt.settle(); assert.equal(f.rt.value.manualRecord, null); f.rt.unmount()
})

test('late success from retired scope cannot refill current evidence with identical revision and generation', async () => {
  const f = setup(), oldScope = f.scopes.current()
  f.switchCredential(); f.rt.render(); f.answer({ scope: oldScope }); await f.rt.settle()
  assert.equal(f.rt.value.evidence, undefined); assert.equal(f.rt.value.manualRecord, null)
  f.answer(); await f.rt.settle(); assert.ok(f.rt.value.evidence); assert.equal(f.rt.value.manualRecord, null); f.rt.unmount()
})

test('published instance with empty range cannot create an observation record', async () => {
  const f = setup(); f.answer({ state: fixture.initialState, source: fixture.initialSource, plan: fixture.initialPlan }); await f.rt.settle()
  const count = f.calls.length; assert.equal(await f.rt.value.confirmObserved(), false); assert.equal(f.calls.length, count); f.rt.unmount()
})
