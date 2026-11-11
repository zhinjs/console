import test from 'node:test'
import { startVisiblePolling } from '../console-ui/src/hooks/visible-polling.mjs'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule } from './locale-fixture.mjs'
import { validatePluginList } from '../console-ui/src/pages/plugin-list-model.mjs'
import * as management from '../console-ui/src/pages/plugin-management-model.mjs'
import * as toggleModel from '../console-ui/src/pages/plugin-toggle-model.mjs'
import * as readState from '../console-ui/src/hooks/console-read-state.mjs'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../console-ui/src/pages/plugins.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source + '\nexport { PluginsPageSession };', {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
const readCode = ts.transpileModule(await readFile(new URL('../console-ui/src/hooks/use-console-read.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText
const pending = { packageName: '@private/implementation-package', instanceKey: 'alias/a?#', installed: true, plugin: true,
  declared: true, version: '1.0.0', revision: 'r1', projectRevision: 'p1', status: 'pending-restart',
  dependencies: 'passed', validation: null, generation: 2, published: false, readiness: 'unknown', restartRequired: true,
  disabled: false, issues: [], verification: 'not-configured' }
const plugin = (name, extra = {}) => ({ name, description: '帮助群成员处理日常事务', status: 'active',
  features: [{ name: 'command', count: 9327, desc: 'INTERNAL_CAPABILITY_COUNT' }], ...extra })
function elements(value) {
  return value && typeof value === 'object' ? [value, ...[value.props?.children, value.props?.actions].flat(Infinity).flatMap(elements)] : []
}
const label = value => typeof value === 'string' ? value : value && typeof value === 'object'
  ? [value.props?.children].flat(Infinity).map(label).join('') : ''
function fixture({ data = [], query = '', loaded = true, loading = false, error = null, response,
  rpc = async () => ({}), wait = management.waitForEnabledManagementState, confirmAnswer = true } = {}) {
  let params = new URLSearchParams(query), read
  const refreshes = [], updates = [], effects = [], rpcs = [], toasts = [], confirms = []
  const refresh = async () => { refreshes.push('read') }
  const module = { exports: {} }
  // Minimal persistent hook slots: state survives re-renders and every setState is counted,
  // so a test can tell a real React update from a mutation nobody re-renders for.
  let slots = [], cursor = 0, stateUpdates = 0
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next; stateUpdates++ }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
  }
  const toast = variant => (description, title) => { toasts.push({ variant, title, description }) }
  const mocks = {
    react: { ...require('react'), ...hooks, useEffect: fn => effects.push(fn), useCallback: fn => fn },
    '../utils/console-rpc': { requestConsole: request => { rpcs.push(request); return rpc(request) } },
    '../components/toast': { useToast: () => ({ success: toast('success'), error: toast('error'), warning: toast('warning'), info: toast('info'), toast: () => {} }) },
    '../components/confirm-dialog': { useConfirm: () => ({ confirm: async options => { confirms.push(options); return confirmAnswer }, ConfirmDialog: null }) },
    'react-router-dom': { Link: 'a', useSearchParams: () => [params, (next, options) => { params = next; updates.push({ next, options }) }] },
    '../i18n': localeModule, '../utils/auth': { apiFetch: async path => { assert.equal(path, '/api/plugins'); return response } },
    '../hooks/use-console-read': { useConsoleRead: reader => { read = reader; return { data, loaded, loading, error, refresh } } },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => 'scope-static' }, '../utils/inbox-cache': { isInboxCacheScopeActive: scope => scope === 'scope-static' },
    './plugin-list-model.mjs': { validatePluginList }, './plugin-management-model.mjs': { ...management, waitForEnabledManagementState: wait }, './plugins.css': {}, './plugin-toggle-model.mjs': toggleModel,
    '../components/ui/badge': { Badge: 'badge' }, '../components/ui/alert': { Alert: 'alert', AlertDescription: 'p' },
    '../components/ui/skeleton': { Skeleton: 'skeleton' }, '../components/ui/button': { Button: 'button' },
    '../components/ui/input': { Input: 'input' }, '../components/PageHeader': { PageHeader: 'page-header' },
    '../components/PageShell': { PageShell: 'main' }, '../components/StatCard': { StatCard: 'stat-card', StatGrid: 'stat-grid' },
    '../hooks/visible-polling.mjs': { startVisiblePolling },
  }
  new Function('require', 'exports', 'module', code)(name => mocks[name] ?? require(name), module.exports, module)
  const render = () => { cursor = 0; return module.exports.PluginsPageSession({ connectionScope: 'scope-static' }) }
  return { render, read: () => read(), refreshes, updates, effects, rpcs, toasts, confirms,
    get params() { return params }, get stateUpdates() { return stateUpdates } }
}

test('production functionality list has one native detail link per instance and preserves the URL search contract', () => {
  const f = fixture({ data: [plugin('alpha & beta', { instanceKey: 'alias/a?#', management: pending }), plugin('other')], query: 'q=alpha+%26+beta&from=sidebar' })
  let tree = f.render()
  const links = () => elements(tree).filter(item => item.type === 'a')
  assert.equal(links().length, 1)
  assert.equal(links()[0].props.to, '/plugins/alias%2Fa%3F%23?q=alpha%20%26%20beta')
  assert.equal(links()[0].props.onKeyDown, undefined)
  assert.equal(links()[0].props.role, undefined)
  assert.ok(label(links()[0]).includes('alpha & beta'))
  assert.ok(label(links()[0]).includes('帮助群成员处理日常事务'))
  assert.equal(label(tree).includes('INTERNAL_CAPABILITY_COUNT'), false)
  assert.equal(label(tree).includes('9327'), false)
  assert.equal(label(tree).includes('@private/implementation-package'), false)
  assert.equal(elements(tree).find(item => item.type === 'page-header').props.title, '插件管理')
  elements(tree).find(item => item.type === 'input').props.onChange({ target: { value: '' } })
  assert.equal(f.params.get('q'), null)
  assert.equal(f.params.get('from'), 'sidebar')
  assert.deepEqual(f.updates[0].options, { replace: true })
  tree = f.render()
  assert.equal(links().length, 2)
  assert.equal(links()[0].props.to, '/plugins/alias%2Fa%3F%23')
})

test('actual application state stays distinct from an active plugin without evidence, and stale results remain explicit', async () => {
  const data = [plugin('unknown'), plugin('pending', { management: pending, managementError: 'inspect denied' }),
    plugin('applied', { management: { ...pending, status: 'enabled', published: true, restartRequired: false } })]
  const f = fixture({ data, error: 'refresh failed' }), tree = f.render()
  const links = elements(tree).filter(item => item.type === 'a')
  const badges = links.map(link => elements(link).find(item => item.type === 'badge'))
  assert.deepEqual(badges.map(label), ['状态未确认', '等待应用', '当前代已应用'])
  assert.deepEqual(badges.map(item => item.props.variant), ['secondary', 'secondary', 'success'])
  assert.ok(label(links[1]).includes('待核对应用'))
  assert.ok(label(links[1]).includes('状态读取失败：inspect denied'))
  assert.ok(label(tree).includes('以下是上次读取的列表'))
  const retry = elements(tree).find(item => item.type === 'button' && label(item) === '重试')
  await retry.props.onClick()
  assert.equal(f.refreshes.length, 1)
  const polling = f.effects[0], scheduled = [], cleared = []
  const previousSet = globalThis.setInterval, previousClear = globalThis.clearInterval
  try {
    globalThis.setInterval = (fn, delay) => { scheduled.push({ fn, delay }); return 17 }
    globalThis.clearInterval = id => cleared.push(id)
    const cleanup = polling()
    assert.equal(scheduled[0].delay, 10000)
    await scheduled[0].fn()
    cleanup()
    assert.deepEqual(cleared, [17])
    assert.equal(f.refreshes.length, 2)
  } finally { globalThis.setInterval = previousSet; globalThis.clearInterval = previousClear }
})

test('permission/read failures are not empty inventory, and a real empty or filtered list keeps its existing action', async () => {
  const denied = fixture({ loaded: false, error: 'no permission', response: { ok: false, status: 403 } })
  const failure = denied.render()
  assert.ok(label(failure).includes('no permission'))
  assert.equal(label(failure).includes('暂无子插件'), false)
  assert.equal(elements(failure).some(item => item.type === 'a'), false)
  await assert.rejects(denied.read(), /当前身份无权读取插件列表/)
  const empty = fixture({ response: { ok: true, json: async () => ({ success: true, data: [] }) } })
  assert.ok(label(empty.render()).includes('暂无子插件'))
  assert.deepEqual(await empty.read(), [])
  const filtered = fixture({ data: [plugin('one')], query: 'q=missing&from=sidebar' }), tree = filtered.render()
  assert.ok(label(tree).includes('没有匹配的插件'))
  elements(tree).find(item => item.type === 'button' && label(item) === '清除筛选').props.onClick()
  assert.equal(filtered.params.get('q'), null)
  assert.equal(filtered.params.get('from'), 'sidebar')
})

/** Drive the production page and existing read hook together, including the real parent-key remount boundary. */
function connectedFixture() {
  let connection = { host: 'https://host-a', credential: 'fixture-a' }, scopeCounter = 0
  const authority = createInboxCacheAuthority(() => connection, () => `scope-${++scopeCounter}`)
  let slots = [], cursor = 0, dirty = false, effects = [], mountedKey, mountedProps, tree
  const calls = [], timers = [], cleared = [], listeners = new Set()
  const pollingEnv = { setInterval: (fn, delay) => { timers.push({ fn, delay }); return timers.length }, clearInterval: id => cleared.push(id) }
  const manager = { onConnectionChange(fn) { listeners.add(fn); return () => listeners.delete(fn) } }
  const equal = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const hooks = {
    useState(initial) { const index = cursor++, owned = slots; if (!(index in owned)) owned[index] = typeof initial === 'function' ? initial() : initial
      return [owned[index], next => { owned[index] = typeof next === 'function' ? next(owned[index]) : next; if (owned === slots) dirty = true }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useCallback(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { fn, deps }; return slots[index].fn },
    useEffect(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn() }) } },
  }
  const read = { exports: {} }
  new Function('require', 'exports', 'module', readCode)(name => {
    if (name === 'react') return hooks
    if (name === '../utils/console-client') return { getConsoleTransport: () => manager }
    if (name === './console-read-state.mjs') return readState
    return require(name)
  }, read.exports, read)
  const mocks = {
    react: hooks, '../i18n': localeModule, 'react-router-dom': { Link: 'a', useSearchParams: () => [new URLSearchParams(), () => {}] },
    '../utils/auth': { apiFetch: url => new Promise((resolve, reject) => calls.push({ url, resolve, reject, scope: authority.current() })) },
    '../hooks/use-console-read': read.exports, './plugin-list-model.mjs': { validatePluginList }, './plugin-management-model.mjs': management, './plugin-toggle-model.mjs': toggleModel,
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() }, '../utils/inbox-cache': { isInboxCacheScopeActive: scope => authority.active(scope) },
    '../components/ui/badge': { Badge: 'badge' }, '../components/ui/alert': { Alert: 'alert', AlertDescription: 'p' },
    '../components/ui/skeleton': { Skeleton: 'skeleton' }, '../components/ui/button': { Button: 'button' }, '../components/ui/input': { Input: 'input' },
    '../components/PageHeader': { PageHeader: 'page-header' }, '../components/PageShell': { PageShell: 'main' }, '../components/StatCard': { StatCard: 'stat-card', StatGrid: 'stat-grid' }, './plugins.css': {},
    '../utils/console-rpc': { requestConsole: async () => { throw new Error('not used by connection tests') } },
    '../components/toast': { useToast: () => ({ success() {}, error() {}, warning() {}, info() {}, toast() {} }) },
    '../components/confirm-dialog': { useConfirm: () => ({ confirm: async () => false, ConfirmDialog: null }) },
    '../hooks/visible-polling.mjs': { startVisiblePolling: (poll, delay) => startVisiblePolling(poll, delay, pollingEnv) },
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)(name => mocks[name] ?? require(name), module.exports, module)
  const cleanup = () => { slots.forEach(slot => slot?.cleanup?.()); slots = []; effects = []; mountedKey = undefined }
  const f = { calls, timers, cleared, listeners,
    render() { let count = 0; do {
      assert.ok(++count < 30); dirty = false; cursor = 0
      const root = module.exports.default()
      if (root.type === module.exports.PluginsPageSession) {
        if (root.key !== mountedKey) { cleanup(); mountedKey = root.key }
        mountedProps = root.props
        tree = root.type(root.props)
      } else { cleanup(); tree = root }
      const pending = effects; effects = []; pending.forEach(fn => fn())
    } while (dirty); return tree },
    renderOldSession() { cursor = 0; return module.exports.PluginsPageSession(mountedProps) },
    async settle() { for (let i = 0; i < 16; i++) { await Promise.resolve(); if (dirty || effects.length) f.render() }; return tree },
    answer(index, rows, status = 200) { calls[index].resolve({ ok: status === 200, status, json: async () => ({ success: true, data: rows }) }) },
    switchHost() { connection = { ...connection, host: 'https://host-b' } },
    switchCredential() { connection = { ...connection, credential: 'fixture-b' } },
    logout() { connection = undefined },
    unmount: cleanup,
    get tree() { return tree },
  }
  f.render()
  return f
}

