import { localeModule, isLocaleImport } from './locale-fixture.mjs'
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
import * as settingsModel from '../console-ui/src/pages/settings-model.mjs'
import { numericFieldIssue } from '../console-ui/src/components/PluginConfigForm/numeric-validation.mjs'
import { isConversationScopeField } from '../console-ui/src/components/PluginConfigForm/conversation-scope-model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as configEvidenceModel from '../console-ui/src/components/PluginConfigForm/config-evidence-model.mjs'

const require = createRequire(import.meta.url)
const files = await Promise.all(['hooks/useConfigSource.ts', 'components/PluginConfigForm/usePluginConfigDraft.ts', 'components/PluginConfigForm/index.tsx', 'pages/config.tsx', 'components/PluginConfigForm/SchemaFieldEditor.tsx']
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

function fixture(query = '') {
  let locale = 'zh-CN'
  let messages = localeModule.useI18n()
  const localized = { ...localeModule, useI18n: () => messages }
  const runtime = hookRuntime(); let connection = { host: 'https://host-a', credential: 'credential-a' }, nextScope = 0
  const authority = createInboxCacheAuthority(() => connection, () => `opaque-${++nextScope}`)
  const calls = []
  const successes = [], errors = []
  const requestConsole = input => new Promise((resolve, reject) => { calls.push({ input, scope: authority.current(), resolve, reject, answered: false }) })
  const mocks = {
    react: { ...runtime.hooks, useId: () => 'test-field', createElement: require('react').createElement },
    '@zhin.js/client': { getWebSocketManager: () => ({ isConnected: () => true, onConnectionChange: () => () => {} }) },
    './config-error-state.mjs': { configErrorReducer },
    '../utils/console-rpc': { requestConsole }, '../../utils/console-rpc': { requestConsole },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() }, '../../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() },
    '../utils/inbox-cache': { getInboxCacheScope: () => authority.current(), isInboxCacheScopeActive: scope => authority.active(scope) },
    '../../utils/inbox-cache': { getInboxCacheScope: () => authority.current(), isInboxCacheScopeActive: scope => authority.active(scope) },
    '../pages/endpoint-detail/message-diagnostics.mjs': { createDiagnosticRequestGate }, '../../pages/endpoint-detail/message-diagnostics.mjs': { createDiagnosticRequestGate },
    './source-model.mjs': sourceModel, './schema-model.mjs': schemaModel, './draft-guard.mjs': { createConfigDraftGuard },
    './numeric-validation.mjs': { numericFieldIssue }, './conversation-scope-model.mjs': { isConversationScopeField }, './ConversationScopeEditor': { ConversationScopeEditor: 'scope-editor' },
    '../ui/input': { Input: 'input' }, '../ui/textarea': { Textarea: 'textarea' }, '../ui/switch': { Switch: 'switch' },
    '../ui/select': { Select: 'select-root', SelectContent: 'select-content', SelectItem: 'option', SelectTrigger: 'select-trigger', SelectValue: 'select-value' },
  '../ui/radio-group': { RadioGroup: 'radio-group', RadioGroupItem: 'radio' }, '../ui/checkbox': { Checkbox: 'checkbox' },
    '../../pages/files/code-editor': { CodeEditor: 'code-editor' }, './files/code-editor': { CodeEditor: 'code-editor' },
    './config-evidence-model.mjs': configEvidenceModel, './ConfigApplicationEvidence': { ConfigApplicationEvidence: 'config-evidence' },
    '../components/PluginConfigForm/config-evidence-model.mjs': configEvidenceModel,
    'react-router-dom': { Link: 'a', useSearchParams: () => [new URLSearchParams(query), () => {}] },
    'lucide-react': new Proxy({}, { get: () => 'i' }),
    './ConfigFieldExplanation': { ConfigFieldExplanation: 'field-explanation' },
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
    './config-source-draft.mjs': sourceDraftModel, './config-source-validation.mjs': sourceValidation, './config-navigation.mjs': configNavigation, './settings-model.mjs': settingsModel,
    './WelcomeFlowContext': { WelcomeFlowContext: 'welcome-flow-context' },
  }
  function compile(source) {
    const module = { exports: {} }
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localized : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
    return module.exports
  }
  const source = compile(files[0]); mocks['../../hooks/useConfigSource'] = source
  const plugin = compile(files[1]); mocks['./usePluginConfigDraft'] = plugin
  const form = compile(`${files[2]}\nexport { PluginConfigFormSession };`)
  mocks['../hooks/useConfigSource'] = source; mocks['../components/PluginConfigForm'] = form
  const page = compile(`${files[3]}\nexport { EditableConfigPage, EditableConfigSession };`)
  const editor = compile(`${files[4]}\nexport { JsonValueEditor, UnionValueEditor, ObjectValueEditor, SequenceValueEditor, SecretTextEditor };`)
  return { runtime, calls, source, plugin, form, page, editor, authority, successes, errors,
    switchLocale(next) { locale = next; messages = { ...localeModule.useI18n(), locale, t: (message, values) => translate(locale, message, values) } },
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
const calendar = JSON.parse(await readFile(new URL('./fixtures/calendar-config-provider.json', import.meta.url), 'utf8'))
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

async function loadedCalendarForm(source = calendar.source) {
  const f = fixture(), connectionScope = f.authority.current()
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'calendar-alpha', connectionScope }))
  f.answer('config:get-source', source); f.answer('schema:get', calendar.schema); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).some(item => label(item) === '配置需要源码编辑'), false)
  button(f.runtime.value, '全部配置').props.onClick(); await f.runtime.settle()
  return f
}
const calendarField = (f, name) => elements(f.runtime.value).find(item => item.type === 'field-editor' && item.props.name === name)

test('actual Calendar projection and production Select/form handlers keep all branches, other aliases and original CAS revision', async () => {
  assert.deepEqual(calendar.schema.object.provider.options.map(item => item.value), ['none', 'caldav', 'google', 'microsoft'])
  const f = await loadedCalendarForm(), provider = calendarField(f, 'provider')
  const select = elements(f.editor.SchemaFieldEditor(provider.props)).find(item => item.type === 'radio-group')
  assert.equal(select.props.value, '1'); select.props.onValueChange('2'); await f.runtime.settle()
  button(f.runtime.value, '保存配置').props.onClick()
  const checked = f.answer('plugin:validate-config', calendar.validation)
  const before = JSON.parse(calendar.source.source)
  const expected = { ...schemaModel.declaredDefaults(calendar.schema, before['calendar-alpha']), provider: 'google' }
  assert.deepEqual(checked.input.data, expected); await f.runtime.settle()
  const saved = f.answer('config:replace-source', calendar.save)
  assert.equal(saved.input.expectedRevision, calendar.source.revision)
  const payload = JSON.parse(saved.input.source)
  assert.deepEqual(payload, { ...before, 'calendar-alpha': expected })
  assert.equal(payload['calendar-alpha'].caldav.password, '${CALDAV_PASSWORD}')
  assert.equal(payload['calendar-alpha'].google.client_secret, '${GOOGLE_SECRET}')
  assert.equal(payload['calendar-alpha'].microsoft.refresh_token, '${MS_REFRESH}')
  await f.runtime.settle()
  // Browser/hook transport is simulated; this derived readback includes the unchanged form's declared defaults.
  f.answer('config:get-source', { ...calendar.after, source: saved.input.source }); f.answer('schema:get', calendar.schema); await f.runtime.settle()
  assert.equal(calendarField(f, 'provider').props.value, 'google'); f.runtime.unmount()
})

test('actual Calendar validation rejects a preserved environment option without deleting it or saving a partial object', async () => {
  const f = await loadedCalendarForm(calendar.referenceSource), provider = calendarField(f, 'provider')
  const select = elements(f.editor.SchemaFieldEditor(provider.props)).find(item => item.type === 'radio-group')
  assert.equal(select.props.value, 'preserved')
  calendarField(f, 'timezone').props.onChange('UTC'); await f.runtime.settle()
  button(f.runtime.value, '保存配置').props.onClick()
  const checked = f.answer('plugin:validate-config', calendar.referenceValidation); await f.runtime.settle()
  assert.equal(checked.input.data.provider, '${CALENDAR_PROVIDER}')
  assert.equal(checked.input.data.timezone, 'UTC')
  assert.equal(f.calls.filter(item => item.input.type === 'config:replace-source').length, 0)
  assert.equal(calendarField(f, 'provider').props.value, '${CALENDAR_PROVIDER}')
  assert.equal(calendarField(f, 'timezone').props.value, 'UTC'); f.runtime.unmount()
})

