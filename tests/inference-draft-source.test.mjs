import test from 'node:test'
import { localeModule } from './locale-fixture.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import ts from 'typescript'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import * as model from '../console-ui/src/pages/inference/model.mjs'

const source = revision => ({ connectionScope: 'connection', base: 'https://host.test', view: {
  rootId: '/host', ownerId: 'host', revision, hostAdministrator: true, deployment: [],
  profiles: { profile: { id: 'profile', accountId: 'account', model: 'native', label: 'Original', parameters: {}, revision } },
  accounts: { account: { id: 'account', ownerId: 'host', serviceId: 'service', label: 'Account', authentication: { method: 'api-key' } } },
  services: { service: { id: 'service', ownerId: 'host', driver: { id: 'driver', owner: 'root', contractVersion: '1' }, options: { region: `region-${revision}` }, models: { native: { id: 'native', protocol: 'chat', kinds: ['language'] } } } },
  statuses: { account: { status: 'ready', revision: revision + 10 } },
  drivers: [{ id: 'driver', owner: 'root', contractVersion: '1', label: 'Driver', authentication: ['api-key'], modelContracts: [{ protocol: 'chat', kinds: ['language'] }] }],
} })
async function fixture(page, options = {}) {
  const runtime = pageRuntime(), saved = [], credentials = [], confirms = [], requests = [], navigation = []
  let current = source(1)
  const management = () => ({ source: current, view: current.view, owners: [], ownerId: 'host', busy: false, pending: null, error: '', revisionEpoch: current.view.revision,
    request: async (...args) => { requests.push(args); return options.request ? options.request(...args) : { inputSchema: {} } }, active: () => true, setError: assert.fail,
    savePlan: async (plan, options) => { saved.push({ plan, options }); return false },
    save: async (path, body, origin) => { credentials.push({ path, body, source: origin?.source }); return false },
  })
  const Dialog = props => props.open ? { type: 'dialog', props } : null
  const dependencies = {
    react: runtime.api,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'lucide-react': { Plus: 'icon', Pencil: 'icon', Trash2: 'icon', RefreshCw: 'icon', KeyRound: 'icon', LogIn: 'icon', Unplug: 'icon', Download: 'icon', Upload: 'icon' },
    '../../i18n': localeModule,
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/input': { Input: 'input' },
    '../../components/ui/select': { SelectField: 'select' }, '../../components/ui/card': { Card: 'card' },
    '../../components/ui/dialog': { Dialog, DialogContent: 'content', DialogHeader: 'header', DialogTitle: 'title', DialogDescription: 'description' },
    '../../components/error-alert': { ErrorAlert: 'error' },
    '../../components/confirm-dialog': { useConfirm: () => ({ ConfirmDialog: null, confirm: () => new Promise(resolve => confirms.push(resolve)) }) },
    './SupportInfo': { SupportLabel: 'support-label', SupportNotice: 'support-notice', supportLabel: label => label },
    './ModelCapabilities': { ModelCapabilities: 'capabilities' }, './SchemaFields': { SchemaFields: 'schema' }, './model.mjs': model,
    './useInferenceManagement': { useInferenceManagement: management },
    './Services': { Services: 'services' }, './Profiles': { Profiles: 'profiles' }, './Accounts': { Accounts: 'accounts' }, './Purposes': { Purposes: 'purposes' }, './PersonalSessions': { PersonalSessions: 'sessions' },
    '../../components/ui/tabs': { Tabs: 'tabs', TabsList: 'tabs-list', TabsTrigger: 'tab', TabsContent: 'tab-content' },
    '../../components/ui/alert': { Alert: 'alert', AlertDescription: 'alert-description' },
    '../../components/ui/textarea': { Textarea: 'textarea' },
    yaml: { parse: text => JSON.parse(text), stringify: JSON.stringify },
  }
  const filename = `${page}.tsx`
  const path = process.env.CONSOLE_FIXTURE_SOURCE_ROOT
    ? join(process.env.CONSOLE_FIXTURE_SOURCE_ROOT, basename(filename))
    : new URL(`../console-ui/src/pages/inference/${filename}`, import.meta.url)
  const output = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(name => { assert.ok(name in dependencies, name); return dependencies[name] }, module, module.exports)
  const Component = module.exports[page === 'Workspace' ? 'InferenceWorkspace' : page]
  runtime.mount(() => ({ type: Component, props: { management: management(), connectionScope: 'connection', onCreateAccount: () => navigation.push('accounts') } }))
  const all = () => nodes(runtime.value)
  return { runtime, saved, credentials, confirms, requests, navigation, all,
    current: () => current,
    refresh() { current = source(2); runtime.render() },
    button(label) { return all().find(node => node.type === 'button' && (node.props['aria-label'] === label || [node.props.children].flat(Infinity).filter(value => typeof value === 'string').join('') === label)) },
    dialog() { return all().find(node => node.type === 'dialog') },
    form() { return all().find(node => node.type === 'form') },
    input() { return all().find(node => node.type === 'input') },
  }
}