for (const change of ['switchHost', 'switchCredential']) test(`production functionality list immediately isolates loaded and late data on ${change} without waiting for polling`, async () => {
  const f = connectedFixture()
  assert.equal(f.calls.length, 1)
  f.answer(0, [plugin('PRIVATE_OLD_LIST')]); await f.settle()
  assert.ok(label(f.tree).includes('PRIVATE_OLD_LIST'))
  const oldRefresh = elements(f.tree).find(item => item.type === 'button' && label(item) === '刷新').props.onClick
  oldRefresh()
  assert.equal(f.calls.length, 2)
  f[change]()
  assert.equal(f.renderOldSession(), null, 'old child data is hidden before the parent remounts')
  const before = f.calls.length
  oldRefresh(); f.timers[0].fn()
  assert.equal(f.calls.length, before, 'retired actions and polling cannot issue a read with new credentials')
  f.render()
  assert.equal(label(f.tree).includes('PRIVATE_OLD_LIST'), false)
  assert.equal(f.calls.length, 3)
  f.answer(1, [plugin('LATE_OLD_LIST')])
  f.answer(2, [plugin('CURRENT_LIST')]); await f.settle()
  assert.ok(label(f.tree).includes('CURRENT_LIST'))
  assert.equal(label(f.tree).includes('OLD_LIST'), false)
  assert.ok(f.cleared.includes(1))
  assert.equal(f.timers[1].delay, 10000)
  f.logout(); f.render()
  assert.equal(label(f.tree).includes('CURRENT_LIST'), false)
  assert.ok(label(f.tree).includes('请连接 Host 后读取功能'))
  assert.equal(f.listeners.size, 0)
  f.unmount()
})

