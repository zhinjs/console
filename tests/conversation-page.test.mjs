import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import * as personalModels from '../console-ui/src/pages/personal-session-model.mjs'
import * as httpPermission from '../console-ui/src/utils/http-permission.mjs'
import * as sessionsDescription from '../console-ui/src/pages/agent-sessions-description.mjs'
import * as accessModel from '../console-ui/src/pages/access/access-model.mjs'
import { readRecentSessions, sessionsNeedingGroupNames, summarizeRecentSessions, withGroupNames } from '../console-ui/src/pages/agent-session-recent.mjs'
import * as recordsModel from '../console-ui/src/pages/scope/records-model.mjs'
import * as scopeTree from '../console-ui/src/scope/scope-tree.mjs'
import * as scopeFilter from '../console-ui/src/pages/insights/scope-filter.mjs'
import * as sessionLabels from '../console-ui/src/utils/session-label.mjs'
import * as consoleProtocol from '@zhin.js/console-protocol'

const require = createRequire(import.meta.url)
const options = { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
function compile(source, mocks = {}) {
  const module = { exports: {} }, code = ts.transpileModule(source, { compilerOptions: options }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : name.endsWith('.css') ? {} : require(name), module.exports, module)
  return module.exports
}
const source = await readFile(new URL('../console-ui/src/pages/agent-sessions.tsx', import.meta.url), 'utf8')
const sessions = compile(await readFile(new URL('../console-ui/src/utils/agent-session.ts', import.meta.url), 'utf8'), { '../pages/personal-session-model.mjs': personalModels, './session-label.mjs': sessionLabels, '@zhin.js/console-protocol': consoleProtocol })
const elements = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : []
// Radix Dialog does not mount its content while closed.
const text = node => typeof node === 'string' ? node : node && typeof node === 'object' ? node.type === 'Dialog' && !node.props.open ? '' : [node.props?.children].flat(Infinity).map(text).join('') : ''
const settle = () => new Promise(resolve => setImmediate(resolve))
function fixture(initialKey = 'icqq:bot:group:room', granted = null) {
  const slots = [], calls = [], traceReads = []; let cursor = 0, effects = [], scope = 'scope-a', params = new URLSearchParams({ sessionKey: initialKey }), tree
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
    './personal-session-model.mjs': personalModels,
    './PersonalSessionPanel': { PersonalSessionPanel: 'personal-session-panel' },
    'react-router-dom': { Link: 'a', useSearchParams: () => [params, next=>{params=typeof next==='function'?next(params):next}] },
    './scope/records-model.mjs': recordsModel, '../scope/scope-tree.mjs': scopeTree, './insights/scope-filter.mjs': scopeFilter,
    '../utils/agent-session': sessions, '../utils/session-label.mjs': sessionLabels,
    '../utils/agent-session-history': {loadAgentSessionHistory:()=>[],pushAgentSessionHistory:key=>[key]},
    '../utils/useInboxCacheScope':{useInboxCacheScope:()=>scope},
    '../utils/inbox-cache':{isInboxCacheScopeActive:expected=>expected===scope},
    '../utils/auth':{apiFetch:(url,init={})=>new Promise(resolve=>calls.push({url,init,resolve}))},
    '@zhin.js/console-ui': { cn:(...parts)=>parts.filter(Boolean).join(' '), PageHeader:'page-header', ErrorAlert:'error-alert', EmptyState:'empty-state', Alert:'alert', AlertDescription:'alert-description', Badge:'badge', Button:'button', Skeleton:'skeleton', Tabs:'tabs', TabsList:'tabs-list', TabsTrigger:'tabs-trigger', TabsContent:'tabs-content', ...(ui), StatCard:'stat-card', StatGrid:'stat-grid' }, '../components/AgentSessionPicker':{AgentSessionPicker:'session-picker'},
    './SessionMessageDetails':{SessionMessageDetails:'message-details'}, './ConversationHistory':{ConversationHistory:'conversation-history'},
    './ConversationTrace':{ConversationTrace:'conversation-trace'}, './useConversationTraces':{useConversationTraces:(...args)=>{ traceReads.push(args); return {turns:[],loading:false,error:null,refresh(){}} }},
    '@zhin.js/client':{cn:(...parts)=>parts.filter(Boolean).join(' ')}, '../contracts/zhin-console':{CONSOLE_REST:{AGENT_SESSIONS:'/api/agent/sessions'}},
    '../utils/console-access.mjs':{hasConsolePermission:name=>!granted||granted.has(name)}, '../utils/http-permission.mjs':httpPermission, './agent-sessions-description.mjs':sessionsDescription, './access/access-model.mjs':accessModel, './agent-session-recent.mjs':{readRecentSessions,summarizeRecentSessions,sessionsNeedingGroupNames,withGroupNames}, './AmbientGroupPicker':{useAmbientGroupCatalog:()=>({loading:false,error:null,catalog:null,retry(){}})}, './ambient-group-picker-model.mjs':{groupNamesFromCatalog:()=>new Map()}, })
  const f = {calls,traceReads,render(){cursor=0;tree=module.default(); const run=effects;effects=[];run.forEach(fn=>fn());return tree},get tree(){return tree},setScope(value){scope=value},navigate(key){params=new URLSearchParams({sessionKey:key})},close(){slots.forEach(slot=>slot?.cleanup?.())}}
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