for (const page of ['Profiles', 'Accounts'])
  test(`${page} keeps edited input, graph source and bindings origin together through refresh and reopens from the new graph`, async () => {
    const f = await fixture(page), first = f.current()
    f.button(page === 'Profiles' ? '编辑 Original' : '编辑').props.onClick(); await f.runtime.settle()
    f.input().props.onChange({ target: { value: 'Draft label' } }); await f.runtime.settle()
    f.refresh(); await f.runtime.settle()
    assert.equal(f.input().props.value, 'Draft label')
    await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
    if (page === 'Accounts') assert.deepEqual(f.saved[0].plan.services.service.options, { region: 'region-1' })
    assert.strictEqual(f.saved[0].options?.source, first)
    f.dialog().props.onOpenChange(false); await f.runtime.settle()
    f.button(page === 'Profiles' ? '编辑 Original' : '编辑').props.onClick(); await f.runtime.settle()
    await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
    assert.strictEqual(f.saved[1].options.source, f.current())
    assert.equal(f.input().props.value, page === 'Profiles' ? 'Original' : 'Account')
    f.runtime.unmount()
  })

test('credential editing retains its observed status revision and source while a refreshed list is displayed', async () => {
  const f = await fixture('Accounts'), first = f.current()
  f.button('设置密钥').props.onClick(); await f.runtime.settle()
  f.input().props.onChange({ target: { value: 'synthetic-memory-only-key' } }); await f.runtime.settle()
  f.refresh(); await f.runtime.settle()
  await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  assert.equal(f.credentials[0].body.expectedRevision, 11)
  assert.strictEqual(f.credentials[0].source, first)
  assert.equal(f.credentials[0].body.key, 'synthetic-memory-only-key')
  assert.equal(f.input().props.value, '', 'secret is cleared at submission and never persisted')
  f.runtime.unmount()
})

test('import keeps the graph read when opened, and explicit close discards that draft before reopening', async () => {
  const f = await fixture('Workspace'), first = f.current()
  f.button('导入').props.onClick(); await f.runtime.settle()
  const textarea = () => f.all().find(node => node.type === 'textarea')
  textarea().props.onChange({ target: { value: '{"version":1}' } }); await f.runtime.settle()
  f.refresh(); await f.runtime.settle()
  await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  assert.strictEqual(f.saved[0].options.source, first)
  f.dialog().props.onOpenChange(false); await f.runtime.settle()
  f.button('导入').props.onClick(); await f.runtime.settle()
  assert.equal(textarea().props.value, '')
  textarea().props.onChange({ target: { value: '{"version":1}' } }); await f.runtime.settle()
  await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  assert.strictEqual(f.saved[1].options.source, f.current())
  f.runtime.unmount()
})

for (const page of ['Profiles', 'Accounts'])
  test(`${page} delete confirmation retains the source actually shown when deletion was requested`, async () => {
    const f = await fixture(page), first = f.current()
    // Use a graph with no attached Profiles so account deletion is an eligible operation.
    if (page === 'Accounts') { f.current().view.profiles = {}; f.runtime.render() }
    f.button(page === 'Profiles' ? '删除 Original' : '删除 Account').props.onClick()
    assert.equal(f.confirms.length, 1)
    f.refresh(); f.confirms[0](true); await f.runtime.settle()
    assert.strictEqual(f.saved[0].options.source, first)
    f.runtime.unmount()
  })

