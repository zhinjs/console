import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import ts from 'typescript'
import { createElement } from 'react'
import * as jsxRuntime from 'react/jsx-runtime'
import { renderToStaticMarkup } from 'react-dom/server'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as model from '../console-ui/src/pages/inference/model.mjs'
import * as personal from '../console-ui/src/pages/personal-session-model.mjs'

const experiment = '实验 · 不受官方支持 · 可能违反供应商条款 · 风险由使用者自行承担。'
const authorization = '未经 OpenAI 对第三方客户端的明确授权。'
const ref = (owner, contractVersion = '1') => ({ owner, id: 'same-driver-id', contractVersion })
function producerView({ member = false } = {}) {
  const metadata = {
    experimental: { status: 'experimental', notice: experiment },
    standard: { status: 'standard', notice: authorization },
    unknown: { status: 'future-status', notice: 'Do not guess support' },
  }
  const ids = ['experimental', 'standard', 'missing', 'unknown', 'unavailable']
  const services = Object.fromEntries(ids.map(id => [id, {
    id, ownerId: 'personal', rootId: '/host', revision: 1, driver: ref(id), options: {},
    models: { native: { id: 'native', protocol: 'chat', kinds: ['language', 'decision', 'image'] } },
  }]))
  return {
    rootId: '/host', ownerId: member ? 'member' : 'personal', revision: 1,
    hostAdministrator: !member,
    services: member ? {} : services,
    accounts: member ? {} : Object.fromEntries(ids.map(id => [id, {
      id, ownerId: 'personal', rootId: '/host', revision: 1, serviceId: id,
      incarnation: `${id}-incarnation`, label: 'Same label', authentication: { method: 'oauth' },
    }])),
    profiles: member ? {} : Object.fromEntries(ids.map(id => [id, {
      id, ownerId: 'personal', rootId: '/host', revision: 1, accountId: id,
      model: 'native', label: 'Same label', parameters: {},
    }])),
    statuses: member ? {} : Object.fromEntries(ids.map(id => [id, { status: 'ready', revision: 1 }])),
    drivers: member ? [] : [
      // Put a mismatched version first so ignoring either owner or version is observable.
      { ...ref('standard', '2'), label: 'Same label', authentication: ['oauth'], modelContracts: [], support: metadata.experimental },
      ...ids.filter(id => id !== 'unavailable').map(id => ({ ...ref(id), label: 'Same label',
        authentication: ['api-key', 'oauth'], modelContracts: [{ protocol: 'chat', kinds: ['language', 'decision', 'image'] }],
        ...(metadata[id] ? { support: metadata[id] } : {}),
      })),
    ],
    deployment: member ? [{ id: 'host-profile', label: 'Shared', model: 'native', accountId: 'host-account',
      accountIncarnation: 'host-incarnation', definition: { id: 'native', protocol: 'chat', kinds: ['language'] }, support: metadata.experimental }] : [],
    purposes: { defaults: {}, decisions: {} },
  }
}
async function fixture() {
  const runtime = pageRuntime(), calls = []
  let locale = 'zh-CN'
  const dependencies = {
    react: runtime.api, 'react/jsx-runtime': jsxRuntime,
    '../../i18n': { useI18n: () => ({ locale, t: message => translate(locale, message) }) },
    '../../components/ui/badge': { Badge: props => createElement('span', { 'data-experimental-badge': true }, props.children) },
    '../../components/ui/button': { Button: 'button' }, '../components/ui/button': { Button: 'button' },
    '../../components/ui/input': { Input: 'input' },
    '../../components/ui/select': { SelectField: 'select' }, '../components/ui/select': { SelectField: 'select' },
    '../../components/ui/card': { Card: 'card' },
    '../../components/error-alert': { ErrorAlert: 'error' }, '../components/error-alert': { ErrorAlert: 'error' },
    '../../components/ui/dialog': { Dialog: props => props.open ? createElement('dialog', props) : null,
      DialogContent: 'content', DialogHeader: 'header', DialogTitle: 'title', DialogDescription: 'description' },
    '../../components/confirm-dialog': { useConfirm: () => ({ confirm: () => false, ConfirmDialog: null }) },
    './SchemaFields': { SchemaFields: 'schema' }, './ModelCapabilities': { ModelCapabilities: 'capabilities' },
    'lucide-react': { Plus: 'icon', Pencil: 'icon', Trash2: 'icon', RefreshCw: 'icon', KeyRound: 'icon', LogIn: 'icon', Unplug: 'icon' },
    './model.mjs': model, './inference/model.mjs': model, './personal-session-model.mjs': personal,
  }
  async function load(filename, extra = {}) {
    const path = process.env.CONSOLE_FIXTURE_SOURCE_ROOT && basename(filename) !== 'SupportInfo.tsx'
      ? join(process.env.CONSOLE_FIXTURE_SOURCE_ROOT, basename(filename))
      : new URL(`../console-ui/src/pages/${filename}`, import.meta.url)
    const output = ts.transpileModule(await readFile(path, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
    } }).outputText
    const module = { exports: {} }, imports = { ...dependencies, ...extra }
    new Function('require', 'module', 'exports', output)(name => { assert.ok(name in imports, name); return imports[name] }, module, module.exports)
    return module.exports
  }
  const support = await load('inference/SupportInfo.tsx')
  dependencies['./SupportInfo'] = support; dependencies['./inference/SupportInfo'] = support
  const management = view => ({ view, source: { view, connectionScope: 'connection', base: 'https://host.test' }, busy: false, pending: null,
    error: '', active: () => true, revisionEpoch: 1, setError: assert.fail,
    request: async path => { calls.push(path); return path === '/targets' ? { adapters: [], endpoints: [], scenes: [], agents: [] } : { inputSchema: {} } },
    action: async path => { calls.push(path); return { loginId: 'synthetic-login', authorizationUrl: 'https://fixture.test/login', redirectUri: 'https://fixture.test/callback' } },
  })
  return { runtime, calls, load, support, management,
    english() { locale = 'en'; runtime.render() },
    all: () => nodes(runtime.value),
    text: () => text(runtime.value),
  }
}
function text(node) {
  return Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : typeof node === 'string' ? node : ''
}
function renderOption(option) { return renderToStaticMarkup(createElement('div', null, option.label)) }
function badges(f) { return f.all().filter(node => node.props?.['data-experimental-badge']) }
function button(f, label) { return f.all().find(node => node.type === 'button' && (node.props['aria-label'] === label || text(node.props.children) === label)) }