test('actual Calendar rejection keeps an unknown alpha field and CAS failure keeps the edited provider draft', async () => {
  const document = JSON.parse(calendar.source.source); document['calendar-alpha'].future = 'must-not-delete'
  const invalid = await loadedCalendarForm({ ...calendar.source, source: JSON.stringify(document) })
  calendarField(invalid, 'timezone').props.onChange('UTC'); await invalid.runtime.settle()
  button(invalid.runtime.value, '保存配置').props.onClick()
  const checked = invalid.answer('plugin:validate-config', calendar.invalid); await invalid.runtime.settle()
  assert.equal(checked.input.data.future, 'must-not-delete')
  assert.equal(invalid.calls.filter(item => item.input.type === 'config:replace-source').length, 0)
  assert.equal(calendarField(invalid, 'timezone').props.value, 'UTC'); invalid.runtime.unmount()
  const conflict = await loadedCalendarForm()
  const select = elements(conflict.editor.SchemaFieldEditor(calendarField(conflict, 'provider').props)).find(item => item.type === 'radio-group')
  select.props.onValueChange('2'); await conflict.runtime.settle()
  button(conflict.runtime.value, '保存配置').props.onClick(); conflict.answer('plugin:validate-config', calendar.validation); await conflict.runtime.settle()
  const write = conflict.answer('config:replace-source', new Error(calendar.conflict), undefined, true); await conflict.runtime.settle()
  assert.equal(write.input.expectedRevision, calendar.source.revision)
  assert.equal(calendarField(conflict, 'provider').props.value, 'google'); conflict.runtime.unmount()
})

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

test('purpose fields expose optional welcome inputs without dropping other fields from the original CAS save', async () => {
  const f = fixture(), connectionScope = f.authority.current()
  const original = { welcomeMessage: 'original', welcomeConversations: [], keywordReply: true, commandNamespace: 'alpha' }
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'group-suite', connectionScope, purposeFields: ['welcomeMessage', 'welcomeConversations'] }))
  f.answer('config:get-source', { ...snapshot('original'), source: JSON.stringify({ 'group-suite': original }) })
  f.answer('schema:get', { type: 'object', object: { ...schema.object, keywordReply: { type: 'boolean' }, commandNamespace: { type: 'string' } } })
  await f.runtime.settle()
  assert.deepEqual(elements(f.runtime.value).filter(item => item.type === 'field-editor').map(item => item.props.name), Object.keys(original))
  button(f.runtime.value, '用途与必填配置').props.onClick(); await f.runtime.settle()
  const editors = elements(f.runtime.value).filter(item => item.type === 'field-editor')
  assert.deepEqual(editors.map(item => item.props.name), ['welcomeMessage', 'welcomeConversations'])
  editors[0].props.onChange('updated welcome'); await f.runtime.settle()
  button(f.runtime.value, '保存配置').props.onClick(); f.answer('plugin:validate-config', valid); await f.runtime.settle()
  const write = f.calls.find(item => item.input.type === 'config:replace-source')
  assert.equal(write.input.expectedRevision, 'same-revision')
  assert.deepEqual(JSON.parse(write.input.source)['group-suite'], { ...original, welcomeMessage: 'updated welcome' })
  f.runtime.unmount()
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
  elements(f.runtime.value).find(item => item.type === 'code-editor' && !item.props.readOnly).props.onChange(aDraft); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).find(item => item.type === 'code-editor' && !item.props.readOnly).props.value, aDraft)
  const oldSave = button(f.runtime.value, '保存').props.onClick
  f.switchHost(); const rootB = f.page.EditableConfigPage(); assert.notEqual(rootA.key, rootB.key)
  f.runtime.remount(() => f.page.EditableConfigSession(rootB.props)); f.answer('config:get-source', wholeSnapshot('B')); await f.runtime.settle()
  const bTree = f.runtime.value, bText = elements(bTree).find(item => item.type === 'code-editor' && !item.props.readOnly)
  assert.equal(bText.props.value, wholeSnapshot('B').source); assert.ok(!bText.props.value.includes('A-only'))
  assert.ok(!elements(bTree).some(item => item.type === 'textarea'))
  const before = f.calls.length; await oldSave(); assert.equal(f.calls.length, before)
  const bDraft = JSON.stringify({ flag: 'B-edited', 'group-suite': { welcomeMessage: 'B-only' } })
  bText.props.onChange(bDraft); await f.runtime.settle()
  const saved = button(f.runtime.value, '保存').props.onClick(); const call = f.answer('config:replace-source', { success: true, revision: 'B-new', restartRequired: false })
  assert.equal(call.scope, rootB.props.connectionScope); assert.equal(call.input.source, bDraft); assert.equal(call.input.expectedRevision, 'same-revision')
  await saved; await f.runtime.settle(); assert.deepEqual(f.errors, []); assert.equal(f.successes.length, 1); f.runtime.unmount()
})

test('canonical scalar forms remount on credential change and cannot save the previous scalar draft', async () => {
  const f = fixture(), scopeA = f.authority.current()
  const scalar = name => ({ source: JSON.stringify({ log_level: name, sibling: { keep: true } }), format: 'json', revision: 'same', configKeys: ['log_level'], configPaths: { log_level: ['log_level'] } })
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'log_level', connectionScope: scopeA }))
  f.answer('config:get-source', scalar('info')); f.answer('schema:get', { type: 'string' }); await f.runtime.settle()
  elements(f.runtime.value).find(item => item.type === 'field-editor').props.onChange('debug'); await f.runtime.settle()
  const oldSave = button(f.runtime.value, '保存配置').props.onClick
  f.switchCredential(); const scopeB = f.authority.current()
  f.runtime.remount(() => f.form.PluginConfigFormSession({ pluginName: 'log_level', connectionScope: scopeB }))
  f.answer('config:get-source', scalar('warn')); f.answer('schema:get', { type: 'string' }); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).find(item => item.type === 'field-editor').props.value, 'warn')
  const before = f.calls.length; await oldSave(); assert.equal(f.calls.length, before)
  elements(f.runtime.value).find(item => item.type === 'field-editor').props.onChange('error'); await f.runtime.settle()
  button(f.runtime.value, '保存配置').props.onClick(); const check = f.answer('plugin:validate-config', valid); assert.equal(check.input.data, 'error'); await f.runtime.settle()
  const write = f.answer('config:replace-source', { success: true, revision: 'next', restartRequired: false })
  assert.equal(write.input.expectedRevision, 'same'); assert.deepEqual(JSON.parse(write.input.source), { log_level: 'error', sibling: { keep: true } }); await f.runtime.settle()
  f.answer('config:get-source', { ...scalar('error'), revision: 'next' }); f.answer('schema:get', { type: 'string' }); await f.runtime.settle(); f.runtime.unmount()
})

test('retired source-page refresh/save responses cannot toast success, clear drafts or reload the new session', async () => {
  for (const operation of ['refresh', 'save']) {
    const f = fixture(), root = f.page.EditableConfigPage(), scope = root.props.connectionScope
    f.runtime.mount(() => f.page.EditableConfigSession(root.props)); f.answer('config:get-source', wholeSnapshot('A')); await f.runtime.settle()
    let pending
    if (operation === 'refresh') pending = button(f.runtime.value, '刷新').props.onClick()
    else {
      elements(f.runtime.value).find(item => item.type === 'code-editor' && !item.props.readOnly).props.onChange(wholeSnapshot('A-changed').source); await f.runtime.settle()
      pending = button(f.runtime.value, '保存').props.onClick()
    }
    f.switchCredential()
    f.answer(operation === 'refresh' ? 'config:get-source' : 'config:replace-source', operation === 'refresh' ? wholeSnapshot('A-late') : { success: true, revision: 'A-new', restartRequired: false }, scope)
    await pending; await f.runtime.settle(); assert.deepEqual(f.successes, []); assert.deepEqual(f.errors, []); f.runtime.unmount()
  }
})

