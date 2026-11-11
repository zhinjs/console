import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, translate } from './locale-fixture.mjs'
import * as installModel from '../console-ui/src/pages/marketplace-install-model.mjs'
import * as versionModel from '../console-ui/src/pages/marketplace-version.mjs'
import * as viewModel from '../console-ui/src/pages/marketplace-view-model.mjs'
import * as welcomeModel from '../console-ui/src/pages/welcome-use-case-model.mjs'
import * as management from '../console-ui/src/pages/plugin-management-model.mjs'
import * as clipboard from '../console-ui/src/pages/clipboard-copy.mjs'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../console-ui/src/pages/marketplace.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source + '\nexport { MarketplaceSession };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText

function elements(value) {
  if (Array.isArray(value)) return value.flatMap(elements)
  return value && typeof value === 'object' ? [value, ...[value.props?.children].flat(Infinity).flatMap(elements)] : []
}
const label = value => typeof value === 'string' || typeof value === 'number' ? String(value) : Array.isArray(value)
  ? value.map(label).join('') : value && typeof value === 'object' ? label(value.props?.children ?? '') : ''
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const json = (body, ok = true, status = 200) => ({ ok, status, json: async () => body })
const plugin = name => ({ name, displayName: name, version: '1.0.0', description: 'desc', author: 'me', isOfficial: false,
  official: false, category: 'util', keywords: [], npm: '', date: '', downloads: { weekly: 0, monthly: 0 } })

function fixture({ search = async () => json({ success: true, data: [], total: 0 }), updates = async () => json({ success: true, data: [] }),
  plugins = async () => json({ success: true, data: [] }), detail = null, requestConsole = async () => ({}) } = {}) {
  const calls = [], toasts = []
  let slots = [], cursor = 0, effects = []
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
  }
  const toast = variant => (description, title) => { toasts.push({ variant, title, description }) }
  const mocks = {
    react: { ...require('react'), ...hooks, useEffect: fn => effects.push(fn), useCallback: fn => fn, useMemo: fn => fn() },
    '../i18n': localeModule, '../i18n/locale.mjs': { translate },
    './clipboard-copy.mjs': clipboard,
    '../components/toast': { useToast: () => ({ success: toast('success'), error: toast('error'), warning: toast('warning'), info: toast('info'), toast: () => {} }) },
    './marketplace-install-model.mjs': installModel, './marketplace-version.mjs': versionModel, './marketplace-view-model.mjs': viewModel,
    './welcome-use-case-model.mjs': welcomeModel, './plugin-management-model.mjs': management,
    './PluginManagementSummary': { PluginManagementSummary: 'plugin-management-summary' },
    '../components/ui/card': { Card: 'card', CardContent: 'card-content' }, '../components/ui/badge': { Badge: 'badge' },
    '../components/ui/button': { Button: 'button' }, '../components/ui/input': { Input: 'input' },
    '../components/ui/select': { SelectField: 'select-field' }, '../components/ui/alert': { Alert: 'alert', AlertDescription: 'alert-description' },
    '../components/ui/skeleton': { Skeleton: 'skeleton' }, '../components/ui/separator': { Separator: 'hr' },
    '../components/ui/tabs': { Tabs: 'tabs', TabsList: 'tabs-list', TabsTrigger: 'tabs-trigger' },
    '../components/ui/dialog': { Dialog: 'dialog', DialogContent: 'dialog-content', DialogHeader: 'dialog-header', DialogFooter: 'dialog-footer',
      DialogTitle: 'dialog-title', DialogDescription: 'dialog-description', DialogClose: 'dialog-close' },
    '../utils/auth': { apiFetch: async path => {
      calls.push(path)
      if (path.startsWith('/pub/marketplace/search')) return search(path)
      if (path === '/api/marketplace/updates') return updates(path)
      if (path === '/api/plugins') return plugins(path)
      if (path.startsWith('/pub/marketplace/detail/')) return detail ? detail(path) : json({ success: false, error: 'not in test' }, false, 404)
      throw new Error(`unexpected ${path}`)
    } },
    '../utils/console-rpc': { requestConsole: (...args) => requestConsole(...args) },
    'react-router-dom': { Link: 'a', useSearchParams: () => [new URLSearchParams()] },
    '../utils/console-access.mjs': { hasConsolePermission: () => true },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => 'scope-a' },
    '../utils/inbox-cache': { isInboxCacheScopeActive: scope => scope === 'scope-a' },
    '../contracts/zhin-console': { CONSOLE_REST: { TASK_USE_CASES: '/api/task-use-cases' } },
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)(name => mocks[name] ?? require(name), module.exports, module)
  const render = () => { cursor = 0; effects = []; return module.exports.MarketplaceSession({ scope: 'scope-a' }) }
  /** Render, then run the plugin search effect (the one that only calls fetchPlugins). */
  const load = async () => {
    render()
    const previous = globalThis.setTimeout
    globalThis.setTimeout = () => 0 // the search debounce never fires in this harness
    try { for (const effect of effects) effect() } finally { globalThis.setTimeout = previous }
    await settle()
    return render()
  }
  return { render, load, calls, toasts }
}

