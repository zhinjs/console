import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'
import { createDiagnosticRequestGate } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'
import { configErrorReducer } from '../console-ui/src/hooks/config-error-state.mjs'
import * as sourceModel from '../console-ui/src/components/PluginConfigForm/source-model.mjs'
import * as schemaModel from '../console-ui/src/components/PluginConfigForm/schema-model.mjs'
import { createConfigDraftGuard } from '../console-ui/src/components/PluginConfigForm/draft-guard.mjs'
import * as sourceDraftModel from '../console-ui/src/pages/config-source-draft.mjs'
import * as sourceValidation from '../console-ui/src/pages/config-source-validation.mjs'
import * as configNavigation from '../console-ui/src/pages/config-navigation.mjs'
import * as configEvidenceModel from '../console-ui/src/components/PluginConfigForm/config-evidence-model.mjs'

const require = createRequire(import.meta.url)
const files = await Promise.all(['hooks/useConfigSource.ts', 'components/PluginConfigForm/usePluginConfigDraft.ts', 'components/PluginConfigForm/index.tsx', 'pages/config.tsx']
  .map(path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')))

/** Execute the production hooks and handlers unchanged; drive hook scheduling and RPC boundaries deterministically. */
function hookRuntime() {
  const slots = []; let cursor = 0, dirty = false, effects = [], renderHook, value
  const same = (a, b) => a && b && a.length === b.length && a.every((item, i) => Object.is(item, b[i]))
  const hooks = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => { const result = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(slots[index], result)) { slots[index] = result; dirty = true } }]
    },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useReducer(reducer, initial) { const [state, set] = hooks.useState(initial); return [state, action => set(previous => reducer(previous, action))] },
    useCallback(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn },
    useMemo(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { deps, value: fn() }; return slots[index].value },
    useEffect(fn, deps) {
      const index = cursor++
      if (!same(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn() }) }
    },
  }
  return {
    hooks,
    mount(fn) { renderHook = fn; return this.render() },
    remount(fn) { this.unmount(); slots.length = 0; dirty = false; return this.mount(fn) },
    render(flushEffects = true) {
      let count = 0
      do {
        assert.ok(++count < 50, 'hook render/effect loop must settle')
        dirty = false; cursor = 0; value = renderHook()
        if (flushEffects) { const pending = effects; effects = []; pending.forEach(run => run()) }
      } while (flushEffects && dirty)
      return value
    },
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty || effects.length) this.render() }; return value },
    unmount() { for (const slot of slots) slot?.cleanup?.(); effects = [] },
    get value() { return value },
  }
}