const customSnapshot = (value, revision = 'r1') => ({ source: JSON.stringify({ entry: value, 'other.alias': { kept: true } }), format: 'json', revision, configKeys: ['entry'], configPaths: { entry: ['entry'] } })
async function customForm(value, definition, props = {}) {
  const f = fixture(), source = customSnapshot(value)
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'entry', connectionScope: f.authority.current(), ...props }))
  f.answer('config:get-source', source); f.answer('schema:get', definition); await f.runtime.settle()
  return f
}
test('production root forms echo null, false, zero and empty strings without coercion and save their actual scalar values', async () => {
  for (const [value, type] of [[null, 'null'], [false, 'boolean'], [0, 'number'], ['', 'string']]) {
    const f = await customForm(value, { type })
    assert.equal(elements(f.runtime.value).find(item => item.type === 'field-editor').props.value, value)
    button(f.runtime.value, '保存配置').props.onClick(); const check = f.answer('plugin:validate-config', valid); assert.equal(check.input.data, value); await f.runtime.settle()
    const write = f.answer('config:replace-source', { success: true, revision: 'r2', restartRequired: false })
    assert.equal(write.input.expectedRevision, 'r1'); assert.deepEqual(JSON.parse(write.input.source), { entry: value, 'other.alias': { kept: true } }); await f.runtime.settle()
    f.answer('config:get-source', customSnapshot(value, 'r2')); f.answer('schema:get', { type }); await f.runtime.settle(); f.runtime.unmount()
  }
})

test('empty object needs no fields, missing Schema stays explicit, and all known fields are displayed by default', async () => {
  const empty = await customForm({}, { type: 'object', object: {}, additional: false })
  assert.ok(label(empty.runtime.value).includes('此项无需配置。')); assert.ok(!label(empty.runtime.value).includes('配置需要源码编辑')); empty.runtime.unmount()
  const missing = await customForm({}, null)
  assert.ok(label(missing.runtime.value).includes('配置 Schema 不可用')); assert.equal(button(missing.runtime.value, '保存配置'), undefined); missing.runtime.unmount()
  const full = await customForm({ optional: 'kept' }, { type: 'object', object: { optional: { type: 'string' }, extra: { type: 'number' } } })
  assert.deepEqual(elements(full.runtime.value).filter(item => item.type === 'field-editor').map(item => item.props.name), ['optional', 'extra']); full.runtime.unmount()
})

test('single-item highlighted source shares the actual form draft and invalid text blocks switching or stale-value saves', async () => {
  const f = await customForm({ text: 'old' }, { type: 'object', object: { text: { type: 'string' } } })
  elements(f.runtime.value).find(item => item.type === 'field-editor').props.onChange('dirty'); await f.runtime.settle()
  button(f.runtime.value, '此项源码').props.onClick(); await f.runtime.settle()
  let source = elements(f.runtime.value).find(item => item.type === 'code-editor'); assert.equal(JSON.parse(source.props.value).text, 'dirty')
  source.props.onChange('{'); await f.runtime.settle(); assert.equal(button(f.runtime.value, '保存配置').props.disabled, true)
  const before = f.calls.length; button(f.runtime.value, '保存配置').props.onClick(); assert.equal(f.calls.length, before)
  button(f.runtime.value, '表单').props.onClick(); await f.runtime.settle(); assert.equal(elements(f.runtime.value).find(item => item.type === 'code-editor').props.value, '{')
  source = elements(f.runtime.value).find(item => item.type === 'code-editor'); source.props.onChange('{"text":"source-edited","future":{"keep":true}}'); await f.runtime.settle()
  button(f.runtime.value, '表单').props.onClick(); await f.runtime.settle(); assert.equal(elements(f.runtime.value).find(item => item.type === 'field-editor' && item.props.name === 'text').props.value, 'source-edited')
  button(f.runtime.value, '此项源码').props.onClick(); await f.runtime.settle(); assert.deepEqual(JSON.parse(elements(f.runtime.value).find(item => item.type === 'code-editor').props.value), { text: 'source-edited', future: { keep: true } }); f.runtime.unmount()
})

test('a field JSON syntax failure synchronously blocks the original save path without converting the rest of the form', async () => {
  const f = await customForm({ raw: { kept: true }, regular: 'hello' }, { type: 'object', object: { raw: { type: 'any' }, regular: { type: 'string' } } })
  const raw = elements(f.runtime.value).find(item => item.type === 'field-editor' && item.props.name === 'raw')
  raw.props.onValidityChange(raw.props.path, true); await f.runtime.settle()
  assert.equal(button(f.runtime.value, '保存配置').props.disabled, true); assert.equal(button(f.runtime.value, '最小必填配置').props.disabled, true)
  button(f.runtime.value, '最小必填配置').props.onClick(); await f.runtime.settle(); assert.ok(elements(f.runtime.value).some(item => item.type === 'field-editor' && item.props.name === 'raw'))
  assert.equal(elements(f.runtime.value).find(item => item.type === 'field-editor' && item.props.name === 'regular').props.value, 'hello')
  raw.props.onValidityChange(raw.props.path, false); await f.runtime.settle(); assert.equal(button(f.runtime.value, '保存配置').props.disabled, false); f.runtime.unmount()
})

test('external source revision refreshes clean forms, while dirty forms retain their original alias and CAS baseline', async () => {
  const f = fixture(); let revision = 'r1'
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'entry', connectionScope: f.authority.current(), sourceRevision: revision }))
  const definition = { type: 'string' }
  f.answer('config:get-source', customSnapshot('old')); f.answer('schema:get', definition); await f.runtime.settle()
  assert.equal(f.calls.filter(item => item.input.type === 'config:get-source').length, 1)
  revision = 'r2'; f.runtime.render(); f.answer('config:get-source', customSnapshot('from-full-source', 'r2')); f.answer('schema:get', definition); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).find(item => item.type === 'field-editor').props.value, 'from-full-source')
  elements(f.runtime.value).find(item => item.type === 'field-editor').props.onChange('dirty-kept'); await f.runtime.settle()
  revision = 'r3'; f.runtime.render(); f.answer('config:get-source', customSnapshot('concurrent', 'r3')); f.answer('schema:get', definition); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).find(item => item.type === 'field-editor').props.value, 'dirty-kept')
  button(f.runtime.value, '保存配置').props.onClick(); f.answer('plugin:validate-config', valid); await f.runtime.settle()
  const write = f.answer('config:replace-source', Error('CAS conflict'), undefined, true); assert.equal(write.input.expectedRevision, 'r2'); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).find(item => item.type === 'field-editor').props.value, 'dirty-kept'); f.runtime.unmount()
})

test('real union controls preserve branch values and the original unknown value through switching', async () => {
  const f = fixture(), drafts = { json: new Map(), unions: new Map() }
  const definition = { type: 'union', list: [{ type: 'object', object: { kind: { type: 'const', value: 'a' }, text: { type: 'string' } } }, { type: 'object', object: { kind: { type: 'const', value: 'b' }, count: { type: 'number', default: 0 } } }] }
  let value = { kind: 'a', text: 'initial', 'future.key': { keep: true } }
  f.runtime.mount(() => f.editor.UnionValueEditor({ name: 'choice', field: definition, value, drafts, onChange: next => { value = next } }))
  let select = elements(f.runtime.value).find(item => item.type === 'select'); assert.equal(select.props.value, '0')
  let child = elements(f.runtime.value).find(item => item.type === f.editor.SchemaFieldEditor)
  child.props.onChange({ ...value, text: 'dirty-a' }); f.runtime.render()
  select = elements(f.runtime.value).find(item => item.type === 'select'); select.props.onChange({ target: { value: '1' } }); f.runtime.render(); assert.deepEqual(value, { kind: 'b', count: 0 })
  child = elements(f.runtime.value).find(item => item.type === f.editor.SchemaFieldEditor); child.props.onChange({ ...value, count: 7 }); f.runtime.render()
  elements(f.runtime.value).find(item => item.type === 'select').props.onChange({ target: { value: '0' } }); f.runtime.render(); assert.equal(value.text, 'dirty-a'); assert.deepEqual(value['future.key'], { keep: true })
  elements(f.runtime.value).find(item => item.type === 'select').props.onChange({ target: { value: '1' } }); f.runtime.render(); assert.equal(value.count, 7)
  elements(f.runtime.value).find(item => item.type === 'select').props.onChange({ target: { value: 'preserved' } }); f.runtime.render(); assert.equal(value.text, 'initial'); f.runtime.unmount()
})

