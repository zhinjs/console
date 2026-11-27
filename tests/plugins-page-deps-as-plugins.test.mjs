import assert from 'node:assert/strict'
import test from 'node:test'
import { pluginInventory, inventoryCounts, matchesHealthFilter, isPluginPackage } from '../console-ui/src/pages/plugin-list-model.mjs'
import { readPackageList } from '../console-ui/src/pages/ops/gateway-model.mjs'

// #1250 `plugins-page-deps-as-plugins`: the plugins page treated every package of the gateway's
// adapter / AI / market catalogs as a plugin, so ordinary dependencies the AI stack pulls in
// (`ai`, `zod`, `@ai-sdk/*`) showed up as 「已安装，待配置」 and were counted under 「需要处理」. The
// gateway now reports what each installed package is to Zhin (`kind`, from `package.json#zhin.type`):
// only `plugin` packages are plugins; `feature` and `library` packages are dependencies.
const instance = [{ name: 'rss', status: 'active', instanceKey: 'rss', packageName: '@zhin.js/rss' }]
const reported = { packageManager: 'pnpm', packages: [
  { name: '@zhin.js/rss', range: '^1', installedVersion: '1.0.0', dependencyType: 'dependencies', catalog: 'market', kind: 'plugin' },
  { name: '@zhin.js/adapter-qq', range: '^2', installedVersion: '2.0.0', dependencyType: 'dependencies', catalog: 'adapter', kind: 'plugin' },
  { name: 'ai', range: '^5', installedVersion: '5.0.0', dependencyType: 'dependencies', catalog: 'ai', kind: 'library' },
  { name: 'zod', range: '^4', installedVersion: '4.0.0', dependencyType: 'dependencies', catalog: 'ai', kind: 'library' },
  { name: '@ai-sdk/openai', range: '^2', installedVersion: '2.0.0', dependencyType: 'dependencies', catalog: 'ai', kind: 'library' },
  { name: '@zhin.js/tool', range: '^1', installedVersion: '1.0.0', dependencyType: 'dependencies', catalog: 'ai', kind: 'feature' },
  { name: 'zhin-plugin-weather', range: '^1', installedVersion: '1.0.0', dependencyType: 'dependencies', kind: 'plugin' },
] }

test('the package list keeps the kind the gateway reports, and records an unknown one as other', () => {
  const list = readPackageList(reported)
  assert.equal(list.packages.find(item => item.name === 'ai')?.kind, 'library')
  assert.equal(list.packages.find(item => item.name === '@zhin.js/rss')?.kind, 'plugin')
  // A newer gateway may report a kind this Console does not know: keep that it reported one.
  const odd = readPackageList({ packages: [{ name: 'x', installedVersion: '1.0.0', kind: 'something' }, { name: 'y', installedVersion: '1.0.0', kind: 3 }] })
  assert.equal(odd.packages.find(item => item.name === 'x')?.kind, 'other')
  assert.equal('kind' in odd.packages.find(item => item.name === 'y'), false, 'a non-string is no report')
})

// Review M2: with an unknown kind the catalog rule must not come back — an ai-catalog dependency
// of a newer kind is still no plugin.
test('an unknown kind is no plugin, even from a plugin catalog', () => {
  const list = readPackageList({ packages: [
    { name: 'future-dep', range: '^1', installedVersion: '1.0.0', dependencyType: 'dependencies', catalog: 'ai', kind: 'toolkit' },
    { name: '@zhin.js/adapter-qq', range: '^2', installedVersion: '2.0.0', dependencyType: 'dependencies', catalog: 'adapter', kind: 'plugin' },
  ] })
  assert.deepEqual(pluginInventory(instance, list).map(row => row.name), ['rss', '@zhin.js/adapter-qq'])
  assert.deepEqual(pluginInventory(null, list).map(row => row.name), ['@zhin.js/adapter-qq'])
})

// Review H1: `zhin.js` and `@zhin.js/core` declare `package.json#zhin.type: "plugin"` (facade / Feature
// carrier), so the gateway reports them as `kind: plugin`, but the instance never lists them in
// `/api/plugins`: they are the framework, not 「已安装，待配置」 plugins.
test('the framework packages are no plugins, whatever kind or catalog they carry', () => {
  const framework = [
    { name: 'zhin.js', range: '^1', installedVersion: '1.6.0', dependencyType: 'dependencies', kind: 'plugin' },
    { name: '@zhin.js/core', range: '^1', installedVersion: '1.6.0', dependencyType: 'dependencies', kind: 'plugin' },
  ]
  for (const packages of [framework, framework.map(({ kind, ...item }) => item)]) {
    const list = readPackageList({ packages: [...reported.packages, ...packages] })
    const rows = pluginInventory(instance, list)
    assert.equal(rows.some(row => ['zhin.js', '@zhin.js/core'].includes(row.name)), false)
    assert.equal(inventoryCounts(rows).pending, 2, 'adapter-qq and weather only')
    assert.equal(pluginInventory(null, list).some(row => ['zhin.js', '@zhin.js/core'].includes(row.name)), false, 'not even with the instance down')
    for (const item of packages) assert.equal(isPluginPackage(item), false, item.name)
  }
  assert.equal(isPluginPackage({ name: '@zhin.js/adapter-qq', kind: 'plugin' }), true)
  assert.equal(isPluginPackage({ name: '@zhin.js/adapter-qq', kind: 'other', catalog: 'adapter' }), false)
})

