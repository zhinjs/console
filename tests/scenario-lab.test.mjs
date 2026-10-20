import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {readScenario,readScenarioJson,readScenarioSegments,scenarioJson,scenarioExportIssues,exportScenarioRegression,scenarioPreviewItems,scenarioMarkdownBlocks} from '../console-ui/src/pages/scenario-lab/scenario-model.mjs'
const fixtureRoot = new URL('./fixtures/scenario-lab/',import.meta.url)
const fixture=JSON.parse(await readFile(new URL('scenario.json',fixtureRoot),'utf8'))
const copy=structuredClone

test('full source identity, sender roles and explicit synthetic mapping survive export unchanged',()=>{
 const scene=readScenario(fixture),out=exportScenarioRegression(scene),json=JSON.parse(out.scenarioJson)
 assert.deepEqual(json,fixture);assert.equal(json.sourceTarget.endpoint.id,'root/source\0zhin.adapter\0example');assert.deepEqual(json.sourceTarget.parent,{kind:'channel',id:'test-workspace'});assert.equal(json.sourceTarget.threadId,'test-thread');assert.equal(json.fixture.syntheticEndpoint,'scenario')
 assert.match(out.testSource,/capabilityId\(rootPluginId\(\), adapterFeatureId/);assert.match(out.testSource,/finally \{ await kit.close\(\)/);assert.match(out.testSource,/assert\.equal\(result\?\.status/);assert.match(out.testSource,/assert\.deepEqual\(kit\.deliveries/);assert.doesNotMatch(out.testSource,/process\.cwd|skip:|todo:|eval\(|new Function|fetch\(/)
})
test('omitted roles stay omitted while explicit empty roles remain []',()=>{
 const absent=copy(fixture);delete absent.sender.roles;assert.equal(Object.hasOwn(readScenarioJson(scenarioJson(absent)).sender,'roles'),false)
 const empty=copy(fixture);empty.sender.roles=[];assert.deepEqual(readScenarioJson(scenarioJson(empty)).sender.roles,[])
 const spaced=copy(fixture);spaced.sender.roles=['team lead','admin'];assert.deepEqual(readScenario(spaced).sender.roles,['team lead','admin'])
})
test('incomplete execution requirements permit valid JSON but block executable export, with no fabricated assertions',()=>{
 const draft=copy(fixture);delete draft.fixture;delete draft.assertions
 assert.equal(JSON.parse(scenarioJson(draft)).fixture,undefined);assert.equal(scenarioExportIssues(draft).length,2);assert.throws(()=>exportScenarioRegression(draft),/暂不能导出/)
 for(const assertions of [{},{dispatchStatus:'executed'},{dispatchStatus:'executed',deliveries:null}]){assert.throws(()=>readScenario({...fixture,assertions}))}
 const noSend=copy(fixture);noSend.assertions={dispatchStatus:'denied',deliveries:[]};assert.deepEqual(readScenario(noSend).assertions.deliveries,[])
})
test('preview output never becomes final assertions implicitly',()=>{
 const scene=copy(fixture);scene.preview=[{type:'text',data:{text:'作者预期 != 最终断言'}}]
 const exported=JSON.parse(exportScenarioRegression(scene).scenarioJson);assert.deepEqual(exported.assertions,fixture.assertions);assert.notDeepEqual(exported.preview,exported.assertions.deliveries[0])
})
test('strict JSON boundary rejects raw/components/functions/instances/prototype keys and oversize nesting',()=>{
 for(const type of ['raw','component','button','jsx'])assert.throws(()=>readScenarioSegments([{type,data:{}}]),/原生 JSON/)
 assert.throws(()=>readScenario({...fixture,preview:[{type:'text',data:{text:'ok',onClick:()=>{}}}]}),/JSON/)
 assert.throws(()=>readScenario({...fixture,fixture:{...fixture.fixture,config:{configVersion:2,x:new Date()}}}),/JSON/)
 const polluted=copy(fixture);polluted.fixture.config.nested=JSON.parse('{"__proto__": {}}');assert.throws(()=>readScenario(polluted),/不安全/)
 assert.throws(()=>readScenarioJson(' '.repeat(96001)),/上限/)
 let nested='x';for(let i=0;i<20;i++)nested={nested};assert.throws(()=>readScenario({...fixture,fixture:{...fixture.fixture,config:{configVersion:2,nested}}}),/嵌套/)
})
test('exact identity never trims, guesses endpoint or loses thread to a bare id',()=>{
 const scene=copy(fixture);scene.sourceTarget.id=' room ';assert.equal(readScenario(scene).sourceTarget.id,' room ')
 for(const target of [{kind:'group',id:'g'}, {...fixture.sourceTarget,endpoint:{id:'x'}}, {...fixture.sourceTarget,parent:{kind:'channel'}},{...fixture.sourceTarget,threadId:''}])assert.throws(()=>readScenario({...fixture,sourceTarget:target}))
})
test('HTML/media/keyboard are inert descriptions, URLs never become resource instructions',()=>{
 const segments=[{type:'html',data:{html:'<script>fetch("https://unsafe.test")</script><img src="https://unsafe.test/x">'}},{type:'image',data:{media:{kind:'path',value:'/private/secret'}}},{type:'keyboard',data:{rows:[[{label:'删除',payload:'danger'}]]}}]
 for(const profile of ['text','rich']){const result=scenarioPreviewItems(segments,profile);assert.equal(result[0].kind,'source');assert.equal(result[1].kind,'placeholder');assert.equal(result[2].kind,'buttons');assert.equal(result[1].text.includes('/private/secret'),false)}
})
test('Markdown subset exposes code, lists, table and quote as plain data, unsupported HTML/media stays source',()=>{
 const blocks=scenarioMarkdownBlocks('# 标题\n\n- 一\n- 二\n\n```ts\nconst x = "<img src=https://unsafe.test>"\n```\n\n> 引用\n\n|键|值|\n|---|---|\n|a|b|\n\n![图](https://unsafe.test/a)')
 assert.deepEqual(blocks.map(x=>x.kind),['heading','list','code','quote','table','source']);assert.deepEqual(blocks[1].items,['一','二']);assert.match(blocks[2].text,/<img/);assert.deepEqual(blocks[4].rows,[['键','值'],['a','b']]);assert.match(blocks[5].label,/超出支持子集/)
 assert.equal(scenarioMarkdownBlocks('```\nunclosed')[0].kind,'source');assert.throws(()=>scenarioMarkdownBlocks('x'.repeat(32001)),/超过/)
})
test('committed golden files are actual current exporter output with generator provenance',async()=>{
 const generated=exportScenarioRegression(fixture)
 for(const [file,value]of [['scenario.json',generated.scenarioJson],['scenario.test.mjs',generated.testSource],['README.md',generated.readme]])assert.equal(await readFile(new URL(file,fixtureRoot),'utf8'),value)
 const provenance=JSON.parse(await readFile(new URL('provenance.json',fixtureRoot),'utf8'));assert.equal(provenance.generatorSha256,createHash('sha256').update(await readFile(new URL('../console-ui/src/pages/scenario-lab/scenario-model.mjs',import.meta.url))).digest('hex'))
})

test('limited is accepted as an explicit expectation, without claiming execution against older Runtime',()=>{const scene=copy(fixture);scene.assertions={dispatchStatus:'limited',deliveries:[]};assert.equal(readScenario(scene).assertions.dispatchStatus,'limited');assert.match(exportScenarioRegression(scene).testSource,/assert.equal\(result\?\.status/)});