function fixture() {
  const runtime = hookRuntime(); let connection = { host: 'https://host-a', credential: 'credential-a' }, nextScope = 0
  const authority = createInboxCacheAuthority(() => connection, () => `opaque-${++nextScope}`)
  const calls = []
  const successes = [], errors = []
  const requestConsole = input => new Promise((resolve, reject) => { calls.push({ input, scope: authority.current(), resolve, reject, answered: false }) })
  const mocks = {
    react: runtime.hooks,
    '@zhin.js/client': { getWebSocketManager: () => ({ isConnected: () => true, onConnectionChange: () => () => {} }) },
    './config-error-state.mjs': { configErrorReducer },
    '../utils/console-rpc': { requestConsole }, '../../utils/console-rpc': { requestConsole },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() }, '../../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() },
    '../utils/inbox-cache': { getInboxCacheScope: () => authority.current(), isInboxCacheScopeActive: scope => authority.active(scope) },
    '../../utils/inbox-cache': { getInboxCacheScope: () => authority.current(), isInboxCacheScopeActive: scope => authority.active(scope) },
    '../pages/endpoint-detail/message-diagnostics.mjs': { createDiagnosticRequestGate }, '../../pages/endpoint-detail/message-diagnostics.mjs': { createDiagnosticRequestGate },
    './source-model.mjs': sourceModel, './schema-model.mjs': schemaModel, './draft-guard.mjs': { createConfigDraftGuard },
    './config-evidence-model.mjs': configEvidenceModel, './ConfigApplicationEvidence': { ConfigApplicationEvidence: 'config-evidence' },
    '../components/PluginConfigForm/config-evidence-model.mjs': configEvidenceModel,
    'react-router-dom': { Link: 'a', useSearchParams: () => [new URLSearchParams(), () => {}] },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
    './SchemaFieldEditor': { SchemaFieldEditor: 'field-editor' }, '../ui/card': { Card: 'article' }, '../ui/badge': { Badge: 'span' },
    '../ui/button': { Button: 'button' }, '../ui/alert': { Alert: 'aside', AlertDescription: 'p' },
    '../components/ui/card': { Card: 'article', CardContent: 'section' }, '../components/ui/button': { Button: 'button' },
    '../components/ui/alert': { Alert: 'aside', AlertDescription: 'p' }, '../components/ui/badge': { Badge: 'span' },
    '../components/ui/tabs': { Tabs: 'tabs', TabsList: 'tabs-list', TabsTrigger: 'tabs-trigger', TabsContent: 'tabs-content' },
    '../components/ui/textarea': { Textarea: 'textarea' }, '../components/ui/input': { Input: 'input' },
    '../components/ui/skeleton': { Skeleton: 'div' }, '../components/ui/separator': { Separator: 'hr' },
    '../components/ui/switch': { Switch: 'switch' }, '../components/PageHeader': { PageHeader: 'header' },
    '../components/toast': { useToast: () => ({ success: message => successes.push(message), error: message => errors.push(message) }) },
    '../utils/read-error.mjs': { readErrorSummary: value => value }, '../utils/demo-mode': { isDemoMode: () => false },
    './config-source-draft.mjs': sourceDraftModel, './config-source-validation.mjs': sourceValidation, './config-navigation.mjs': configNavigation,
  }
  function compile(source) {
    const module = { exports: {} }
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    new Function('require', 'exports', 'module', code)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
    return module.exports
  }
  const source = compile(files[0]); mocks['../../hooks/useConfigSource'] = source
  const plugin = compile(files[1]); mocks['./usePluginConfigDraft'] = plugin
  const form = compile(`${files[2]}\nexport { PluginConfigFormSession };`)
  mocks['../hooks/useConfigSource'] = source; mocks['../components/PluginConfigForm'] = form
  const page = compile(`${files[3]}\nexport { EditableConfigPage, EditableConfigSession, GeneralConfigForm };`)
  return { runtime, calls, source, plugin, form, page, authority, successes, errors,
    switchHost() { connection = { host: 'https://host-b', credential: 'credential-b' } },
    switchCredential() { connection = { ...connection, credential: 'credential-b' } },
    logout() { connection = undefined },
    answer(type, data, scope = authority.current(), failed = false) {
      const call = calls.find(item => !item.answered && item.scope === scope && item.input.type === type)
      assert.ok(call, `pending ${type} in ${scope}`); call.answered = true; failed ? call.reject(data) : call.resolve(data); return call
    },
  }
}
const snapshot = label => ({ source: JSON.stringify({ 'group-suite': { welcomeMessage: label, welcomeConversations: [] } }),
  format: 'json', revision: 'same-revision', configKeys: ['group-suite'], configPaths: { 'group-suite': ['group-suite'] } })
const schema = { type: 'object', object: { welcomeMessage: { type: 'string' }, welcomeConversations: { type: 'list', inner: { type: 'object', object: {} } } } }
const valid = { valid: true, schemaAvailable: true, errors: [], missingEnv: [] }
function elements(value) { return value && typeof value === 'object' ? [value, ...[value.props?.children, value.props?.actions].flat(Infinity).flatMap(elements)] : [] }
const label = element => element && typeof element === 'object'
  ? [element.props?.children].flat(Infinity).map(value => typeof value === 'string' ? value : label(value)).join('') : ''