test('library and feature packages are neither listed nor counted as plugins', () => {
  const rows = pluginInventory(instance, readPackageList(reported))
  assert.deepEqual(rows.map(row => [row.kind, row.name, row.health]), [
    ['plugin', 'rss', 'healthy'],
    ['package', '@zhin.js/adapter-qq', 'undeclared'],
    ['package', 'zhin-plugin-weather', 'undeclared'],
  ])
  assert.deepEqual(inventoryCounts(rows), { all: 3, healthy: 1, pending: 2, inactive: 0 })
  assert.equal(rows.filter(row => matchesHealthFilter(row, 'pending')).some(row => ['ai', 'zod', '@ai-sdk/openai', '@zhin.js/tool'].includes(row.name)), false)
})

test('with the instance down, only plugin packages are listed as unreported', () => {
  const rows = pluginInventory(null, readPackageList(reported))
  assert.deepEqual(rows.map(row => row.name).sort(), ['@zhin.js/adapter-qq', '@zhin.js/rss', 'zhin-plugin-weather'])
  assert.ok(rows.every(row => row.health === 'unreported'))
})

test('an older gateway without kind keeps the catalog rule', () => {
  const legacy = { packages: reported.packages.map(({ kind, ...item }) => item) }
  const rows = pluginInventory(instance, readPackageList(legacy))
  assert.deepEqual(rows.map(row => row.name), ['rss', '@ai-sdk/openai', '@zhin.js/adapter-qq', '@zhin.js/tool', 'ai', 'zod'])
})

test('an older gateway without kind never lists the framework either', () => {
  const legacy = readPackageList({ packages: [
    { name: 'zhin.js', range: '^1', installedVersion: '1.0.0', dependencyType: 'dependencies' },
    { name: '@zhin.js/core', range: '^1', installedVersion: '1.0.0', dependencyType: 'dependencies' },
    { name: '@zhin.js/adapter-qq', range: '^2', installedVersion: '2.0.0', dependencyType: 'dependencies' },
  ] })
  assert.deepEqual(pluginInventory(null, legacy).map(row => row.name), ['@zhin.js/adapter-qq'], 'the plugin-like name rule skips @zhin.js/core')
})

// Review L2: opening /plugins/ai directly (the instance answers 404, the gateway lists `ai`) said
// 「已安装，待配置」 for any listed package. The detail page now uses the list's rule.
test('the detail page calls only plugin packages 「已安装，待配置」', async () => {
  const { detailPackageState } = await import('../console-ui/src/pages/plugin-detail-model.mjs')
  const { readFileSync } = await import('node:fs')
  const list = readPackageList({ packages: [...reported.packages,
    { name: 'zhin.js', range: '^1', installedVersion: '1.6.0', dependencyType: 'dependencies', kind: 'plugin' },
    { name: '@zhin.js/core', range: '^1', installedVersion: '1.6.0', dependencyType: 'dependencies', kind: 'plugin' },
    { name: 'future-dep', range: '^1', installedVersion: '1.0.0', dependencyType: 'dependencies', catalog: 'ai', kind: 'toolkit' },
  ] })
  const state = (name, detailStatus = 404, plugin = null) => detailPackageState({ plugin, entry: list.packages.find(item => item.name === name) ?? null, detailStatus })
  assert.equal(state('@zhin.js/adapter-qq'), 'undeclared')
  for (const name of ['ai', 'zod', '@ai-sdk/openai', '@zhin.js/tool', 'zhin.js', '@zhin.js/core', 'future-dep']) assert.equal(state(name), 'dependency', name)
  assert.equal(state('ai', 500), null, 'the instance did not answer')
  assert.equal(state('@zhin.js/rss', 404, { name: 'rss' }), null, 'the instance reports the plugin')
  assert.equal(state('not-listed'), null)
  const legacy = readPackageList({ packages: [{ name: 'ai', range: '^5', installedVersion: '5.0.0', dependencyType: 'dependencies', catalog: 'ai' }] })
  assert.equal(detailPackageState({ plugin: null, entry: legacy.packages[0], detailStatus: 404 }), 'undeclared', 'an older gateway keeps the catalog rule')
  const page = readFileSync(new URL('../console-ui/src/pages/plugin-detail.tsx', import.meta.url), 'utf8')
  assert.match(page, /const undeclaredPackage = packageState === 'undeclared'/u)
  assert.match(page, /packageState === 'dependency' \? i18n\.t\("依赖包，不是插件"\)/u)
  const { translate } = await import('../console-ui/src/i18n/locale.mjs')
  assert.equal(translate('en', '依赖包，不是插件'), 'Dependency, not a plugin')
})
