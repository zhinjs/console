import assert from 'node:assert/strict'
import test from 'node:test'
import { capabilityOwner, packageFromSource } from '../console-ui/src/pages/introspection/capability-layout-model.mjs'

test('a source path names the package it lives in', () => {
  assert.equal(packageFromSource('./node_modules/.pnpm/@zhin.js+plugin-60s@1.1.20_@zhin.js+command@1.2.2_zhin.js@1.2.0/node_modules/@zhin.js/plugin-60s/commands/bing/index.js'), '@zhin.js/plugin-60s')
  assert.equal(packageFromSource('/srv/bot/node_modules/zhin-plugin-weather/lib/index.js'), 'zhin-plugin-weather')
  assert.equal(packageFromSource('C:\\bot\\node_modules\\@acme\\tools\\dist\\a.js'), '@acme/tools', 'Windows paths too')
  assert.equal(packageFromSource('./plugins/weather/index.ts'), 'weather', 'a local plugin folder')
  assert.equal(packageFromSource('./src/commands/ping.ts'), '', 'nothing to name: the caller keeps the path')
  assert.equal(packageFromSource('./node_modules/.pnpm/'), '')
  assert.equal(packageFromSource(undefined), '')
})

test('the owner prefers what the Host names, then the package of the source path', () => {
  assert.deepEqual(capabilityOwner({ owner: 'welcome', source: './node_modules/x/a.js' }), { name: 'welcome' })
  assert.deepEqual(capabilityOwner({ plugin: 'rss' }), { name: 'rss' })
  assert.deepEqual(capabilityOwner({ source: './node_modules/@zhin.js/plugin-60s/a.js' }), { name: '@zhin.js/plugin-60s', path: './node_modules/@zhin.js/plugin-60s/a.js' })
  assert.deepEqual(capabilityOwner({ source: './src/ping.ts' }), { name: './src/ping.ts' }, 'an unrecognised path is kept as is')
  assert.deepEqual(capabilityOwner({ adapter: 'icqq' }), { name: 'icqq' })
  assert.deepEqual(capabilityOwner({}), { name: '' })
})
