import { defaultI18n, translate } from './locale-fixture.mjs'
import { verificationCheckDisplay, captureVerificationPlan, verifyApprovedPlugin, verificationRequest, verificationResultDisplay } from '../console-ui/src/pages/plugin-management-model.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'

async function handler(name, bindings, presentation = defaultI18n) {
 const source=await readFile(new URL('../console-ui/src/pages/plugin-detail.tsx',import.meta.url),'utf8')
 const ast=ts.createSourceFile('plugin-detail.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 let declaration
 function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)declaration=node;ts.forEachChild(node,find)}
 find(ast);assert.ok(declaration)
 const code=ts.transpileModule(`const ${declaration.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 return Function('i18n', 'verificationCheckDisplay', ...Object.keys(bindings),`${code}; return ${name};`)(presentation, verificationCheckDisplay, ...Object.values(bindings))
}
const noop=()=>{}
test('lost business-check reply stays unknown after actual page state refresh and is never retried',async()=>{
 let locked=false, unknown=null, error=null, calls=0
 const run=await handler('runVerification',{
  plugin:{management:{}},verificationPlan:{checks:[{id:'roundtrip',title:'平台投递',scope:'platform',effects:['发送测试消息']}],generation:1},writable:true,
  actionInFlight:{current:false},actionUnconfirmed:false,routeIdentity:{current:'plugin'},name:'plugin',confirm:async()=>true,
  setActionLoading:noop,setActionError:v=>{error=v},setVerificationPlan:noop,setVerificationResult:noop,setVerificationInvalidated:noop,
  setActionUnconfirmed:v=>{locked=v},setUnconfirmedCheck:v=>{unknown=v},requestConsole:noop,
  verifyApprovedPlugin:async()=>{calls++;throw Error('reply lost')}
 })
 await run('roundtrip');assert.equal(calls,1);assert.equal(locked,true);assert.equal(unknown,'平台投递');assert.match(error,/刷新插件状态不能确认/)
 const refresh=await handler('fetchPluginDetail',{
  detailSequence:{current:0},setLoading:noop,apiFetch:async()=>({ok:true,json:async()=>({success:true,data:{instanceKey:'plugin',management:{status:'enabled'}}})}),
  validatePluginDetail:noop,validateManagementState:noop,setPlugin:noop,setError:noop,actionUnconfirmed:locked,unconfirmedCheck:unknown,
  setActionError:v=>{error=v},setActionErrorDetail:noop,setActionMessage:noop,setActionUnconfirmed:v=>{locked=v},setVerificationPlan:noop
 })
 await refresh('plugin');assert.equal(locked,true);assert.match(error,/结果未知/);assert.equal(calls,1)
})

test('actual plugin verification plan and result JSX render provider metadata in both languages and retain third-party originals', async () => {
 const source=await readFile(new URL('../console-ui/src/pages/plugin-detail.tsx',import.meta.url),'utf8')
 const ast=ts.createSourceFile('plugin-detail.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX), sections=[]
 function find(node){if(ts.isJsxElement(node)&&node.openingElement.tagName.getText(ast)==='section'&&node.openingElement.attributes.getText(ast).match(/业务验证计划|业务验证结果/))sections.push(node.getText(ast));ts.forEachChild(node,find)}
 find(ast);assert.equal(sections.length,2)
 const compiled=ts.transpileModule(`function View({verificationPlan,verificationResult}){const verificationDisplay=verificationResultDisplay(verificationResult.outcome,i18n.locale);return <>${sections.join('')}</>}`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.None,jsx:ts.JsxEmit.React}}).outputText
 const plan={generation:7,checks:[{id:'fixture',title:'临时任务',titleI18n:{en:'Temporary task'},scope:'local',effects:['不投递'],effectsI18n:{en:['No delivery']}}]}
 const result={outcome:{summary:'任务已取消',summaryI18n:{en:'Task cancelled'},evidence:['读取成功'],evidenceI18n:{en:['Read succeeded']}}}
 function render(locale,verificationPlan=plan,verificationResult=result){
  const bindings={i18n:{locale,t:(message,values)=>translate(locale,message,values)},verificationCheckDisplay,verificationResultDisplay,verificationSummary:()=>'',Badge:'span',Button:'button',actionLoading:false,actionUnconfirmed:false,runVerification:noop}
  const View=Function('React',...Object.keys(bindings),`${compiled};return View`)(React,...Object.values(bindings))
  return renderToStaticMarkup(React.createElement(View,{verificationPlan,verificationResult}))
 }
 const english=render('en'), chinese=render('zh-CN')
 for(const text of ['Temporary task','No delivery','Task cancelled','Read succeeded'])assert.ok(english.includes(text),text)
 for(const text of ['临时任务','不投递','任务已取消','读取成功'])assert.ok(chinese.includes(text),text)
 const fallback=render('en',{generation:7,checks:[{id:'third-party',title:'第三方原文',scope:'local',effects:['原始副作用']}]},{outcome:{summary:'第三方结果 <script>',evidence:['原始证据']}})
 assert.match(fallback,/第三方原文/);assert.match(fallback,/原始副作用/);assert.match(fallback,/第三方结果 &lt;script&gt;/);assert.match(fallback,/原始证据/)
})

test('actual business-check confirmation uses explicit provider translations without changing approval or request identity', async () => {
 const state={packageName:'fixture',instanceKey:'fixture',installed:true,plugin:true,declared:true,version:'1.0.0',revision:'config',projectRevision:'project',status:'enabled',dependencies:'passed',validation:null,generation:1,published:true,readiness:'unknown',restartRequired:false,disabled:false,issues:[],verification:'available'}
 const source={packageName:'fixture',instanceKey:'fixture',generation:1,projectRevision:'project',checkRevision:'complete-bilingual-definition',checks:[{id:'roundtrip',title:'临时任务',titleI18n:{en:'Temporary task'},scope:'local',effects:['写入后取消；不投递'],effectsI18n:{en:['Write and cancel; no delivery']}}]}
 const plan=captureVerificationPlan(source,state), before=structuredClone(plan), calls=[], confirmations=[]
 const outcome={packageName:'fixture',instanceKey:'fixture',checkId:'roundtrip',generation:1,current:true,status:'passed',scope:'local',summary:'任务已取消',summaryI18n:{en:'Task cancelled'},evidence:['读取成功'],evidenceI18n:{en:['Read succeeded']}}
 let result
 const run=await handler('runVerification',{
  plugin:{management:state},verificationPlan:plan,writable:true,actionInFlight:{current:false},actionUnconfirmed:false,routeIdentity:{current:'fixture'},name:'fixture',
  confirm:async options=>{confirmations.push(options);return true},setActionLoading:noop,setActionError:noop,setVerificationPlan:noop,
  setVerificationResult:value=>{if(value)result=value},setVerificationInvalidated:noop,setActionUnconfirmed:noop,setUnconfirmedCheck:noop,
  requestConsole:async request=>{calls.push(request);return outcome},verifyApprovedPlugin,
 },{locale:'en',t:(message,values)=>translate('en',message,values)})
 await run('roundtrip')
 assert.match(confirmations[0].title,/Temporary task/);assert.match(confirmations[0].description,/Write and cancel; no delivery/)
 assert.deepEqual(calls,[verificationRequest(plan,'roundtrip',state,'zh-CN')]);assert.deepEqual(plan,before);assert.strictEqual(result.plan,plan)
 assert.deepEqual(verificationResultDisplay(result.outcome,'en'),{summary:'Task cancelled',evidence:['Read succeeded']})
 assert.equal(result.outcome.summary,'任务已取消');assert.deepEqual(result.outcome.evidence,['读取成功'])
 assert.deepEqual(verificationCheckDisplay({title:'第三方原文',effects:['原始副作用']},'en'),{title:'第三方原文',effects:['原始副作用']})
 assert.deepEqual(verificationResultDisplay({summary:'第三方结果正文',evidence:['原始证据'],summaryI18n:{en:42},evidenceI18n:{en:['']}},'en'),{summary:'第三方结果正文',evidence:['原始证据']})
 assert.deepEqual(verificationCheckDisplay({title:'第三方原文',effects:['不能隐藏的副作用'],effectsI18n:{en:[]}},'en').effects,['不能隐藏的副作用'])
 assert.deepEqual(verificationResultDisplay({summary:'第三方结果正文',evidence:['证据1','证据2'],evidenceI18n:{en:['only one']}},'en').evidence,['证据1','证据2'])
})
