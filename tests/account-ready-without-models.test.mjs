import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import { localeModule } from './locale-fixture.mjs'
import * as model from '../console-ui/src/pages/inference/model.mjs'

// #64 `account-ready-without-models`: an account with no model under it said only 「可用」, though
// 用途 cannot pick it; adding a model meant finding the 模型 tab yourself.
const view = { rootId: '/host', ownerId: 'host', revision: 1, hostAdministrator: true, deployment: [],
  profiles: { p: { id: 'p', accountId: 'used', model: 'native', label: 'Original', parameters: {}, revision: 1 } },
  accounts: {
    used: { id: 'used', ownerId: 'host', serviceId: 'service', label: 'Used', authentication: { method: 'api-key' } },
    fresh: { id: 'fresh', ownerId: 'host', serviceId: 'service', label: 'Gemini 官方', authentication: { method: 'api-key' } },
  },
  services: { service: { id: 'service', ownerId: 'host', driver: { id: 'driver', owner: 'root', contractVersion: '1' }, options: {}, models: {} } },
  statuses: { used: { status: 'ready', revision: 1 }, fresh: { status: 'ready', revision: 1 } },
  drivers: [{ id: 'driver', owner: 'root', contractVersion: '1', label: 'Driver', authentication: ['api-key'], modelContracts: [{ protocol: 'chat', kinds: ['language'] }] }],
}

async function mount(page, props) {
  const runtime = pageRuntime()
  const source = { connectionScope: 'c', base: 'https://host.test', view }
  const management = { source, view, owners: [], ownerId: 'host', busy: false, pending: null, error: '', revisionEpoch: 1, request: async () => ({}), active: () => true, setError: () => {}, savePlan: async () => false, save: async () => false, action: async () => null }
  const deps = {
    react: runtime.api,
    'react/jsx-runtime': { jsx: (type, p, key) => ({ type, props: p, key }), jsxs: (type, p, key) => ({ type, props: p, key }) },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '../../i18n': localeModule,
    '@zhin.js/console-ui': { Button: 'button', Input: 'input', SelectField: 'select', Card: 'card', Dialog: p => p.open ? { type: 'dialog', props: p } : null, DialogContent: 'content', DialogHeader: 'header', DialogTitle: 'title', DialogDescription: 'description', ErrorAlert: 'error', useConfirm: () => ({ ConfirmDialog: null, confirm: async () => false }) },
    '../../components/StatusState': { StatusState: 'status-state' },
    './SupportInfo': { SupportLabel: 'support-label', SupportNotice: 'support-notice', supportLabel: label => label },
    './ModelCapabilities': { ModelCapabilities: 'capabilities' }, './SchemaFields': { SchemaFields: 'schema' }, './model.mjs': model,
  }
  const code = ts.transpileModule(await readFile(new URL(`../console-ui/src/pages/inference/${page}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  runtime.mount(() => ({ type: module.exports[page], props: { management, ...props } }))
  await runtime.settle()
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
  return { runtime, all: () => nodes(runtime.value), text: () => text(runtime.value) }
}

test('an account without models says so and offers 「添加模型」 for that account', async () => {
  assert.equal(model.accountHasModels(view, 'used'), true)
  assert.equal(model.accountHasModels(view, 'fresh'), false)
  assert.equal(model.accountHasModels(null, 'fresh'), false)
  const opened = []
  const page = await mount('Accounts', { onAddModel: id => opened.push(id) })
  const text = page.text()
  assert.match(text, /可用 · 还没有模型/)
  assert.equal(text.match(/还没有模型/g).length, 1, 'only the account without models')
  const add = page.all().filter(node => node.type === 'button' && [node.props.children].flat(Infinity).includes('添加模型'))
  assert.equal(add.length, 1)
  add[0].props.onClick()
  assert.deepEqual(opened, ['fresh'])
})

test('「添加模型」 opens the add dialog on 模型 with that account selected', async () => {
  let handled = 0
  const page = await mount('Profiles', { onCreateAccount: () => {}, addModelFor: 'fresh', onAddModelOpened: () => { handled++ } })
  assert.equal(handled, 1)
  assert.ok(page.all().some(node => node.type === 'dialog'), 'the add dialog is open')
  const account = page.all().find(node => node.type === 'select' && node.props.onValueChange && node.props.options?.some(option => option.value === 'fresh'))
  assert.equal(account.props.value, 'fresh')
  // An account that no longer exists opens nothing.
  const gone = await mount('Profiles', { onCreateAccount: () => {}, addModelFor: 'deleted', onAddModelOpened: () => {} })
  assert.equal(gone.all().some(node => node.type === 'dialog'), false)
})

test('the workspace switches to 模型 and hands the account over', async () => {
  const source = await readFile(new URL('../console-ui/src/pages/inference/Workspace.tsx', import.meta.url), 'utf8')
  assert.match(source, /onAddModel=\{accountId => \{ setAddModelFor\(accountId\); setTab\('profiles'\) \}\}/)
  assert.match(source, /addModelFor=\{addModelFor\} onAddModelOpened=\{\(\) => setAddModelFor\(null\)\}/)
})
