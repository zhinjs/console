import test from 'node:test'
import assert from 'node:assert/strict'
import {
  marketplaceListView, isCardActivationKey, classifyUpdateCheck, updateCheckFeedback,
  readInstalledPackages, marketplacePluginStatus, pluginManageUrl, pluginConfigUrl,
} from '../console-ui/src/pages/marketplace-view-model.mjs'

test('the list shows loading first, then an error instead of the empty state, then empty or results', () => {
  assert.equal(marketplaceListView({ loading: true, error: 'boom', count: 0 }), 'loading')
  assert.equal(marketplaceListView({ loading: true, error: null, count: 3 }), 'loading')
  assert.equal(marketplaceListView({ loading: false, error: '搜索失败', count: 0 }), 'error')
  // A failed page change must not keep presenting the previous query's plugins as current results.
  assert.equal(marketplaceListView({ loading: false, error: '搜索失败', count: 4 }), 'error')
  assert.equal(marketplaceListView({ loading: false, error: null, count: 0 }), 'empty')
  assert.equal(marketplaceListView({ loading: false, error: '', count: 0 }), 'empty')
  assert.equal(marketplaceListView({ loading: false, error: null, count: 2 }), 'results')
})

test('cards activate on Enter and Space only', () => {
  for (const key of ['Enter', ' ', 'Spacebar']) assert.equal(isCardActivationKey(key), true, key)
  for (const key of ['Tab', 'Escape', 'a', 'ArrowDown', '']) assert.equal(isCardActivationKey(key), false, key)
})

test('update checks are classified as current, available or failed', () => {
  const ok = data => ({ ok: true, status: 200, body: { success: true, data } })
  assert.deepEqual(classifyUpdateCheck(ok([])), { kind: 'current', updates: [] })
  assert.deepEqual(classifyUpdateCheck(ok([{ name: 'a', current: '1.0.0', latest: '1.0.0' }, { name: 'b', current: '', latest: '2.0.0' }])), { kind: 'current', updates: [] })
  const available = classifyUpdateCheck(ok([{ name: 'a', current: '1.0.0', latest: '1.1.0' }, { name: 'b', current: '2.0.0', latest: '2.0.0' }, null]))
  assert.equal(available.kind, 'available')
  assert.deepEqual(available.updates.map(item => item.name), ['a'])

  assert.deepEqual(classifyUpdateCheck({ ok: false, status: 500, body: null }), { kind: 'failed', updates: [], reason: 'HTTP 500' })
  assert.equal(classifyUpdateCheck({ ok: false, status: 403, body: { success: false, error: '无权限' } }).reason, '无权限')
  assert.equal(classifyUpdateCheck({ ok: true, status: 200, body: { success: false, error: 'npm 超时' } }).reason, 'npm 超时')
  assert.equal(classifyUpdateCheck({ ok: true, status: 200, body: { success: false } }).reason, '数据格式错误')
  assert.equal(classifyUpdateCheck({ ok: true, status: 200, body: null }).reason, '数据格式错误')
  assert.equal(classifyUpdateCheck({ ok: true, status: 200, body: { success: true, data: 'x' } }).reason, '数据格式错误')
  assert.equal(classifyUpdateCheck({ error: new Error('network down') }).reason, 'network down')
  assert.equal(classifyUpdateCheck({ error: 'timeout' }).reason, 'timeout')
  assert.equal(classifyUpdateCheck({ error: undefined }).reason, '未知错误')
  assert.equal(classifyUpdateCheck({ error: undefined }, 'en').reason, 'Unknown error')
})

test('update check feedback distinguishes up to date from failure, in both languages', () => {
  assert.deepEqual(updateCheckFeedback({ kind: 'current', updates: [] }), { variant: 'success', description: '已是最新，没有可更新的插件' })
  assert.deepEqual(updateCheckFeedback({ kind: 'available', updates: [{}, {}] }), { variant: 'info', description: '发现 2 个可更新插件' })
  assert.deepEqual(updateCheckFeedback({ kind: 'failed', updates: [], reason: 'HTTP 500' }), { variant: 'error', description: '检查失败：HTTP 500' })
  assert.equal(updateCheckFeedback({ kind: 'current', updates: [] }, 'en').description, 'Already up to date. No plugin updates available.')
  assert.equal(updateCheckFeedback({ kind: 'available', updates: [{}] }, 'en').description, 'Found 1 plugin update(s)')
  assert.equal(updateCheckFeedback({ kind: 'failed', updates: [], reason: 'HTTP 500' }, 'en').description, 'Update check failed: HTTP 500')
})

test('the installed index maps packages to their instances and refuses unreadable lists', () => {
  for (const body of [null, {}, { success: false, data: [] }, { success: true, data: {} }]) assert.equal(readInstalledPackages(body), null)
  assert.equal(readInstalledPackages({ success: true, data: [] }).size, 0)
  const index = readInstalledPackages({ success: true, data: [
    { name: 'a-main', packageName: '@x/a', instanceKey: 'a-main', management: { installed: true, version: '1.0.0' } },
    { name: 'a-second', packageName: '@x/a', instanceKey: 'a-second' },
    { name: 'a-main', packageName: '@x/a', instanceKey: 'a-main' },
    // Loaded plugins may only carry identity inside the management evidence.
    { name: 'b-main', management: { packageName: '@x/b', instanceKey: 'b-main', installed: true, version: '2.0.0' } },
    // Declared, but the Host reports the package missing on disk.
    { name: 'c-main', packageName: '@x/c', instanceKey: 'c-main', management: { installed: false, version: null } },
    { name: 'no-package' }, null, 'junk',
  ] })
  assert.deepEqual([...index.keys()], ['@x/a', '@x/b'])
  assert.deepEqual(index.get('@x/a'), { instanceKeys: ['a-main', 'a-second'], version: '1.0.0' })
  assert.deepEqual(index.get('@x/b'), { instanceKeys: ['b-main'], version: '2.0.0' })
})

test('plugin status prefers a real update, then installed, and separates unknown from not installed', () => {
  const installed = new Map([['@x/a', { instanceKeys: ['a-main', 'a-2'], version: '1.0.0' }]])
  const updates = [{ name: '@x/a', current: '1.0.0', latest: '1.2.0' }, { name: '@x/same', current: '1.0.0', latest: '1.0.0' }]
  assert.deepEqual(marketplacePluginStatus('@x/a', installed, updates),
    { kind: 'update', current: '1.0.0', latest: '1.2.0', version: '1.0.0', instanceKey: 'a-main', instanceCount: 2 })
  assert.deepEqual(marketplacePluginStatus('@x/a', installed, []), { kind: 'installed', version: '1.0.0', instanceKey: 'a-main', instanceCount: 2 })
  // An update entry implies the package is declared even before the installed list arrives.
  assert.equal(marketplacePluginStatus('@x/a', null, updates).kind, 'update')
  assert.equal(marketplacePluginStatus('@x/a', null, updates).instanceKey, null)
  assert.equal(marketplacePluginStatus('@x/same', installed, updates).kind, 'not-installed')
  assert.equal(marketplacePluginStatus('@x/other', null, []).kind, 'unknown')
})

test('navigation targets use the routes that handle updates and settings', () => {
  assert.equal(pluginManageUrl('@x/a', 'a-main'), '/plugins/a-main')
  assert.equal(pluginManageUrl('@x/a', null), '/plugins/%40x%2Fa')
  assert.equal(pluginConfigUrl('a main/1'), '/config?plugin=a%20main%2F1')
})
