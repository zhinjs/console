import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { defaultI18n } from './locale-fixture.mjs'
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
test('projected complex AST is supported; unprojected reference structures remain explicitly recognizable',()=>{
  assert.deepEqual(unsupportedFormFields(schema),[])
  for(const field of [{$ref:'#/$defs/A'}, {type:'object',object:{},patternProperties:{}}]){
    const errors=unsupportedFormFields({type:'object',object:{supported:{type:'string'},unsupported:field}})
    assert.ok(errors.some(error=>error.includes('$.unsupported')))
  }
  for (const field of [{type:'union',list:[{type:'string'}]}, {type:'tuple',list:[{type:'null'}],inner:false}, {type:'dict',inner:{type:'string'}}, {type:'intersect',list:[{type:'object',object:{}}]}, {type:'any'}]) assert.deepEqual(unsupportedFormFields(field),[])
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

test('restoring defaults deletes only the selected override in JSON and YAML while preserving explicit null', () => {
  const original = { menuKeyword: 'custom', sibling: { nullable: null, keep: true } }
  const replaced = replaceConfigAtPath(original, ['menuKeyword'], undefined)
  assert.equal(Object.hasOwn(replaced, 'menuKeyword'), false)
  assert.deepEqual(replaced.sibling, original.sibling)
  assert.equal(original.menuKeyword, 'custom')
  for (const [format, source] of [
    ['json', JSON.stringify(original)],
    ['yaml', '# keep sibling guidance\nsibling:\n  nullable: null\n  keep: true\nmenuKeyword: custom\n'],
  ]) {
    const restored = configSourceForPlugin(source, format, ['menuKeyword'], undefined)
    const parsed = parseConfigDocument(restored, format)
    assert.equal(Object.hasOwn(parsed, 'menuKeyword'), false)
    assert.deepEqual(parsed.sibling, original.sibling)
    if (format === 'yaml') assert.match(restored, /# keep sibling guidance/)
    const nullable = parseConfigDocument(configSourceForPlugin(source, format, ['menuKeyword'], null), format)
    assert.equal(Object.hasOwn(nullable, 'menuKeyword'), true)
    assert.equal(nullable.menuKeyword, null)
  }
})

test('removing a nested alias override detaches only its path and missing removal creates no parents', () => {
  const source = 'plugins:\n  a: &shared\n    nested:\n      enabled: false\n      keep: true\n  b: *shared\n'
  const restored = parseConfigDocument(configSourceForPlugin(source, 'yaml', ['plugins', 'a', 'nested', 'enabled'], undefined), 'yaml')
  assert.equal(Object.hasOwn(restored.plugins.a.nested, 'enabled'), false)
  assert.equal(restored.plugins.a.nested.keep, true)
  assert.equal(restored.plugins.b.nested.enabled, false)
  assert.equal(restored.plugins.b.nested.keep, true)
  assert.deepEqual(replaceConfigAtPath({ sibling: true }, ['missing', 'nested', 'key'], undefined), { sibling: true })
  for (const [format, input] of [['json', '{"sibling":true}'], ['yaml', 'sibling: true\n']]) {
    assert.deepEqual(parseConfigDocument(configSourceForPlugin(input, format, ['missing', 'nested', 'key'], undefined), format), { sibling: true })
  }
})


test('schema-driven scalar edits retain the original revision and the actual bound-save callback rejects a stale CAS', async () => {
  const scope = 'scalar-test-scope'
  const baseline = {source: '{"log_level":"info","plugin":{"one":1}}', format: 'json', revision: 'a', configKeys: ['log_level'], connectionScope: scope}
  const refreshed = {...baseline, source: '{"log_level":"warn","plugin":{"one":1,"otherClient":2}}', revision: 'b'}
  const guard = createConfigDraftGuard()
  assert.equal(guard.receive('log_level', 'info', baseline), true)
  guard.edited()
  assert.equal(guard.receive('log_level', 'warn', refreshed), false)
  const next = configSourceForPlugin(guard.snapshot.source, guard.snapshot.format, ['log_level'], 'debug')
  assert.equal(guard.snapshot.revision, 'a')
  assert.deepEqual(JSON.parse(next), {log_level: 'debug', plugin: {one: 1}})

  // Execute the active hook's callback so the regression pins the real RPC CAS
  // payload rather than the removed full-file editor's draft helper.
  const source = await readFile(new URL('../console-ui/src/hooks/useConfigSource.ts', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('useConfigSource.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS)
  let callback
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'saveBound' && ts.isCallExpression(node.initializer)) callback = node.initializer.arguments[0]
    ts.forEachChild(node, visit)
  }
  visit(ast)
  assert.ok(callback, 'the active source hook retains a bound save callback')
  const compiled = ts.transpileModule(`const saveBound = ${callback.getText(ast)};`, {compilerOptions: {target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext}}).outputText
  const calls = [], actions = [], loading = [], errorScopes = []
  let persisted = refreshed.source
  const bindings = {
    messages: {current: defaultI18n}, scope,
    isInboxCacheScopeActive: candidate => candidate === scope,
    operations: {current: {begin: () => ({current: () => true})}},
    setFeedbackScope() {}, setLoading: value => loading.push(value), errorAction: action => actions.push(action.type),
    setSaveErrorScope: value => errorScopes.push(value),
    setConfig: () => assert.fail('a rejected CAS cannot replace the active snapshot'),
    requestConsole: async input => {
      calls.push(input)
      if (input.expectedRevision !== refreshed.revision) throw Error('CAS conflict')
      persisted = input.source
      return {success: true, revision: 'c', restartRequired: false}
    },
  }
  const saveBound = Function(...Object.keys(bindings), `${compiled}; return saveBound;`)(...Object.values(bindings))
  await assert.rejects(saveBound(next, guard.snapshot), /CAS conflict/)
  assert.deepEqual(calls, [{type: 'config:replace-source', source: next, expectedRevision: 'a'}])
  assert.equal(persisted, refreshed.source)
  assert.deepEqual(actions, ['save-start', 'save-failed'])
  assert.deepEqual(errorScopes, [scope])
  assert.deepEqual(loading, [true, false])
  assert.equal(guard.snapshot.revision, 'a')
  assert.equal(guard.dirty, true)
})