const button = (tree, text) => elements(tree).find(item => item.type === 'button' && label(item) === text)
async function loadedSource(f, name = 'A') {
  f.runtime.mount(() => f.source.useConfigSource({ autoLoad: false }))
  const pending = f.runtime.value.load(); f.answer('config:get-source', snapshot(name)); await pending; await f.runtime.settle()
  return f.runtime.value
}
async function loadedPlugin(f, name = 'A') {
  f.runtime.mount(() => f.plugin.usePluginConfigDraft('group-suite'))
  f.answer('config:get-source', snapshot(name)); f.answer('schema:get', schema); await f.runtime.settle()
  assert.equal(f.runtime.value.loaded, true); return f.runtime.value
}
async function loadedForm(f, onSuccess = () => {}) {
  const connectionScope = f.authority.current()
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'group-suite', connectionScope, onSuccess }))
  f.answer('config:get-source', snapshot('A')); f.answer('schema:get', schema); await f.runtime.settle()
  assert.ok(button(f.runtime.value, '保存配置')); return f.runtime.value
}

for (const change of ['switchHost', 'switchCredential', 'logout']) test(`configuration masks old data and refuses old-snapshot writes before effects after ${change}`, async () => {
  const f = fixture(), old = await loadedSource(f), before = f.calls.length
  f[change](); const current = f.runtime.render(false)
  assert.equal(current.loaded, false); assert.equal(current.snapshot, null); assert.equal(current.source, ''); assert.equal(current.error, null)
  await assert.rejects(old.saveBound('old draft', old.snapshot), /旧连接|连接/)
  await assert.rejects(current.saveBound('old draft', old.snapshot), /旧连接|连接/)
  assert.equal(f.calls.length, before); f.runtime.unmount()
})

test('equal revisions on two Hosts cannot authorize a source from the other connection', async () => {
  const f = fixture(), old = await loadedSource(f)
  f.switchHost(); f.runtime.render(); const pending = f.runtime.value.load()
  f.answer('config:get-source', snapshot('B')); await pending; await f.runtime.settle()
  const current = f.runtime.value; assert.equal(current.revision, old.revision)
  assert.notEqual(current.snapshot.connectionScope, old.snapshot.connectionScope)
  await assert.rejects(current.saveBound(old.source, old.snapshot), /旧连接/)
  assert.equal(f.calls.filter(item => item.input.type === 'config:replace-source').length, 0)
  f.runtime.unmount()
})

test('late reads and failures from a retired connection cannot publish data or diagnostics', async () => {
  for (const failure of [false, true]) {
    const f = fixture(); f.runtime.mount(() => f.source.useConfigSource({ autoLoad: false }))
    const oldScope = f.authority.current(), pending = f.runtime.value.load()
    const rejected = assert.rejects(pending, /读取已过期/)
    f.switchCredential(); f.runtime.render()
    f.answer('config:get-source', failure ? new Error('OLD-CONNECTION-PRIVATE') : snapshot('A-only'), oldScope, failure)
    await rejected; await f.runtime.settle()
    assert.equal(f.runtime.value.loaded, false); assert.equal(f.runtime.value.error, null); assert.equal(f.runtime.value.loading, false)
    f.runtime.unmount()
  }
})

test('late save success cannot update a new connection or pretend its application completed', async () => {
  const f = fixture(), old = await loadedSource(f), oldScope = f.authority.current()
  const pending = old.saveBound('A changed', old.snapshot), rejected = assert.rejects(pending, /旧连接|替代/)
  f.switchHost(); f.runtime.render(); const read = f.runtime.value.load(); f.answer('config:get-source', snapshot('B')); await read; await f.runtime.settle()
  f.answer('config:replace-source', { success: true, revision: 'A-new', restartRequired: false }, oldScope)
  await rejected; await f.runtime.settle()
  assert.equal(f.runtime.value.source, snapshot('B').source); assert.equal(f.runtime.value.revision, 'same-revision'); assert.equal(f.runtime.value.error, null)
  f.runtime.unmount()
})

