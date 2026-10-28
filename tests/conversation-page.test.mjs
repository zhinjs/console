import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import { readRecentSessions } from '../console-ui/src/pages/agent-session-recent.mjs'

const require = createRequire(import.meta.url)
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
function compile(source, mocks = {}) {
  const module = { exports: {} }, code = ts.transpileModule(source, { compilerOptions: options }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : require(name), module.exports, module)
  return module.exports
}
const source = await readFile(new URL('../console-ui/src/pages/agent-sessions.tsx', import.meta.url), 'utf8')
const sessions = compile(await readFile(new URL('../console-ui/src/utils/agent-session.ts', import.meta.url), 'utf8'))
const elements = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : []
// Radix Dialog does not mount its content while closed.
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? node.type === 'Dialog' && !node.props.open ? '' : [node.props?.children].flat(Infinity).map(text).join('') : ''
const settle = () => new Promise(resolve => setImmediate(resolve))
function fixture() {
  const slots = [], calls = []; let cursor = 0, effects = [], scope = 'scope-a', params = new URLSearchParams({ sessionKey: 'icqq:bot:group:room' }), tree
  const same = (a,b) => a && a.length === b.length && a.every((value,index) => Object.is(value,b[index]))
  const hooks = {
    useState(initial) { const index=cursor++; if (!(index in slots)) slots[index]=typeof initial==='function'?initial():initial; return [slots[index], value=>{ slots[index]=typeof value==='function'?value(slots[index]):value }] },
    useRef(initial) { const index=cursor++; return slots[index]??(slots[index]={current:initial}) },
    useCallback(fn,deps) { const index=cursor++; if (!same(slots[index]?.deps,deps)) slots[index]={fn,deps}; return slots[index].fn },
    useEffect(fn,deps) { const index=cursor++; if (!same(slots[index]?.deps,deps)) { slots[index]?.cleanup?.(); slots[index]={deps}; effects.push(()=>{slots[index].cleanup=fn()}) } },
  }
  const ui = Object.fromEntries(['Dialog','DialogContent','DialogHeader','DialogFooter','DialogTitle','DialogDescription','DialogClose'].map(name=>[name,name]))
  const module = compile(source, {
    react: hooks,
    'react-router-dom': { useSearchParams: () => [params, next=>{params=next}] },
    '../utils/agent-session': sessions,
    '../utils/agent-session-history': {loadAgentSessionHistory:()=>[],pushAgentSessionHistory:key=>[key]},
    '../utils/useInboxCacheScope':{useInboxCacheScope:()=>scope},
    '../utils/inbox-cache':{isInboxCacheScopeActive:expected=>expected===scope},
    '../utils/auth':{apiFetch:(url,init={})=>new Promise(resolve=>calls.push({url,init,resolve}))},
    '../components/PageHeader':{PageHeader:'page-header'}, '../components/error-alert':{ErrorAlert:'error-alert'},
    '../components/empty-state':{EmptyState:'empty-state'}, '../components/ui/alert':{Alert:'alert',AlertDescription:'alert-description'},
    '../components/ui/badge':{Badge:'badge'}, '../components/ui/button':{Button:'button'}, '../components/ui/skeleton':{Skeleton:'skeleton'},
    '../components/ui/tabs':{Tabs:'tabs',TabsList:'tabs-list',TabsTrigger:'tabs-trigger',TabsContent:'tabs-content'},
    '../components/ui/dialog':ui, '../components/AgentSessionPicker':{AgentSessionPicker:'session-picker'},
    './SessionMessageDetails':{SessionMessageDetails:'message-details'}, './ConversationHistory':{ConversationHistory:'conversation-history'},
    '@zhin.js/client':{cn:(...parts)=>parts.filter(Boolean).join(' ')}, '../contracts/zhin-console':{CONSOLE_REST:{AGENT_SESSIONS:'/api/agent/sessions'}},
    '../utils/demo-mode':{isDemoMode:()=>false}, './agent-session-recent.mjs':{readRecentSessions},
  })
  const f = {calls,render(){cursor=0;tree=module.default(); const run=effects;effects=[];run.forEach(fn=>fn());return tree},get tree(){return tree},setScope(value){scope=value},navigate(key){params=new URLSearchParams({sessionKey:key})},close(){slots.forEach(slot=>slot?.cleanup?.())}}
  f.render();return f
}
const find=(f,type)=>elements(f.tree).find(node=>node.type===type)
const answerTree=(call,key='icqq:bot:group:room')=>call.resolve({status:200,ok:true,json:async()=>({success:true,data:{sessionKey:key,sessionId:'sid',activeLeafMessageId:null,points:[{index:1,messageId:7,preview:'FULL BRANCH PREVIEW',parentMessageId:null,activePath:true}]}})})

test('default history reads the physical conversation without loading Agent branch data',()=>{
  const f=fixture();f.render()
  assert.equal(find(f,'tabs').props.value,'conversation')
  assert.equal(find(f,'conversation-history').props.sessionKey,'icqq:bot:group:room')
  assert.equal(find(f,'conversation-history').props.connectionScope,'scope-a')
  assert.ok(!f.calls.some(call=>call.url.endsWith('/tree')||call.init.method==='POST'))
  f.close()
})