for (const page of ['Profiles', 'Accounts'])
  test(`${page} producer-shaped rows mark only exact experimental Drivers and preserve ready/unknown/unavailable`, async () => {
    const f = await fixture(), view = producerView(), Component = (await f.load(`inference/${page}.tsx`))[page]
    f.runtime.mount(() => createElement(Component, { management: f.management(view) })); await f.runtime.settle()
    assert.equal(badges(f).length, 1)
    assert.equal(text(badges(f)[0]), '实验')
    assert.equal(f.text().includes(experiment), false, 'list rows have no persistent notice')
    assert.equal(f.text().includes('接入状态未声明'), false)
    assert.deepEqual(f.calls, [], 'rendering metadata has no login, discovery, credential, or inference effect')
    f.english(); assert.equal(text(badges(f)[0]), 'Experimental'); assert.deepEqual(f.calls, [])
    f.runtime.unmount()
  })

test('selected account detail and its OAuth flow render the required notice once even with the background detail open', async () => {
  const f = await fixture(), view = producerView(), { Accounts } = await f.load('inference/Accounts.tsx')
  f.runtime.mount(() => createElement(Accounts, { management: f.management(view) })); await f.runtime.settle()
  button(f, '编辑').props.onClick(); await f.runtime.settle()
  assert.equal(f.text().split(experiment).length - 1, 1)
  button(f, '客户端凭据').props.onClick(); await f.runtime.settle()
  assert.equal(f.text().split(experiment).length - 1, 1)
  button(f, '登录').props.onClick(); await f.runtime.settle()
  assert.equal(f.text().split(experiment).length - 1, 1)
  assert.deepEqual(f.calls, ['/login/begin'])
  f.english()
  assert.equal(f.text().split(translate('en', experiment)).length - 1, 1)
  assert.deepEqual(f.calls, ['/login/begin'], 'translation does not repeat login')
  f.runtime.unmount()
})

