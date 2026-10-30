import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import * as model from '../console-ui/src/pages/conversation-trace-model.mjs'
import { createDiagnosticRequestGate, diagnosticConversationKey } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'

const require = createRequire(import.meta.url)
const sources = Object.fromEntries(await Promise.all(['ConversationTrace', 'ConversationUsage', 'useConversationTraces'].map(async name => [name, await readFile(new URL(`../console-ui/src/pages/${name}.${name.startsWith('use') ? 'ts' : 'tsx'}`, import.meta.url), 'utf8')])))
const compile = (name, mocks) => {
  const module = { exports: {} }
  const code = ts.transpileModule(sources[name], { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require','exports','module',code)(key => isLocaleImport(key) ? localeModule : mocks[key] ?? require(key), module.exports, module)
  return module.exports
}
const conversation = { endpoint: { adapter: 'root/icqq', id: 'canonical-bot' }, kind: 'group', id: 'group-a' }
const session = 'icqq:alias:group:group-a'
const turn = { turn_id: 'turn-a', session_key: session, started_at: 1, model_calls: 1, tool_calls: 0, termination: { status: 'completed' }, origin: { conversation, messageId: 'msg' }, usage_calls: [{ prompt_tokens: 20, completion_tokens: 2, total_tokens: 22 }] }
const detail = { ...turn, model_calls: turn.usage_calls, tool_calls: [], subagents: [], requests: [{ request_id: 'request-a', index: 1, started_at: 1, status: 'completed', body_status: 'recorded' }] }
const wrap = data => ({ success: true, data })
const elements = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : []
const label = node => typeof node === 'string' ? node : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(label).join('') : ''

function runtime() {
  const slots = []; let cursor = 0, dirty = false, effects = [], render, value
  const same = (a,b) => a && b && a.length === b.length && a.every((v,i)=>Object.is(v,b[i]))
  const hooks = {
    useState(initial) { const i=cursor++; if (!(i in slots)) slots[i]=typeof initial==='function'?initial():initial; return [slots[i],next=>{ const result=typeof next==='function'?next(slots[i]):next; if (!Object.is(result,slots[i])) { slots[i]=result; dirty=true } }] },
    useRef(initial) { const i=cursor++;return slots[i]??(slots[i]={current:initial}) },
    useCallback(fn,deps) { const i=cursor++;if(!same(slots[i]?.deps,deps))slots[i]={fn,deps};return slots[i].fn },
    useEffect(fn,deps) { const i=cursor++;if(!same(slots[i]?.deps,deps)){const old=slots[i];slots[i]={deps,cleanup:old?.cleanup};effects.push(()=>{old?.cleanup?.();slots[i].cleanup=fn()})} },
  }
  return { hooks, mount(fn){render=fn;return this.render()}, render(flush=true){let count=0;do{assert.ok(++count<40);cursor=0;dirty=false;value=render();if(flush){const pending=effects;effects=[];pending.forEach(fn=>fn())}}while(flush&&dirty);return value}, async settle(){for(let i=0;i<16;i++){await Promise.resolve();if(dirty||effects.length)this.render()}return value}, unmount(){slots.forEach(slot=>slot?.cleanup?.());effects=[]},get value(){return value} }
}

function fixture(kind='list') {
  let connection={host:'https://host-a',credential:'fixture-a'},scopeId=0
  const authority=createInboxCacheAuthority(()=>connection,()=>`scope-${++scopeId}`)
  const hooks=runtime(),calls=[]
  const props={connectionScope:authority.current(),sessionKey:session,turnId:'turn-a',requestId:'request-a',conversation,turn}
  const mocks={
    react:{...require('react'),...hooks.hooks},
    '../utils/auth':{apiFetch:(url,options)=>new Promise((resolve,reject)=>calls.push({url,...options,resolve,reject}))},
    '../utils/inbox-cache':{getInboxCacheScope:()=>authority.current(),isInboxCacheScopeActive:scope=>authority.active(scope)},
    './endpoint-detail/message-diagnostics.mjs':{createDiagnosticRequestGate,diagnosticConversationKey},
    './conversation-trace-model.mjs':model,
    '../components/ui/button':{Button:'button'}, '../components/error-alert':{ErrorAlert:'error-alert'},
    '../components/ui/accordion':Object.fromEntries(['Accordion','AccordionContent','AccordionItem','AccordionTrigger'].map(key=>[key,key])),
    './ConversationUsage':{UsageSummary:'usage-summary',ContextUsage:'context-usage'},
  }
  const module=compile(kind==='list'?'useConversationTraces':'ConversationTrace',mocks)
  hooks.mount(()=>kind==='list'?module.useConversationTraces(props.sessionKey,props.connectionScope,props.conversation):kind==='request'?module.RequestDetails(props):module.TurnDetails(props))
  return {props,hooks,calls,authority,answer(index,data,status=200){calls[index].resolve({ok:status>=200&&status<300,status,json:async()=>data})},switchHost(){connection={...connection,host:'https://host-b'}},switchCredential(){connection={...connection,credential:'fixture-b'}},module}
}

test('summary reads are batched once per resolved physical conversation and never request bodies',async()=>{
  const f=fixture();assert.equal(f.calls.length,1)
  assert.match(f.calls[0].url,/\/turns\?/);assert.equal(f.calls[0].cache,'no-store')
  assert.deepEqual(JSON.parse(new URL(f.calls[0].url,'https://fixture').searchParams.get('conversation')),conversation)
  f.answer(0,wrap([turn]));await f.hooks.settle();assert.equal(f.hooks.value.turns.length,1)
  for(let i=0;i<3;i++)f.hooks.render()
  assert.equal(f.calls.length,1)
  f.hooks.unmount()
})

test('a successful explicit refresh invalidates open detail snapshots; a failed refresh retains the prior revision',async()=>{
  const f=fixture();f.answer(0,wrap([turn]));await f.hooks.settle();assert.equal(f.hooks.value.revision,1)
  f.hooks.value.refresh();f.answer(1,{},500);await f.hooks.settle();assert.equal(f.hooks.value.revision,1)
  assert.equal(f.hooks.value.turns.length,1)
  f.hooks.value.refresh();f.answer(2,wrap([turn]));await f.hooks.settle();assert.equal(f.hooks.value.revision,2)
  f.hooks.unmount()
})

test('no trace query is issued before the history resolves a canonical conversation',()=>{
  const f=fixture();f.props.conversation=undefined;f.hooks.render()
  assert.equal(f.calls[0].signal.aborted,true);assert.equal(f.calls.length,1);assert.equal(f.hooks.value.turns.length,0)
  f.hooks.unmount()
})

for(const change of ['switchHost','switchCredential'])test(`summary data and stale callbacks are invalid after ${change}`,async()=>{
  const f=fixture();f.answer(0,wrap([turn]));await f.hooks.settle()
  const staleRefresh=f.hooks.value.refresh;staleRefresh()
  f[change]();assert.deepEqual(f.hooks.render(false).turns,[])
  const count=f.calls.length;staleRefresh();assert.equal(f.calls.length,count)
  f.props.connectionScope=f.authority.current();f.hooks.render();assert.equal(f.calls[1].signal.aborted,true)
  f.answer(1,wrap([{...turn,turn_id:'late-private-turn'}]));f.answer(2,wrap([turn]));await f.hooks.settle()
  assert.equal(f.hooks.value.turns[0].turn_id,'turn-a');f.hooks.unmount()
})

test('turn selection loads metadata only; request bodies are separate, scoped, and abort on unmount',async()=>{
  const f=fixture('turn');assert.match(f.calls[0].url,/\/turn\?/)
  f.answer(0,wrap(detail));await f.hooks.settle();assert.equal(f.calls.length,1)
  assert.ok(elements(f.hooks.value).some(node=>typeof node.type==='function'&&node.type.name==='TurnRequests'))
  f.hooks.unmount()
  const request=fixture('request');assert.match(request.calls[0].url,/\/request\?/)
  request.hooks.unmount();assert.equal(request.calls[0].signal.aborted,true)
})

test('request body from another identity never settles and retry stays attached to the original request',async()=>{
  const f=fixture('request')
  f.answer(0,{},503);await f.hooks.settle()
  const error=elements(f.hooks.value).find(node=>node.type==='error-alert');assert.ok(error)
  error.props.onRetry();f.hooks.render();assert.equal(f.calls[0].url,f.calls[1].url)
  f.switchCredential();assert.equal(f.hooks.render(false),null)
  f.props.connectionScope=f.authority.current();f.hooks.render();assert.equal(f.calls[1].signal.aborted,true)
  const response=wrap({session_key:session,turn_id:'turn-a',request:{...detail.requests[0],body:{system:'PRIVATE_OLD_BODY',messages:[],tools:[]}}})
  f.answer(1,response);f.answer(2,{...response,data:{...response.data,request:{...response.data.request,body:{system:'CURRENT_BODY',messages:[],tools:[]}}}})
  await f.hooks.settle()
  const body=elements(f.hooks.value).find(node=>typeof node.type==='function'&&node.type.name==='RequestBody')
  assert.equal(body.props.request.body.system,'CURRENT_BODY');f.hooks.unmount()
})

test('prompt sections render complete escaped text and ordered message roles, without loading omitted media',()=>{
  const simple=({children})=>require('react').createElement('section',null,children)
  const module=compile('ConversationTrace',{
    '../utils/auth':{},'../utils/inbox-cache':{},'./conversation-trace-model.mjs':model,
    '../components/ui/button':{Button:simple},'../components/error-alert':{ErrorAlert:simple},'./ConversationUsage':{UsageSummary:simple,ContextUsage:simple},
    '../components/ui/accordion':Object.fromEntries(['Accordion','AccordionContent','AccordionItem','AccordionTrigger'].map(key=>[key,simple])),
  })
  const long='  <script>danger()</script>\n'+'complete '.repeat(2000)+'END\n'
  const html=renderToStaticMarkup(require('react').createElement(module.RequestBody,{request:{...detail.requests[0],body:{system:long,tools:[{name:'tool',input_schema:{type:'object'}}],messages:[{role:'user',content:'first'},{role:'assistant',content:'second'},{role:'tool',content:[{type:'image',omitted:'media'}]}]}}}))
  assert.ok(html.includes('END\n'));assert.ok(html.includes('&lt;script&gt;'));assert.ok(!html.includes('<script>'))
  assert.ok(html.indexOf('first')<html.indexOf('second'));assert.ok(html.includes('omitted'));assert.ok(!html.includes('<img'))
})

test('usage summary distinguishes total, cached and non-cached input without inventing unknown usage', () => {
  const simple = ({ children }) => children
  const { UsageSummary } = compile('ConversationUsage', {
    './conversation-trace-model.mjs': model,
    '../components/ui/button': { Button: simple },
    '../components/ui/popover': { Popover: simple, PopoverContent: simple, PopoverTrigger: simple },
  })
  const render = calls => renderToStaticMarkup(require('react').createElement(UsageSummary, { turns: [{ usage_calls: calls }] }))
  const html = render([{ prompt_tokens: 13184, cache_read_tokens: 11083, completion_tokens: 54 }])
  assert.match(html, /总输入<\/dt><dd>13,184/)
  assert.match(html, /非缓存输入<\/dt><dd>2,101/)
  assert.match(html, /缓存读取<\/dt><dd>11,083/)
  assert.match(render([{ prompt_tokens: 13184 }]), /非缓存输入<\/dt><dd>—/)
})
