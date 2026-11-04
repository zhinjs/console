import test from 'node:test'
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
async function fixture(page) {
  const runtime = pageRuntime(), saved = [], credentials = [], confirms = []
  let current = source(1)
  const management = () => ({ source: current, view: current.view, owners: [], ownerId: 'host', busy: false, pending: null, error: '', revisionEpoch: current.view.revision,
    request: async () => ({ inputSchema: {} }), active: () => true, setError: assert.fail,
    savePlan: async (plan, options) => { saved.push({ plan, options }); return false },
    save: async (path, body, origin) => { credentials.push({ path, body, source: origin?.source }); return false },
  })
  const Dialog = props => props.open ? { type: 'dialog', props } : null
  const dependencies = {
    react: runtime.api,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'lucide-react': { Plus: 'icon', Pencil: 'icon', Trash2: 'icon', RefreshCw: 'icon', KeyRound: 'icon', LogIn: 'icon', Unplug: 'icon', Download: 'icon', Upload: 'icon' },
    '../../components/ui/button': { Button: 'button' }, '../../components/ui/input': { Input: 'input' },
    '../../components/ui/select': { SelectField: 'select' }, '../../components/ui/card': { Card: 'card' },
    '../../components/ui/dialog': { Dialog, DialogContent: 'content', DialogHeader: 'header', DialogTitle: 'title', DialogDescription: 'description' },
    '../../components/error-alert': { ErrorAlert: 'error' },
    '../../components/confirm-dialog': { useConfirm: () => ({ ConfirmDialog: null, confirm: () => new Promise(resolve => confirms.push(resolve)) }) },
    './ModelCapabilities': { ModelCapabilities: 'capabilities' }, './SchemaFields': { SchemaFields: 'schema' }, './model.mjs': model,
    './useInferenceManagement': { useInferenceManagement: management },
    './Profiles': { Profiles: 'profiles' }, './Accounts': { Accounts: 'accounts' }, './Purposes': { Purposes: 'purposes' }, './PersonalSessions': { PersonalSessions: 'sessions' },
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
  runtime.mount(() => ({ type: Component, props: { management: management(), connectionScope: 'connection' } }))
  const all = () => nodes(runtime.value)
  return { runtime, saved, credentials, confirms, all,
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