test('an unset union opens its first fillable branch without writing a value', async () => {
  const f = fixture(), drafts = { json: new Map(), unions: new Map() }, writes = []
  const definition = { type: 'union', list: [{ type: 'null' }, { type: 'boolean' }, { type: 'string' }] }
  f.runtime.mount(() => f.editor.UnionValueEditor({ name: 'enabled', field: definition, value: undefined, drafts, onChange: next => writes.push(next) }))
  const select = elements(f.runtime.value).find(item => item.type === 'select')
  assert.equal(select.props.value, '1')
  assert.ok(elements(f.runtime.value).some(item => item.type === 'option' && item.props.value === 'preserved' && item.props.children === '暂不设置'))
  assert.equal(elements(f.runtime.value).some(item => item.type === f.editor.JsonValueEditor), false)
  assert.deepEqual(writes, []); f.runtime.unmount()
})

test('real field JSON control keeps invalid raw text across remounts and reports errors before any parsed-value write', async () => {
  const f = fixture(), drafts = { json: new Map(), unions: new Map() }, flags = [], writes = []
  const props = { name: 'raw', field: { type: 'any' }, value: { keep: true }, path: '$/choice/branch:0', drafts, onChange: value => writes.push(value), onValidityChange: (path, invalid) => flags.push({ path, invalid }) }
  f.runtime.mount(() => f.editor.JsonValueEditor(props))
  elements(f.runtime.value).find(item => item.type === 'code-editor').props.onChange('{')
  assert.equal(flags.at(-1).invalid, true); assert.deepEqual(writes, []); await f.runtime.settle()
  f.runtime.remount(() => f.editor.JsonValueEditor(props)); await f.runtime.settle(); assert.equal(elements(f.runtime.value).find(item => item.type === 'code-editor').props.value, '{'); assert.equal(flags.at(-1).invalid, true)
  elements(f.runtime.value).find(item => item.type === 'code-editor').props.onChange('{"keep":false}'); assert.deepEqual(writes, [{ keep: false }]); assert.equal(flags.at(-1).invalid, false); f.runtime.unmount()
})

test('real dynamic dictionary keeps literal keys, rejects duplicate/reserved keys and edits one nested value', async () => {
  const f = fixture(); let value = { 'a.b': { nested: [1], keep: true }, untouched: { keep: true } }
  const props = () => ({ name: 'dict', field: { type: 'dict', inner: { type: 'object', object: { nested: { type: 'list', inner: { type: 'number' } } } } }, value, onChange: next => { value = next } })
  f.runtime.mount(() => f.editor.ObjectValueEditor(props()))
  const child = elements(f.runtime.value).find(item => item.type === f.editor.SchemaFieldEditor && item.props.name === 'a.b'); child.props.onChange({ nested: [2], keep: true }); f.runtime.render()
  assert.deepEqual(value, { 'a.b': { nested: [2], keep: true }, untouched: { keep: true } })
  let input = elements(f.runtime.value).find(item => item.type === 'input'); input.props.onChange({ target: { value: '__proto__' } }); await f.runtime.settle(); button(f.runtime.value, '添加键值').props.onClick(); await f.runtime.settle(); assert.ok(!Object.hasOwn(value, '__proto__'))
  input = elements(f.runtime.value).find(item => item.type === 'input'); input.props.onChange({ target: { value: 'new.key' } }); await f.runtime.settle(); button(f.runtime.value, '添加键值').props.onClick(); f.runtime.render(); assert.deepEqual(value['new.key'], {}); f.runtime.unmount()
})

test('tuple positions do not shift and tail values use their own projected schema', () => {
  const f = fixture(); let value = ['first', 2, { old: true }]
  const props = { name: 'tuple', field: { type: 'tuple', list: [{ type: 'string' }, { type: 'number' }], inner: { type: 'any' } }, value, onChange: next => { value = next } }
  const tree = f.editor.SequenceValueEditor(props), fields = elements(tree).filter(item => item.type === f.editor.SchemaFieldEditor)
  assert.deepEqual(fields.map(item => item.props.field.type), ['string', 'number', 'any'])
  fields[1].props.onChange(9); assert.deepEqual(value, ['first', 9, { old: true }]); assert.equal(elements(tree).filter(item => item.type === 'button' && label(item) === '删除此项').length, 1)
  const fixed = f.editor.SequenceValueEditor({ ...props, field: { ...props.field, inner: false } }); assert.equal(button(fixed, '添加列表项'), undefined)
})

test('Host-only conditional constraints cannot edit, remove or default the shared intersection value', () => {
  const f = fixture(), changes = []
  const tree = f.editor.SchemaFieldEditor({ name: 'conditional', field: { type: 'constraint', reason: 'host-validation' }, value: { enabled: true }, onChange: next => changes.push(next) })
  assert.ok(label(tree).includes('提交后由 Host 校验')); assert.deepEqual(elements(tree).filter(item => ['input', 'button', 'code-editor'].includes(item.type)), []); assert.deepEqual(changes, [])
  const definition = { type: 'intersect', list: [{ type: 'object', object: { enabled: { type: 'boolean', default: false } } }, { type: 'constraint', default: { injected: true } }] }
  assert.deepEqual(schemaModel.initialSchemaValue(definition), { enabled: false })
  assert.deepEqual(schemaModel.declaredDefaults(definition, { kept: true }), { kept: true, enabled: false })
})

test('secret annotations on an object are inherited by dynamic and known child editors', () => {
  const f = fixture()
  f.runtime.mount(() => f.editor.ObjectValueEditor({ name: 'secrets', field: { type: 'object', secret: true, object: { known: { type: 'string', secret: false } }, additional: { type: 'any' } }, value: { known: 'hide-me', dynamic: { secret: 'hide-too' } }, onChange: () => assert.fail('render must not write') }))
  const fields = elements(f.runtime.value).filter(item => item.type === f.editor.SchemaFieldEditor)
  assert.equal(fields.length, 2); assert.ok(fields.every(item => item.props.field.secret === true)); f.runtime.unmount()
})

test('secret textarea stays hidden until explicit editing and preserves multiline content including trailing newline', async () => {
  const f = fixture(), changes = [], value = 'PRIVATE-FIRST\nPRIVATE-SECOND\n'
  const props = { name: 'credential', field: { type: 'string', secret: true, component: 'textarea' }, value, onChange: next => changes.push(next) }
  const root = f.editor.SchemaFieldEditor(props)
  assert.equal(elements(root).filter(item => item.type === 'textarea' || item.type === 'input').length, 0)
  assert.ok(!label(root).includes('PRIVATE-FIRST')); assert.deepEqual(changes, [])
  const secret = elements(root).find(item => item.type === f.editor.SecretTextEditor)
  f.runtime.mount(() => f.editor.SecretTextEditor(secret.props))
  assert.equal(elements(f.runtime.value).filter(item => item.type === 'textarea').length, 0)
  button(f.runtime.value, '编辑敏感文本').props.onClick(); await f.runtime.settle()
  const input = elements(f.runtime.value).find(item => item.type === 'textarea'); assert.equal(input.props.value, value)
  input.props.onChange({ target: { value: value + 'NEW-LINE\n' } }); assert.deepEqual(changes, [value + 'NEW-LINE\n'])
  button(f.runtime.value, '隐藏敏感文本').props.onClick(); await f.runtime.settle(); assert.equal(elements(f.runtime.value).filter(item => item.type === 'textarea').length, 0); f.runtime.unmount()
})