test('Trace reuses the mounted history resolver, rejects ambiguity, and clears canonical scope on URL change',()=>{
  const f=fixture(), conversation={endpoint:{adapter:'root/icqq',id:'canonical'},kind:'group',id:'room'}
  assert.equal(f.traceReads.at(-1)[2],undefined)
  const history=find(f,'conversation-history')
  const panel=elements(f.tree).find(node=>node.type==='tabs-content'&&node.props.value==='conversation')
  assert.equal(panel.props.forceMount,true)
  history.props.onConversation(conversation);f.render();assert.equal(f.traceReads.at(-1)[2],conversation)
  history.props.onOpenTrace('turn-a');f.render();assert.equal(find(f,'tabs').props.value,'trace')
  assert.equal(find(f,'conversation-trace').props.selectedTurn,'turn-a')
  let retries=0
  find(f,'conversation-history').props.onConversation(undefined,'AMBIGUOUS',()=>retries++);f.render()
  assert.equal(f.traceReads.at(-1)[2],undefined)
  assert.equal(find(f,'conversation-trace').props.error,'AMBIGUOUS')
  find(f,'conversation-trace').props.refresh();assert.equal(retries,1)
  f.navigate('icqq:bot:group:another-room');f.render()
  assert.equal(f.traceReads.at(-1)[2],undefined)
  assert.equal(find(f,'conversation-trace').props.selectedTurn,'')
  f.close()
})


test('personal model management is additive: existing exact-session read tabs remain independent of binding', async () => {
  const key = `personal-session:v1:${'a'.repeat(64)}`
  const f = fixture(key); f.render()
  assert.equal(find(f, 'personal-session-panel').props.sessionKey, key)
  assert.equal(find(f, 'conversation-history'), undefined)
  assert.ok(find(f, 'conversation-trace'))
  assert.ok(find(f, 'tabs'))
  assert.equal(f.calls.length, 0)
  assert.equal(f.traceReads.at(-1)[0], key)
  find(f, 'tabs').props.onValueChange('branches'); f.render()
  const request = f.calls.find(call => call.url.endsWith('/tree'))
  assert.ok(request); assert.ok(request.url.includes(encodeURIComponent(key)))
  answerTree(request, key); await settle(); f.render()
  assert.equal(find(f, 'message-details').props.sessionKey, key)
  assert.ok(!f.calls.some(call => call.url.includes('/trace-archive/sessions') || call.url.includes('/conversations/history')))
  f.close()
})


