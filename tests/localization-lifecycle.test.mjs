import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { envEditorAccess, maskEnvContent } from '../console-ui/src/pages/env-editor-model.mjs'
import { createDiagnosticRequestGate } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'
import { readTaskProviders, readTaskUseCases, reconcileTaskMutation } from '../console-ui/src/pages/task-center-model.mjs'

import { permissionRequest, readPermissionCatalog, readPermissionExplanation, permissionHttpError } from '../console-ui/src/pages/permission-explanation-model.mjs'

function hooks() {
  const slots=[]; let cursor=0, pending=[], dirty=false, render, value
  const same=(a,b)=>a && b && a.length===b.length && a.every((v,i)=>Object.is(v,b[i]))
  const api={
    useState(initial){const i=cursor++; if(!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i],next=>{const v=typeof next==='function'?next(slots[i]):next;if(!Object.is(slots[i],v)){slots[i]=v;dirty=true}}]},
    useRef(initial){const i=cursor++;return slots[i]??(slots[i]={current:initial})},
    useCallback(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={deps,fn};return slots[i].fn},
    useEffect(fn,deps){const i=cursor++;if(!same(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps,cleanup:old?.cleanup};pending.push(()=>{old?.cleanup?.();slots[i].cleanup=fn()})}},
  }
  return {api,mount(fn){render=fn;return this.render()},render(){let n=0;do{assert.ok(++n<50);dirty=false;cursor=0;value=render();const effects=pending;pending=[];effects.forEach(fn=>fn())}while(dirty);return value},async settle(){for(let i=0;i<12;i++){await Promise.resolve();if(dirty||pending.length)this.render()}return value},get value(){return value}}
}
// Execute the production state/effect lifecycle up to the render section. Only expose state to
// drive edits; effects, load/save callbacks, dependency lists and request boundaries are unchanged.
async function lifecycle(file,name,stop,expose,bindings){
 const source=await readFile(new URL(`../console-ui/src/${file}`,import.meta.url),'utf8')
 const ast=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 let declaration;function find(n){if(ts.isFunctionDeclaration(n)&&n.name?.text===name)declaration=n;ts.forEachChild(n,find)}find(ast);assert.ok(declaration)
 let code=declaration.getText(ast).replace(/^export (default )?/, '');assert.ok(code.indexOf(stop)>0);code=code.slice(0,code.indexOf(stop))+`return {${expose}};}`
 code=ts.transpileModule(code,{compilerOptions:{module:ts.ModuleKind.None,target:ts.ScriptTarget.ES2022}}).outputText
 return Function(...Object.keys(bindings),`${code};return ${name}`)(...Object.values(bindings))
}
const messages=locale=>({locale,t:(message,values)=>translate(locale,message,values)})
for(const [file,name,prop,reader] of [['pages/files/file-editor.tsx','FileEditor','filePath','readFile'],['pages/env.tsx','EnvFileEditor','filename','getFile']]){
 test(`${name}: changing locale preserves an edited draft without a reload or extra write`,async()=>{
  const runtime=hooks();let locale=messages('zh-CN'),reads=0,writes=0;const drafts=[]
  const component=await lifecycle(file,name,'  if (loading', 'content, originalContent, setContent, loadContent',{
   ...runtime.api,useI18n:()=>locale,readErrorSummary:String,envEditorAccess,maskEnvContent,window:{addEventListener(){},removeEventListener(){}},
  })
  const props={[prop]:'fixture.txt',[reader]:async()=>{reads++;return 'original'},saveFile:async()=>{writes++},readOnly:false,onDraftChange:draft=>drafts.push(draft),onClose(){}}
  runtime.mount(()=>component(props));await runtime.settle();assert.equal(runtime.value.content,'original')
  runtime.value.setContent('未保存草稿');runtime.render();const load=runtime.value.loadContent
  locale=messages('en');runtime.render();await runtime.settle()
  assert.equal(runtime.value.content,'未保存草稿');assert.equal(runtime.value.originalContent,'original')
  assert.strictEqual(runtime.value.loadContent,load);assert.equal(reads,1);assert.equal(writes,0)
  assert.equal(drafts.at(-1).content,'未保存草稿')
 })
}

