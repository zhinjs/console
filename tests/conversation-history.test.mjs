import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { renderToStaticMarkup } from 'react-dom/server'
import ts from 'typescript'
import { localeModule } from './locale-fixture.mjs'
import * as model from '../console-ui/src/pages/conversation-history-model.mjs'
import * as traceModel from '../console-ui/src/pages/conversation-trace-model.mjs'
import { createDiagnosticRequestGate } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'
import { pickMessageMediaRaw } from '../console-ui/src/pages/endpoint-detail/media-source.mjs'

const require = createRequire(import.meta.url)
const source = await readFile(new URL('../console-ui/src/pages/ConversationHistory.tsx', import.meta.url), 'utf8')
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const bodyCode = ts.transpileModule(await readFile(new URL('../console-ui/src/pages/endpoint-detail/MessageBody.tsx', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText
// The installed SDK's pure media helper avoids loading its browser-only entry in Node.
const sdkMedia = await import(new URL('mediaSrc.js', import.meta.resolve('@zhin.js/client')))
const bodyModule = { exports: {} }
new Function('require', 'exports', 'module', bodyCode)(name => {
  if (name === '../../i18n' || name === '../../i18n/locale.mjs') return localeModule
  if (name === './media-source.mjs') return { pickMessageMediaRaw }
  if (name === '@zhin.js/client') return { ...sdkMedia, cn: (...values) => values.filter(Boolean).join(' '), MarkdownContent: 'markdown-content' }
  return require(name)
}, bodyModule.exports, bodyModule)
const conversation = { endpoint: { adapter: 'root/icqq', id: 'canonical-account' }, kind: 'channel', id: 'room', parent: { kind: 'channel', id: 'guild' }, threadId: 'topic' }
const message = (sequence, text, actor) => ({ sequence, type: 'message.created', timestamp: 1_700_000_000_000 + sequence,
  message: { ref: { conversation, id: `msg-${sequence}` }, timestamp: 1_700_000_000_000 + sequence,
    segments: [{ type: 'text', data: { text } }], ...(actor === undefined ? {} : { actor }) } })
const body = (items, hasMore = false, ref = conversation) => ({ success: true, data: { conversation: ref, items, hasMore, nextBeforeSequence: hasMore ? items[0]?.sequence : null } })
const events = (start, count) => Array.from({ length: count }, (_, index) => ({ sequence: start + index, type: 'member.joined', timestamp: 1_700_000_000_000 }))
function elements(value) { return value && typeof value === 'object' ? [value, ...[value.props?.children].flat(Infinity).flatMap(elements)] : [] }
const label = value => typeof value === 'string' ? value : value && typeof value === 'object' ? [value.props?.children].flat(Infinity).map(label).join('') : ''
const button = (tree, text) => elements(tree).find(item => item.type === 'button' && label(item) === text)
function runtime() {
  const slots = []; let cursor = 0, dirty = false, effects = [], render, value
  const same = (a, b) => a && b && a.length === b.length && a.every((item, index) => Object.is(item, b[index]))
  const hooks = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => { const result = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(result, slots[index])) { slots[index] = result; dirty = true } }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useCallback(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) slots[index] = { fn, deps }; return slots[index].fn },
    useEffect(fn, deps) { const index = cursor++; if (!same(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps, cleanup: old?.cleanup }; effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn() }) } },
  }
  return { hooks, mount(fn) { render = fn; return this.render() }, render(flush = true) { let count = 0; do {
    assert.ok(++count < 40); cursor = 0; dirty = false; value = render()
    if (flush) { const pending = effects; effects = []; pending.forEach(fn => fn()) }
  } while (flush && dirty); return value }, async settle() { for (let i = 0; i < 16; i++) { await Promise.resolve(); if (dirty || effects.length) this.render() }; return value },
  unmount() { slots.forEach(slot => slot?.cleanup?.()); effects = [] }, get value() { return value } }
}
function fixture({ realMessageBody = false } = {}) {
  let connection = { host: 'https://host-a', credential: 'fixture-a' }, scopeId = 0
  const authority = createInboxCacheAuthority(() => connection, () => `scope-${++scopeId}`)
  const props = { sessionKey: 'icqq:alias:channel:room', connectionScope: authority.current() }
  const calls = [], hooks = runtime(), module = { exports: {} }
  const mocks = {
    react: { ...require('react'), ...hooks.hooks }, '../i18n': localeModule,
    '../components/ui/button': { Button: 'button' }, '../components/error-alert': { ErrorAlert: 'error-alert' },
    '../utils/auth': { apiFetch: (url, options) => new Promise((resolve, reject) => calls.push({ url, ...options, resolve, reject })) },
    '../utils/inbox-cache': { getInboxCacheScope: () => authority.current(), isInboxCacheScopeActive: scope => authority.active(scope) },
    './endpoint-detail/message-diagnostics.mjs': { createDiagnosticRequestGate },
    './endpoint-detail/MessageBody': realMessageBody ? bodyModule.exports : { MessageBody: 'message-body' }, './conversation-history-model.mjs': model,
    './ConversationUsage': { ConversationUsage: 'conversation-usage' }, './conversation-trace-model.mjs': traceModel,
  }
  new Function('require', 'exports', 'module', code)(name => mocks[name] ?? require(name), module.exports, module)
  hooks.mount(() => module.exports.ConversationHistory(props))
  const answer = (index, result, status = 200) => calls[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => result })
  return { hooks, props, calls, answer, authority,
    switchHost() { connection = { ...connection, host: 'https://host-b' } },
    switchCredential() { connection = { ...connection, credential: 'fixture-b' } },
  }
}

