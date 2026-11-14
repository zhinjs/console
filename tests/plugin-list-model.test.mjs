import test from 'node:test'
import assert from 'node:assert/strict'
import { validatePluginList } from '../console-ui/src/pages/plugin-list-model.mjs'
test('only successful valid plugin arrays establish an empty or populated list', () => {
  assert.deepEqual(validatePluginList({ success: true, data: [] }), [])
  const plugin = { name: 'fixture', status: 'active', features: [{ name: 'commands', count: 1 }] }
  assert.deepEqual(validatePluginList({ success: true, data: [plugin] }), [plugin])
  for (const data of [{}, null, [null], [{ ...plugin, features: null }], [{ ...plugin, features: [{ name: 'commands', count: -1 }] }]]) assert.throws(() => validatePluginList({ success: true, data }))
  assert.throws(() => validatePluginList({ success: false, data: [] }))
})


test('unknown plugin states and fractional capability counts are rejected', () => {
 for (const status of ['unknown', '', undefined, null]) assert.throws(() => validatePluginList({success:true,data:[{name:'fixture',status,features:[]}]}));
 assert.throws(() => validatePluginList({success:true,data:[{name:'fixture',status:'active',features:[{name:'commands',count:1.5}]}]}));
 assert.equal(validatePluginList({success:true,data:[{name:'fixture',status:'inactive',features:[]}]}).length,1);
});

test('the 插件 table reads type and source, sorts versions numerically and groups in a fixed order', async () => {
  const { pluginType, pluginSource, sortInventory, groupInventory, needsStateLabel } = await import('../console-ui/src/pages/plugin-list-model.mjs')
  const rows = [
    { name: 'welcome', packageName: '@zhin.js/plugin-welcome', version: '1.10.0', health: 'healthy' },
    { name: 'icqq', packageName: '@zhin.js/adapter-icqq', version: '1.2.0', health: 'pending' },
    { name: 'ai', packageName: '', version: null, health: 'healthy' },
    { name: 'foo', packageName: 'zhin-plugin-foo', version: '1.9.0', health: 'inactive' },
    { name: '@zhin.js/adapter-qq', packageName: '@zhin.js/adapter-qq', catalog: 'adapter', version: '2.0.1', health: 'undeclared' },
  ]
  assert.deepEqual(rows.map(pluginType), ['feature', 'adapter', 'ai', 'feature', 'adapter'])
  assert.deepEqual(rows.map(pluginSource), ['official', 'official', 'local', 'npm', 'official'])
  assert.deepEqual(sortInventory(rows, 'version').map(row => row.version), [null, '1.2.0', '1.9.0', '1.10.0', '2.0.1'])
  assert.deepEqual(sortInventory(rows, 'name', 'desc').map(row => row.name), ['welcome', 'icqq', 'foo', 'ai', '@zhin.js/adapter-qq'])
  assert.equal(sortInventory(rows, 'status')[0].health, 'pending', 'problems first')
  assert.deepEqual(groupInventory(rows, 'type').map(group => [group.key, group.rows.length]), [['adapter', 2], ['ai', 1], ['feature', 2]])
  assert.deepEqual(groupInventory(rows, 'source').map(group => group.key), ['official', 'npm', 'local'])
  assert.deepEqual(groupInventory(rows).map(group => group.rows.length), [5])
  assert.deepEqual(rows.map(needsStateLabel), [false, true, false, true, true], 'a healthy plugin carries no state label')
})
