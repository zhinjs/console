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