test('the pending filter includes plugins waiting for a restart, matching their warning status dot', () => {
  const restart = { ...pending, status: 'pending-restart', published: true, restartRequired: true }
  const data = [plugin('needs-restart', { management: restart }),
    plugin('applied', { management: { ...pending, status: 'enabled', published: true, restartRequired: false } })]
  const tree = fixture({ data, query: 'status=pending' }).render()
  const links = elements(tree).filter(item => item.type === 'a')
  assert.deepEqual(links.map(link => label(link).includes('needs-restart')), [true])
})

const declared = { ...pending, status: 'enabled', published: true, restartRequired: false }
const toggleButton = tree => elements(tree).find(item => item.type === 'button' && /console-plugin-toggle-btn/.test(item.props.className ?? ''))
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve() }
function deferred() { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }

test('a toggle in progress re-renders as a disabled loading button and ignores repeated clicks', async () => {
  const settled = deferred()
  const f = fixture({ data: [plugin('qq', { instanceKey: 'qq', management: { ...declared, instanceKey: 'qq', disabled: true } })],
    wait: () => settled.promise })
  let button = toggleButton(f.render())
  assert.equal(button.props.disabled, false)
  assert.equal(label(button), '启用')
  const click = button.props.onClick({})
  await flush()
  assert.ok(f.stateUpdates > 0, 'starting a toggle must schedule a React update, not only mutate a module-level set')
  button = toggleButton(f.render())
  assert.equal(button.props.disabled, true)
  assert.equal(button.props['aria-busy'], true)
  assert.equal(label(button), '启用中…')
  await button.props.onClick({})
  assert.equal(f.rpcs.filter(request => request.type === 'plugin:set-enabled').length, 1)
  assert.deepEqual(f.confirms, [], 'enabling does not ask for confirmation')
  settled.resolve({ ...declared, instanceKey: 'qq', disabled: false })
  await click
  button = toggleButton(f.render())
  assert.equal(button.props.disabled, false)
  assert.equal(f.refreshes.length, 1)
  assert.deepEqual(f.toasts.map(item => item.variant), ['success'])
})

