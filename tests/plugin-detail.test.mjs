import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePluginDetail, pluginDiagnosticSummary, pluginDetailView } from '../console-ui/src/pages/plugin-detail-model.mjs';
const plugin=JSON.parse(readFileSync(new URL('./fixtures/plugin-detail.json',import.meta.url))).data;
test('formal detail preserves commands and middleware without legacy contexts',()=>{
 assert.equal(plugin.contexts,undefined);validatePluginDetail(plugin);
 assert.deepEqual(plugin.features.map(f=>[f.name,f.count,f.items[0].name]),[['command',1,'repeater-status'],['middleware',1,'repeater']]);
});
test('missing or invalid capabilities are errors rather than silent empty groups',()=>{
 assert.throws(()=>validatePluginDetail({...plugin,features:undefined}));
 assert.throws(()=>validatePluginDetail({...plugin,features:[{...plugin.features[0],count:0}]}));
});

test('diagnostic summary never hides missing environment variables behind schema validity', () => {
 assert.equal(pluginDiagnosticSummary({validation:{valid:true,errors:[],missingEnv:['BOT_TOKEN']}}).status,'missing-env');
 const invalid=pluginDiagnosticSummary({validation:{valid:false,errors:[{path:'$.port',message:'需为数字'}],missingEnv:[]},plan:{warnings:['需要重启']}});
 assert.equal(invalid.status,'invalid');assert.deepEqual(invalid.errors,['$.port 需为数字']);assert.deepEqual(invalid.warnings,['需要重启']);
 assert.equal(pluginDiagnosticSummary({}).status,'unknown');
 assert.equal(pluginDiagnosticSummary({validation:{valid:true,errors:[],missingEnv:[]}}).status,'valid');
});


test('unknown status and malformed management eligibility cannot establish plugin state or actions', () => {
 for (const status of [undefined, null, 'unknown', true]) assert.throws(() => validatePluginDetail({...plugin,status}), /插件详情响应格式/);
 for (const manageable of [undefined, null, 'true', 1]) assert.throws(() => validatePluginDetail({...plugin,manageable}), /插件详情响应格式/);
 assert.throws(() => validatePluginDetail({...plugin,readOnly:'false'}), /插件详情响应格式/);
 validatePluginDetail({...plugin,status:'inactive',manageable:true,readOnly:false});
});

test('plugin detail keeps shown content while refreshing and turns refresh errors into an inline notice', () => {
  const plugin = { name: 'qq' }
  assert.deepEqual(pluginDetailView({ loading: true, plugin: null, error: null }), { view: 'skeleton', staleError: null })
  assert.deepEqual(pluginDetailView({ loading: false, plugin: null, error: 'HTTP 500' }), { view: 'error', staleError: null })
  assert.deepEqual(pluginDetailView({ loading: false, plugin: null, error: null }), { view: 'error', staleError: null })
  assert.deepEqual(pluginDetailView({ loading: true, plugin, error: null }), { view: 'content', staleError: null })
  assert.deepEqual(pluginDetailView({ loading: false, plugin, error: 'HTTP 500' }), { view: 'content', staleError: 'HTTP 500' })
  assert.deepEqual(pluginDetailView({ loading: true, plugin, error: 'HTTP 500' }), { view: 'content', staleError: 'HTTP 500' })
})

test('the detail page manages packages only through gateway transactions and keeps the switches in the object tree', async () => {
  const source = readFileSync(new URL('../console-ui/src/pages/plugin-detail.tsx', import.meta.url), 'utf8')
  for (const removed of ['plugin:install', 'plugin:update', 'plugin:uninstall', 'plugin:plan-update', 'plugin:plan-uninstall', 'plugin:set-enabled']) {
    assert.equal(source.includes(`'${removed}'`), false, removed)
  }
  assert.match(source, /packageAction\.prepare\('update'/)
  assert.match(source, /packageAction\.prepare\('uninstall'/)
  assert.match(source, /FEATURE_RPC\.MATRIX/)
  assert.match(source, /pluginScopeSummary\(/)
  assert.match(source, /IAM_RPC\.ROLES_LIST/)
  assert.match(source, /DeclarePluginDialog/)
})
