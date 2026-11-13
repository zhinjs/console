import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { localeModule } from './locale-fixture.mjs'
import { pageRuntime, nodes } from './helpers/inference-page-runtime.mjs'
import * as entry from '../console-ui/src/pages/inference/models-entry.mjs'
import { buildSettingsCatalog, resolveSettingsSelection } from '../console-ui/src/pages/settings-model.mjs'
import { ROUTE_SEARCH_HINTS } from '../console-ui/src/components/command-center-model.mjs'

test('tab ids resolve per owner and anything unknown falls back to the default tab', () => {
  assert.deepEqual(entry.inferenceTabs(true), ['profiles', 'accounts', 'services', 'purposes'])
  assert.deepEqual(entry.inferenceTabs(false), ['profiles', 'accounts', 'services', 'sessions'])
  assert.equal(entry.resolveInferenceTab('accounts', true), 'accounts')
  assert.equal(entry.resolveInferenceTab('purposes', true), 'purposes')
  assert.equal(entry.resolveInferenceTab('purposes', false), 'profiles', 'a personal owner has no purposes tab')
  assert.equal(entry.resolveInferenceTab('sessions', true), 'profiles', 'an administrator has no personal sessions tab')
  for (const value of [null, undefined, '', 'bogus', '__proto__', 'constructor', 'toString']) assert.equal(entry.resolveInferenceTab(value, true), 'profiles')
})

test('tab URLs keep unrelated parameters and the default tab uses the plain path', () => {
  assert.equal(entry.inferenceTabParams(new URLSearchParams('tab=services&from=skills'), 'profiles').toString(), 'from=skills')
  assert.equal(entry.inferenceTabParams(new URLSearchParams('from=skills'), 'accounts').toString(), 'from=skills&tab=accounts')
  assert.equal(entry.modelsHref(), '/features/ai')
  assert.equal(entry.modelsHref('profiles'), '/features/ai')
  assert.equal(entry.modelsHref('purposes'), '/features/ai?tab=purposes')
})

test('old settings model links redirect to the single entry with their tab; other settings links stay', () => {
  const redirect = query => entry.legacySettingsModelsRedirect(new URLSearchParams(query))
  assert.equal(redirect('section=models'), '/features/ai')
  assert.equal(redirect('section=ai:inference'), '/features/ai')
  assert.equal(redirect('section=models&tab=accounts'), '/features/ai?tab=accounts')
  assert.equal(redirect('section=ai%3Ainference&tab=purposes&q=x'), '/features/ai?tab=purposes')
  for (const query of ['', 'section=presets', 'section=general', 'plugin=ai', 'plugin=qq&section=models', 'q=模型']) assert.equal(redirect(query), null, query)
})

test('settings no longer embeds a second model workspace, so model management has one destination', async () => {
  const catalog = buildSettingsCatalog({ ai: {} }, ['ai'], { ai: ['ai'] })
  assert.deepEqual(catalog.map(group => group.id), ['general', 'presets', 'plugins'])
  assert.equal(catalog.flatMap(group => group.entries).some(item => item.editor || item.id === 'ai:inference'), false)
  assert.deepEqual(resolveSettingsSelection('models', catalog), { group: 'general' })
  const shell = await readFile(new URL('../console-ui/src/registerBuiltinShell.tsx', import.meta.url), 'utf8')
  assert.equal(shell.match(/element: <PersonalModelsPage \/>/g)?.length, 1, 'one registered route renders model management')
  const config = await readFile(new URL('../console-ui/src/pages/config.tsx', import.meta.url), 'utf8')
  assert.doesNotMatch(config, /InferenceWorkspace/, 'the settings page links out instead of mounting the workspace')
  const hinted = Object.entries(ROUTE_SEARCH_HINTS).filter(([, hint]) => hint.keywords.includes('API Key') || hint.keywords.includes('provider'))
  assert.deepEqual(hinted.map(([path]) => path), ['/features/ai'], 'the command palette offers one model destination')
})

