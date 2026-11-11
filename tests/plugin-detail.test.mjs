import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validatePluginDetail, requirePluginUpdate, pluginDiagnosticSummary } from '../console-ui/src/pages/plugin-detail-model.mjs';
const plugin=JSON.parse(readFileSync(new URL('./fixtures/plugin-detail.json',import.meta.url))).data;
test('formal detail preserves commands and middleware without legacy contexts',()=>{
 assert.equal(plugin.contexts,undefined);validatePluginDetail(plugin);
 assert.deepEqual(plugin.features.map(f=>[f.name,f.count,f.items[0].name]),[['command',1,'repeater-status'],['middleware',1,'repeater']]);
});
test('missing or invalid capabilities are errors rather than silent empty groups',()=>{
 assert.throws(()=>validatePluginDetail({...plugin,features:undefined}));
 assert.throws(()=>validatePluginDetail({...plugin,features:[{...plugin.features[0],count:0}]}));
});

test('a failed or incomplete version check never means the installed plugin is latest', () => {
 assert.throws(() => requirePluginUpdate({success:false,error:'unavailable'}, '@zhin.js/repeater'));
 assert.throws(() => requirePluginUpdate({success:true,data:{}}, '@zhin.js/repeater'));
 assert.throws(() => requirePluginUpdate({success:true,data:[]}, '@zhin.js/repeater'));
 assert.throws(() => requirePluginUpdate({success:true,data:[{name:'@zhin.js/repeater'}]}, '@zhin.js/repeater'));
 const update = {name:'@zhin.js/repeater',current:'1.0.0',latest:'1.0.1'};
 assert.deepEqual(requirePluginUpdate({success:true,data:[update]}, update.name), update);
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

test('detail page asks before disabling, sends nothing when cancelled, and enables without asking', async () => {
 const ts = (await import('typescript')).default
 const { defaultI18n } = await import('./locale-fixture.mjs')
 const { disableConfirmation } = await import('../console-ui/src/pages/plugin-toggle-model.mjs')
 const source = readFileSync(new URL('../console-ui/src/pages/plugin-detail.tsx', import.meta.url), 'utf8')
 const ast = ts.createSourceFile('plugin-detail.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
 let declaration
 const find = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'setEnabled') declaration = node; ts.forEachChild(node, find) }
 find(ast); assert.ok(declaration)
 const code = ts.transpileModule(`const ${declaration.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
 const run = async (enabled, answer) => {
  const confirms = [], requests = [], noop = () => {}
  const management = { instanceKey: 'qq', disabled: !enabled }
  const bindings = {
   i18n: defaultI18n, disableConfirmation, confirm: async options => { confirms.push(options); return answer },
   plugin: { name: 'qq', instanceKey: 'qq', features: [{ name: 'adapter', count: 1 }], management }, writable: true,
   actionInFlight: { current: false }, actionUnconfirmed: false, lifecycleAbort: { current: null }, routeIdentity: { current: 'qq' }, name: 'qq',
   detailSequence: { current: 0 }, fetchPluginDetail: async () => {},
   setActionLoading: noop, setActionError: noop, setActionErrorDetail: noop, setActionMessage: noop, setActionUnconfirmed: noop,
   requestConsole: async request => { requests.push(request); return management },
   waitForEnabledManagementState: async () => ({ ...management, disabled: !enabled }),
  }
  const setEnabled = Function(...Object.keys(bindings), `${code}; return setEnabled;`)(...Object.values(bindings))
  await setEnabled(enabled)
  return { confirms, requests: requests.filter(request => request.type === 'plugin:set-enabled') }
 }
 const cancelled = await run(false, false)
 assert.equal(cancelled.confirms.length, 1)
 assert.match(cancelled.confirms[0].description, /聊天账号会掉线/)
 assert.deepEqual(cancelled.requests, [])
 const accepted = await run(false, true)
 assert.deepEqual(accepted.requests, [{ type: 'plugin:set-enabled', instanceKey: 'qq', enabled: false }])
 const enabling = await run(true, false)
 assert.deepEqual(enabling.confirms, [])
 assert.deepEqual(enabling.requests, [{ type: 'plugin:set-enabled', instanceKey: 'qq', enabled: true }])
})
