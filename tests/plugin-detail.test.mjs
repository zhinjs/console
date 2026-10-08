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
