import * as ambientModel from '../console-ui/src/pages/ambient-engagement-model.mjs'
import { configurationReceiptForRead } from '../console-ui/src/components/PluginConfigForm/config-live-status.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as envEditorModel from '../console-ui/src/pages/env-editor-model.mjs'
import { createDiagnosticRequestGate } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'
import { readTaskProviders, readTaskUseCases, reconcileTaskMutation } from '../console-ui/src/pages/task-center-model.mjs'
import * as taskModel from '../console-ui/src/pages/task-center-model.mjs'
import * as schemaModel from '../console-ui/src/components/PluginConfigForm/schema-model.mjs'
import { createConfigDraftGuard } from '../console-ui/src/components/PluginConfigForm/draft-guard.mjs'
import { readMessageHistory, mergeHistoryRows } from '../console-ui/src/pages/endpoint-detail/inbox-history-model.mjs'
import * as composerDraftModel from '../console-ui/src/pages/endpoint-detail/composer-draft-model.mjs'

import { permissionRequest, readPermissionCatalog, readPermissionExplanation, permissionHttpError } from '../console-ui/src/pages/permission-explanation-model.mjs'
import * as permissionLinkModel from '../console-ui/src/pages/permission-link-model.mjs'

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

// Keep production JSX event handlers and render expressions intact; inert children expose their
// props so the test can type into the actual editor and inspect the resulting error message.
const element = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
const elements = node => !node || typeof node !== 'object' ? [] : [node, ...(node.children ?? []).flatMap(elements)]
async function componentFunctions(file, names, bindings) {
  const source = await readFile(new URL(`../console-ui/src/${file}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const code = names.map(name => {
    const node = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name)
    assert.ok(node, name); return node.getText(ast).replace(/^export /, '')
  }).join('\n')
  const compiled = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return Function('React', ...Object.keys(bindings), `${compiled}; return ${names[0]}`)({ createElement: element }, ...Object.values(bindings))
}

test('ambient same-file refresh replaces an earlier saved application receipt', async () => {
  const runtime = hooks(); let epoch = 1
  const evidence = (id, status) => ({ application: { operationId: id, sourceRevision: 'r1', saved: true, generation: 2, applicationRevision: 1,
    groups: [{ id: 'root', paths: [['root']], effect: 'reload-plugin', status, dependsOn: [] }] } })
  let initial = { revision: 'r1', readEpoch: epoch, settings: { behavior: 'off', groupScope: 'all', groups: [], maxPerHour: 6 }, application: evidence('op1', 'applied') }
  const Component = await componentFunctions('pages/ambient-engagement.tsx', ['AmbientSettingsForm'], {
    ...runtime.api, ...ambientModel, configurationReceiptForRead, useI18n: () => messages('zh-CN'), useInboxCacheScope: () => 'scope', isInboxCacheScopeActive: () => true,
    requestConsole: async () => ({ status: 'saved', revision: 'r1', ...evidence('op2', 'applied') }),
    Card: 'Card', CardHeader: 'CardHeader', CardTitle: 'CardTitle', CardContent: 'CardContent', RadioGroup: 'RadioGroup', RadioGroupItem: 'RadioGroupItem',
    Input: 'Input', Textarea: 'Textarea', Button: 'Button', ApplyFeedback: 'ApplyFeedback', ConfigurationLiveStatus: 'ConfigurationLiveStatus',
  })
  const onReload = async () => { initial = { ...initial, readEpoch: ++epoch, application: evidence('op2', 'applied') }; return initial }
  runtime.mount(() => Component({ initial, onReload, currentReadEpoch: () => epoch }))
  const save = elements(runtime.value).find(node => node.type === 'Button')
  assert.equal(save.props.disabled, false, 'Ambient supports a real no-op save')
  save.props.onClick(); await runtime.settle()
  initial = { ...initial, readEpoch: ++epoch, application: evidence('op3', 'restart-pending') }; runtime.render()
  const shown = elements(runtime.value).find(node => node.type === 'ConfigurationLiveStatus').props
  assert.equal(shown.result.application.operationId, 'op3')
  assert.equal(shown.result.application.groups[0].status, 'restart-pending')
})

test('JSON field and dictionary errors follow the interface language while invalid drafts stay intact', async () => {
  for (const name of ['JsonValueEditor', 'ObjectValueEditor']) {
    const runtime = hooks(); let locale = messages('zh-CN'); const writes = [], validity = []
    const Component = await componentFunctions('components/PluginConfigForm/SchemaFieldEditor.tsx', [name, 'sameValue', 'jsonText'], {
      ...runtime.api, ...schemaModel, useId: () => ':fixture:', useI18n: () => locale,
      CodeEditor: 'CodeEditor', Input: 'Input', Button: 'Button', SchemaFieldEditor: 'SchemaFieldEditor',
    })
    const props = { name: 'data', field: name === 'JsonValueEditor' ? { type: 'any' } : { type: 'dict', inner: { type: 'string' } }, value: {},
      onChange: value => writes.push(value), drafts: { json: new Map() }, onValidityChange: (_path, invalid) => validity.push(invalid) }
    runtime.mount(() => Component(props))
    if (name === 'JsonValueEditor') elements(runtime.value).find(node => node.type === 'CodeEditor').props.onChange('{')
    else elements(runtime.value).find(node => node.type === 'Button').props.onClick()
    runtime.render()
    const original = elements(runtime.value).find(node => node.props.role === 'alert').children.join('')
    locale = messages('en'); runtime.render()
    assert.equal(elements(runtime.value).find(node => node.props.role === 'alert').children.join(''), translate('en', original))
    assert.equal(writes.length, 0)
    if (name === 'JsonValueEditor') {
      assert.equal(props.drafts.json.get('$').text, '{'); assert.equal(validity.at(-1), true)
      assert.equal(elements(runtime.value).find(node => node.type === 'CodeEditor').props.invalid, true)
    }
    locale = messages('zh-CN'); runtime.render()
    assert.equal(elements(runtime.value).find(node => node.props.role === 'alert').children.join(''), original)
  }
})

test('task review display follows refreshed locale while mutation identity and drafts stay pinned', async () => {
  const runtime = hooks(); let locale = messages('zh-CN'); const scope = 'task-fixture'; const requests = []
  const fixture = JSON.parse(await readFile(new URL('./fixtures/task-providers.json', import.meta.url), 'utf8'))
  let revision = fixture.data.providers[0].revision
  const Component = await lifecycle('pages/task-center.tsx', 'TaskCenterPage', '  return <div',
    'chooseProvider, setParameters, parameters, base, review, reviewTitle, reviewEffects, prepareCreateOrUpdate, refresh, mutationEpoch', {
      ...runtime.api, ...taskModel, useI18n: () => locale, useInboxCacheScope: () => scope, createDiagnosticRequestGate,
      getInboxCacheScope: () => scope, isInboxCacheScopeActive: value => value === scope,
      emptyTarget: { kind: 'private', id: '', parentKind: '', parentId: '', threadId: '' }, savedPending: () => null, isDemoMode: () => false,
      window: { addEventListener() {}, removeEventListener() {} }, CONSOLE_REST: { TASK_PROVIDERS: '/providers', TASK_USE_CASES: '/use-cases' },
      buildPreviewTarget: () => ({ endpoint: { adapter: 'memory', id: 'fixture' }, kind: 'group', id: 'room', threadId: 'topic' }),
      apiFetch: async path => {
        requests.push(path); const data = structuredClone(fixture); data.data.providers[0].revision = revision
        if (path.includes('locale=en')) Object.assign(data.data.providers[0], { title: 'Administrator reminders', effects: ['This task sends a reminder at the scheduled time.'] })
        return { ok: true, json: async () => path.includes('use-cases') ? { success: true, data: [] } : data }
      },
    })
  runtime.mount(() => Component()); await runtime.settle(); runtime.value.chooseProvider('root/reminder'); runtime.render()
  runtime.value.setParameters({ text: '用户原文', at: '2027-01-15T08:01:00.000Z' }); runtime.render()
  runtime.value.prepareCreateOrUpdate(); runtime.render()
  const mutation = structuredClone(runtime.value.review.body), epoch = runtime.value.mutationEpoch.current, base = runtime.value.base
  locale = messages('en'); runtime.render(); await runtime.settle()
  assert.equal(runtime.value.reviewTitle, 'Confirm administrator task creation')
  assert.deepEqual(runtime.value.reviewEffects, ['This task sends a reminder at the scheduled time.'])
  assert.deepEqual(runtime.value.review.body, mutation); assert.strictEqual(runtime.value.base, base)
  assert.equal(runtime.value.mutationEpoch.current, epoch); assert.equal(runtime.value.parameters.text, '用户原文')
  runtime.value.prepareCreateOrUpdate(); runtime.render()
  assert.deepEqual(runtime.value.review.effects, ['This task sends a reminder at the scheduled time.'])
  const secondMutation = structuredClone(runtime.value.review.body)
  revision = 'new-unapproved-revision'; locale = messages('zh-CN'); runtime.render(); await runtime.settle()
  assert.deepEqual(runtime.value.reviewEffects, ['This task sends a reminder at the scheduled time.'], 'a different revision cannot silently replace reviewed effects')
  assert.deepEqual(runtime.value.review.body, secondMutation)
  assert.ok(requests.every(path => path.startsWith('/providers?locale=') || path.startsWith('/use-cases?locale=')))
})

test('switching language preserves loaded chat history pages and composer without another history read', async () => {
  const runtime = hooks(); let locale = messages('zh-CN'); const requests = []
  const rows = Array.from({ length: 100 }, (_, i) => ({ id: i + 1, platformMessageId: `fixture-${i + 1}`, timestamp: 1000 + i,
    sender: { id: 'fixture' }, channel: { id: 'room', type: 'group' }, content: `user original ${i + 1}` }))
  const Component = await lifecycle('pages/endpoint-detail/useMessageHistory.ts', 'useMessageHistory', '  // A bounded event-history gap',
    'inboxMessages, loadInboxMessages, setMsgContent, msgContent, inboxMessagesError', {
      ...runtime.api, ...composerDraftModel, useI18n: () => locale, useInboxCacheScope: () => 'fixture', isInboxCacheScopeActive: () => true,
      useToast: () => ({ error() {} }), toRpcChannelParent: () => undefined, readMessageHistory, mergeHistoryRows, INBOX_RPC: { MESSAGES: 'fixture' },
      requestConsole: async request => { requests.push(request); return { inboxEnabled: true, messages: request.beforeTs === undefined ? rows.slice(50) : rows.slice(0, 50) } },
    })
  const params = { adapter: 'fixture', endpointId: 'fixture', selection: { type: 'channel', channelType: 'group', id: 'room' } }
  runtime.mount(() => Component(params)); await runtime.settle(); await runtime.value.loadInboxMessages(1050); await runtime.settle()
  runtime.value.setMsgContent('未发送草稿'); runtime.render()
  const history = runtime.value.inboxMessages, load = runtime.value.loadInboxMessages
  locale = messages('en'); runtime.render(); await runtime.settle()
  assert.strictEqual(runtime.value.inboxMessages, history); assert.equal(history.length, 100)
  assert.strictEqual(runtime.value.loadInboxMessages, load); assert.equal(requests.length, 2); assert.equal(runtime.value.msgContent, '未发送草稿')
  locale = messages('zh-CN'); runtime.render(); await runtime.settle()
  assert.strictEqual(runtime.value.inboxMessages, history); assert.equal(requests.length, 2)
})
for(const [file,name,prop,reader] of [['pages/files/file-editor.tsx','FileEditor','filePath','readFile'],['pages/env.tsx','EnvFileEditor','filename','getFile']]){
 test(`${name}: changing locale preserves an edited draft without a reload or extra write`,async()=>{
  const runtime=hooks();let locale=messages('zh-CN'),reads=0,writes=0;const drafts=[]
  const component=await lifecycle(file,name,'  if (loading', 'content, originalContent, setContent, loadContent',{
   ...runtime.api,useI18n:()=>locale,readErrorSummary:String,...envEditorModel,window:{addEventListener(){},removeEventListener(){}},
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
  ...permissionLinkModel, useSearchParams:()=>[new URLSearchParams(),()=>{}],
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


test('skills status language refresh keeps its reader identity and uses the current language only on explicit refresh', async () => {
  const runtime = hooks(); let locale = messages('zh-CN'); const reads = []
  const Component = await componentFunctions('pages/skills-assistant.tsx', ['SkillsAssistantSession'], {
    ...runtime.api, useI18n: () => locale,
    readSkillsStatus: async value => { reads.push(value); return null },
    useConsoleRead: read => {
      runtime.api.useEffect(() => { void read() }, [read])
      return { refresh: read, loading: false }
    },
    PageShell: 'PageShell', PageHeader: 'PageHeader', Button: 'Button', Link: 'Link', RefreshCw: 'RefreshCw', SkillsStatusSection: 'SkillsStatusSection',
  })
  runtime.mount(() => Component()); await runtime.settle()
  assert.deepEqual(reads, ['zh-CN'])
  const first = elements(runtime.value).find(node => node.type === 'SkillsStatusSection').props.onRetry
  locale = messages('en'); runtime.render(); await runtime.settle()
  assert.deepEqual(reads, ['zh-CN'], 'locale changes do not trigger reads or graph mutations')
  const link = elements(runtime.value).find(node => node.type === 'Link')
  assert.equal(link.props.to, '/agent/models')
  assert.equal(link.children.join(''), 'Manage model purposes')
  const header = elements(runtime.value).find(node => node.type === 'PageHeader')
  await header.props.actions.props.onClick(); await runtime.settle()
  assert.deepEqual(reads, ['zh-CN', 'en'])
  assert.equal(typeof first, 'function')
})