test('typing an unknown model ID preserves the capability draft explicitly selected by the user', async () => {
  const f = await fixture('Profiles')
  f.button('添加模型').props.onClick(); await f.runtime.settle()
  const account = f.all().find(node => node.type === 'select')
  account.props.onValueChange('account'); await f.runtime.settle()
  f.button('输入模型 ID').props.onClick(); await f.runtime.settle()
  const input = () => f.all().find(node => node.type === 'input' && node.props.placeholder === '填写服务的真实模型 ID')
  input().props.onChange({ target: { value: 'new' } }); await f.runtime.settle()
  let capabilities = f.all().find(node => node.type === 'capabilities')
  capabilities.props.onChange({ ...capabilities.props.value, kinds: ['language'], input: ['text'], streaming: false })
  await f.runtime.settle()
  input().props.onChange({ target: { value: 'new-model' } }); await f.runtime.settle()
  capabilities = f.all().find(node => node.type === 'capabilities')
  assert.deepEqual(capabilities.props.value, { id: 'new-model', protocol: 'chat', kinds: ['language'], input: ['text'], streaming: false })
  f.runtime.unmount()
})

test('a manual ID without a declared kind has an actionable save validation error', async () => {
  const f = await fixture('Profiles')
  f.button('添加模型').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'select').props.onValueChange('account'); await f.runtime.settle()
  f.button('输入模型 ID').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'input' && node.props.placeholder === '填写服务的真实模型 ID').props.onChange({ target: { value: 'unknown-model' } }); await f.runtime.settle()
  assert.equal(!!f.button('保存').props.disabled, false)
  await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  assert.ok(f.all().some(node => node.type === 'error' && node.props.error.includes('用途')))
  assert.equal(f.saved.length, 0)
  f.runtime.unmount()
})


for (const discovery of [true, false, undefined]) test(`model discovery is shown only for an exact capable Driver (${discovery})`, async () => {
  const f = await fixture('Profiles')
  f.current().view.drivers[0].discovery = discovery
  f.current().view.drivers.unshift({ ...f.current().view.drivers[0], owner: 'different-owner', discovery: true })
  f.button('添加模型').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'select').props.onValueChange('account'); await f.runtime.settle()
  assert.equal(!!f.button('从服务读取模型'), discovery === true)
  assert.ok(f.button('输入模型 ID'))
  f.runtime.unmount()
})


test('manual model ID typing waits for an explicit blur or Save before local schema validation', async () => {
  const f = await fixture('Profiles')
  f.button('添加模型').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'select').props.onValueChange('account'); await f.runtime.settle()
  f.button('输入模型 ID').props.onClick(); await f.runtime.settle()
  const input = () => f.all().find(node => node.type === 'input' && node.props.placeholder === '填写服务的真实模型 ID')
  input().props.onChange({ target: { value: 'new' } }); await f.runtime.settle()
  const capabilities = f.all().find(node => node.type === 'capabilities')
  capabilities.props.onChange({ ...capabilities.props.value, kinds: ['language'] }); await f.runtime.settle()
  input().props.onChange({ target: { value: 'new-model' } }); await f.runtime.settle()
  assert.equal(f.requests.length, 0)
  await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  assert.deepEqual(f.requests.map(call => call[0]), ['/profile-schema'])
  assert.equal(f.saved.length, 1)
  assert.equal(Object.values(f.saved[0].plan.profiles)[0].model, 'new-model')
  f.runtime.unmount()
})

test('without an Account the model page offers the existing account path', async () => {
  const f = await fixture('Profiles')
  f.current().view.accounts = {}; f.current().view.profiles = {}; f.runtime.render()
  assert.equal(!!f.button('添加账号').props.disabled, false)
  f.button('添加账号').props.onClick(); await f.runtime.settle()
  assert.deepEqual(f.navigation, ['accounts'])
  assert.equal(f.dialog(), undefined)
  f.runtime.unmount()
})

test('the workspace account action selects the existing account tab', async () => {
  const f = await fixture('Workspace')
  f.all().find(node => node.type === 'profiles').props.onCreateAccount(); await f.runtime.settle()
  assert.equal(f.all().find(node => node.type === 'tabs').props.value, 'accounts')
  f.runtime.unmount()
})

test('a standalone Service saves through the existing plan without accounts, discovery or credentials', async () => {
  const f = await fixture('Services'), initial = f.current()
  initial.view.services = {}; initial.view.accounts = {}; initial.view.profiles = {}; f.runtime.render()
  f.button('添加服务').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'select').props.onValueChange(model.driverKey(initial.view.drivers[0])); await f.runtime.settle()
  f.input().props.onChange({ target: { value: 'Independent service' } }); await f.runtime.settle()
  f.all().find(node => node.type === 'schema').props.onChange({ region: 'explicit-region' }); await f.runtime.settle()
  await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  const entry = Object.values(f.saved[0].plan.services)[0]
  assert.deepEqual(entry, { driver: { id: 'driver', owner: 'root', contractVersion: '1' }, options: { region: 'explicit-region' }, models: {}, label: 'Independent service' })
  assert.equal(f.saved[0].plan.accounts, undefined)
  assert.strictEqual(f.saved[0].options.source, initial)
  assert.deepEqual(f.requests, [])
  assert.deepEqual(f.credentials, [])
  f.runtime.unmount()
})

