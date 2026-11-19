import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { CONSOLE_BUILTIN_ROLES, resolveConsoleHttpPermission } from '@zhin.js/console-protocol'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import { localeModule } from './locale-fixture.mjs'
import * as model from '../console-ui/src/pages/inference/model.mjs'
import { UNRESTRICTED_ACCESS, createConsoleAccess } from '../console-ui/src/utils/console-access.mjs'
import { englishMessages as en } from '../console-ui/src/i18n/messages.en.mjs'

// #inference-write-gating: the 「AI 与模型」 tabs offered every write to identities the Host refuses.
const NOTE = '当前身份只能查看，修改模型配置需要 agent.configure 权限。'
const role = name => createConsoleAccess({ permissions: CONSOLE_BUILTIN_ROLES[name].permissions })

test('the protocol reads /agent/inference with agent.view and needs the gated permission for every write', () => {
  for (const path of ['/agent/inference', '/agent/inference/owners', '/agent/inference/export', '/agent/inference/targets'])
    assert.equal(resolveConsoleHttpPermission('GET', path)?.permission, 'agent.view', path)
  for (const method of ['POST', 'PUT', 'DELETE'])
    for (const path of ['/agent/inference/plan', '/agent/inference/apply', '/agent/inference/disconnect', '/agent/inference/session', '/agent/inference/probe'])
      assert.equal(resolveConsoleHttpPermission(method, path)?.permission, model.INFERENCE_CONFIGURE_PERMISSION, `${method} ${path}`)
})

test('canConfigure follows agent.configure: owner and admin may change models, operator and viewer only read', () => {
  assert.equal(model.inferenceCanConfigure(UNRESTRICTED_ACCESS), true, 'a Host that reports no permissions decides itself')
  assert.equal(model.inferenceCanConfigure(role('owner')), true)
  assert.equal(model.inferenceCanConfigure(role('admin')), true)
  for (const name of ['operator', 'viewer']) {
    assert.equal(CONSOLE_BUILTIN_ROLES[name].permissions.includes('agent.view'), true, `${name} still reads`)
    assert.equal(model.inferenceCanConfigure(role(name)), false, name)
  }
  assert.equal(model.inferenceCanConfigure(createConsoleAccess({ permissions: ['agent.*'] })), true)
  assert.equal(model.inferenceCanConfigure(createConsoleAccess({ permissions: [] })), false)
})

test('the read-only note has an English entry', () => {
  assert.equal(typeof en[NOTE], 'string')
  assert.match(en[NOTE], /agent\.configure/)
  assert.doesNotMatch(en[NOTE], /\*\*/)
})

const view = { rootId: '/host', ownerId: 'host', revision: 1, hostAdministrator: true, deployment: [],
  profiles: { p: { id: 'p', accountId: 'key', model: 'native', label: 'Chat', parameters: {}, revision: 1 } },
  accounts: {
    key: { id: 'key', ownerId: 'host', serviceId: 'service', label: 'Key', authentication: { method: 'api-key' } },
    oauth: { id: 'oauth', ownerId: 'host', serviceId: 'service', label: 'OAuth', authentication: { method: 'oauth' } },
  },
  services: { service: { id: 'service', ownerId: 'host', label: 'Service', driver: { id: 'driver', owner: 'root', contractVersion: '1' }, options: {}, models: {} } },
  statuses: { key: { status: 'ready', revision: 1 }, oauth: { status: 'authenticated', preparation: 'required', revision: 1 } },
  capabilities: { connectionTest: true },
  drivers: [{ id: 'driver', owner: 'root', contractVersion: '1', label: 'Driver', authentication: ['api-key', 'oauth'], modelContracts: [{ protocol: 'chat', kinds: ['language'] }] }],
}