// Run the real Workspace with a memory address bar that records replace vs push writes.
async function workspace({ query = '', hostAdministrator = true } = {}) {
  const runtime = pageRuntime(), url = { query, writes: [] }
  const view = { rootId: '/host', ownerId: 'host', revision: 1, hostAdministrator, deployment: [], profiles: {}, accounts: {}, services: {}, statuses: {}, drivers: [] }
  const management = () => ({ source: { view }, view, owners: [], ownerId: 'host', busy: false, pending: null, error: '',
    request: async () => ({}), active: () => true, setError: assert.fail, savePlan: async () => false, save: async () => false, load() {} })
  const dependencies = {
    react: runtime.api,
    'react/jsx-runtime': { jsx: (type, props, key) => ({ type, props, key }), jsxs: (type, props, key) => ({ type, props, key }) },
    'react-router-dom': { useSearchParams: () => [new URLSearchParams(url.query), (next, options) => {
      const value = typeof next === 'function' ? next(new URLSearchParams(url.query)) : new URLSearchParams(next)
      url.query = value.toString(); url.writes.push({ query: url.query, replace: options?.replace === true })
    }] },
    'lucide-react': new Proxy({}, { get: () => 'icon' }),
    '../../i18n': localeModule,
    '../../components/ui/button': { Button: 'button' }, '../../components/StatusState': { StatusState: 'status-state' }, '../../components/ui/select': { SelectField: 'select' },
    '../../components/ui/tabs': { Tabs: 'tabs', TabsList: 'tabs-list', TabsTrigger: 'tab', TabsContent: 'tab-content' },
    '../../components/ui/dialog': { Dialog: () => null, DialogContent: 'content', DialogHeader: 'header', DialogTitle: 'title', DialogDescription: 'description' },
    '../../components/error-alert': { ErrorAlert: 'error' }, '../../components/ui/alert': { Alert: 'alert', AlertDescription: 'alert-description' },
    '../../components/ui/textarea': { Textarea: 'textarea' }, yaml: { parse: JSON.parse, stringify: JSON.stringify },
    './useInferenceManagement': { useInferenceManagement: management }, './models-entry.mjs': entry,
    './Services': { Services: 'services' }, './Profiles': { Profiles: 'profiles' }, './Accounts': { Accounts: 'accounts' }, './Purposes': { Purposes: 'purposes' }, './PersonalSessions': { PersonalSessions: 'sessions' },
  }
  const source = await readFile(new URL('../console-ui/src/pages/inference/Workspace.tsx', import.meta.url), 'utf8')
  const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  const module = { exports: {} }
  new Function('require', 'module', 'exports', output)(name => { assert.ok(name in dependencies, name); return dependencies[name] }, module, module.exports)
  runtime.mount(() => ({ type: module.exports.InferenceWorkspace, props: { connectionScope: 'connection' } }))
  const tabs = () => nodes(runtime.value).find(node => node.type === 'tabs')
  return { runtime, url, tabs, triggers: () => nodes(runtime.value).filter(node => node.type === 'tab').map(node => node.props.value) }
}

test('a shared /features/ai?tab= link opens that tab after refresh', async () => {
  const f = await workspace({ query: 'tab=accounts' })
  try {
    assert.equal(f.tabs().props.value, 'accounts')
    assert.deepEqual(f.url.writes, [], 'reading the tab does not rewrite the address')
  } finally { f.runtime.unmount() }
})

test('choosing a tab replaces the current history entry with ?tab=, and the default tab clears it', async () => {
  const f = await workspace()
  try {
    assert.equal(f.tabs().props.value, 'profiles')
    f.tabs().props.onValueChange('services'); f.runtime.render()
    assert.deepEqual(f.url.writes, [{ query: 'tab=services', replace: true }])
    assert.equal(f.tabs().props.value, 'services')
    f.tabs().props.onValueChange('profiles'); f.runtime.render()
    assert.deepEqual(f.url.writes.at(-1), { query: '', replace: true })
    assert.equal(f.tabs().props.value, 'profiles')
    nodes(f.runtime.value).find(node => node.type === 'profiles').props.onCreateAccount(); f.runtime.render()
    assert.deepEqual(f.url.writes.at(-1), { query: 'tab=accounts', replace: true })
    assert.equal(f.tabs().props.value, 'accounts')
  } finally { f.runtime.unmount() }
})

test('an unknown tab or one this owner cannot see falls back to the default tab without error', async () => {
  for (const [query, hostAdministrator, expected] of [['tab=bogus', true, 'profiles'], ['tab=purposes', false, 'profiles'],
    ['tab=sessions', true, 'profiles'], ['tab=sessions', false, 'sessions'], ['tab=purposes', true, 'purposes']]) {
    const f = await workspace({ query, hostAdministrator })
    try {
      assert.equal(f.tabs().props.value, expected, `${query} as ${hostAdministrator ? 'administrator' : 'personal owner'}`)
      assert.ok(f.triggers().includes(expected), 'the selected tab has a trigger')
      assert.deepEqual(f.url.writes, [])
    } finally { f.runtime.unmount() }
  }
})