test('actual history reads one page, advances through non-message events only on demand, and keeps full text/actor/recall semantics', async () => {
  const f = fixture(), long = '完整聊天正文'.repeat(4000) + 'COMPLETE_TAIL'
  assert.equal(f.calls.length, 1)
  assert.equal(new URL(f.calls[0].url, 'https://console.example').searchParams.has('beforeSequence'), false)
  f.answer(0, body(events(51, 50), true)); await f.hooks.settle()
  assert.equal(f.calls.length, 1, 'a non-message-only page must not automatically scan older events')
  assert.equal(elements(f.hooks.value).filter(item => item.type === 'message-body').length, 0)
  button(f.hooks.value, '加载更早记录').props.onClick()
  button(f.hooks.value, '加载更早记录').props.onClick()
  assert.equal(f.calls.length, 2, 'an in-flight page cannot be requested twice before React rerenders')
  assert.equal(new URL(f.calls[1].url, 'https://console.example').searchParams.get('beforeSequence'), '51')
  f.answer(1, body([message(1, long), { sequence: 2, type: 'message.recalled', timestamp: 1_700_000_000_002, messageRef: { conversation, id: 'msg-1' } },
    message(3, 'UNKNOWN_INBOUND', { id: 'unknown', displayName: 'Unknown sender' }), ...events(4, 47)])); await f.hooks.settle()
  const displayed = elements(f.hooks.value).filter(item => item.type === 'message-body')
  assert.equal(displayed.length, 2)
  assert.equal(displayed[0].props.content[0].data.text, long)
  const rows = elements(f.hooks.value).filter(item => item.type === 'article')
  assert.ok(rows[0].props.className.includes('conversation-message-outgoing'))
  assert.equal(rows[1].props.className.includes('conversation-message-outgoing'), false)
  assert.ok(label(rows[1]).includes('Unknown sender'))
  assert.ok(label(rows[0]).includes('已撤回'))
  assert.ok(label(f.hooks.value).includes('消息已撤回'))
  assert.equal(button(f.hooks.value, '加载更早记录'), undefined)
  assert.equal(f.calls.length, 2)
  f.hooks.unmount()
})

test('earlier-read failure preserves loaded messages; retry uses the same exclusive cursor and rejects cross-thread pages', async () => {
  const f = fixture()
  f.answer(0, body([message(51, 'KEEP_READ'), ...events(52, 49)], true)); await f.hooks.settle()
  button(f.hooks.value, '加载更早记录').props.onClick()
  f.answer(1, { code: 'history_unavailable' }, 503); await f.hooks.settle()
  assert.equal(elements(f.hooks.value).find(item => item.type === 'message-body').props.content[0].data.text, 'KEEP_READ')
  let error = elements(f.hooks.value).find(item => item.type === 'error-alert')
  assert.equal(error.props.kind, '503')
  error.props.onRetry()
  assert.equal(new URL(f.calls[2].url, 'https://console.example').searchParams.get('beforeSequence'), '51')
  f.answer(2, body([message(1, 'OTHER_THREAD')], false, { ...conversation, threadId: 'other-topic' })); await f.hooks.settle()
  assert.equal(elements(f.hooks.value).find(item => item.type === 'message-body').props.content[0].data.text, 'KEEP_READ')
  error = elements(f.hooks.value).find(item => item.type === 'error-alert')
  error.props.onRetry()
  f.answer(3, body([message(1, 'OLDER')])); await f.hooks.settle()
  assert.deepEqual(elements(f.hooks.value).filter(item => item.type === 'message-body').map(item => item.props.content[0].data.text), ['OLDER', 'KEEP_READ'])
  f.hooks.unmount()
})