test('inherited secret textarea, null mismatches and password JSON cannot expose saved content on initial form rendering', () => {
  const f = fixture(), hidden = 'PRIVATE-SAVED-VALUE'
  f.runtime.mount(() => f.editor.ObjectValueEditor({ name: 'parent', field: { type: 'object', secret: true, object: { nested: { type: 'string', component: 'textarea', secret: false } } }, value: { nested: hidden }, onChange() {} }))
  const child = elements(f.runtime.value).find(item => item.type === f.editor.SchemaFieldEditor)
  const text = f.editor.SchemaFieldEditor(child.props)
  assert.ok(elements(text).some(item => item.type === f.editor.SecretTextEditor)); assert.ok(!label(text).includes(hidden)); f.runtime.unmount()
  const nullField = f.editor.SchemaFieldEditor({ name: 'nullable', field: { type: 'null', secret: true }, value: hidden, onChange() {} })
  assert.ok(!label(nullField).includes(hidden)); assert.ok(label(nullField).includes('敏感原值未展示'))
  const password = f.editor.SchemaFieldEditor({ name: 'password', field: { type: 'any', component: 'password' }, value: { token: hidden }, onChange() {} })
  const json = elements(password).find(item => item.type === f.editor.JsonValueEditor); assert.equal(json.props.field.secret, true)
  f.runtime.mount(() => f.editor.JsonValueEditor(json.props)); assert.equal(elements(f.runtime.value).filter(item => item.type === 'code-editor').length, 0); assert.ok(!label(f.runtime.value).includes(hidden)); f.runtime.unmount()
})

test('real list deletion preserves the second row React identity, union branch and branch drafts while purging only the removed row', async () => {
  const list = fixture(), child = fixture(), drafts = { json: new Map(), unions: new Map() }, flags = []
  const union = { type: 'union', list: [{ type: 'object', object: { kind: { type: 'const', value: 'a' }, text: { type: 'string' } } }, { type: 'object', object: { kind: { type: 'const', value: 'b' }, count: { type: 'number', default: 0 } } }] }
  let rows = [{ kind: 'a', text: 'first' }, { kind: 'b', count: 99, keep: 'second' }]
  const listProps = () => ({ name: 'rows', path: '$/rows', field: { type: 'list', inner: union }, value: rows, drafts, onValidityChange: (path, invalid) => flags.push({ path, invalid }), onChange: next => { rows = next } })
  list.runtime.mount(() => list.editor.SequenceValueEditor(listProps()))
  const fields = () => elements(list.runtime.value).filter(item => item.type === list.editor.SchemaFieldEditor)
  const firstPath = fields()[0].props.path, secondPath = fields()[1].props.path
  const oldKey = elements(list.runtime.value).find(item => [item.props?.children].flat().some(node => node?.props?.path === secondPath))?.key
  assert.notEqual(oldKey, undefined)
  drafts.json.set(`${firstPath}/branch:0/raw`, { text: '{', value: null, error: 'invalid' })
  drafts.unions.set(firstPath, { selected: 0, values: new Map() })
  let secondProps = fields()[1].props
  child.runtime.mount(() => child.editor.UnionValueEditor(secondProps))
  assert.equal(elements(child.runtime.value).find(item => item.type === 'select').props.value, '1')
  elements(list.runtime.value).find(item => item.type === 'button' && label(item) === '删除此项').props.onClick(); list.runtime.render()
  assert.equal(fields().length, 1); assert.equal(fields()[0].props.path, secondPath); assert.notEqual(fields()[0].props.path, firstPath)
  const newKey = elements(list.runtime.value).find(item => [item.props?.children].flat().some(node => node?.props?.path === secondPath))?.key; assert.equal(newKey, oldKey)
  assert.equal(drafts.json.has(`${firstPath}/branch:0/raw`), false); assert.equal(drafts.unions.has(firstPath), false); assert.deepEqual(flags.at(-1), { path: `${firstPath}/branch:0/raw`, invalid: false })
  secondProps = fields()[0].props; child.runtime.render()
  assert.equal(elements(child.runtime.value).find(item => item.type === 'select').props.value, '1'); assert.deepEqual(rows, [{ kind: 'b', count: 99, keep: 'second' }])
  elements(child.runtime.value).find(item => item.type === 'select').props.onChange({ target: { value: '0' } }); list.runtime.render(); secondProps = fields()[0].props; child.runtime.render()
  elements(child.runtime.value).find(item => item.type === 'select').props.onChange({ target: { value: '1' } }); list.runtime.render(); secondProps = fields()[0].props; child.runtime.render()
  assert.deepEqual(rows, [{ kind: 'b', count: 99, keep: 'second' }]); assert.equal(elements(child.runtime.value).find(item => item.type === 'select').props.value, '1')
  child.runtime.unmount(); list.runtime.unmount()
})

test('deleting a row with invalid JSON does not transfer its text to an equal-valued sibling or a newly appended row', async () => {
  const f = fixture(), json = fixture(), drafts = { json: new Map(), unions: new Map() }
  let rows = [{ same: true }, { same: true }]
  const props = () => ({ name: 'rows', path: '$/rows', field: { type: 'list', inner: { type: 'any' } }, value: rows, drafts, onChange: next => { rows = next } })
  f.runtime.mount(() => f.editor.SequenceValueEditor(props()))
  const fields = () => elements(f.runtime.value).filter(item => item.type === f.editor.SchemaFieldEditor)
  const first = fields()[0].props, second = fields()[1].props
  json.runtime.mount(() => json.editor.JsonValueEditor(first)); elements(json.runtime.value).find(item => item.type === 'code-editor').props.onChange('{'); await json.runtime.settle(); json.runtime.unmount()
  elements(f.runtime.value).find(item => item.type === 'button' && label(item) === '删除此项').props.onClick(); f.runtime.render()
  assert.equal(fields()[0].props.path, second.path)
  json.runtime.remount(() => json.editor.JsonValueEditor(fields()[0].props)); assert.deepEqual(JSON.parse(elements(json.runtime.value).find(item => item.type === 'code-editor').props.value), { same: true }); json.runtime.unmount()
  // Add sits on the list's own title row, outside the row editor.
  button(f.editor.SchemaFieldEditor(props()), '添加列表项').props.onClick(); f.runtime.render()
  assert.notEqual(fields()[1].props.path, first.path); assert.notEqual(fields()[1].props.path, second.path)
  assert.ok(!drafts.json.has(first.path)); f.runtime.unmount()
})

test('deleting and recreating a dynamic key removes its invalid JSON draft but preserves its sibling drafts', async () => {
  const f = fixture(), json = fixture(), drafts = { json: new Map(), unions: new Map() }, flags = []
  let value = { entry: null, sibling: { keep: true } }
  const props = () => ({ name: 'dict', path: '$/dict', field: { type: 'dict', inner: { type: 'any' } }, value, drafts, onValidityChange: (path, invalid) => flags.push({ path, invalid }), onChange: next => { value = next } })
  f.runtime.mount(() => f.editor.ObjectValueEditor(props()))
  const entry = () => elements(f.runtime.value).find(item => item.type === f.editor.SchemaFieldEditor && item.props.name === 'entry').props
  const removedPath = entry().path, siblingPath = elements(f.runtime.value).find(item => item.type === f.editor.SchemaFieldEditor && item.props.name === 'sibling').props.path
  const siblingDraft = { text: '{"keep":true}', value: { keep: true }, error: null }; drafts.json.set(siblingPath, siblingDraft)
  json.runtime.mount(() => json.editor.JsonValueEditor(entry())); elements(json.runtime.value).find(item => item.type === 'code-editor').props.onChange('{'); await json.runtime.settle(); json.runtime.unmount()
  button(f.runtime.value, '删除键 entry').props.onClick(); f.runtime.render()
  assert.equal(Object.hasOwn(value, 'entry'), false); assert.equal(drafts.json.has(removedPath), false)
  assert.equal(drafts.json.get(siblingPath), siblingDraft); assert.deepEqual(value.sibling, { keep: true })
  elements(f.runtime.value).find(item => item.type === 'input').props.onChange({ target: { value: 'entry' } }); await f.runtime.settle(); button(f.runtime.value, '添加键值').props.onClick(); f.runtime.render()
  assert.equal(value.entry, null); json.runtime.remount(() => json.editor.JsonValueEditor(entry())); await json.runtime.settle()
  assert.equal(elements(json.runtime.value).find(item => item.type === 'code-editor').props.value, 'null'); assert.equal(flags.at(-1).invalid, false)
  json.runtime.unmount(); f.runtime.unmount()
})

