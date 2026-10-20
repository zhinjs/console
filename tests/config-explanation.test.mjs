import test from 'node:test'
import assert from 'node:assert/strict'
import {readConfigExplanation,explanationBindingKey,createConfigExplanationReader} from '../console-ui/src/components/PluginConfigForm/config-explanation-model.mjs'
const revision='a'.repeat(64),projectRevision='b'.repeat(64)
// Synthetic unit inputs only; actual Host DTO fixture is checked separately once available.
const dto={instanceKey:'demo',revision,projectRevision,generation:2,projection:'supported',fields:[{path:['literal.dot','a/b'],candidateOrigin:'file',generationMatch:'equal',generationOrigin:'unknown'},{path:['default'],candidateOrigin:'schema-default',generationMatch:'different',generationOrigin:'unknown'},{path:['secret'],candidateOrigin:'file',generationMatch:'redacted',generationOrigin:'unknown'},{path:['absent'],candidateOrigin:'unset',generationMatch:'unknown',generationOrigin:'unknown'}]}
const copy=structuredClone
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no});return{promise,resolve,reject}}
function setup(){let binding={scope:'opaque-A',instanceKey:'demo',revision},activeScope='opaque-A';const calls=[],states=[],pending=[];const reader=createConfigExplanationReader({getBinding:()=>binding,active:scope=>scope===activeScope,read:arg=>{calls.push(arg);const wait=deferred();pending.push(wait);return wait.promise},publish:state=>states.push(state)});return{reader,calls,states,pending,setBinding:value=>{binding=value},setActive:value=>{activeScope=value}}}

test('metadata parser preserves static path segments and never invents current generation origin',()=>{
 const parsed=readConfigExplanation(dto,{instanceKey:'demo',revision});assert.deepEqual(parsed,dto);assert.deepEqual(parsed.fields[0].path,['literal.dot','a/b']);assert.equal(parsed.fields.every(x=>x.generationOrigin==='unknown'),true)
 assert.notEqual(parsed.fields,dto.fields);assert.equal(JSON.stringify(parsed).includes('value'),false)
})
test('unsupported is explicit, empty supported schema is distinct, and unavailable generation cannot prove equality',()=>{
 const unsupported={...dto,generation:null,projection:'unsupported',reason:'instance-unavailable',fields:[]};assert.equal(readConfigExplanation(unsupported).projection,'unsupported');assert.deepEqual(readConfigExplanation({...dto,fields:[]}).fields,[])
 for(const changed of [{...unsupported,fields:dto.fields},{...unsupported,reason:'guess'},{...dto,generation:null},{...dto,reason:'complex-schema'}])assert.throws(()=>readConfigExplanation(changed))
})
test('parser rejects values, unknown origins, unproved generation origin, duplicates, malformed versions and bounds',()=>{
 for(const changed of [{...dto,instanceKey:'x'.repeat(129)},{...dto,values:{secret:'must not show'}},{...dto,revision:'bad'},{...dto,projectRevision:'bad'},{...dto,generation:-1},{...dto,fields:[{...dto.fields[0],generationOrigin:'file'}]},{...dto,fields:[dto.fields[0],dto.fields[0]]},{...dto,fields:[{...dto.fields[0],path:[]}]},{...dto,fields:[{...dto.fields[0],path:Array(9).fill('a')}]},{...dto,fields:[{...dto.fields[0],candidateOrigin:'environment'}]}])assert.throws(()=>readConfigExplanation(changed))
 assert.throws(()=>readConfigExplanation({...dto,fields:Array.from({length:129},(_,i)=>({...dto.fields[0],path:[String(i)]}))}))
 assert.throws(()=>readConfigExplanation({...dto,fields:Array.from({length:128},(_,i)=>({...dto.fields[0],path:['中'.repeat(100),String(i)]}))}))
 assert.throws(()=>readConfigExplanation(dto,{instanceKey:'other',revision}),/不属于/);assert.throws(()=>readConfigExplanation(dto,{instanceKey:'demo',revision:'c'.repeat(64)}),/不属于/)
})
test('real read handler passes only exact stored identity/revision and publishes parsed metadata',async()=>{
 const t=setup();const done=t.reader.load();assert.deepEqual(t.calls,[{instanceKey:'demo',revision}]);t.pending[0].resolve(dto);await done;assert.equal(t.states.at(-1).kind,'ready');assert.deepEqual(t.states.at(-1).data,dto)
})
test('same binding supersedes old requests, while cancellation prevents late errors',async()=>{
 const t=setup(),first=t.reader.load(),second=t.reader.load();t.pending[1].resolve(dto);await second;const count=t.states.length;t.pending[0].resolve({...dto,generation:1});await first;assert.equal(t.states.length,count);assert.equal(t.states.at(-1).data.generation,2)
 const third=t.reader.load();t.reader.cancel();const before=t.states.length;t.pending[2].reject(new Error('old secret error'));await third;assert.equal(t.states.length,before)
})
for(const change of ['host','credential','revision','instance','disabled'])test(`late result cannot publish after ${change} changes`,async()=>{
 const t=setup(),done=t.reader.load(),count=t.states.length
 if(change==='host'||change==='credential'){t.setActive('opaque-B');t.setBinding({scope:'opaque-B',instanceKey:'demo',revision})}
 if(change==='revision')t.setBinding({scope:'opaque-A',instanceKey:'demo',revision:'c'.repeat(64)})
 if(change==='instance')t.setBinding({scope:'opaque-A',instanceKey:'other',revision})
 if(change==='disabled')t.setBinding({scope:'opaque-A',instanceKey:'demo',revision,disabled:true})
 t.pending[0].resolve(dto);await done;assert.equal(t.states.length,count)
})
test('current drift clears data; raw server errors and sensitive extra values are never surfaced',async()=>{
 const t=setup(),done=t.reader.load();t.pending[0].resolve({...dto,revision:'c'.repeat(64)});await done;assert.equal(t.states.at(-1).kind,'error');assert.match(t.states.at(-1).message,/不属于当前已保存版本/);assert.equal(t.states.at(-1).data,undefined)
 const again=t.reader.load();t.pending[1].reject(new Error('字段解释不属于当前已保存版本 SECRET_ENV_VALUE'));await again;assert.equal(t.states.at(-1).message.includes('SECRET_ENV_VALUE'),false)
 const third=t.reader.load();t.pending[2].resolve({...dto,value:'SECRET_ENV_VALUE'});await third;assert.equal(JSON.stringify(t.states.at(-1)).includes('SECRET_ENV_VALUE'),false)
})
test('old DOM binding cannot request another credential scope, nor a missing revision',async()=>{
 const t=setup();t.setActive('opaque-B');await t.reader.load();assert.equal(t.calls.length,0)
 t.setBinding({scope:'opaque-B',instanceKey:'x'.repeat(129),revision});await t.reader.load();assert.equal(t.calls.length,0)
 t.setBinding({scope:'opaque-B',instanceKey:'demo',revision:''});await t.reader.load();assert.equal(t.calls.length,0);assert.equal(explanationBindingKey({scope:'x',instanceKey:'demo',revision}),JSON.stringify(['x','demo',revision]))
})