test('selected Profile details use exact Driver notice, not an account label or ready status', async () => {
  const f = await fixture(), view = producerView(), { Profiles } = await f.load('inference/Profiles.tsx')
  f.runtime.mount(() => createElement(Profiles, { management: f.management(view) })); await f.runtime.settle()
  button(f, '编辑 Same label').props.onClick(); await f.runtime.settle()
  assert.equal(f.text().split(experiment).length - 1, 1)
  assert.deepEqual(f.calls, ['/profile-schema'])
  f.runtime.unmount()
})

test('all purpose candidates show the same short mark without notices or metadata in the saved plan', async () => {
  const f = await fixture(), view = producerView(), m = f.management(view), saved = []
  m.savePlan = async plan => { saved.push(plan); return false }
  const { Purposes } = await f.load('inference/Purposes.tsx')
  f.runtime.mount(() => createElement(Purposes, { management: m })); await f.runtime.settle()
  const fields = f.all().filter(node => node.type === 'select' && node.props.options?.some(option => option.value === 'experimental'))
  assert.ok(fields.length >= 6)
  for (const field of fields) {
    for (const id of ['experimental', 'standard', 'missing', 'unknown', 'unavailable']) {
      const option = field.props.options.find(option => option.value === id)
      const markup = renderOption(option)
      assert.equal(markup.includes('data-experimental-badge'), id === 'experimental', id)
      assert.equal(markup.includes(experiment), false)
    }
  }
  const skills = fields.find(node => node.props['aria-label'] === '技能选择模型')
  skills.props.onValueChange('experimental'); await f.runtime.settle()
  await f.runtime.value.props.onSubmit({ preventDefault() {} })
  assert.equal(saved[0].purposes.decisions.skills.profile, 'experimental')
  assert.equal(JSON.stringify(saved).includes('support'), false)
  assert.deepEqual(f.calls, ['/targets'])
  f.runtime.unmount()
})

for (const member of [false, true])
  test(`${member ? 'member deployment' : 'personal'} Session candidates keep account identity and selection calls unchanged`, async () => {
    const f = await fixture(), view = producerView({ member }), calls = []
    const address = { rootId: '/host', platform: 'qq', endpoint: 'bot', subjectId: 'alice', conversation: { endpoint: { adapter: 'qq', id: 'adapter' }, kind: 'private', id: 'alice' } }
    const sessionKey = `personal-session:v1:${'a'.repeat(64)}`
    const { PersonalSessionModelPicker } = await f.load('PersonalSessionModelPicker.tsx', {
      '../utils/inbox-cache': { isInboxCacheScopeActive: () => true },
      '../utils/auth': { apiFetch: async (url, init) => { calls.push({ url, init }); return Response.json({ success: true, data: {
        identity: { key: sessionKey, address }, revision: 1,
        selection: init?.method === 'PUT' ? JSON.parse(init.body).selection : { kind: 'inherit' },
      } }) } },
    })
    f.runtime.mount(() => createElement(PersonalSessionModelPicker, { sessionKey, address, models: view, ownerId: view.ownerId, connectionScope: 'connection' })); await f.runtime.settle()
    const field = () => f.all().find(node => node.type === 'select')
    for (const option of field().props.options.filter(option => option.value)) {
      assert.equal(renderOption(option).includes('data-experimental-badge'), option.value === (member ? 'host-profile' : 'experimental'))
    }
    const selected = member ? 'host-profile' : 'experimental'
    field().props.onValueChange(selected); await f.runtime.settle()
    assert.equal(f.text().split(experiment).length - 1, 1)
    assert.equal(calls.length, 1, 'selection and metadata do not reread or discover')
    button(f, '保存').props.onClick(); await f.runtime.settle()
    const request = calls.find(call => call.init?.method === 'PUT'), payload = JSON.parse(request.init.body)
    assert.deepEqual(payload.selection.profile, { id: selected, rootId: '/host', accountId: member ? 'host-account' : 'experimental', accountIncarnation: member ? 'host-incarnation' : 'experimental-incarnation', kind: 'language' })
    assert.equal(new URL(request.url, 'https://fixture').searchParams.get('owner'), view.ownerId)
    assert.equal(JSON.stringify(payload).includes('support'), false)
    assert.equal(calls.length, 2)
    if (member) assert.deepEqual([view.services, view.accounts, view.profiles, view.drivers], [{}, {}, {}, []])
    f.runtime.unmount()
  })