test('Service rename preserves its declared models, options and observed source through refresh', async () => {
  const f = await fixture('Services'), initial = f.current()
  f.button('编辑服务 service').props.onClick(); await f.runtime.settle()
  f.input().props.onChange({ target: { value: 'Renamed' } }); await f.runtime.settle()
  f.refresh(); await f.runtime.settle()
  await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  assert.deepEqual(f.saved[0].plan.services.service.options, { region: 'region-1' })
  assert.deepEqual(f.saved[0].plan.services.service.models, initial.view.services.service.models)
  assert.equal(f.saved[0].plan.services.service.label, 'Renamed')
  assert.strictEqual(f.saved[0].options.source, initial)
  f.runtime.unmount()
})

test('Service deletion keeps its reviewed identity and source while confirmation is pending', async () => {
  const f = await fixture('Services'), initial = f.current()
  const request = f.button('删除服务 service').props.onClick(); await f.runtime.settle()
  f.refresh(); await f.runtime.settle()
  f.confirms[0](true); await request; await f.runtime.settle()
  assert.deepEqual(f.saved[0].plan, { version: 1, remove: { services: ['service'] } })
  assert.strictEqual(f.saved[0].options.source, initial)
  f.runtime.unmount()
})


test('a late schema response cannot replace the newer manual model draft', async () => {
  const pending = []
  const f = await fixture('Profiles', { request: () => new Promise(resolve => pending.push(resolve)) })
  f.button('添加模型').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'select').props.onValueChange('account'); await f.runtime.settle()
  f.button('输入模型 ID').props.onClick(); await f.runtime.settle()
  const input = () => f.all().find(node => node.type === 'input' && node.props.placeholder === '填写服务的真实模型 ID')
  input().props.onChange({ target: { value: 'first' } }); await f.runtime.settle()
  const capability = f.all().find(node => node.type === 'capabilities')
  capability.props.onChange({ ...capability.props.value, kinds: ['language'] }); await f.runtime.settle()
  input().props.onBlur(); await f.runtime.settle()
  input().props.onChange({ target: { value: 'second' } }); await f.runtime.settle()
  input().props.onBlur(); await f.runtime.settle()
  assert.equal(pending.length, 2)
  pending[1]({ inputSchema: { type: 'object', properties: { current: { type: 'string' } } } }); await f.runtime.settle()
  pending[0]({ inputSchema: { type: 'object', properties: { old: { type: 'string' } } } }); await f.runtime.settle()
  assert.equal(input().props.value, 'second')
  assert.deepEqual(f.all().find(node => node.type === 'schema').props.schema, { type: 'object', properties: { current: { type: 'string' } } })
  f.runtime.unmount()
})

test('a new model ID does not borrow capabilities from a known catalog model', async () => {
  const f = await fixture('Profiles')
  f.button('编辑 Original').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'input' && node.props.placeholder === '填写服务的真实模型 ID').props.onChange({ target: { value: 'different-native' } }); await f.runtime.settle()
  assert.deepEqual(f.all().find(node => node.type === 'capabilities').props.value.kinds, [])
  f.runtime.unmount()
})

test('closing the editor while Save validates a model does not submit the abandoned draft', async () => {
  const pending = []
  const f = await fixture('Profiles', { request: () => new Promise(resolve => pending.push(resolve)) })
  f.button('添加模型').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'select').props.onValueChange('account'); await f.runtime.settle()
  f.button('输入模型 ID').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'input' && node.props.placeholder === '填写服务的真实模型 ID').props.onChange({ target: { value: 'manual' } }); await f.runtime.settle()
  const capability = f.all().find(node => node.type === 'capabilities')
  capability.props.onChange({ ...capability.props.value, kinds: ['language'] }); await f.runtime.settle()
  const saving = f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  f.dialog().props.onOpenChange(false); await f.runtime.settle()
  pending[0]({ inputSchema: {} }); await saving; await f.runtime.settle()
  assert.deepEqual(f.saved, [])
  f.runtime.unmount()
})