test('recreating a deleted union dictionary key selects its new initial branch without resurrecting the old branch cache', async () => {
  const f = fixture(), union = fixture(), drafts = { json: new Map(), unions: new Map() }
  const definition = { type: 'union', default: { kind: 'a', text: 'new' }, list: [{ type: 'object', object: { kind: { type: 'const', value: 'a' }, text: { type: 'string' } } }, { type: 'object', object: { kind: { type: 'const', value: 'b' }, count: { type: 'number' } } }] }
  let value = { entry: { kind: 'b', count: 99 }, sibling: { kind: 'a', text: 'keep' } }
  const props = () => ({ name: 'dict', path: '$/dict', field: { type: 'dict', inner: definition }, value, drafts, onChange: next => { value = next } })
  f.runtime.mount(() => f.editor.ObjectValueEditor(props()))
  const entry = () => elements(f.runtime.value).find(item => item.type === f.editor.SchemaFieldEditor && item.props.name === 'entry').props
  union.runtime.mount(() => union.editor.UnionValueEditor(entry())); assert.equal(elements(union.runtime.value).find(item => item.type === 'select').props.value, '1'); union.runtime.unmount()
  button(f.runtime.value, '删除键 entry').props.onClick(); f.runtime.render()
  elements(f.runtime.value).find(item => item.type === 'input').props.onChange({ target: { value: 'entry' } }); await f.runtime.settle(); button(f.runtime.value, '添加键值').props.onClick(); f.runtime.render()
  union.runtime.remount(() => union.editor.UnionValueEditor(entry())); assert.equal(elements(union.runtime.value).find(item => item.type === 'select').props.value, '0')
  assert.deepEqual(value, { sibling: { kind: 'a', text: 'keep' }, entry: { kind: 'a', text: 'new' } }); union.runtime.unmount(); f.runtime.unmount()
})

test('explicitly unsetting and re-adding an optional object cannot revive its discarded invalid JSON child draft', async () => {
  const object = fixture(), json = fixture(), drafts = { json: new Map(), unions: new Map() }, flags = []
  const definition = { type: 'object', default: { raw: null }, object: { raw: { type: 'any' } }, additional: false }
  let value = { raw: null }
  const props = () => ({ name: 'optional', path: '$/optional', field: definition, value, drafts, onValidityChange: (path, invalid) => flags.push({ path, invalid }), onChange: next => { value = next } })
  object.runtime.mount(() => object.editor.ObjectValueEditor(props()))
  const raw = () => elements(object.runtime.value).find(item => item.type === object.editor.SchemaFieldEditor && item.props.name === 'raw').props
  json.runtime.mount(() => json.editor.JsonValueEditor(raw())); elements(json.runtime.value).find(item => item.type === 'code-editor').props.onChange('{'); await json.runtime.settle()
  button(object.editor.SchemaFieldEditor(props()), '清空').props.onClick(); object.runtime.render(); json.runtime.unmount()
  assert.equal(value, undefined)
  button(object.runtime.value, '添加对象配置').props.onClick(); object.runtime.render(); assert.deepEqual(value, { raw: null })
  json.runtime.remount(() => json.editor.JsonValueEditor(raw())); await json.runtime.settle()
  assert.equal(elements(json.runtime.value).find(item => item.type === 'code-editor').props.value, 'null'); assert.equal(flags.at(-1).invalid, false)
  json.runtime.unmount(); object.runtime.unmount()
})


test('changing interface locale keeps the actual config form draft and original revision without issuing another load', async () => {
  const f = await loadedCalendarForm()
  calendarField(f, 'provider').props.onChange('google'); await f.runtime.settle()
  const calls = f.calls.length
  f.switchLocale('en'); f.runtime.render(); await f.runtime.settle()
  assert.equal(f.calls.length, calls)
  assert.equal(calendarField(f, 'provider').props.value, 'google')
  assert.ok(button(f.runtime.value, 'Save configuration'))
  button(f.runtime.value, 'Save configuration').props.onClick()
  const validated = f.answer('plugin:validate-config', calendar.validation)
  assert.equal(validated.input.data.provider, 'google'); await f.runtime.settle()
  const saved = f.answer('config:replace-source', calendar.save)
  assert.equal(saved.input.expectedRevision, calendar.source.revision)
  await f.runtime.settle()
})

test('production schema editor translates labels while preserving selected and emitted option values', () => {
  const f = fixture(); f.switchLocale('en')
  const changes = []
  const field = { type:'string', title:'模式', options:[{value:'off',label:'关闭'},{value:'on',label:'开启'}], 'x-i18n':{en:{title:'Mode',description:'Choose a mode',enumLabels:{on:'On',off:'Off'}}} }
  f.runtime.mount(() => f.editor.SchemaFieldEditor({name:'mode',field,value:'off',onChange: value => changes.push(value)}))
  const tree = f.runtime.value
  assert.ok(elements(tree).some(item => label(item) === 'Mode'))
  const options = elements(tree).filter(item => item.type === 'label' && [item.props.children].flat().some(child => child?.type === 'radio'))
  assert.deepEqual(options.map(label), ['Off','On'])
  const select = elements(tree).find(item => item.type === 'radio-group')
  assert.equal(select.props.value,'0'); assert.deepEqual(changes,[])
  select.props.onValueChange('1'); assert.deepEqual(changes,['on'])
  assert.equal(field.title,'模式')
})

test('fill mode sits on the key title row and the branch never repeats the key as a second header', () => {
  const f = fixture(), drafts = { json: new Map(), unions: new Map(), originals: new Map() }
  const definition = { type: 'union', title: 'trigger', list: [{ type: 'object', object: { mode: { type: 'string' } } }, { type: 'boolean' }] }
  let value = { mode: 'x' }
  f.runtime.mount(() => f.editor.UnionValueEditor({ name: 'trigger', path: '$/trigger', field: definition, value, drafts, onChange: next => { value = next } }))
  const branch = elements(f.runtime.value).find(item => item.type === f.editor.SchemaFieldEditor)
  assert.equal(branch.props.label, 'trigger'); assert.equal(branch.props.inheritActions, true)
  assert.equal(branch.props.actions[0].type, 'select')
  const tree = f.editor.SchemaFieldEditor(branch.props)
  const titles = elements(tree).filter(item => item.props?.className === 'text-sm font-medium')
  assert.deepEqual(titles.map(label), ['trigger'])
  assert.ok(elements(tree).some(item => item.type === 'details'))
  assert.equal(label(tree).includes('取消此项设置'), false)
  f.runtime.unmount()
})

test('撤销 restores the first-seen value and 清空 leaves the key unset', () => {
  const f = fixture(), drafts = { json: new Map(), unions: new Map(), originals: new Map() }, changes = []
  const props = value => ({ name: 'token', path: '$/token', field: { type: 'string', default: 'd' }, value, drafts, onChange: next => changes.push(next) })
  let tree = f.editor.SchemaFieldEditor(props('saved'))
  assert.equal(button(tree, '撤销'), undefined)
  tree = f.editor.SchemaFieldEditor(props('edited'))
  button(tree, '撤销').props.onClick(); assert.deepEqual(changes, ['saved'])
  button(tree, '清空').props.onClick(); assert.deepEqual(changes, ['saved', undefined])
  assert.equal(elements(tree).find(item => item.type === 'input').props.placeholder.includes('${ENV_NAME}'), true)
})

test('booleans render only a title-row switch, and list enums are checkboxes that keep unknown values', () => {
  const f = fixture(), changes = []
  const flag = f.editor.SchemaFieldEditor({ name: 'enabled', field: { type: 'boolean' }, value: true, onChange: next => changes.push(next) })
  assert.equal(elements(flag).filter(item => item.type === 'switch').length, 1); assert.equal(label(flag).includes('已启用'), false)
  const list = f.editor.SchemaFieldEditor({ name: 'kinds', field: { type: 'list', inner: { type: 'string', enum: ['a', 'b', 'c'] } }, value: ['b', 'zzz'], onChange: next => changes.push(next) })
  const boxes = elements(list).filter(item => item.type === 'checkbox')
  assert.deepEqual(boxes.map(item => item.props.checked), [false, true, false])
  boxes[2].props.onCheckedChange(true); assert.deepEqual(changes.at(-1), ['b', 'c', 'zzz'])
  boxes[1].props.onCheckedChange(false); assert.deepEqual(changes.at(-1), ['zzz'])
  assert.equal(button(list, '添加列表项'), undefined)
})