// The (closed) detail dialog has its own error alert; only the page body is checked here.
const pageElements = tree => elements(tree).filter(item => item.type !== 'dialog' && !elements(elements(tree).find(node => node.type === 'dialog')).includes(item))
const destructive = tree => pageElements(tree).filter(item => item.type === 'alert' && item.props.variant === 'destructive')
const buttonLabelled = (tree, text) => elements(tree).find(item => item.type === 'button' && label(item).includes(text))

test('a failed search shows the error with a retry, and not the misleading empty state', async () => {
  let attempts = 0
  const f = fixture({ search: async () => { attempts++; return attempts === 1 ? json({}, false, 503) : json({ success: true, data: [plugin('alpha')], total: 1 }) } })
  let tree = await f.load()
  assert.equal(destructive(tree).length, 1)
  assert.ok(label(destructive(tree)[0]).includes('搜索失败'))
  assert.equal(label(tree).includes('未找到插件'), false)
  assert.equal(label(tree).includes('尝试调整搜索条件'), false)
  assert.equal(label(tree).includes('共 0 个插件'), false)
  const retry = elements(destructive(tree)[0]).find(item => item.type === 'button' && label(item).includes('重试'))
  assert.ok(retry, 'error alert offers a retry button')
  await retry.props.onClick()
  await settle()
  tree = f.render()
  assert.equal(attempts, 2)
  assert.equal(destructive(tree).length, 0)
  assert.equal(elements(tree).filter(item => item.type === 'card' && item.props.role === 'button').length, 1)
})

test('a successful search with no results keeps the empty state and no error', async () => {
  const f = fixture()
  const tree = await f.load()
  assert.equal(destructive(tree).length, 0)
  assert.ok(label(tree).includes('未找到插件'))
  assert.ok(label(tree).includes('尝试调整搜索条件或分类筛选'))
})

test('plugin cards open details from the keyboard and the search box has an accessible name', async () => {
  const f = fixture({ search: async () => json({ success: true, data: [plugin('alpha')], total: 1 }) })
  const tree = await f.load()
  const card = elements(tree).find(item => item.type === 'card' && item.props.onClick)
  assert.equal(card.props.role, 'button')
  assert.equal(card.props.tabIndex, 0)
  assert.equal(typeof card.props.onKeyDown, 'function')
  let prevented = 0
  card.props.onKeyDown({ key: 'Tab', preventDefault() { prevented++ } })
  assert.equal(f.calls.filter(path => path.startsWith('/pub/marketplace/detail/')).length, 0)
  card.props.onKeyDown({ key: 'Enter', preventDefault() { prevented++ } })
  card.props.onKeyDown({ key: ' ', preventDefault() { prevented++ } })
  await settle()
  assert.equal(prevented, 2)
  assert.deepEqual(f.calls.filter(path => path.startsWith('/pub/marketplace/detail/')), ['/pub/marketplace/detail/alpha', '/pub/marketplace/detail/alpha'])
  const input = elements(tree).find(item => item.type === 'input')
  assert.equal(input.props['aria-label'], '搜索插件名称、描述...')
})

