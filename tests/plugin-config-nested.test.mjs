import test from 'node:test'
import assert from 'node:assert/strict'
import { declaredDefaults, unsupportedFormFields, updateObjectField, updateListItem, numericDraft, requiredGuidance, hostValidationSummary } from '../console-ui/src/components/PluginConfigForm/schema-model.mjs'
import { configSourceForPlugin, parseConfigDocument, configAtPath, replaceConfigAtPath } from '../console-ui/src/components/PluginConfigForm/source-model.mjs'
import { createConfigDraftGuard } from '../console-ui/src/components/PluginConfigForm/draft-guard.mjs'
const schema = { type:'object', object:{
  optional:{type:'object',object:{enabled:{type:'boolean',default:false}}},
  database:{type:'object',required:true,object:{connection:{type:'object',object:{port:{type:'number',default:0},password:{type:'string',secret:true,required:true}}}}},
  rules:{type:'list',inner:{type:'object',object:{label:{type:'string',required:true},enabled:{type:'boolean',default:false}}}},
} }

test('defaults preserve false/zero/null and unknown values, without inventing absent optional objects',()=>{
  const initial={database:{connection:{password:'${PG_PASSWORD}',unknown:'retain'}},rules:[{label:'a'}],extra:{keep:true}}
  const result=declaredDefaults(schema,initial)
  assert.equal(result.database.connection.port,0)
  assert.equal(result.rules[0].enabled,false)
  assert.equal(result.optional,undefined)
  assert.equal(result.extra.keep,true)
  assert.equal(result.database.connection.unknown,'retain')
  assert.equal(initial.database.connection.port,undefined)
  assert.equal(declaredDefaults({type:'string',default:'default'},null),null)
})
test('deep object and object-list updates preserve all siblings and literal field names',()=>{
  const initial={database:{connection:{password:'${KEY}',port:10},other:true},rules:[{label:'a',enabled:false},{label:'b'}]}
  const connection=updateObjectField(initial.database.connection,'port',12)
  const database=updateObjectField(initial.database,'connection',connection)
  const next=updateObjectField(initial,'database',database)
  next.rules=updateListItem(next.rules,1,updateObjectField(next.rules[1],'label','new'))
  assert.equal(next.database.connection.password,'${KEY}')
  assert.equal(next.database.other,true)
  assert.equal(next.rules[0].label,'a')
  assert.equal(initial.rules[1].label,'b')
  const literal=updateObjectField({},'a.b',3)
  assert.deepEqual(literal,{'a.b':3})
  assert.deepEqual(updateObjectField(literal,'a.b',undefined),{})
})
test('required guidance reports deep list/object omissions without pretending to validate schemas',()=>{
  assert.deepEqual(requiredGuidance(schema,{}),['$.database'])
  assert.deepEqual(requiredGuidance(schema,{database:{connection:{}},rules:[{}]}),['$.database.connection.password','$.rules[0].label'])
  assert.equal(numericDraft(''),undefined)
  assert.equal(numericDraft('0'),0)
  assert.equal(numericDraft('${PORT}'),'${PORT}')
  assert.equal(numericDraft('not-a-number'),'not-a-number')
  assert.match(hostValidationSummary({valid:true,missingEnv:['KEY']}),/环境变量/)
  assert.match(hostValidationSummary({valid:false,missingEnv:[]}),/Host 校验/)
})
test('unsupported structures block the entire form, including nested refs, dicts, tuples and unions',()=>{
  assert.deepEqual(unsupportedFormFields(schema),[])
  for(const field of [{$ref:'#/$defs/A'}, {type:'union',list:[{type:'string'}]}, {type:'tuple'}, {type:'dict',inner:{type:'string'}}, {type:'object',object:{},patternProperties:{}}]){
    const errors=unsupportedFormFields({type:'object',object:{supported:{type:'string'},unsupported:field}})
    assert.ok(errors.some(error=>error.includes('$.unsupported')))
  }
})
test('formal Host paths edit only the chosen plugin and preserve unknown config/source siblings',()=>{
  const source='# retain host guidance\nhttp:\n  port: 8090\nplugins:\n  "a/b":\n    nested: {old: true}\n  sibling:\n    keep: secret-reference\n'
  const result=configSourceForPlugin(source,'yaml',['plugins','a/b'],{nested:{updated:true},unknown:'keep'})
  assert.match(result,/# retain host guidance/)
  const parsed=parseConfigDocument(result,'yaml')
  assert.equal(parsed.http.port,8090)
  assert.equal(parsed.plugins.sibling.keep,'secret-reference')
  assert.equal(parsed.plugins['a/b'].unknown,'keep')
  assert.equal(configAtPath(parsed,['plugins','a/b']).nested.updated,true)
  assert.equal(configAtPath({plugins:{a:null}},['plugins','a']),null)
  assert.throws(()=>parseConfigDocument('null','yaml'),/键值对象/)
  assert.throws(()=>configSourceForPlugin(source,'yaml',undefined,{}),/路径/)
  assert.throws(()=>replaceConfigAtPath({plugins:'wrong'},['plugins','a'],{}),/父节点/)
  assert.throws(()=>replaceConfigAtPath({},['__proto__','polluted'],true),/路径/)
})
test('editing a YAML aliased plugin must not mutate its sibling configuration',()=>{
  const source='plugins:\n  a: &shared\n    plugins:\n      nested: {enabled: false}\n  b: *shared\n'
  const result=configSourceForPlugin(source,'yaml',['plugins','a','plugins','nested'],{enabled:true})
  const parsed=parseConfigDocument(result,'yaml')
  assert.equal(parsed.plugins.a.plugins.nested.enabled,true)
  assert.equal(parsed.plugins.b.plugins.nested.enabled,false)
})
test('dirty source/config drafts keep their bound revision after refresh until explicitly discarded',()=>{
  const guard=createConfigDraftGuard()
  const first={source:'old',revision:'r1',format:'yaml',configKeys:['a'],configPaths:{a:['plugins','a']}}
  const newer={...first,source:'new',revision:'r2'}
  assert.equal(guard.receive('a',{},first),true)
  guard.edited()
  assert.equal(guard.receive('a',{},newer),false)
  assert.equal(guard.snapshot.revision,'r1')
  guard.saved()
  assert.equal(guard.receive('a',{},newer),true)
  assert.equal(guard.snapshot.revision,'r2')
})