test('a failed or unconfirmed toggle tells the user why instead of silently refreshing', async () => {
  const rejected = fixture({ data: [plugin('qq', { instanceKey: 'qq', management: { ...declared, instanceKey: 'qq', disabled: true } })],
    rpc: async () => { throw new Error('permission denied') }, wait: async () => null })
  await toggleButton(rejected.render()).props.onClick({})
  assert.equal(rejected.toasts.length, 1)
  assert.equal(rejected.toasts[0].variant, 'error')
  assert.equal(rejected.toasts[0].title, '启用 qq 的结果未确认')
  assert.match(rejected.toasts[0].description, /permission denied/)
  assert.equal(rejected.refreshes.length, 1)
  assert.equal(toggleButton(rejected.render()).props.disabled, false, 'the button is usable again after a failure')

  const thrown = fixture({ data: [plugin('qq', { instanceKey: 'qq', management: { ...declared, instanceKey: 'qq', disabled: true } })],
    wait: async () => { throw new Error('inspect failed') } })
  await toggleButton(thrown.render()).props.onClick({})
  assert.deepEqual(thrown.toasts.map(item => [item.variant, item.title]), [['error', '启用 qq 失败']])
  assert.match(thrown.toasts[0].description, /inspect failed/)
})

test('disabling asks first and explains that adapter accounts go offline; cancelling sends nothing', async () => {
  const row = plugin('qq', { instanceKey: 'qq', features: [{ name: 'adapter', count: 2 }], management: { ...declared, instanceKey: 'qq' } })
  const cancelled = fixture({ data: [row], confirmAnswer: false })
  const button = toggleButton(cancelled.render())
  assert.equal(label(button), '停用')
  await button.props.onClick({})
  assert.equal(cancelled.confirms.length, 1)
  assert.equal(cancelled.confirms[0].variant, 'destructive')
  assert.match(cancelled.confirms[0].description, /2 个聊天账号会掉线/)
  assert.deepEqual(cancelled.rpcs, [])
  assert.deepEqual(cancelled.toasts, [])

  const accepted = fixture({ data: [row], wait: async () => ({ ...declared, instanceKey: 'qq', disabled: true }) })
  await toggleButton(accepted.render()).props.onClick({})
  assert.deepEqual(accepted.rpcs.filter(request => request.type === 'plugin:set-enabled'), [{ type: 'plugin:set-enabled', instanceKey: 'qq', enabled: false }])
  assert.deepEqual(accepted.toasts.map(item => item.variant), ['success'])
})
