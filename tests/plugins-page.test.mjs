import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule } from './locale-fixture.mjs'
import { validatePluginList } from '../console-ui/src/pages/plugin-list-model.mjs'
import * as management from '../console-ui/src/pages/plugin-management-model.mjs'
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
function fixture({ data = [], query = '', loaded = true, loading = false, error = null, response } = {}) {
  let params = new URLSearchParams(query), read
  const refreshes = [], updates = [], effects = []
  const refresh = async () => { refreshes.push('read') }
  const module = { exports: {} }
  const mocks = {
    react: { ...require('react'), useEffect: fn => effects.push(fn), useCallback: fn => fn },
    'react-router-dom': { Link: 'a', useSearchParams: () => [params, (next, options) => { params = next; updates.push({ next, options }) }] },
    '../i18n': localeModule, '../utils/auth': { apiFetch: async path => { assert.equal(path, '/api/plugins'); return response } },
    '../hooks/use-console-read': { useConsoleRead: reader => { read = reader; return { data, loaded, loading, error, refresh } } },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => 'scope-static' }, '../utils/inbox-cache': { isInboxCacheScopeActive: scope => scope === 'scope-static' },
    './plugin-list-model.mjs': { validatePluginList }, './plugin-management-model.mjs': management, './plugins.css': {},
    '../components/ui/badge': { Badge: 'badge' }, '../components/ui/alert': { Alert: 'alert', AlertDescription: 'p' },
    '../components/ui/skeleton': { Skeleton: 'skeleton' }, '../components/ui/button': { Button: 'button' },
    '../components/ui/input': { Input: 'input' }, '../components/PageHeader': { PageHeader: 'page-header' },
    '../components/PageShell': { PageShell: 'main' },
  }
  new Function('require', 'exports', 'module', code)(name => mocks[name] ?? require(name), module.exports, module)
  const render = () => module.exports.PluginsPageSession({ connectionScope: 'scope-static' })
  return { render, read: () => read(), refreshes, updates, effects, get params() { return params } }
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
  assert.equal(elements(tree).find(item => item.type === 'page-header').props.title, '功能管理')
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
    if (name === '@zhin.js/client') return { getWebSocketManager: () => manager }
    if (name === './console-read-state.mjs') return readState
    return require(name)
  }, read.exports, read)
  const mocks = {
    react: hooks, '../i18n': localeModule, 'react-router-dom': { Link: 'a', useSearchParams: () => [new URLSearchParams(), () => {}] },
    '../utils/auth': { apiFetch: url => new Promise((resolve, reject) => calls.push({ url, resolve, reject, scope: authority.current() })) },
    '../hooks/use-console-read': read.exports, './plugin-list-model.mjs': { validatePluginList }, './plugin-management-model.mjs': management,
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() }, '../utils/inbox-cache': { isInboxCacheScopeActive: scope => authority.active(scope) },
    '../components/ui/badge': { Badge: 'badge' }, '../components/ui/alert': { Alert: 'alert', AlertDescription: 'p' },
    '../components/ui/skeleton': { Skeleton: 'skeleton' }, '../components/ui/button': { Button: 'button' }, '../components/ui/input': { Input: 'input' },
    '../components/PageHeader': { PageHeader: 'page-header' }, '../components/PageShell': { PageShell: 'main' }, './plugins.css': {},
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', 'setInterval', 'clearInterval', code)(name => mocks[name] ?? require(name), module.exports, module,
    (fn, delay) => { timers.push({ fn, delay }); return timers.length }, id => cleared.push(id))
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