test('normal reads and saves on the same connection retain CAS and do not send local scope metadata', async () => {
  const f = fixture(), old = await loadedSource(f)
  const pending = old.saveBound('normal changed', old.snapshot)
  const call = f.answer('config:replace-source', { success: true, revision: 'next', restartRequired: true })
  assert.deepEqual(call.input, { type: 'config:replace-source', source: 'normal changed', expectedRevision: 'same-revision' })
  assert.equal((await pending).restartRequired, true); await f.runtime.settle()
  assert.equal(f.runtime.value.source, 'normal changed'); assert.equal(f.runtime.value.revision, 'next'); assert.equal(f.runtime.value.loading, false)
  f.runtime.unmount()
})

test('a newer read supersedes an older read in the same connection', async () => {
  const f = fixture(); f.runtime.mount(() => f.source.useConfigSource({ autoLoad: false }))
  const first = f.runtime.value.load(), rejected = assert.rejects(first, /过期/), firstCall = f.calls.at(-1)
  const second = f.runtime.value.load(), secondCall = f.calls.at(-1)
  secondCall.answered = true; secondCall.resolve(snapshot('newest')); await second
  firstCall.answered = true; firstCall.resolve(snapshot('stale')); await rejected; await f.runtime.settle()
  assert.equal(f.runtime.value.source, snapshot('newest').source); f.runtime.unmount()
})

test('plugin drafts hide their config/schema immediately and refuse stale baselines even with identical plugin names', async () => {
  const f = fixture(), old = await loadedPlugin(f), before = f.calls.length
  f.switchHost(); const current = f.runtime.render(false)
  assert.equal(current.loaded, false); assert.equal(current.config, undefined); assert.equal(current.schema, null); assert.equal(current.snapshot, undefined)
  await assert.rejects(old.setConfig({ welcomeMessage: 'A changed' }, old.snapshot), /当前连接|旧连接/)
  assert.equal(f.calls.length, before); f.runtime.unmount()
})

test('a delayed schema response cannot join an old source to the current plugin draft', async () => {
  const f = fixture(); f.runtime.mount(() => f.plugin.usePluginConfigDraft('group-suite'))
  const oldScope = f.authority.current(); f.answer('config:get-source', snapshot('A')); await f.runtime.settle()
  f.switchCredential(); f.runtime.render()
  f.answer('config:get-source', snapshot('B')); f.answer('schema:get', schema); await f.runtime.settle()
  f.answer('schema:get', { type: 'object', object: { oldPrivateField: { type: 'string' } } }, oldScope); await f.runtime.settle()
  assert.equal(f.runtime.value.config.welcomeMessage, 'B'); assert.equal(f.runtime.value.schema, schema)
  f.runtime.unmount()
})

test('form sessions and their child confirmations are keyed by opaque scope and plugin name', () => {
  const f = fixture(); f.runtime.mount(() => f.form.PluginConfigForm({ pluginName: 'group-suite' }))
  const first = f.runtime.value; f.switchCredential(); const second = f.runtime.render(false)
  assert.notEqual(first.key, second.key); assert.ok(!first.key.includes('credential'))
  f.logout(); const empty = f.runtime.render(false); assert.notEqual(empty.type, first.type); f.runtime.unmount()
})

test('a captured form save handler cannot validate or write after the connection changes before effects', async () => {
  const f = fixture(), tree = await loadedForm(f), save = button(tree, '保存配置'), before = f.calls.length
  f.switchHost(); save.props.onClick(); await f.runtime.settle()
  assert.equal(f.calls.length, before); f.runtime.unmount()
})