async function mount(page, canConfigure) {
  const runtime = pageRuntime(), writes = []
  const source = { connectionScope: 'c', base: 'https://host.test', view }
  const write = name => async () => { writes.push(name); return false }
  const management = { source, view, owners: [], ownerId: 'host', busy: false, pending: null, canConfigure, error: '', revisionEpoch: 1,
    request: async () => ({}), active: () => true, setError: () => {}, savePlan: write('savePlan'), save: write('save'), action: write('action') }
  const deps = {
    react: runtime.api,
    'react/jsx-runtime': { jsx: (type, p, key) => ({ type, props: p, key }), jsxs: (type, p, key) => ({ type, props: p, key }) },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '../../i18n': localeModule,
    '@zhin.js/console-ui': { Button: 'button', Input: 'input', SelectField: 'select', Card: 'card', Dialog: p => p.open ? { type: 'dialog', props: p } : null, DialogContent: 'content', DialogHeader: 'header', DialogTitle: 'title', DialogDescription: 'description', ErrorAlert: 'error', useConfirm: () => ({ ConfirmDialog: null, confirm: async () => true }) },
    '../../components/StatusState': { StatusState: 'status-state' },
    './SupportInfo': { SupportLabel: 'support-label', SupportNotice: 'support-notice', supportLabel: label => label },
    './ModelCapabilities': { ModelCapabilities: 'capabilities' }, './SchemaFields': { SchemaFields: 'schema' }, './model.mjs': model,
  }
  const code = ts.transpileModule(await readFile(new URL(`../console-ui/src/pages/inference/${page}.tsx`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', code)(name => { assert.ok(name in deps, name); return deps[name] }, module, module.exports)
  runtime.mount(() => ({ type: module.exports[page], props: { management, onCreateAccount: () => {}, onAddModel: () => {} } }))
  await runtime.settle()
  return { buttons: () => nodes(runtime.value).filter(node => node.type === 'button'), writes }
}

for (const page of ['Profiles', 'Accounts', 'Services'])
  test(`${page}: every write action is shown but disabled without agent.configure, and enabled with it`, async () => {
    const locked = await mount(page, false)
    // 添加模型 / 编辑 / 删除; 新增账号 / 编辑 / 新增替代账号 / 测试连接 / 设置密钥 / 登录 / 客户端凭据 / 完成准备 / 断开 / 删除; 添加服务 / 编辑 / 删除.
    assert.ok(locked.buttons().length >= (page === 'Accounts' ? 10 : 3), 'actions stay visible')
    for (const button of locked.buttons()) assert.equal(button.props.disabled, true, JSON.stringify(button.props['aria-label'] ?? button.props.children))
    const open = await mount(page, true)
    assert.equal(open.buttons().every(button => button.props.disabled === false), true)
  })

const source = name => readFile(new URL(`../console-ui/src/pages/${name}`, import.meta.url), 'utf8')

test('the workspace gates 导入 and its save, keeps 导出 and 重新读取, and shows the page-level note', async () => {
  const text = await source('inference/Workspace.tsx')
  const button = label => text.slice(text.lastIndexOf('<Button', text.indexOf(`{i18n.t("${label}")}`)), text.indexOf(`{i18n.t("${label}")}`))
  assert.match(button('导入'), /disabled=\{!m\.canConfigure \|\|/)
  assert.doesNotMatch(button('导出'), /canConfigure/)
  assert.doesNotMatch(text.slice(text.indexOf('重新读取模型配置'), text.indexOf('重新读取模型配置') + 200), /canConfigure/)
  assert.match(text, /<Button type="submit" disabled=\{!m\.canConfigure \|\|/)
  assert.match(text, new RegExp(`m\\.view && !m\\.canConfigure[\\s\\S]{0,200}${NOTE}`))
})

test('the hook exposes canConfigure from agent.configure and refuses writes itself', async () => {
  const text = await source('inference/useInferenceManagement.ts')
  assert.match(text, /const canConfigure = inferenceCanConfigure\(useConsoleAccess\(\)\)/)
  assert.match(text, /if \(!canConfigure \|\| !active\(\) \|\| busyOperation\.current !== null \|\| pendingId\.current\) return false/)
  assert.match(text, /if \(!canConfigure \|\| !active\(\) \|\| busyOperation\.current !== null \|\| pendingId\.current\) return undefined/)
  assert.match(text, /\n {4}canConfigure,\n/)
})

test('purposes and the personal session picker disable their editors and saves without agent.configure', async () => {
  const purposes = await source('inference/Purposes.tsx')
  assert.match(purposes, /const readOnly = !m\.canConfigure\n {2}const disabled = readOnly \|\|/)
  assert.match(purposes, /<SaveButton type="submit" disabled=\{disabled\}/)
  // 默认模型, 插话判断, each decision, each Agent and each scene override.
  assert.ok((purposes.match(/<fieldset (?:key=\{\w+\} )?disabled=\{readOnly\}/g) ?? []).length >= 5)
  assert.match(purposes, /readOnly=\{readOnly\}/)
  const picker = await source('PersonalSessionModelPicker.tsx')
  assert.match(picker, /const canConfigure = inferenceCanConfigure\(useConsoleAccess\(\)\)/)
  assert.match(picker, /if \(!canConfigure \|\| !state/)
  assert.equal((picker.match(/disabled=\{!canConfigure \|\| !state \|\| busy/g) ?? []).length, 2)
})