test('a personal tree denied by the existing full guard renders no branch messages and triggers no write', async () => {
  const key = `personal-session:v1:${'b'.repeat(64)}`
  const f = fixture(key); find(f, 'tabs').props.onValueChange('branches'); f.render()
  const request = f.calls.find(call => call.url.endsWith('/tree'))
  assert.ok(request)
  request.resolve({ status: 403, ok: false, json: async () => ({ success: false, error: 'full required' }) })
  await settle(); f.render()
  assert.equal(find(f, 'message-details'), undefined)
  assert.ok(!text(f.tree).includes('FULL BRANCH PREVIEW'))
  assert.ok(!f.calls.some(call => call.init.method === 'POST'))
  f.close()
})


test('already-authorized recent personal sessions stay visible without querying an all-session directory from a personal page', async () => {
  const key = `personal-session:v1:${'d'.repeat(64)}`
  const f = fixture()
  f.calls.find(call => call.url.endsWith('/trace-archive/sessions')).resolve({ ok: true, json: async () => ({ success: true,
    data: [{ session_key: key, turns: 1, last_started_at: 1, last_status: 'completed' }] }) })
  await settle(); f.render()
  assert.equal(find(f, 'session-picker').props.recent[0].sessionKey, key)
  f.navigate(key); f.render()
  assert.equal(find(f, 'session-picker').props.recent[0].sessionKey, key)
  assert.equal(f.calls.filter(call => call.url.endsWith('/trace-archive/sessions')).length, 1)
  f.setScope('scope-b'); f.render()
  assert.equal(find(f, 'session-picker').props.recent, null)
  f.close()
})


test('personal sessions open on the trace tab and explain, without an error, that the conversation is not shown here (it is not lost)', () => {
  const key = `personal-session:v1:${'e'.repeat(64)}`
  const f = fixture(key); f.render()
  assert.equal(find(f, 'tabs').props.value, 'trace')
  assert.ok(find(f, 'conversation-trace'))
  const panel = elements(f.tree).find(node => node.type === 'tabs-content' && node.props.value === 'conversation')
  assert.equal(elements(panel).find(node => node.type === 'error-alert'), undefined)
  assert.ok(!text(f.tree).includes('聊天记录暂不可用'))
  const notice = elements(panel).find(node => node.type === 'empty-state')
  assert.ok(notice, 'the conversation tab carries a neutral notice')
  assert.equal(notice.props.title, '这里不显示个人会话的对话')
  assert.match(notice.props.description, /为保护隐私/)
  assert.match(notice.props.description, /仍在原来的聊天里/)
  assert.match(notice.props.description, /平台或沙盒/)
  assert.doesNotMatch(`${notice.props.title}${notice.props.description}`, /没有聊天记录|不保存聊天记录/, 'the chat is kept: never claim it is not')
  assert.match(notice.props.description, /轨迹/)
  // 查看轨迹 is the EmptyState's one action (console-ui 1.1).
  const toTrace = notice.props.action
  assert.equal(toTrace.label, '查看轨迹')
  find(f, 'tabs').props.onValueChange('conversation'); f.render()
  assert.equal(find(f, 'tabs').props.value, 'conversation')
  toTrace.onSelect(); f.render()
  assert.equal(find(f, 'tabs').props.value, 'trace')
  f.close()
})

test('a tab chosen for a group conversation does not carry the conversation tab into a personal session', () => {
  const f = fixture(); assert.equal(find(f, 'tabs').props.value, 'conversation')
  find(f, 'tabs').props.onValueChange('conversation'); f.render()
  f.navigate(`personal-session:v1:${'f'.repeat(64)}`); f.render()
  assert.equal(find(f, 'tabs').props.value, 'trace')
  f.navigate('icqq:bot:group:room'); f.render()
  assert.equal(find(f, 'tabs').props.value, 'conversation')
  f.close()
})