test('reading branch details has no write action; only the separate confirmed button switches the branch',async()=>{
  const f=fixture(); find(f,'tabs').props.onValueChange('branches');f.render()
  const call=f.calls.find(call=>call.url.endsWith('/tree'));assert.ok(call);answerTree(call);await settle();f.render()
  const preview=elements(f.tree).find(node=>node.type==='p'&&text(node)==='FULL BRANCH PREVIEW')
  assert.ok(preview);assert.equal(preview.props.onClick,undefined)
  assert.equal(find(f,'Dialog').props.open,false)
  const continueButton=elements(f.tree).find(node=>node.type==='button'&&text(node)==='从这里继续')
  assert.ok(continueButton);continueButton.props.onClick();f.render()
  assert.equal(find(f,'Dialog').props.open,true)
  assert.ok(!f.calls.some(call=>call.init.method==='POST'))
  const confirm=elements(f.tree).find(node=>node.type==='button'&&text(node)==='确认切换')
  confirm.props.onClick();assert.equal(f.calls.filter(call=>call.init.method==='POST').length,1)
  assert.deepEqual(JSON.parse(f.calls.at(-1).init.body),{messageId:7});f.close()
})

test('selecting another conversation retains the complete URL key and clears old branch context',()=>{
  const f=fixture();const picker=find(f,'session-picker'), key='icqq:bot:channel:room:literal%2Fid'
  picker.props.onChange(key);picker.props.onLoad(key);f.render();f.render()
  assert.equal(find(f,'conversation-history').props.sessionKey,key)
  assert.equal(find(f,'Dialog').props.open,false)
  assert.ok(!f.calls.some(call=>call.init.method==='POST'));f.close()
})

test('Host or credential change invalidates pending branch data before it can reach the current view',async()=>{
  const f=fixture();find(f,'tabs').props.onValueChange('branches');f.render()
  const old=f.calls.find(call=>call.url.endsWith('/tree'));f.setScope('scope-b');f.render();f.render()
  answerTree(old);await settle();f.render()
  assert.ok(!text(f.tree).includes('FULL BRANCH PREVIEW'))
  assert.equal(find(f,'conversation-history').props.connectionScope,'scope-b');f.close()
})

test('recent directories belong to the producing connection even before reset effects run', async()=>{
  const f=fixture(), recent=f.calls.find(call=>call.url.endsWith('/trace-archive/sessions'))
  recent.resolve({ok:true,json:async()=>({success:true,data:[{session_key:'icqq:bot:group:A-PRIVATE-DIRECTORY',turns:3,last_started_at:1,last_status:'completed'}]})})
  await settle();f.render();assert.equal(find(f,'session-picker').props.recent.length,1)
  f.setScope('scope-b');f.render()
  assert.equal(find(f,'session-picker').props.recent,null)
  f.close()
})

test('direct URL navigation cannot render a previous conversation branch or its open confirmation',async()=>{
  const f=fixture();find(f,'tabs').props.onValueChange('branches');f.render()
  answerTree(f.calls.find(call=>call.url.endsWith('/tree')));await settle();f.render()
  const action=elements(f.tree).find(node=>node.type==='button'&&text(node)==='从这里继续')
  action.props.onClick();f.render();assert.equal(find(f,'Dialog').props.open,true)
  f.navigate('icqq:bot:group:another-room');f.render()
  assert.ok(!text(f.tree).includes('FULL BRANCH PREVIEW'))
  assert.equal(find(f,'Dialog').props.open,false)
  assert.equal(find(f,'conversation-history').props.sessionKey,'icqq:bot:group:another-room')
  assert.ok(!f.calls.some(call=>call.init.method==='POST'));f.close()
})

test('invalid URL identities show a validation error without requesting either history source',()=>{
  const f=fixture();f.navigate('invalid-key');f.render();f.render()
  assert.ok(find(f,'error-alert').props.error.includes('会话标识不完整'))
  assert.equal(find(f,'conversation-history'),undefined)
  assert.ok(!f.calls.some(call=>call.url.endsWith('/tree')||call.init.method==='POST'));f.close()
})

test('branch errors belong to their producing Host and URL before reset effects run',async()=>{
  for (const change of ['scope','url']) {
    const f=fixture();find(f,'tabs').props.onValueChange('branches');f.render()
    const request=f.calls.find(call=>call.url.endsWith('/tree'))
    request.resolve({status:404,ok:false,json:async()=>({success:false,error:'PRIVATE_A_ERROR'})})
    await settle();f.render();assert.equal(find(f,'error-alert').props.error,'PRIVATE_A_ERROR')
    if (change==='scope') f.setScope('scope-b'); else f.navigate('icqq:bot:group:room-b')
    f.render();assert.equal(find(f,'error-alert'),undefined);f.close()
  }
})