async function checkWith(updates) {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const f = fixture({ updates: async path => { await gate; return updates(path) } })
  let tree = await f.load()
  const pending = buttonLabelled(tree, '检查更新').props.onClick()
  tree = f.render()
  const busy = elements(tree).find(item => item.type === 'button' && item.props['aria-busy'])
  assert.ok(busy, 'the check button reports that it is busy')
  assert.equal(busy.props.disabled, true)
  assert.ok(label(busy).includes('检查中…'))
  release(); await pending; await settle()
  return { f, tree: f.render() }
}

test('checking for updates always reports its result: up to date, updates found, or failure', async () => {
  let { f, tree } = await checkWith(async () => json({ success: true, data: [{ name: 'a', current: '1.0.0', latest: '1.0.0' }] }))
  assert.deepEqual(f.toasts, [{ variant: 'success', title: undefined, description: '已是最新，没有可更新的插件' }])
  assert.ok(buttonLabelled(tree, '检查更新'))
  assert.equal(buttonLabelled(tree, '检查更新').props.disabled, false);

  ({ f, tree } = await checkWith(async () => json({ success: true, data: [{ name: 'a', current: '1.0.0', latest: '1.1.0' }] })))
  assert.deepEqual(f.toasts, [{ variant: 'info', title: undefined, description: '发现 1 个可更新插件' }])
  assert.ok(label(tree).includes('a：1.0.0 → latest 1.1.0'));

  ({ f } = await checkWith(async () => json({ success: false, error: 'registry offline' }, false, 502)))
  assert.deepEqual(f.toasts, [{ variant: 'error', title: undefined, description: '检查失败：registry offline' }]);

  ({ f } = await checkWith(async () => { throw new Error('network down') }))
  assert.deepEqual(f.toasts, [{ variant: 'error', title: undefined, description: '检查失败：network down' }])
})

const links = tree => elements(tree).filter(item => item.type === 'a' && typeof item.props.to === 'string')
const cardFor = (tree, name) => elements(tree).find(item => item.type === 'card' && item.props.role === 'button' && label(item).includes(name))
const installedList = (...items) => async () => json({ success: true, data: items.map(([packageName, instanceKey, version]) => ({
  name: instanceKey, status: 'active', description: '', features: [], packageName, instanceKey,
  management: { packageName, instanceKey, installed: true, version } })) })

test('cards show installed and update status from the Host plugin list and the update check', async () => {
  let { f, tree } = await checkWithFixture({
    search: async () => json({ success: true, data: [plugin('alpha'), plugin('beta'), plugin('gamma')], total: 3 }),
    plugins: installedList(['alpha', 'alpha-main', '1.0.0'], ['gamma', 'gamma-main', '2.0.0']),
    updates: async () => json({ success: true, data: [{ name: 'gamma', current: '2.0.0', latest: '2.1.0' }, { name: 'alpha', current: '1.0.0', latest: '1.0.0' }] }),
  })
  assert.ok(f.calls.includes('/api/plugins'))
  const badges = card => elements(card).filter(item => item.type === 'badge').map(label)
  assert.ok(badges(cardFor(tree, 'alpha')).includes('已安装'))
  assert.equal(badges(cardFor(tree, 'alpha')).includes('有更新'), false)
  assert.ok(badges(cardFor(tree, 'gamma')).includes('有更新'))
  assert.equal(badges(cardFor(tree, 'gamma')).includes('已安装'), false)
  assert.deepEqual(badges(cardFor(tree, 'beta')).filter(text => text === '已安装' || text === '有更新'), [])
})

test('an unreadable installed list shows no install status instead of guessing', async () => {
  const f = fixture({
    search: async () => json({ success: true, data: [plugin('alpha')], total: 1 }),
    plugins: async () => json({ success: false, error: 'forbidden' }, false, 403),
  })
  const tree = await f.load()
  assert.equal(label(cardFor(tree, 'alpha')).includes('已安装'), false)
})

