import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { editSourceDraft, saveSourceDraft } from '../console-ui/src/pages/config-source-draft.mjs'
import { configurationSaveSummary } from '../console-ui/src/components/PluginConfigForm/config-evidence-model.mjs'

const a={source:'{"plugin":{"one":1}}',format:'json',revision:'a',configKeys:['plugin'],connectionScope:'test-scope'}
const b={...a,source:'{"plugin":{"one":1,"otherClient":2}}',revision:'b'}
async function pageSaveHandler(bindings, name = 'handleYamlSave') {
 bindings={connectionScope:'test-scope',isInboxCacheScopeActive:()=>true,operation:{current:0},configurationSaveSummary,...bindings}
 const source=await readFile(new URL('../console-ui/src/pages/config.tsx',import.meta.url),'utf8')
 const ast=ts.createSourceFile('config.tsx',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX)
 let declaration
 function find(node) { if(ts.isVariableDeclaration(node)&&node.name.getText(ast)===name) declaration=node; ts.forEachChild(node,find) }
 find(ast);assert.ok(declaration,'actual page must have a source-save handler')
 const code=ts.transpileModule(`const ${declaration.getText(ast)};`,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText
 return Function(...Object.keys(bindings),`${code}; return ${name};`)(...Object.values(bindings))
}

test('actual page save keeps the original draft revision after refresh and subsequent typing, preserving concurrent changes',async()=>{
 const draft=editSourceDraft(editSourceDraft(null,a,'{"plugin":{"one":9}}'),b,'{"plugin":{"one":10}}')
 let persisted=b.source, unsafeSaveCalls=0, discarded=false, errors=0
 const calls=[]
 const handler=await pageSaveHandler({saving:false,sourceDirty:true,sourceIssue:null,sourceDraft:draft,sourceText:draft.source,
  saveSourceDraft,saveBound:async(source,snapshot)=>{calls.push({source,revision:snapshot.revision});if(snapshot.revision!==b.revision)throw Error('CAS conflict');persisted=source},
  save:async(source)=>{unsafeSaveCalls++;persisted=source},setSaving:()=>{},setSourceDraft:()=>{discarded=true},success:()=>{},toastError:()=>{errors++}})
 await handler()
 assert.deepEqual(calls,[{source:draft.source,revision:'a'}]);assert.equal(persisted,b.source);assert.equal(unsafeSaveCalls,0);assert.equal(discarded,false);assert.equal(errors,1)
})

test('actual page discards a draft only after the bound save succeeds; explicit discard starts from the latest revision',async()=>{
 const draft=editSourceDraft(null,b,'{"plugin":{"one":10,"otherClient":2}}')
 let discarded=false, persisted
 const handler=await pageSaveHandler({saving:false,sourceDirty:true,sourceIssue:null,sourceDraft:draft,sourceText:draft.source,
  saveSourceDraft,saveBound:async(source,snapshot)=>{assert.equal(snapshot.revision,'b');persisted=source;return {success:true,revision:'c'}},
  setSaving:()=>{},setSourceDraft:()=>{discarded=true},success:()=>{},toastError:()=>{assert.fail('save should succeed')}})
 await handler();assert.equal(discarded,true);assert.equal(persisted,draft.source)
 assert.throws(()=>editSourceDraft(null,null,'draft'),/版本未知/)
})


test('actual GeneralConfigForm and parent save handlers keep the dirty form baseline after refresh',async()=>{
 const baseline={...a,source:'{"systemFlag":1,"plugin":{"one":1}}'}
 const refreshed={...b,source:'{"systemFlag":2,"plugin":{"one":1,"otherClient":2}}'}
 let persisted=refreshed.source, cleared=false, unsafeCalls=0
 const calls=[]
 const parent=await pageSaveHandler({source:refreshed.source,format:'json',snapshot:refreshed,
  setSaving:()=>{},saveBound:async(source,original)=>{calls.push({source,revision:original.revision});if(original.revision!==refreshed.revision)throw Error('CAS conflict');persisted=source},
  save:async(source)=>{unsafeCalls++;persisted=source},success:()=>{},toastError:()=>{},parseYaml:()=>{throw Error('unexpected format')},stringifyYaml:()=>{throw Error('unexpected format')}},'handleFormSave')
 const form=await pageSaveHandler({localValues:{systemFlag:9},baselineSnapshot:baseline,snapshot:refreshed,onSave:parent,setDirty:()=>{cleared=true}},'handleSave')
 await form()
 assert.equal(calls.length,1);assert.equal(calls[0].revision,'a');assert.deepEqual(JSON.parse(calls[0].source),{systemFlag:9,plugin:{one:1}})
 assert.equal(persisted,refreshed.source);assert.equal(unsafeCalls,0);assert.equal(cleared,false)
})