test('manual refresh is available on the final page, preserves read pages on failure, and retries refresh rather than older history', async () => {
  const f = fixture()
  f.answer(0, body([message(1, 'FINAL_PAGE')])); await f.hooks.settle()
  button(f.hooks.value, '刷新').props.onClick()
  assert.equal(new URL(f.calls[1].url, 'https://console.example').searchParams.has('beforeSequence'), false)
  f.answer(1, { code: 'history_unavailable' }, 503); await f.hooks.settle()
  assert.equal(elements(f.hooks.value).find(item => item.type === 'message-body').props.content[0].data.text, 'FINAL_PAGE')
  elements(f.hooks.value).find(item => item.type === 'error-alert').props.onRetry()
  assert.equal(new URL(f.calls[2].url, 'https://console.example').searchParams.has('beforeSequence'), false)
  f.answer(2, body([message(100, 'LATEST_PAGE')], true)); await f.hooks.settle()
  assert.deepEqual(elements(f.hooks.value).filter(item => item.type === 'message-body').map(item => item.props.content[0].data.text), ['LATEST_PAGE'])
  button(f.hooks.value, '加载更早记录').props.onClick()
  assert.equal(new URL(f.calls[3].url, 'https://console.example').searchParams.get('beforeSequence'), '100')
  f.hooks.unmount()
  assert.equal(f.calls[3].signal.aborted, true)
})

for (const change of ['switchHost', 'switchCredential']) test(`loaded/private and late history are hidden immediately after ${change}`, async () => {
  const f = fixture()
  f.answer(0, body([message(10, 'PRIVATE_OLD_IDENTITY')], true)); await f.hooks.settle()
  const staleLoad = button(f.hooks.value, '加载更早记录').props.onClick
  staleLoad()
  f[change]()
  assert.equal(f.hooks.render(false), null, 'old data must disappear even before effects or parent-key remount')
  f.props.connectionScope = f.authority.current()
  f.hooks.render()
  const before = f.calls.length; staleLoad(); assert.equal(f.calls.length, before)
  assert.equal(f.calls[1].signal.aborted, true)
  f.answer(1, body([message(1, 'LATE_OLD_IDENTITY')]))
  f.answer(2, body([message(20, 'CURRENT_IDENTITY')])); await f.hooks.settle()
  assert.deepEqual(elements(f.hooks.value).filter(item => item.type === 'message-body').map(item => item.props.content[0].data.text), ['CURRENT_IDENTITY'])
  f.hooks.unmount()
})

test('changing sessions cancels old reads, clears old data before effects, and never substitutes Agent records for an unavailable history endpoint', async () => {
  const f = fixture()
  f.answer(0, body([message(1, 'OLD_SESSION')])); await f.hooks.settle()
  button(f.hooks.value, '刷新').props.onClick()
  f.props.sessionKey = 'icqq:alias:channel:another-room'
  assert.equal(f.hooks.render(false), null)
  f.hooks.render()
  assert.equal(f.calls[1].signal.aborted, true)
  f.answer(1, body([message(2, 'LATE_OLD_SESSION')]))
  f.answer(2, { code: 'history_not_recorded' }, 404); await f.hooks.settle()
  assert.equal(elements(f.hooks.value).some(item => item.type === 'message-body'), false)
  assert.match(elements(f.hooks.value).find(item => item.type === 'error-alert').props.error, /尚无可读取的聊天记录/)
  assert.ok(f.calls.every(call => call.url.startsWith('/api/conversations/history?')))
  assert.equal(f.calls.length, 3)
  f.hooks.unmount()
})

test('the actual timeline and MessageBody render the entire long message and public canonical image without replacing them with an Agent excerpt', async () => {
  const f = fixture({ realMessageBody: true }), text = '正文'.repeat(12000) + 'ACTUAL_RENDERED_TAIL'
  const item = message(1, text)
  item.message.segments.push({ type: 'image', data: { media: { kind: 'url', value: 'https://assets.example/full.png' } } })
  f.answer(0, body([item])); await f.hooks.settle()
  const html = renderToStaticMarkup(f.hooks.value)
  assert.ok(html.includes(text))
  assert.match(html, /<img[^>]*src="https:\/\/assets\.example\/full\.png"/)
  assert.doesNotMatch(html, /查看全文|切换到此处|执行分支|line-clamp/)
  f.hooks.unmount()
})

test('usage attaches to the precise triggering inbound message and never to an assumed reply', async()=>{
  const f=fixture(), observations=[]
  f.props.onConversation=(...args)=>observations.push(args)
  f.props.turns=[{turn_id:'turn-a',origin:{conversation,messageId:'msg-1'}}]
  f.hooks.render()
  f.answer(0,body([message(1,'trigger',{id:'member'}),message(2,'bot reply'),message(3,'other user',{id:'other'})]));await f.hooks.settle()
  const usage=elements(f.hooks.value).filter(node=>node.type==='conversation-usage')
  assert.equal(usage.length,2)
  assert.equal(usage[0].props.turns[0].turn_id,'turn-a');assert.equal(usage[1].props.turns.length,0)
  assert.deepEqual(observations[0][0],conversation)
  button(f.hooks.value,'刷新').props.onClick();f.answer(1,{code:'conversation_ambiguous'},409);await f.hooks.settle()
  assert.equal(observations.at(-1)[0],undefined);assert.match(observations.at(-1)[1],/多个频道或话题/)
  f.hooks.unmount()
})