test('the update banner links each update to the plugin detail page that performs it', async () => {
  const many = Array.from({ length: 7 }, (_, i) => ({ name: `p${i}`, current: '1.0.0', latest: '1.1.0' }))
  const { f, tree } = await checkWithFixture({
    plugins: installedList(['p0', 'p0-main', '1.0.0']),
    updates: async () => json({ success: true, data: many }),
  })
  const banner = elements(tree).find(item => item.type === 'alert' && label(item).includes('个插件的本地版本与注册表 latest 不同'))
  assert.ok(banner)
  const update = links(banner).filter(link => label(link) === '去更新')
  assert.equal(update.length, 5)
  assert.equal(update[0].props.to, '/plugins/p0-main', 'known instance goes to its detail page')
  assert.equal(update[1].props.to, '/plugins/p1', 'unknown instance falls back to the package name the Host also resolves')
  assert.ok(update[0].props['aria-label'].includes('p0'))
  const overflow = links(banner).find(link => link.props.to === '/plugins')
  assert.ok(overflow && label(overflow).includes('另有 2 个'))
  const details = elements(banner).find(item => item.type === 'button' && label(item) === '市场详情')
  await details.props.onClick(); await settle()
  assert.ok(f.calls.includes('/pub/marketplace/detail/p0'))
})

test('a confirmed install offers a direct link to the plugin settings', async () => {
  const fixtureState = JSON.parse(await readFile(new URL('./fixtures/welcome-flow-provider.json', import.meta.url), 'utf8')).initialState
  const { packageName, instanceKey, version, projectRevision } = fixtureState
  const rpc = []
  const f = fixture({
    search: async () => json({ success: true, data: [plugin(packageName)], total: 1 }),
    detail: async () => json({ success: true, data: { name: packageName, version, description: '', license: '', author: '', homepage: '', repository: '',
      keywords: [], engines: {}, peerDependencies: {}, downloads: { weekly: 0, monthly: 0 }, readme: '', versions: [version], lastPublish: '' } }),
    requestConsole: async request => {
      rpc.push(request.type)
      if (request.type === 'plugin:plan-install') return { packageName, instanceKey, projectRevision, alreadyDeclared: false, alreadyInstalled: false,
        restartRequired: false, changes: { packageManifest: 'added', config: 'added' }, warnings: [] }
      if (request.type === 'plugin:inspect') return fixtureState
      return {}
    },
  })
  let tree = await f.load()
  cardFor(tree, packageName).props.onClick(); await settle()
  tree = f.render()
  assert.equal(links(tree).some(link => label(link).includes('去配置')), false, 'not offered before anything is installed')
  await elements(tree).find(item => item.type === 'button' && label(item) === '安装').props.onClick(); await settle()
  tree = f.render()
  await buttonLabelled(tree, '确认安装').props.onClick(); await settle()
  tree = f.render()
  assert.deepEqual(rpc, ['plugin:plan-install', 'plugin:install', 'plugin:inspect'])
  const configure = links(tree).filter(link => label(link).includes('去配置'))
  assert.equal(configure.length, 1)
  assert.equal(configure[0].props.to, `/features/global/${encodeURIComponent(instanceKey)}`)
  const summary = elements(tree).find(item => item.type === 'plugin-management-summary')
  assert.equal(summary.props.showNavigation, false, 'the summary does not repeat the same links')
  assert.equal(f.calls.filter(path => path === '/api/plugins').length, 2, 'the installed list is re-read after the install')
})

test('details of an already installed package link to its settings and its update', async () => {
  const f = fixture({
    search: async () => json({ success: true, data: [plugin('alpha')], total: 1 }),
    plugins: installedList(['alpha', 'alpha-main', '1.0.0']),
    detail: async () => json({ success: true, data: { name: 'alpha', version: '1.1.0', description: '', license: '', author: '', homepage: '', repository: '',
      keywords: [], engines: {}, peerDependencies: {}, downloads: { weekly: 0, monthly: 0 }, readme: '', versions: ['1.1.0'], lastPublish: '' } }),
  })
  let tree = await f.load()
  cardFor(tree, 'alpha').props.onClick(); await settle()
  tree = f.render()
  assert.ok(label(tree).includes('此 Host 已安装 1.0.0。'))
  assert.equal(links(tree).find(link => label(link).includes('去配置')).props.to, '/features/global/alpha-main')
  assert.equal(links(tree).find(link => label(link) === '插件详情').props.to, '/plugins/alpha-main')
})

async function checkWithFixture(options) {
  const f = fixture(options)
  let tree = await f.load()
  await buttonLabelled(tree, '检查更新').props.onClick(); await settle()
  return { f, tree: f.render() }
}
