import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import * as management from '../console-ui/src/pages/plugin-management-model.mjs'
import * as evidence from '../console-ui/src/components/PluginConfigForm/config-evidence-model.mjs'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'

const source = await readFile(new URL('../console-ui/src/components/PluginConfigForm/ConfigApplicationEvidence.tsx', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const pending = { packageName: '@test/demo', instanceKey: 'demo', installed: true, plugin: true, declared: true, version: '1.0.0',
  revision: 'r1', projectRevision: 'p1', status: 'pending-restart', dependencies: 'passed', validation: { schemaAvailable: true, valid: true, errors: [], missingEnv: [] },
  generation: 2, published: false, readiness: 'unknown', restartRequired: true, disabled: false, issues: [], verification: 'not-configured' }
const applied = { ...pending, status: 'enabled', generation: 3, published: true, readiness: 'ready', restartRequired: false }

function hooks() {
  const slots = []; let cursor = 0, dirty = false, effects = [], render, value
  const equal = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]))
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => { const result = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(slots[index], result)) { slots[index] = result; dirty = true } }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useEffect(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps, cleanup: old?.cleanup }
      effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn() }) } },
  }
  return { react,
    mount(fn) { render = fn; return this.render() },
    render() { let count = 0; do { assert(++count < 30); dirty = false; cursor = 0; value = render(); const queue = effects; effects = []; queue.forEach(fn => fn()) } while (dirty); return value },
    async settle() { for (let i = 0; i < 16; i++) { await Promise.resolve(); if (dirty || effects.length) this.render() }; return value },
    remount() { this.unmount(); slots.length = 0; return this.render() },
    unmount() { slots.forEach(slot => slot?.cleanup?.()); effects = [] },
    get value() { return value },
  }
}
function elements(value) { if (!value || typeof value !== 'object') return []; return [value, ...[value.props?.children].flat(Infinity).flatMap(elements)] }
function text(value) { if (value == null || typeof value === 'boolean') return ''; if (typeof value !== 'object') return String(value); return [value.props?.children].flat(Infinity).map(text).join('') }
function fixture({ approve = async () => true, wait, buildRequest, storageFailure = false } = {}) {
  const runtime = hooks(), calls = [], records = new Map()
  const storage = { getItem: key => records.get(key) ?? null, setItem(key, value) { if (storageFailure) throw Error('storage blocked'); records.set(key, value) }, removeItem: key => records.delete(key) }
  const model = { ...evidence, readPendingConfigApplication: (scope, name) => evidence.readPendingConfigApplication(scope, name, storage),
    rememberConfigApplication: (scope, state) => evidence.rememberConfigApplication(scope, state, storage),
    forgetConfigApplication: (scope, name) => evidence.forgetConfigApplication(scope, name, storage) }
  let connection = { host: 'https://host-a', credential: 'synthetic-a' }, nonce = 0
  const authority = createInboxCacheAuthority(() => connection, () => `scope-${++nonce}`)
  let props = { pluginName: 'demo', revision: 'r1', draftRevision: 'r1', dirty: false, managed: true, disabled: false, scope: authority.current() }
  const request = input => new Promise((resolve, reject) => { calls.push({ input, resolve, reject, answered: false, scope: authority.current() }) })
  const mocks = {
    react: runtime.react, 'react-router-dom': { Link: 'a' }, '../ui/button': { Button: 'button' },
    '../../pages/PluginManagementSummary': { PluginManagementSummary: 'summary' }, './config-evidence-model.mjs': model,
    '../../pages/plugin-management-model.mjs': { ...management, ...(buildRequest ? { applyRequest: buildRequest } : {}), waitForManagementState: wait ?? ((read, previous, signal) => management.waitForManagementState(read, previous, signal, { attempts: 1 })) },
    '../../utils/console-rpc': { requestConsole: request }, '../../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() },
    '../../utils/inbox-cache': { isInboxCacheScopeActive: scope => authority.active(scope) }, '../confirm-dialog': { useConfirm: () => ({ confirm: approve, ConfirmDialog: 'dialog' }) },
  }
  const module = { exports: {} }, code = ts.transpileModule(`${source}\nexport { EvidenceSession };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
  runtime.mount(() => module.exports.EvidenceSession(props))
  return { runtime, calls, records,
    remount() { props = { ...props, scope: authority.current() }; runtime.remount() },
    button(label) { const button = elements(runtime.value).find(node => node.type === 'button' && text(node) === label); assert(button, label); return button },
    answer(type, result, fail = false) { const call = calls.find(item => !item.answered && item.input.type === type); assert(call, `pending ${type}`); call.answered = true; fail ? call.reject(result) : call.resolve(result); return call },
    update(next) { props = { ...props, ...next }; runtime.render() },
    switchHost() { connection = { host: 'https://host-b', credential: 'synthetic-b' } },
    switchCredential() { connection = { ...connection, credential: 'synthetic-b' } },
  }
}
async function loaded(f, state = pending) {
  const reading = f.button('读取应用证据').props.onClick(); await f.runtime.settle(); f.answer('plugin:inspect', state); await reading; await f.runtime.settle()
}

test('only formal instances use plugin application and save copy follows real Host restart evidence', () => {
  const snapshot = { source: '{"configVersion":2,"plugins":{"demo":"@test/demo"},"http":{}}', format: 'json' }
  assert.equal(evidence.isManagedConfigInstance(snapshot, 'demo'), true)
  for (const name of ['http', 'plugin', 'missing']) assert.equal(evidence.isManagedConfigInstance(snapshot, name), false)
  assert.match(evidence.configurationSaveSummary({ success: true, revision: 'r1', restartRequired: true }), /需要重启/)
  assert.doesNotMatch(evidence.configurationSaveSummary({ success: true, revision: 'r1', restartRequired: false }), /需要重启/)
  assert.match(evidence.configurationSaveSummary({ success: true, revision: 'r1' }), /未提供重启判断/)
  assert.throws(() => evidence.configurationSaveSummary({ success: false, revision: 'r1' }), /未提供完整保存回执/)
})

test('actual evidence reader binds revision and identity, and mismatch or a dirty draft cannot apply', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0)
  await loaded(f, { ...pending, revision: 'newer-file' }); assert.equal(f.button('应用已保存配置').props.disabled, true)
  assert.match(text(f.runtime.value), /证据与已读取文件版本不一致/)
  await loaded(f); assert.equal(f.button('应用已保存配置').props.disabled, false)
  f.update({ dirty: true }); assert.equal(f.button('应用已保存配置').props.disabled, true)
  await f.button('应用已保存配置').props.onClick(); assert.equal(f.calls.filter(item => item.input.type === 'plugin:apply').length, 0)
  f.runtime.unmount()
})

test('the actual handler submits one approved request, then reads existing publication evidence without business execution', async () => {
  const f = fixture(); await loaded(f)
  const apply = f.button('应用已保存配置').props.onClick
  const first = apply(), second = apply(); await f.runtime.settle()
  assert.equal(f.calls.filter(item => item.input.type === 'plugin:apply').length, 1)
  const call = f.answer('plugin:apply', { requested: true, state: pending }); assert.deepEqual(call.input, { type: 'plugin:apply', instanceKey: 'demo', expectedProjectRevision: 'p1' })
  await f.runtime.settle(); f.answer('plugin:inspect', applied); await Promise.all([first, second]); await f.runtime.settle()
  assert.match(text(f.runtime.value), /包与已保存配置语义一致/)
  assert.equal(f.calls.filter(item => item.input.type === 'plugin:apply').length, 1)
  assert.equal(f.calls.some(item => item.input.type === 'plugin:verify'), false); f.runtime.unmount()
})

test('a lost apply receipt uses read-only reconciliation, and unknown never becomes an automatic retry', async () => {
  const f = fixture(); await loaded(f)
  const applying = f.button('应用已保存配置').props.onClick(); await f.runtime.settle()
  f.answer('plugin:apply', new Error('lost response'), true); await f.runtime.settle(); f.answer('plugin:inspect', pending)
  await applying; await f.runtime.settle(); assert.match(text(f.runtime.value), /应用结果未知/)
  assert.equal(f.button('应用已保存配置').props.disabled, true)
  await loaded(f, applied); assert.match(text(f.runtime.value), /只读核对确认/)
  assert.equal(f.calls.filter(item => item.input.type === 'plugin:apply').length, 1); f.runtime.unmount()
})

test('changes to the dirty draft while confirmation is open prevent the old approval from submitting', async () => {
  let approve
  const f = fixture({ approve: () => new Promise(resolve => { approve = resolve }) }); await loaded(f)
  const applying = f.button('应用已保存配置').props.onClick(); f.update({ dirty: true }); approve(true); await applying; await f.runtime.settle()
  assert.equal(f.calls.filter(item => item.input.type === 'plugin:apply').length, 0); f.runtime.unmount()
})

for (const change of ['switchHost', 'switchCredential']) test(`late evidence and confirmations cannot cross ${change}`, async () => {
  const f = fixture(); const reading = f.button('读取应用证据').props.onClick(); f[change](); f.answer('plugin:inspect', applied); await reading; await f.runtime.settle()
  assert.equal(elements(f.runtime.value).some(node => node.type === 'summary'), false)
  await f.button('应用已保存配置').props.onClick(); assert.equal(f.calls.filter(item => item.input.type === 'plugin:apply').length, 0); f.runtime.unmount()
})

test('a file revision change invalidates a late response, and unmount aborts any further read-after-apply work', async () => {
  const f = fixture(); const reading = f.button('读取应用证据').props.onClick(); f.update({ revision: 'r2' }); f.answer('plugin:inspect', pending); await reading; await f.runtime.settle()
  assert.equal(elements(f.runtime.value).some(node => node.type === 'summary'), false)
  await loaded(f, { ...pending, revision: 'r2' }); const applying = f.button('应用已保存配置').props.onClick(); await f.runtime.settle()
  f.runtime.unmount(); const count = f.calls.length; f.answer('plugin:apply', { requested: true }); await applying; assert.equal(f.calls.length, count)
})

test('the current configuration evidence never labels an unavailable observation as an application failure', async () => {
  const f = fixture(); const reading = f.button('读取应用证据').props.onClick(); f.answer('plugin:inspect', new Error('raw private details'), true); await reading; await f.runtime.settle()
  assert.match(text(f.runtime.value), /不能判定应用失败/); assert.doesNotMatch(text(f.runtime.value), /raw private details/); f.runtime.unmount()
})


test('lost receipt plus rejected inspect freezes writes across remount until exact published evidence is read', async () => {
  const f = fixture(); await loaded(f)
  f.button('应用已保存配置').props.onClick(); await f.runtime.settle()
  f.answer('plugin:apply', new Error('lost response'), true); await f.runtime.settle()
  f.answer('plugin:inspect', new Error('Host unavailable'), true); await f.runtime.settle()
  assert.equal(f.button('应用已保存配置').props.disabled, true); assert.equal(f.records.size, 1)
  assert.doesNotMatch([...f.records.values()][0], /synthetic|source|validation|errors/)
  f.remount(); assert.match(text(f.runtime.value), /原应用申请结果尚未确认/)
  await loaded(f); assert.equal(f.button('应用已保存配置').props.disabled, true)
  await f.button('应用已保存配置').props.onClick(); assert.equal(f.calls.filter(call => call.input.type === 'plugin:apply').length, 1)
  await loaded(f, { ...applied, version: 'different' }); assert.equal(f.records.size, 1)
  await loaded(f, { ...applied, revision: 'different' }); assert.equal(f.records.size, 1)
  await loaded(f, applied); assert.equal(f.records.size, 0); assert.match(text(f.runtime.value), /只读核对确认/)
  f.runtime.unmount()
})

test('unexpected reconciliation exceptions after dispatch retain the unknown guard', async () => {
  const f = fixture({ wait: async () => { throw Error('unexpected observation error') } }); await loaded(f)
  f.button('应用已保存配置').props.onClick(); await f.runtime.settle(); f.answer('plugin:apply', { requested: true }); await f.runtime.settle()
  assert.match(text(f.runtime.value), /应用结果未确认/); assert.equal(f.button('应用已保存配置').props.disabled, true)
  await f.button('应用已保存配置').props.onClick(); assert.equal(f.calls.filter(call => call.input.type === 'plugin:apply').length, 1)
  f.remount(); await loaded(f); assert.equal(f.button('应用已保存配置').props.disabled, true)
  await loaded(f, applied); assert.equal(f.records.size, 0); f.runtime.unmount()
})

for (const options of [{ approve: async () => { throw Error('local confirmation failure') } },
  { buildRequest: () => { throw Error('local request construction failure') } }, { storageFailure: true }]) {
  test('a local pre-dispatch failure neither sends nor leaves an unknown operation', async () => {
    const f = fixture(options); await loaded(f); f.button('应用已保存配置').props.onClick(); await f.runtime.settle()
    assert.equal(f.calls.filter(call => call.input.type === 'plugin:apply').length, 0); assert.equal(f.records.size, 0)
    assert.equal(f.button('应用已保存配置').props.disabled, false); assert.match(text(f.runtime.value), /尚未提交应用申请/); f.runtime.unmount()
  })
}

for (const change of ['switchHost', 'switchCredential']) test(`retained pending metadata is isolated after ${change}`, async () => {
  const f = fixture({ wait: async () => { throw Error('unknown') } }); await loaded(f)
  f.button('应用已保存配置').props.onClick(); await f.runtime.settle(); f.answer('plugin:apply', { requested: true }); await f.runtime.settle()
  assert.equal(f.records.size, 1); f[change](); f.remount()
  assert.doesNotMatch(text(f.runtime.value), /原应用申请结果尚未确认/)
  assert.equal(f.button('应用已保存配置').props.disabled, true)
  await loaded(f); assert.equal(f.button('应用已保存配置').props.disabled, false); f.runtime.unmount()
})

test('malformed or inaccessible retained guards fail closed without disclosing stored material', () => {
  const bad = { getItem: () => '{private-content' }
  assert.deepEqual(evidence.readPendingConfigApplication('scope', 'demo', bad), { status: 'unavailable' })
  assert.deepEqual(evidence.readPendingConfigApplication('scope', 'demo', { getItem() { throw Error('private') } }), { status: 'unavailable' })
})
