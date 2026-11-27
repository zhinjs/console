import assert from 'node:assert/strict'
import test from 'node:test'
import { pluginInventory, inventoryCounts, matchesHealthFilter } from '../console-ui/src/pages/plugin-list-model.mjs'
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

test('the package list keeps the kind the gateway reports, and drops values it does not know', () => {
  const list = readPackageList(reported)
  assert.equal(list.packages.find(item => item.name === 'ai')?.kind, 'library')
  assert.equal(list.packages.find(item => item.name === '@zhin.js/rss')?.kind, 'plugin')
  const odd = readPackageList({ packages: [{ name: 'x', installedVersion: '1.0.0', kind: 'something' }] })
  assert.equal('kind' in odd.packages[0], false)
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
