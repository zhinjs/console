import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import ts from 'typescript'
import React from 'react'
import {renderToStaticMarkup} from 'react-dom/server'
import * as model from '../console-ui/src/components/PluginConfigForm/config-explanation-model.mjs'
import {createInboxCacheAuthority} from '../console-ui/src/utils/inbox-cache-scope.mjs'
const require=createRequire(import.meta.url)
const source=await readFile(new URL('../console-ui/src/components/PluginConfigForm/ConfigFieldExplanation.tsx',import.meta.url),'utf8')
const fixture=JSON.parse(await readFile(new URL('./fixtures/config-explanation-host.json',import.meta.url),'utf8'))
const initial=fixture.initial.reply.data
function hooks(){const slots=[];let cursor=0,dirty=false,effects=[],render,value;const equal=(a,b)=>a&&b&&a.length===b.length&&a.every((item,i)=>Object.is(item,b[i]));const react={useState(initial){const i=cursor++;if(!(i in slots))slots[i]=typeof initial==='function'?initial():initial;return[slots[i],next=>{const result=typeof next==='function'?next(slots[i]):next;if(!Object.is(slots[i],result)){slots[i]=result;dirty=true}}]},useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial})},useEffect(fn,deps){const i=cursor++;if(!equal(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn()})}}};return{react,mount(fn){render=fn;return this.render()},render(){let count=0;do{assert(++count<30);dirty=false;cursor=0;value=render();const queue=effects;effects=[];queue.forEach(fn=>fn())}while(dirty);return value},async settle(){for(let i=0;i<16;i++){await Promise.resolve();if(dirty||effects.length)this.render()}return value},unmount(){slots.forEach(slot=>slot?.cleanup?.());effects=[]},get value(){return value}}}
function elements(value){if(!value||typeof value!=='object')return[];return[value,...[value.props?.children].flat(Infinity).flatMap(elements)]}
function text(value){if(value==null||typeof value==='boolean')return'';if(typeof value!=='object')return String(value);return[value.props?.children].flat(Infinity).map(text).join('')}
function setup(){const runtime=hooks(),calls=[];let connection={host:'mock-a',credential:'synthetic-A'},next=0;const authority=createInboxCacheAuthority(()=>connection,()=>`opaque-${++next}`);let props={instanceKey:'demo',revision:initial.revision,draftRevision:initial.revision,dirty:false,disabled:false,scope:authority.current()};const mocks={react:runtime.react,'../ui/button':{Button:'button'},'../../utils/console-rpc':{requestConsole:request=>new Promise((resolve,reject)=>calls.push({request,resolve,reject}))},'../../contracts/zhin-console':{CONSOLE_RPC:{CONFIG_EXPLAIN:fixture.initial.request.type}},'../../utils/inbox-cache':{getInboxCacheScope:()=>authority.current(),isInboxCacheScopeActive:scope=>authority.active(scope)},'../../utils/useInboxCacheScope':{useInboxCacheScope:()=>authority.current()},'../../utils/demo-mode':{isDemoMode:()=>false},'./config-explanation-model.mjs':model};const module={exports:{}};const code=ts.transpileModule(source+'\nexport {ExplanationSession};',{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;new Function('require','exports','module',code)(name=>isLocaleImport(name)?localeModule:Object.hasOwn(mocks,name)?mocks[name]:require(name),module.exports,module);runtime.mount(()=>module.exports.ExplanationSession(props));return{runtime,calls,module:module.exports,button(label){const node=elements(runtime.value).find(node=>node.type==='button'&&text(node)===label);assert(node,label);return node},update(next){props={...props,...next};runtime.render()},switchHost(){connection={host:'mock-b',credential:'synthetic-B'}},switchCredential(){connection={...connection,credential:'synthetic-B'}},data(){return elements(runtime.value).find(node=>node.type===module.exports.ConfigFieldExplanationView)?.props.data}}}

test('actual Host DTO fixtures satisfy the contract including default/file/unset and unsupported reasons',()=>{
 for(const name of ['initial','different','unsupportedComplex','unsupportedCustom']){const item=fixture[name];assert.deepEqual(model.readConfigExplanation(item.reply.data,{instanceKey:item.request.instanceKey,revision:item.request.expectedRevision}),item.reply.data)}
 assert.equal(fixture.drift.reply.data,undefined);assert.equal(fixture.demoDenied.reply.data,undefined)
})
test('actual component reader sends only stored revision and shows read-time evidence, never a draft',async()=>{
 const f=setup();assert.equal(f.calls.length,0);f.update({dirty:true});assert.match(text(f.runtime.value),/不解释或覆盖草稿/);f.button('读取已保存版本解释').props.onClick();await f.runtime.settle();assert.deepEqual(f.calls[0].request,{type:'config:explain',instanceKey:'demo',expectedRevision:initial.revision});f.calls[0].resolve(initial);await f.runtime.settle();assert.deepEqual(f.data(),initial);assert.equal(f.calls.length,1);f.runtime.unmount()
})
test('busy while a read resolves then same-revision recovery never leaves a permanently loading button',async()=>{
 const f=setup();f.button('读取已保存版本解释').props.onClick();await f.runtime.settle();assert.equal(f.button('正在读取解释…').props.disabled,true);f.update({disabled:true});f.calls[0].resolve(initial);await f.runtime.settle();f.update({disabled:false});assert.equal(f.button('读取已保存版本解释').props.disabled,false);assert.equal(f.data(),undefined);f.button('读取已保存版本解释').props.onClick();await f.runtime.settle();f.calls[1].resolve(initial);await f.runtime.settle();assert.deepEqual(f.data(),initial);f.runtime.unmount()
})
for(const change of ['switchHost','switchCredential'])test(`actual old DOM click and late results cannot cross ${change}`,async()=>{
 const f=setup(),oldClick=f.button('读取已保存版本解释').props.onClick;oldClick();f[change]();f.calls[0].resolve(initial);await f.runtime.settle();assert.equal(f.data(),undefined);oldClick();assert.equal(f.calls.length,1);f.runtime.unmount()
})
test('actual revision changes clear shown data synchronously and reject old reply',async()=>{
 const f=setup();f.button('读取已保存版本解释').props.onClick();await f.runtime.settle();f.update({revision:fixture.different.reply.data.revision});f.calls[0].resolve(initial);await f.runtime.settle();assert.equal(f.data(),undefined);f.button('读取已保存版本解释').props.onClick();await f.runtime.settle();f.calls[1].resolve(fixture.different.reply.data);await f.runtime.settle();assert.equal(f.data().fields.find(x=>x.path[0]==='count').generationMatch,'different');f.runtime.unmount()
})
test('SSR gives readable origin and comparison labels with unknown old origin, never expanded values',()=>{
 const f=setup(),View=f.module.ConfigFieldExplanationView;const html=renderToStaticMarkup(React.createElement(View,{data:initial}));assert.match(html,/配置文件明确设置/);assert.match(html,/Schema 声明默认值/);assert.match(html,/未设置/);assert.match(html,/敏感或环境引用，未比较/);assert.match(html,/运行代字段来源：未知/);assert.match(html,/值一致不证明来自同一配置来源/);assert.doesNotMatch(html,/value=|SECRET_ENV/);assert.match(html,/<table/)
 const unsupported=renderToStaticMarkup(React.createElement(View,{data:fixture.unsupportedComplex.reply.data}));assert.match(unsupported,/暂不能解释/);assert.doesNotMatch(unsupported,/<table/)
 const hostile=model.readConfigExplanation({...initial,fields:[{...initial.fields[0],path:['<img src=x>','literal.dot']}]});const safe=renderToStaticMarkup(React.createElement(View,{data:hostile}));assert.match(safe,/&lt;img/);assert.doesNotMatch(safe,/<img/);f.runtime.unmount()
})