test('scene-task and schedule sessions are listed, selectable by URL, open on the trace tab, and say truthfully why the conversation is not shown', async () => {
  const scene = `scene-task:v1:${'9f8e7d6c'.repeat(8)}`
  const f = fixture()
  f.calls.find(call => call.url.endsWith('/trace-archive/sessions')).resolve({ ok: true, json: async () => ({ success: true, data: [
    { session_key: scene, turns: 2, last_started_at: 2, last_status: 'completed' },
    { session_key: 'schedule:job-daily', turns: 1, last_started_at: 1, last_status: 'completed' },
  ] }) })
  await settle(); f.render()
  assert.deepEqual(find(f, 'session-picker').props.recent.map(row => row.sessionKey), [scene, 'schedule:job-daily'])
  const cards = elements(f.tree).filter(node => node.type === 'stat-card')
  assert.equal(cards.find(card => card.props.label === '群聊与频道').props.value, 1)
  assert.match(cards.find(card => card.props.label === '群聊与频道').props.sub, /其他 1 个/)
  for (const [key, title, copy] of [
    [scene, '这里还不显示这个会话的对话', /还不能把这个会话对应到原来的聊天.*平台查看.*轨迹/],
    ['schedule:job-daily', '这里不显示定时任务的对话', /定时任务按计划运行.*轨迹/],
  ]) {
    find(f, 'session-picker').props.onLoad(key); f.render(); f.render()
    assert.equal(find(f, 'tabs').props.value, 'trace', key)
    assert.ok(find(f, 'conversation-trace'))
    assert.ok(f.traceReads.some(args => args[0] === key), 'turns are read by the key')
    assert.equal(find(f, 'conversation-history'), undefined, 'no conversation read for a key without an address')
    const panel = elements(f.tree).find(node => node.type === 'tabs-content' && node.props.value === 'conversation')
    const notice = elements(panel).find(node => node.type === 'empty-state')
    assert.equal(notice.props.title, title)
    assert.match(notice.props.description, copy)
    assert.equal(notice.props.action.label, '查看轨迹')
    assert.equal(elements(panel).find(node => node.type === 'error-alert'), undefined)
    assert.equal(find(f, 'personal-session-panel'), undefined)
  }
  f.close()
})

// #64 `session-leaf-permission-mismatch`: 「从这里继续」 (POST /agent/sessions/<key>/leaf) was gated on
// endpoint.operate, but the protocol requires agent.configure: the built-in operator (endpoint.operate,
// no agent.configure) saw the button and was refused.
test('「从这里继续」 follows the protocol (agent.configure), not endpoint.operate', async () => {
  const branches = async granted => {
    const f = fixture('icqq:bot:group:room', granted); find(f, 'tabs').props.onValueChange('branches'); f.render()
    answerTree(f.calls.find(call => call.url.endsWith('/tree'))); await settle(); f.render()
    return f
  }
  const operator = await branches(new Set(['endpoint.view', 'endpoint.operate', 'agent.view', 'feature.view']))
  assert.ok(elements(operator.tree).some(node => node.type === 'p' && text(node) === 'FULL BRANCH PREVIEW'), 'the branch points are still shown')
  assert.equal(elements(operator.tree).find(node => node.type === 'button' && text(node) === '从这里继续'), undefined, 'no button the Host would refuse')
  assert.equal(find(operator, 'Dialog'), undefined)
  assert.match(text(operator.tree), /需要「修改 AI 与 Agent 设置」权限才能从其他消息继续/)
  operator.close()
  const configurer = await branches(new Set(['endpoint.view', 'agent.view', 'agent.configure']))
  const button = elements(configurer.tree).find(node => node.type === 'button' && text(node) === '从这里继续')
  assert.ok(button, 'agent.configure without endpoint.operate may switch')
  button.props.onClick(); configurer.render()
  elements(configurer.tree).find(node => node.type === 'button' && text(node) === '确认切换').props.onClick()
  assert.equal(configurer.calls.filter(call => call.init.method === 'POST').length, 1)
  assert.doesNotMatch(text(configurer.tree), /需要「修改 AI 与 Agent 设置」权限/)
  configurer.close()
})