test('settings categories share one raw root draft and original CAS without materializing defaults or losing hidden siblings', async () => {
  const f = fixture(), connectionScope = f.authority.current()
  let fields = ['providers']
  const original = { providers: { primary: { model: 'old' } }, agents: { zhin: { provider: 'primary' } }, future: { keep: true } }
  const source = { source: JSON.stringify({ ai: original, untouched: { keep: true } }), format: 'json', revision: 'ai-r1', configKeys: ['ai'], configPaths: { ai: ['ai'] } }
  const definition = { type: 'object', object: { providers: { type: 'dict', inner: { type: 'any' } }, agents: { type: 'dict', inner: { type: 'any' } }, enabled: { type: 'boolean', default: true }, maxTurns: { type: 'number', default: 7 } }, additional: { type: 'any' } }
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'ai', connectionScope, fieldNames: fields, displayTitle: '模型', onOpenYaml: () => {} }))
  f.answer('config:get-source', source); f.answer('schema:get', definition); await f.runtime.settle()
  const currentFields = () => elements(f.runtime.value).filter(item => item.type === 'field-editor')
  assert.deepEqual(currentFields().map(item => item.props.name), ['providers'])
  assert.equal(button(f.runtime.value, '此项源码'), undefined)
  assert.ok(button(f.runtime.value, '打开完整源码'))
  currentFields()[0].props.onChange({ primary: { model: 'edited' } }); await f.runtime.settle()
  fields = ['agents']; f.runtime.render(); await f.runtime.settle()
  assert.deepEqual(currentFields().map(item => item.props.name), ['agents'])
  currentFields()[0].props.onChange({ zhin: { provider: 'primary', nickname: 'edited' } }); await f.runtime.settle()
  fields = ['enabled']; f.runtime.render(); await f.runtime.settle()
  assert.equal(currentFields()[0].props.value, undefined)
  assert.equal(currentFields()[0].props.useDeclaredDefaults, true)
  button(f.runtime.value, '保存配置').props.onClick()
  const validation = f.answer('plugin:validate-config', valid); await f.runtime.settle()
  const expected = { ...original, providers: { primary: { model: 'edited' } }, agents: { zhin: { provider: 'primary', nickname: 'edited' } } }
  assert.deepEqual(validation.input.data, expected)
  const write = f.answer('config:replace-source', { success: true, revision: 'ai-r2', restartRequired: true }); await f.runtime.settle()
  assert.equal(write.input.expectedRevision, 'ai-r1')
  assert.deepEqual(JSON.parse(write.input.source), { ai: expected, untouched: { keep: true } })
  f.runtime.unmount()
})

test('settings category with no Host-defined field does not expose the root or additional fields', async () => {
  const f = fixture(), connectionScope = f.authority.current()
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'group-suite', connectionScope, fieldNames: ['missing'] }))
  f.answer('config:get-source', snapshot('keep')); f.answer('schema:get', { ...schema, additional: { type: 'any' } }); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).filter(item => item.type === 'field-editor').length, 0)
  assert.match(label(f.runtime.value), /Host 尚未提供此分类的可编辑字段/)
  assert.equal(button(f.runtime.value, '此项源码'), undefined)
  f.runtime.unmount()
})

test('an invalid JSON draft in a hidden settings category still blocks validation after editor unmount cleanup', async () => {
  const f = fixture(), connectionScope = f.authority.current()
  let fields = ['welcomeMessage']
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'group-suite', connectionScope, fieldNames: fields }))
  f.answer('config:get-source', snapshot('keep')); f.answer('schema:get', schema); await f.runtime.settle()
  const editor = elements(f.runtime.value).find(item => item.type === 'field-editor')
  editor.props.drafts.json.set(editor.props.path, { text: '{', value: 'keep', error: true })
  editor.props.onValidityChange(editor.props.path, true); await f.runtime.settle()
  fields = ['welcomeConversations']; f.runtime.render(); editor.props.onValidityChange(editor.props.path, false); await f.runtime.settle()
  assert.equal(button(f.runtime.value, '保存配置').props.disabled, true)
  const before = f.calls.length; button(f.runtime.value, '保存配置').props.onClick(); await f.runtime.settle()
  assert.equal(f.calls.length, before)
  fields = ['welcomeMessage']; f.runtime.render(); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).find(item => item.type === 'field-editor').props.drafts.json.get(editor.props.path).text, '{')
  button(f.runtime.value, '撤销草稿').props.onClick(); await f.runtime.settle()
  assert.equal(button(f.runtime.value, '保存配置').props.disabled, false)
  f.runtime.unmount()
})

test('scoped scalar defaults are displayed without writes and restore-default removes the override', () => {
  const f = fixture(), changes = [], drafts = { json: new Map(), unions: new Map(), originals: new Map() }
  const props = value => ({ name: 'enabled', path: '$/enabled', field: { type: 'boolean', default: true }, value, useDeclaredDefaults: true, drafts, onChange: next => changes.push(next) })
  let tree = f.editor.SchemaFieldEditor(props(undefined))
  assert.equal(elements(tree).find(item => item.type === 'switch').props.checked, true)
  assert.deepEqual(changes, [])
  assert.match(label(tree), /使用默认值/)
  assert.equal(button(tree, '恢复默认'), undefined)
  tree = f.editor.SchemaFieldEditor(props(false))
  assert.equal(elements(tree).find(item => item.type === 'switch').props.checked, false)
  assert.match(label(tree), /已自定义/)
  button(tree, '恢复默认').props.onClick()
  assert.deepEqual(changes, [undefined])
})

const settingsSnapshot = {
  source: JSON.stringify({ locale: 'zh-CN', http: { port: 8068 },
    ai: { providers: { service: { apiKey: '${MODEL_KEY}', models: ['model-a'] } }, agents: { zhin: { provider: 'service', model: 'model-a' } } },
    plugins: { 'calendar-custom': '@example/calendar' }, 'calendar-custom': { provider: 'none' }, unknown_saved: { untouched: true } }),
  format: 'json', revision: 'settings-original', configKeys: ['locale', 'http', 'ai', 'calendar-custom'],
  configPaths: { locale: ['locale'], http: ['http'], ai: ['ai'], 'calendar-custom': ['calendar-custom'] },
}
const pageForm = (f, name) => elements(f.runtime.value).filter(element => element.type === f.form.PluginConfigForm && element.props.pluginName === name)
async function settingsPage() {
  const f = fixture(), root = f.page.EditableConfigPage()
  f.runtime.mount(() => f.page.EditableConfigSession(root.props)); f.answer('config:get-source', settingsSnapshot); await f.runtime.settle()
  return f
}

test('actual settings page separates four categories and retains one owner form across model, preset and AI capability views', async () => {
  const f = await settingsPage()
  for (const title of ['通用设置', '模型', 'Agent 预设', '插件配置']) assert.ok(button(f.runtime.value, title))
  assert.equal(pageForm(f, 'ai').length, 0, 'category landing does not request every form')
  button(f.runtime.value, '模型').props.onClick(); await f.runtime.settle()
  let forms = pageForm(f, 'ai'); assert.equal(forms.length, 1); assert.deepEqual(forms[0].props.fieldNames, ['providers'])
  const formType = forms[0].type, ownerSection = elements(f.runtime.value).find(element => element.type === 'section' && element.key === 'ai')
  assert.ok(ownerSection); assert.equal(ownerSection.props.hidden, false)
  button(f.runtime.value, 'Agent 预设').props.onClick(); await f.runtime.settle()
  forms = pageForm(f, 'ai'); assert.equal(forms.length, 1); assert.equal(forms[0].type, formType); assert.deepEqual(forms[0].props.fieldNames, ['agents'])
  assert.equal(elements(f.runtime.value).filter(element => element.type === 'section' && element.key === 'ai').length, 1)
  button(f.runtime.value, '插件配置').props.onClick(); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).find(element => element.type === 'section' && element.key === 'ai').props.hidden, true)
  const capability = elements(f.runtime.value).find(element => element.type === 'button' && label(element).includes('对话与执行'))
  capability.props.onClick(); await f.runtime.settle()
  forms = pageForm(f, 'ai'); assert.equal(forms.length, 1); assert.deepEqual(forms[0].props.fieldNames, ['enabled', 'agent'])
  assert.ok(label(f.runtime.value).includes('保存会包含这份草稿中的全部修改'))
  assert.equal(f.calls.filter(call => call.input.type === 'config:replace-source').length, 0, 'navigation never writes configuration')
  f.runtime.unmount()
})