test('a late validation result cannot submit a config to another credential or apply success to its page', async () => {
  const f = fixture(), successes = []; await loadedForm(f, () => successes.push('saved'))
  const oldScope = f.authority.current(); button(f.runtime.value, '保存配置').props.onClick(); assert.equal(f.calls.at(-1).input.type, 'plugin:validate-config')
  f.switchCredential(); f.answer('plugin:validate-config', valid, oldScope); await f.runtime.settle()
  assert.equal(f.calls.filter(item => item.input.type === 'config:replace-source').length, 0); assert.deepEqual(successes, [])
  f.runtime.unmount()
})

test('a late persisted-save result cannot call onSuccess or reload/apply the new connection', async () => {
  const f = fixture(), successes = []; await loadedForm(f, () => successes.push('saved'))
  const oldScope = f.authority.current(); button(f.runtime.value, '保存配置').props.onClick(); f.answer('plugin:validate-config', valid); await f.runtime.settle()
  assert.equal(f.calls.at(-1).input.type, 'config:replace-source')
  const before = f.calls.length; f.switchHost(); f.answer('config:replace-source', { success: true, revision: 'A-new', restartRequired: false }, oldScope)
  // No rerender/effect is needed for the stale save handler to reject its result.
  for (let i = 0; i < 8; i++) await Promise.resolve()
  assert.deepEqual(successes, []); assert.equal(f.calls.length, before); f.runtime.unmount()
})

test('the normal form validation/save path still saves edited content and reports success once', async () => {
  const f = fixture(), successes = []; await loadedForm(f, () => successes.push('saved'))
  button(f.runtime.value, '全部配置').props.onClick(); await f.runtime.settle()
  const field = elements(f.runtime.value).find(item => item.type === 'field-editor' && item.props.name === 'welcomeMessage')
  assert.ok(field); field.props.onChange('changed'); await f.runtime.settle()
  button(f.runtime.value, '保存配置').props.onClick(); f.answer('plugin:validate-config', valid); await f.runtime.settle()
  const saved = f.answer('config:replace-source', { success: true, revision: 'new', restartRequired: false })
  assert.equal(JSON.parse(saved.input.source)['group-suite'].welcomeMessage, 'changed'); await f.runtime.settle()
  assert.deepEqual(successes, ['saved']); f.answer('config:get-source', snapshot('changed')); f.answer('schema:get', schema); await f.runtime.settle()
  f.runtime.unmount()
})

const wholeSnapshot = name => ({ ...snapshot(name), source: JSON.stringify({ flag: name, 'group-suite': { welcomeMessage: name, welcomeConversations: [] } }) })
test('a dirty whole-file A session is remounted on B; B rendering and equal-revision CAS payload never reuse A draft', async () => {
  const f = fixture(), rootA = f.page.EditableConfigPage()
  f.runtime.mount(() => f.page.EditableConfigSession(rootA.props)); f.answer('config:get-source', wholeSnapshot('A')); await f.runtime.settle()
  const aDraft = JSON.stringify({ flag: 'A-edited', 'group-suite': { welcomeMessage: 'A-only' } })
  elements(f.runtime.value).find(item => item.type === 'textarea').props.onChange({ target: { value: aDraft } }); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).find(item => item.type === 'textarea').props.value, aDraft)
  const oldSave = button(f.runtime.value, '保存').props.onClick
  f.switchHost(); const rootB = f.page.EditableConfigPage(); assert.notEqual(rootA.key, rootB.key)
  f.runtime.remount(() => f.page.EditableConfigSession(rootB.props)); f.answer('config:get-source', wholeSnapshot('B')); await f.runtime.settle()
  const bTree = f.runtime.value, bText = elements(bTree).find(item => item.type === 'textarea')
  assert.equal(bText.props.value, wholeSnapshot('B').source); assert.ok(!bText.props.value.includes('A-only'))
  const general = elements(bTree).find(item => item.type === f.page.GeneralConfigForm)
  assert.equal(general.props.config.flag, 'B'); assert.equal(general.props.snapshot.connectionScope, rootB.props.connectionScope)
  const before = f.calls.length; await oldSave(); assert.equal(f.calls.length, before)
  const bDraft = JSON.stringify({ flag: 'B-edited', 'group-suite': { welcomeMessage: 'B-only' } })
  bText.props.onChange({ target: { value: bDraft } }); await f.runtime.settle()
  const saved = button(f.runtime.value, '保存').props.onClick(); const call = f.answer('config:replace-source', { success: true, revision: 'B-new', restartRequired: false })
  assert.equal(call.scope, rootB.props.connectionScope); assert.equal(call.input.source, bDraft); assert.equal(call.input.expectedRevision, 'same-revision')
  await saved; await f.runtime.settle(); assert.deepEqual(f.errors, []); assert.equal(f.successes.length, 1); f.runtime.unmount()
})

