// Render tests for the zhinjs/zhin#1250 small fixes on 用途 and 模型 (review L1 / L3): the real page
// components run on the keyed hook runtime of `helpers/inference-page-runtime.mjs`, like
// `console-batch3.test.mjs` and `inference-support-display.test.mjs`.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import ts from 'typescript'
import { createElement } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as model from '../console-ui/src/pages/inference/model.mjs'
import * as ambientJudgeModel from '../console-ui/src/pages/inference/ambient-judge-model.mjs'
import { saveButtonMock } from './helpers/save-button-mock.mjs'

const HINT = '（在「用途」页签修改）'

function text(node) {
  return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' || typeof node === 'number' ? String(node) : ''
}

async function fixture({ modelModule = model } = {}) {
  const runtime = pageRuntime()
  const i18n = { useI18n: () => ({ locale: 'zh-CN', t: (message, values, context) => translate('zh-CN', message, values, context) }) }
  const dependencies = {
    react: runtime.api, 'react/jsx-runtime': jsxRuntime, '../../i18n': i18n,
    '@zhin.js/console-ui': { Badge: 'badge', Button: 'button', Input: 'input', SelectField: 'select', SearchableSelectField: 'select', Card: 'card', ErrorAlert: 'error',
      Dialog: props => props.open ? createElement('dialog', props) : null, DialogContent: 'content', DialogHeader: 'header', DialogTitle: 'title', DialogDescription: 'description',
      useConfirm: () => ({ confirm: async () => false, ConfirmDialog: null }), DropdownMenu: 'menu', DropdownMenuContent: 'menu-content', DropdownMenuItem: 'menu-item', DropdownMenuTrigger: 'menu-trigger' },
    '../../components/StatusState': { StatusState: 'status-state' }, './SchemaFields': { SchemaFields: 'schema' }, './ModelCapabilities': { ModelCapabilities: 'capabilities' },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    './model.mjs': modelModule, './ambient-judge-model.mjs': ambientJudgeModel, '../../components/SaveButton': saveButtonMock,
    '../../utils/plugin-rpc': { pluginRpc: async () => { throw new Error('ambient status unavailable') } },
    '../../utils/useUnsavedChangesGuard': { useUnsavedChangesGuard: () => null },
    '../../hooks/use-console-access': { useConsoleAccess: () => ({}) }, '../../utils/console-access.mjs': { hasConsolePermission: () => true },
  }
  async function load(file) {
    const output = ts.transpileModule(await readFile(new URL(`../console-ui/src/pages/inference/${file}`, import.meta.url), 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
    const module = { exports: {} }
    new Function('require', 'module', 'exports', output)(name => { assert.ok(name in dependencies, name); return dependencies[name] }, module, module.exports)
    return module.exports
  }
  dependencies['./SupportInfo'] = await load('SupportInfo.tsx')
  return { runtime, load, all: () => nodes(runtime.value), text: () => text(runtime.value) }
}

function view({ purposes, fallbacks = false } = {}) {
  const profile = (id, label) => ({ id, accountId: 'acc', model: id, label })
  return {
    rootId: '/host', ownerId: 'host', revision: 1, hostAdministrator: true, deployment: [], drivers: [], statuses: {},
    services: { svc: { id: 'svc', label: 'Service', driver: { id: 'd' }, models: { pa: { kinds: ['language'] }, pb: { kinds: ['language'] }, pc: { kinds: ['language'] } } } },
    accounts: { acc: { id: 'acc', serviceId: 'svc', label: 'Main' } },
    profiles: { pa: profile('pa', 'Alpha'), pb: profile('pb', 'Beta'), pc: profile('pc', 'Gamma') },
    purposes: purposes ?? { defaults: {}, decisions: {} },
    ...(fallbacks ? { modelAvailability: { unavailable: [], recentFallbacks: [] } } : {}),
  }
}
const management = v => ({ view: v, source: { view: v }, busy: false, pending: null, canConfigure: true, error: '', active: () => true, setError: assert.fail,
  request: async () => ({ adapters: [], endpoints: [], scenes: [], agents: [] }), savePlan: async () => true })

/** The 「谁在用」 line of one model row, by the model's label. */
function usageLine(f, label) {
  const isLine = node => node.type === 'p' && text(node).startsWith('谁在用：')
  // The smallest block holding both the label and one usage line is that model's row.
  const block = f.all().filter(node => node.type === 'div' && text(node).includes(label) && nodes(node).some(isLine))
    .sort((a, b) => text(a).length - text(b).length)[0]
  assert.ok(block, label)
  const row = nodes(block).find(isLine)
  return { text: text(row), buttons: nodes(row).filter(node => node.type === 'button').map(text) }
}

async function profilesPage({ onOpenPurpose, modelModule, purposes }) {
  const f = await fixture({ modelModule })
  const { Profiles } = await f.load('Profiles.tsx')
  f.runtime.mount(() => createElement(Profiles, { management: management(view({ purposes })), onCreateAccount: () => {}, onOpenPurpose }))
  await f.runtime.settle()
  return f
}

const purposes = {
  defaults: { chat: 'pa', summary: 'pa' },
  decisions: { skills: { profile: 'pc', mode: 'on' } },
  agents: { planner: 'pb' },
}

test('Profiles with onOpenPurpose: names are buttons and the hint is gone only when every name is one', async () => {
  const opened = []
  const f = await profilesPage({ onOpenPurpose: focus => opened.push(focus), purposes })
  const alpha = usageLine(f, 'Alpha')
  assert.deepEqual(alpha.buttons, ['默认聊天', '默认摘要'])
  assert.equal(alpha.text.includes(HINT), false, 'every name is a button: no repeated hint')
  f.all().find(node => node.type === 'button' && text(node) === '默认摘要').props.onClick()
  assert.deepEqual(opened, ['defaults'])
  f.runtime.unmount()
})

test('Profiles with onOpenPurpose keeps the hint when a name is plain text', async () => {
  // A usage 用途 cannot focus (no `usagePurposeFocus`) is plain text, so the row says where to change it.
  const modelModule = { ...model, usagePurposeFocus: key => key.startsWith('agent:') ? undefined : model.usagePurposeFocus(key) }
  const f = await profilesPage({ onOpenPurpose: () => {}, modelModule, purposes: { ...purposes, defaults: { chat: 'pb' } } })
  const beta = usageLine(f, 'Beta')
  assert.deepEqual(beta.buttons, ['默认聊天'])
  assert.match(beta.text, /Agent planner/u)
  assert.ok(beta.text.endsWith(HINT), beta.text)
  f.runtime.unmount()
})

test('Profiles with onOpenPurpose keeps the hint when no purpose uses the model in effect', async () => {
  // Only an ignored reference (ADR 0066 D7): 「还没有用途引用它」 plus a dimmed, plain-text name.
  const v = { ...purposes, decisions: { skills: { profile: 'pc', mode: 'on' } } }
  const f = await fixture()
  const { Profiles } = await f.load('Profiles.tsx')
  const shown = { ...view({ purposes: v }), purposeEffects: { 'decisions.skills': { status: 'ignored', reason: 'disabled' } } }
  f.runtime.mount(() => createElement(Profiles, { management: management(shown), onCreateAccount: () => {}, onOpenPurpose: () => {} }))
  await f.runtime.settle()
  const gamma = usageLine(f, 'Gamma')
  assert.deepEqual(gamma.buttons, [])
  assert.match(gamma.text, /还没有用途引用它/u)
  assert.ok(gamma.text.endsWith(HINT), gamma.text)
  f.runtime.unmount()
})

test('Profiles without onOpenPurpose: names are plain text and every line keeps the hint', async () => {
  const f = await profilesPage({ purposes })
  for (const label of ['Alpha', 'Beta', 'Gamma']) {
    const line = usageLine(f, label)
    assert.deepEqual(line.buttons, [], label)
    assert.ok(line.text.endsWith(HINT), line.text)
  }
  f.runtime.unmount()
})

async function purposesPage(v) {
  const f = await fixture()
  const { Purposes } = await f.load('Purposes.tsx')
  f.runtime.mount(() => createElement(Purposes, { management: management(v) }))
  await f.runtime.settle()
  return f
}

test('Purposes on a Host with fallbacks names every switching class and links the zh-CN rules', async () => {
  const f = await purposesPage(view({ fallbacks: true }))
  assert.match(f.text(), /连续超时，或网络错误和 5xx 在同模型重试后仍失败时/u)
  const link = f.all().find(node => node.type === 'a' && text(node) === '切换规则')
  assert.ok(link)
  assert.equal(link.props.href, 'https://zhin.js.org/ai/model-policy#%E5%A4%87%E7%94%A8%E6%A8%A1%E5%9E%8B-fallbacks')
  assert.equal(decodeURIComponent(new URL(link.props.href).hash), '#备用模型-fallbacks')
  assert.equal(link.props.target, '_blank')
  assert.equal(link.props.rel, 'noreferrer')
  f.runtime.unmount()
})

test('Purposes on an older Host without fallbacks shows neither the hint nor the link', async () => {
  const f = await purposesPage(view())
  assert.doesNotMatch(f.text(), /备用模型。/u)
  assert.equal(f.all().some(node => node.type === 'a' && text(node) === '切换规则'), false)
  f.runtime.unmount()
})