test('support text uses the existing English dictionary and escapes third-party markup; malformed metadata adds nothing', async () => {
  const f = await fixture(), { SupportLabel, SupportNotice, supportLabel } = f.support
  f.runtime.mount(() => createElement('div'))
  f.english()
  assert.match(renderToStaticMarkup(createElement(SupportNotice, { support: { status: 'standard', notice: authorization } })), /No explicit authorization from OpenAI/)
  const markup = '<img src=x onerror="alert(1)"><script>attack()</script>'
  const rendered = renderToStaticMarkup(createElement(SupportNotice, { support: { status: 'experimental', notice: markup } }))
  assert.ok(rendered.includes('&lt;img')); assert.equal(rendered.includes('<script>'), false)
  assert.equal(rendered.includes('<img '), false)
  for (const support of [undefined, { status: 'standard' }, { status: 'future-status', notice: markup }, { status: 'experimental', notice: 42 }]) {
    assert.equal(renderToStaticMarkup(createElement(SupportNotice, { support })), '')
    if (support?.status !== 'experimental') {
      assert.equal(renderToStaticMarkup(createElement(SupportLabel, { label: 'Same label', support })).includes('data-experimental-badge'), false)
      assert.equal(supportLabel('Same label', support), 'Same label', 'ordinary options retain their string tooltip/typeahead contract')
    }
  }
  assert.deepEqual(f.calls, [])
  f.runtime.unmount()
})

for (const principal of ['operator', 'member'])
  test(`the real held Management.view ${principal} fixture renders its exact public support projection`, async () => {
    const f = await fixture()
    const view = JSON.parse(await readFile(new URL(`./fixtures/inference-support/${principal}.json`, import.meta.url), 'utf8'))
    assert.deepEqual(view.deployment.map(row => [row.id, row.support?.status]), [
      ['chosen', 'experimental'], ['other', 'standard'], ['stale', undefined], ['missing', undefined],
    ])
    if (principal === 'operator') {
      const { Profiles } = await f.load('inference/Profiles.tsx')
      f.runtime.mount(() => createElement(Profiles, { management: f.management(view) })); await f.runtime.settle()
      assert.equal(badges(f).length, 1)
      assert.deepEqual(f.calls, [])
      assert.equal(f.text().includes('Experimental fixture'), false)
    } else {
      const calls = [], sessionKey = `personal-session:v1:${'b'.repeat(64)}`
      const address = { rootId: view.rootId, platform: 'qq', endpoint: 'synthetic', subjectId: 'member', conversation: { endpoint: { adapter: 'qq', id: 'adapter' }, kind: 'private', id: 'member' } }
      const { PersonalSessionModelPicker } = await f.load('PersonalSessionModelPicker.tsx', {
        '../utils/inbox-cache': { isInboxCacheScopeActive: () => true },
        '../utils/auth': { apiFetch: async (url, init) => { calls.push({ url, init }); return Response.json({ success: true, data: { identity: { key: sessionKey, address }, revision: 1, selection: { kind: 'inherit' } } }) } },
      })
      f.runtime.mount(() => createElement(PersonalSessionModelPicker, { sessionKey, address, models: view, ownerId: view.ownerId, connectionScope: 'connection' })); await f.runtime.settle()
      const field = f.all().find(node => node.type === 'select')
      assert.deepEqual(field.props.options.map(option => option.value), ['', 'chosen', 'other', 'stale', 'missing'])
      for (const option of field.props.options) assert.equal(renderOption(option).includes('data-experimental-badge'), option.value === 'chosen')
      field.props.onValueChange('chosen'); await f.runtime.settle()
      assert.equal(f.text().split('Experimental fixture').length - 1, 1)
      assert.equal(calls.length, 1)
      assert.deepEqual([view.services, view.accounts, view.profiles, view.statuses], [{}, {}, {}, {}])
      assert.equal(JSON.stringify(view).includes('not-a-member-service'), false)
      assert.equal(new URL(calls[0].url, 'https://fixture').searchParams.get('owner'), view.ownerId)
    }
    f.runtime.unmount()
  })