test('the General form starts a fresh B draft and its actual save handler carries only the B baseline', async () => {
  const f = fixture(), rootA = f.page.EditableConfigPage(), writes = []
  const aSnapshot = { ...wholeSnapshot('A'), connectionScope: rootA.props.connectionScope }
  const onSave = async (patch, baseline) => writes.push({ patch, baseline })
  const aProps = { config: { flag: 'A' }, pluginKeys: [], snapshot: aSnapshot, onSave, saving: false, connectionScope: rootA.props.connectionScope }
  f.runtime.mount(() => f.page.GeneralConfigForm(aProps))
  elements(f.runtime.value).find(item => item.props?.fieldKey === 'flag').props.onChange('A-dirty'); await f.runtime.settle()
  const oldSave = button(f.runtime.value, '保存').props.onClick
  f.switchCredential(); const rootB = f.page.EditableConfigPage(); assert.notEqual(rootA.key, rootB.key)
  const bSnapshot = { ...wholeSnapshot('B'), connectionScope: rootB.props.connectionScope }
  const bProps = { config: { flag: 'B' }, pluginKeys: [], snapshot: bSnapshot, onSave, saving: false, connectionScope: rootB.props.connectionScope }
  f.runtime.remount(() => f.page.GeneralConfigForm(bProps))
  assert.equal(elements(f.runtime.value).find(item => item.props?.fieldKey === 'flag').props.value, 'B')
  await oldSave(); assert.deepEqual(writes, [])
  elements(f.runtime.value).find(item => item.props?.fieldKey === 'flag').props.onChange('B-dirty'); await f.runtime.settle()
  await button(f.runtime.value, '保存').props.onClick()
  assert.deepEqual(writes, [{ patch: { flag: 'B-dirty' }, baseline: bSnapshot }]); f.runtime.unmount()
})

test('retired source-page refresh/save responses cannot toast success, clear drafts or reload the new session', async () => {
  for (const operation of ['refresh', 'save']) {
    const f = fixture(), root = f.page.EditableConfigPage(), scope = root.props.connectionScope
    f.runtime.mount(() => f.page.EditableConfigSession(root.props)); f.answer('config:get-source', wholeSnapshot('A')); await f.runtime.settle()
    let pending
    if (operation === 'refresh') pending = button(f.runtime.value, '刷新').props.onClick()
    else {
      elements(f.runtime.value).find(item => item.type === 'textarea').props.onChange({ target: { value: wholeSnapshot('A-changed').source } }); await f.runtime.settle()
      pending = button(f.runtime.value, '保存').props.onClick()
    }
    f.switchCredential()
    f.answer(operation === 'refresh' ? 'config:get-source' : 'config:replace-source', operation === 'refresh' ? wholeSnapshot('A-late') : { success: true, revision: 'A-new', restartRequired: false }, scope)
    await pending; await f.runtime.settle(); assert.deepEqual(f.successes, []); assert.deepEqual(f.errors, []); f.runtime.unmount()
  }
})
