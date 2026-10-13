import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

async function handler(name, bindings) {
 const source=await readFile(new URL('../console-ui/src/pages/plugin-detail.tsx',import.meta.url),'utf8')
 const ast=ts.createSourceFile('plugin-detail.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 let declaration
 function find(node){if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name)declaration=node;ts.forEachChild(node,find)}
 find(ast);assert.ok(declaration)
 const code=ts.transpileModule(`const ${declaration.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 return Function(...Object.keys(bindings),`${code}; return ${name};`)(...Object.values(bindings))
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