test('actual settings page searches catalog metadata and explains an unknown saved section without fabricating a form', async () => {
  const f = await settingsPage()
  button(f.runtime.value, '插件配置').props.onClick(); await f.runtime.settle()
  const search = () => elements(f.runtime.value).find(element => element.type === 'input' && element.props['aria-label'] === '搜索设置')
  search().props.onChange({ target: { value: 'calendar-custom' } }); await f.runtime.settle()
  assert.ok(elements(f.runtime.value).some(element => element.type === 'button' && label(element).includes('calendar-custom')))
  assert.ok(!elements(f.runtime.value).some(element => element.type === 'button' && label(element).includes('unknown_saved')))
  search().props.onChange({ target: { value: '${MODEL_KEY}' } }); await f.runtime.settle()
  assert.ok(label(f.runtime.value).includes('没有匹配的设置'))
  button(f.runtime.value, '清除搜索').props.onClick(); await f.runtime.settle()
  elements(f.runtime.value).find(element => element.type === 'button' && label(element).includes('unknown_saved')).props.onClick(); await f.runtime.settle()
  assert.equal(pageForm(f, 'unknown_saved').length, 0)
  assert.ok(label(f.runtime.value).includes('Host 未提供此项的可编辑路径'))
  assert.equal(f.calls.filter(call => call.input.type === 'schema:get').length, 0)
  f.runtime.unmount()
})

test('whole-root settings with an empty exclusion retain scalar, array and dictionary editors without guessing defaults', async () => {
  for (const [pluginName, definition, original] of [
    ['locale', { type: 'string', default: 'zh-CN' }, 'en'],
    ['menuKeyword', { type: 'list', inner: { type: 'string' } }, ['menu']],
    ['customDict', { type: 'dict', inner: { type: 'number' } }, { a: 1 }],
  ]) {
    const f = fixture(), connectionScope = f.authority.current()
    f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName, connectionScope, excludedFieldNames: [] }))
    f.answer('config:get-source', { source: JSON.stringify({ [pluginName]: original, sibling: 'keep' }), format: 'json', revision: 'root-r1', configKeys: [pluginName], configPaths: { [pluginName]: [pluginName] } })
    f.answer('schema:get', definition); await f.runtime.settle()
    const editors = elements(f.runtime.value).filter(item => item.type === 'field-editor')
    assert.equal(editors.length, 1); assert.equal(editors[0].props.field.type, definition.type)
    assert.deepEqual(editors[0].props.value, original)
    assert.equal(label(f.runtime.value).includes('Host 尚未提供此分类的可编辑字段'), false)
    button(f.runtime.value, '保存配置').props.onClick(); const validation = f.answer('plugin:validate-config', valid); await f.runtime.settle()
    assert.deepEqual(validation.input.data, original)
    const write = f.answer('config:replace-source', { success: true, revision: 'root-r2', restartRequired: true }); await f.runtime.settle()
    assert.deepEqual(JSON.parse(write.input.source), { [pluginName]: original, sibling: 'keep' })
    assert.equal(write.input.expectedRevision, 'root-r1')
    f.runtime.unmount()
  }
})

test('settings diagnostics follow editable fields in one closed disclosure and unset values do not claim an absent default', async () => {
  const f = fixture(), connectionScope = f.authority.current()
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'group-suite', connectionScope, fieldNames: ['welcomeMessage'] }))
  f.answer('config:get-source', snapshot('keep')); f.answer('schema:get', schema); await f.runtime.settle()
  const all = elements(f.runtime.value), editor = all.findIndex(item => item.type === 'field-editor')
  const diagnostic = all.find(item => item.type === 'details' && label(item).includes('高级与诊断'))
  assert.ok(diagnostic); assert.equal(diagnostic.props.open, undefined)
  assert.ok(all.indexOf(diagnostic) > editor)
  assert.equal(elements(diagnostic).filter(item => item.type === 'field-explanation').length, 1)
  assert.equal(elements(diagnostic).filter(item => item.type === 'config-evidence').length, 1)
  assert.equal(button(f.runtime.value, '表单'), undefined)
  assert.equal(button(f.runtime.value, '最小必填配置'), undefined)
  const tree = f.editor.SchemaFieldEditor({ name: 'unset', field: { type: 'string' }, value: undefined, useDeclaredDefaults: true, onChange: () => assert.fail('render must not write') })
  assert.ok(label(tree).includes('尚未设置；不编辑时保持省略。'))
  assert.ok(!label(tree).includes('使用默认值'))
  f.runtime.unmount()
})

test('existing plugin configuration links and group-welcome context still open the original owner and purpose fields', async () => {
  const f = fixture('plugin=group-suite&useCase=group-welcome'), root = f.page.EditableConfigPage()
  f.runtime.mount(() => f.page.EditableConfigSession(root.props)); f.answer('config:get-source', snapshot('saved')); await f.runtime.settle()
  const forms = pageForm(f, 'group-suite')
  assert.equal(forms.length, 1)
  assert.deepEqual(forms[0].props.purposeFields, ['welcomeMessage', 'welcomeConversations'])
  assert.deepEqual(forms[0].props.excludedFieldNames, [])
  assert.ok(elements(f.runtime.value).some(element => element.type === 'welcome-flow-context' && element.props.instanceKey === 'group-suite'))
  assert.equal(elements(f.runtime.value).find(element => element.type === 'section' && element.key === 'group-suite').props.hidden, false)
  f.runtime.unmount()
})

test('switching a minimum-only AI capability view to one-field models still exposes the optional providers field', async () => {
  const f = fixture(), connectionScope = f.authority.current()
  let include
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'ai', connectionScope, fieldNames: include, excludedFieldNames: include ? undefined : ['providers'] }))
  f.answer('config:get-source', { source: JSON.stringify({ ai: { providers: { primary: { model: 'saved' } } } }), format: 'json', revision: 'ai-r1', configKeys: ['ai'], configPaths: { ai: ['ai'] } })
  f.answer('schema:get', { type: 'object', object: { providers: { type: 'dict', inner: { type: 'any' } }, enabled: { type: 'boolean', default: true }, maxTurns: { type: 'number', default: 7 } } }); await f.runtime.settle()
  button(f.runtime.value, '最小必填配置').props.onClick(); await f.runtime.settle()
  include = ['providers']; f.runtime.render(); await f.runtime.settle()
  const editors = elements(f.runtime.value).filter(item => item.type === 'field-editor')
  assert.deepEqual(editors.map(item => item.props.name), ['providers'])
  assert.deepEqual(editors[0].props.value, { primary: { model: 'saved' } })
  assert.equal(button(f.runtime.value, '全部配置'), undefined)
  f.runtime.unmount()
})

test('actual root scalar restore-default saves YAML with the override absent rather than null', async () => {
  const f = fixture(), connectionScope = f.authority.current()
  f.runtime.mount(() => f.form.PluginConfigFormSession({ pluginName: 'menuKeyword', connectionScope, excludedFieldNames: [] }))
  f.answer('config:get-source', { source: 'menuKeyword: custom\nsibling:\n  keep: true\n  nullable: null\n', format: 'yaml', revision: 'menu-r1', configKeys: ['menuKeyword'], configPaths: { menuKeyword: ['menuKeyword'] } })
  f.answer('schema:get', { type: 'string', default: 'menu' }); await f.runtime.settle()
  const props = elements(f.runtime.value).find(item => item.type === 'field-editor').props
  const editor = f.editor.SchemaFieldEditor(props)
  button(editor, '恢复默认').props.onClick(); await f.runtime.settle()
  assert.equal(elements(f.runtime.value).find(item => item.type === 'field-editor').props.value, undefined)
  button(f.runtime.value, '保存配置').props.onClick()
  const validation = f.answer('plugin:validate-config', valid); await f.runtime.settle()
  assert.equal(validation.input.data, undefined)
  const write = f.answer('config:replace-source', { success: true, revision: 'menu-r2', restartRequired: true }); await f.runtime.settle()
  const saved = sourceModel.parseConfigDocument(write.input.source, 'yaml')
  assert.equal(Object.hasOwn(saved, 'menuKeyword'), false)
  assert.deepEqual(saved.sibling, { keep: true, nullable: null })
  assert.equal(write.input.expectedRevision, 'menu-r1')
  f.runtime.unmount()
})