test('task language refresh preserves the operation epoch, target and draft while requesting localized catalogs',async()=>{
 const runtime=hooks();let locale=messages('zh-CN');const requests=[];const scope='fixture-scope'
 const component=await lifecycle('pages/task-center.tsx','TaskCenterPage','  const chooseProvider', 'setParameters, parameters, setTargetFields, targetFields, mutationEpoch, setReview, review',{
  ...runtime.api,useI18n:()=>locale,useInboxCacheScope:()=>scope,createDiagnosticRequestGate,getInboxCacheScope:()=>scope,isInboxCacheScopeActive:v=>v===scope,
  emptyTarget:{kind:'private',id:'',parentKind:'',parentId:'',threadId:''},savedPending:()=>null,isDemoMode:()=>false,
  apiFetch:async path=>{requests.push(path);return {ok:true,json:async()=>({success:true,data:path.includes('use-cases')?[]:{generation:1,providers:[]}})}},
  readTaskProviders,readTaskUseCases,reconcileTaskMutation,CONSOLE_REST:{TASK_PROVIDERS:'/providers',TASK_USE_CASES:'/use-cases'},window:{addEventListener(){},removeEventListener(){}},
 })
 runtime.mount(()=>component());await runtime.settle()
 runtime.value.setParameters({text:'原始正文'});runtime.value.setTargetFields({kind:'group',id:'room',parentKind:'',parentId:'',threadId:'topic'});runtime.value.setReview({title:'existing review'});runtime.render()
 const epoch=runtime.value.mutationEpoch.current
 locale=messages('en');runtime.render();await runtime.settle()
 assert.deepEqual(runtime.value.parameters,{text:'原始正文'});assert.equal(runtime.value.targetFields.threadId,'topic');assert.equal(runtime.value.review.title,'existing review')
 assert.equal(runtime.value.mutationEpoch.current,epoch)
 assert.deepEqual(requests,['/providers?locale=zh-CN','/use-cases?locale=zh-CN','/providers?locale=en','/use-cases?locale=en'])
})


test('permission requests use the selected language without clearing hypotheses or automatically rerunning checks', async () => {
 const runtime=hooks(); let locale=messages('zh-CN'); const requests=[]; const scope='permission-fixture';
 const command={id:'root/demo\0zhin.command\0status',owner:'root/demo',name:'status',description:'状态',permits:[]};
 const component=await lifecycle('pages/command-permissions.tsx','CommandPermissionsPage','  return <div',
  'loadCatalog, explain, choose, setSenderId, senderId, setRoles, roles, setTarget, target, setIncludeTarget, setHypothesis, hypothesis, selected, current', {
  ...runtime.api, useI18n:()=>locale, useInboxCacheScope:()=>scope, createDiagnosticRequestGate, getInboxCacheScope:()=>scope,
  isInboxCacheScopeActive:value=>value===scope, isDemoMode:()=>false, permissionRequest, readPermissionCatalog, readPermissionExplanation, permissionHttpError,
  CONSOLE_REST:{COMMAND_PERMISSIONS:'/permissions',COMMAND_PERMISSION_EXPLAIN:'/explain'},
  apiFetch:async (url, options)=>{requests.push({url,options});return {ok:true,json:async()=>options.method==='POST'?
   {success:true,data:{generation:3,simulation:true,command,permissionHost:'present',adapter:{outcome:'not_evaluated',reason:'fixture'},rules:[],summary:{outcome:'unknown',reason:'fixture'},unconstrained:[],assumptions:[],...JSON.parse(options.body)}}:
   {success:true,data:{generation:3,page:1,pageSize:50,total:1,commands:[command]}}}},
 });
 runtime.mount(()=>component()); await runtime.value.loadCatalog(); await runtime.settle();
 runtime.value.choose(command); await runtime.settle();
 runtime.value.setSenderId('原始用户'); runtime.value.setRoles('project admin'); runtime.value.setTarget({endpoint:{adapter:'qq',id:'endpoint'},kind:'group',id:'room',threadId:'topic'});
 runtime.value.setIncludeTarget(true); runtime.value.setHypothesis(true); runtime.render();
 const before=requests.length; locale=messages('en'); runtime.render(); await runtime.settle();
 assert.equal(requests.length,before); assert.equal(runtime.value.senderId,'原始用户'); assert.equal(runtime.value.roles,'project admin'); assert.equal(runtime.value.target.threadId,'topic'); assert.equal(runtime.value.selected.id,command.id); assert.equal(runtime.value.hypothesis,true);
 await runtime.value.explain(command,true); await runtime.settle();
 const check=requests.at(-1); assert.equal(check.url,'/explain?locale=en');
 assert.deepEqual(JSON.parse(check.options.body),{generation:3,commandId:command.id,target:runtime.value.target,sender:{id:'原始用户',roles:['project admin']}});
 await runtime.value.loadCatalog(); await runtime.settle();
 assert.equal(new URL(requests.at(-1).url,'https://example.test').searchParams.get('locale'),'en');
 assert.equal(new URL(requests[0].url,'https://example.test').searchParams.get('locale'),'zh-CN');
});