for (const settlement of ['success', 'failure']) test(`an older A schema ${settlement} cannot settle a newer A after A-B-A edits`, async () => {
  const pending = []
  const f = await fixture('Profiles', { request: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) })
  f.button('编辑 Original').props.onClick(); await f.runtime.settle()
  f.button('调整模型能力').props.onClick(); await f.runtime.settle()
  let capability = f.all().find(node => node.type === 'capabilities')
  capability.props.onChange({ ...capability.props.value, contextWindow: 123 }); await f.runtime.settle()
  capability = f.all().find(node => node.type === 'capabilities')
  const { contextWindow, ...original } = capability.props.value
  capability.props.onChange(original); await f.runtime.settle()
  assert.equal(pending.length, 3)
  pending[2].resolve({ inputSchema: { type: 'object', title: 'newest' } }); await f.runtime.settle()
  if (settlement === 'success') pending[0].resolve({ inputSchema: { type: 'object', title: 'stale' } })
  else pending[0].reject(new Error('stale schema failure'))
  await f.runtime.settle()
  assert.equal(f.all().find(node => node.type === 'schema').props.schema.title, 'newest')
  assert.equal(f.all().some(node => node.type === 'error'), false)
  f.runtime.unmount()
})

test('an older A finally cannot clear the newer A request or cause duplicate schema validation', async () => {
  const pending = []
  const f = await fixture('Profiles', { request: () => new Promise(resolve => pending.push(resolve)) })
  f.button('编辑 Original').props.onClick(); await f.runtime.settle()
  f.button('调整模型能力').props.onClick(); await f.runtime.settle()
  let capability = f.all().find(node => node.type === 'capabilities')
  capability.props.onChange({ ...capability.props.value, contextWindow: 123 }); await f.runtime.settle()
  capability = f.all().find(node => node.type === 'capabilities')
  const { contextWindow, ...original } = capability.props.value
  capability.props.onChange(original); await f.runtime.settle()
  pending[0]({ inputSchema: { type: 'object', title: 'stale' } }); await f.runtime.settle()
  const saving = f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  assert.equal(pending.length, 3)
  assert.equal(f.saved.length, 0)
  pending[2]({ inputSchema: { type: 'object', title: 'newest' } }); await saving; await f.runtime.settle()
  assert.equal(f.saved.length, 1)
  assert.equal(f.all().find(node => node.type === 'schema').props.schema.title, 'newest')
  f.runtime.unmount()
})

test('a selected model owns its schema result and cannot retain another model error', async () => {
  const unavailable = new model.InferenceRequestError('unsupported')
  const f = await fixture('Profiles', { request: async (_path, body) => {
    if (body.model.id === 'other') throw unavailable
    return { inputSchema: { type: 'object', title: 'native schema' } }
  } })
  f.current().view.services.service.models.other = { id: 'other', protocol: 'chat', kinds: ['language'] }
  f.button('添加模型').props.onClick(); await f.runtime.settle()
  f.all().find(node => node.type === 'select').props.onValueChange('account'); await f.runtime.settle()
  const selectModel = () => f.all().find(node => node.type === 'select' && node.props.options.some(option => option.value === 'native'))
  selectModel().props.onValueChange('native'); await f.runtime.settle()
  selectModel().props.onValueChange('other'); await f.runtime.settle()
  assert.ok(f.all().some(node => node.type === 'error' && node.props.error === model.inferenceError(unavailable)))
  selectModel().props.onValueChange('native'); await f.runtime.settle()
  assert.equal(f.all().some(node => node.type === 'error'), false)
  assert.equal(f.all().find(node => node.type === 'schema').props.schema.title, 'native schema')
  f.runtime.unmount()
})

test('retry performs one schema request and a successful current result is reused by Save', async () => {
  let count = 0
  const f = await fixture('Profiles', { request: async () => {
    count++
    if (count === 1) throw new model.InferenceRequestError('unsupported')
    return { inputSchema: { type: 'object', title: 'retry schema' } }
  } })
  f.button('编辑 Original').props.onClick(); await f.runtime.settle()
  f.button('重新读取参数').props.onClick(); await f.runtime.settle()
  assert.equal(count, 2)
  assert.equal(f.all().some(node => node.type === 'error'), false)
  assert.equal(f.all().find(node => node.type === 'schema').props.schema.title, 'retry schema')
  await f.form().props.onSubmit({ preventDefault() {} }); await f.runtime.settle()
  assert.equal(count, 2)
  assert.equal(f.saved.length, 1)
  f.runtime.unmount()
})
