import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { matchesMessageConversation } from '../console-ui/src/pages/endpoint-detail/rendering-diagnostics.mjs'

// The safety models are new; load them lazily so the lifecycle tests below still run (and fail on
// behaviour, not on a missing import) against code that predates them.
const draftModel = await import('../console-ui/src/pages/endpoint-detail/composer-draft-model.mjs').catch(() => ({}))
const memberModel = await import('../console-ui/src/pages/endpoint-detail/group-members-model.mjs').catch(() => ({}))

function hooks() {
  const slots = []; let cursor = 0, pending = [], dirty = false, render, value
  const same = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const api = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], next => { const v = typeof next === 'function' ? next(slots[i]) : next; if (!Object.is(slots[i], v)) { slots[i] = v; dirty = true } }] },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useCallback(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, fn }; return slots[i].fn },
    useMemo(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) slots[i] = { deps, value: fn() }; return slots[i].value },
    useEffect(fn, deps) { const i = cursor++; if (!same(slots[i]?.deps, deps)) { const old = slots[i]; slots[i] = { deps, cleanup: old?.cleanup }; pending.push(() => { old?.cleanup?.(); slots[i].cleanup = fn() }) } },
  }
  return {
    api,
    mount(fn) { render = fn; return this.render() },
    render() { let n = 0; do { assert.ok(++n < 50); dirty = false; cursor = 0; value = render(); const effects = pending; pending = []; effects.forEach(fn => fn()) } while (dirty); return value },
    async settle() { for (let i = 0; i < 12; i++) { await Promise.resolve(); if (dirty || pending.length) this.render() } return value },
    get value() { return value },
  }
}

const element = (type, props, ...children) => ({ type, props: props ?? {}, children: children.flat(Infinity) })
/** Run a production component/hook body up to `stop`, returning `expose` instead of its JSX. */
async function lifecycle(file, name, stop, expose, bindings) {
  const source = await readFile(new URL(`../console-ui/src/${file}`, import.meta.url), 'utf8')
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration; (function find(n) { if (ts.isFunctionDeclaration(n) && n.name?.text === name) declaration = n; ts.forEachChild(n, find) })(ast)
  assert.ok(declaration, name)
  let code = declaration.getText(ast).replace(/^export (default )?/, ''); assert.ok(code.indexOf(stop) > 0, `${name} contains ${JSON.stringify(stop)}`)
  code = code.slice(0, code.indexOf(stop)) + `return {${expose}};}`
  code = ts.transpileModule(code, { fileName: 'lifecycle.tsx', compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText
  return Function('React', ...Object.keys(bindings), `${code};return ${name}`)({ createElement: element }, ...Object.values(bindings))
}

const i18n = { locale: 'zh-CN', t: (message, values) => translate('zh-CN', message, values) }
const group = id => ({ type: 'channel', channelType: 'group', id, name: `群 ${id}` })
function deferred() { let resolve, reject; const promise = new Promise((ok, fail) => { resolve = ok; reject = fail }); return { promise, resolve, reject } }

test('message composer text belongs to the conversation it was typed in', async () => {
  const runtime = hooks(); const sends = []
  const useMessageHistory = await lifecycle('pages/endpoint-detail/useMessageHistory.ts', 'useMessageHistory', '  return {\n    receivedMessages',
    'msgContent, setMsgContent, handleSend', {
      ...runtime.api, ...draftModel, useI18n: () => i18n, useInboxCacheScope: () => 'fixture', isInboxCacheScopeActive: () => true,
      useToast: () => ({ error() {} }), toRpcChannelParent: () => undefined, readMessageHistory: () => [], mergeHistoryRows: (a, b) => [...a, ...b],
      INBOX_RPC: { MESSAGES: 'inbox.messages' }, ENDPOINT_RPC: { SEND_MESSAGE: 'endpoint.send' }, SIDE_EVENT_PUSH: { MESSAGE_RECEIVE: 'message.receive' },
      subscribeConsoleRecoveryGap: () => () => {}, subscribeEndpointPush: () => () => {}, listInboxCache: async () => [], putInboxCache: async () => {},
      readMessagePush: () => undefined, normalizeInboundContent: value => value, correlateChatRows: rows => rows, matchesMessageConversation,
      parseComposerToSegments: text => text ? [{ type: 'text', data: { text } }] : [], hasRenderableComposerSegments: segments => segments.length > 0,
      requestConsole: request => { if (request.type === 'endpoint.send') { const d = deferred(); sends.push({ request, ...d }); return d.promise } return Promise.resolve({ inboxEnabled: false, messages: [] }) },
    })
  let selection = group('A')
  runtime.mount(() => useMessageHistory({ adapter: 'icqq', endpointId: 'bot', endpoint: { id: 'bot', adapter: 'icqq' }, selection })); await runtime.settle()
  runtime.value.setMsgContent('发给 A 的话'); runtime.render()
  selection = group('B'); runtime.render(); await runtime.settle()
  assert.equal(runtime.value.msgContent, '', 'switching conversations must not carry the previous draft')
  runtime.value.setMsgContent(current => current + '发给 B'); runtime.render()
  selection = group('A'); runtime.render(); await runtime.settle()
  assert.equal(runtime.value.msgContent, '发给 A 的话', 'returning restores the conversation draft')

  // A send that finishes after the user moved on clears only the conversation it was sent to.
  void runtime.value.handleSend(); await runtime.settle()
  assert.equal(sends.length, 1); assert.equal(sends[0].request.channelId, 'A')
  selection = group('B'); runtime.render(); await runtime.settle()
  sends[0].resolve({ messageId: 'm1' }); await runtime.settle()
  assert.equal(runtime.value.msgContent, '发给 B')
  selection = group('A'); runtime.render(); await runtime.settle()
  assert.equal(runtime.value.msgContent, '', 'the sent draft is gone from its own conversation')
})

test('group member list is cleared on switch, auto-loaded, and never fed a stale group result', async () => {
  const runtime = hooks(); const reads = []; const actions = []
  const useGroupActions = await lifecycle('pages/endpoint-detail/useGroupActions.ts', 'useGroupActions', '  return {\n    members',
    'members, membersLoading, loadMembers, groupAction', {
      ...runtime.api, ...memberModel, useI18n: () => i18n, useToast: () => toast,
      GROUP_ACTION_LABELS: { kick: '已踢出群成员' }, ENDPOINT_RPC: { GROUP_MEMBERS: 'members', GROUP_KICK: 'kick', GROUP_MUTE: 'mute', GROUP_ADMIN: 'admin' },
      requestConsole: request => {
        if (request.type === 'members') { const d = deferred(); reads.push({ groupId: request.groupId, ...d }); return d.promise }
        actions.push(request); return Promise.resolve({})
      },
    })
  const toast = { success() {}, error() {} }
  let selection = group('1')
  runtime.mount(() => useGroupActions({ adapter: 'icqq', endpointId: 'bot', selection })); await runtime.settle()
  assert.deepEqual(reads.map(r => r.groupId), ['1'], 'selecting a group loads its members automatically')
  assert.equal(runtime.value.membersLoading, true)
  reads[0].resolve({ members: [{ user_id: 101 }] }); await runtime.settle()
  assert.deepEqual(runtime.value.members, [{ user_id: 101 }]); assert.equal(runtime.value.membersLoading, false)

  selection = group('2'); runtime.render()
  assert.deepEqual(runtime.value.members, [], 'members of group 1 disappear as soon as group 2 is selected')
  assert.equal(runtime.value.membersLoading, true, 'an unread group shows the loading state, not an empty list')
  await runtime.settle()
  assert.deepEqual(reads.map(r => r.groupId), ['1', '2'])

  // Group 2 is still loading when the user moves to group 3; its late answer must not land there.
  selection = group('3'); runtime.render(); await runtime.settle()
  assert.deepEqual(reads.map(r => r.groupId), ['1', '2', '3'])
  reads[1].resolve({ members: [{ user_id: 202 }] }); await runtime.settle()
  assert.deepEqual(runtime.value.members, [], 'a stale group 2 result is discarded')
  assert.equal(runtime.value.membersLoading, true)
  reads[2].resolve({ members: [{ user_id: 303 }] }); await runtime.settle()
  assert.deepEqual(runtime.value.members, [{ user_id: 303 }]); assert.equal(runtime.value.membersLoading, false)

  const done = runtime.value.groupAction('kick', 303); await runtime.settle()
  assert.deepEqual(actions.map(a => [a.groupId, a.userId]), [['3', '303']])
  assert.equal(reads.at(-1).groupId, '3', 'the list is re-read after a member action')
  reads.at(-1).resolve({ members: [] }); assert.equal(await done, true); await runtime.settle()
  assert.deepEqual(runtime.value.members, [])
})

test('attachments, quotes and forwards stay with their conversation', async () => {
  const runtime = hooks(); const sent = []
  let ctx
  const EndpointWorkspace = await lifecycle('pages/endpoint-detail/index.tsx', 'EndpointWorkspace', '  let lastDay', 'composerAttachments, quoteDraft, forwardDraft, setQuoteDraft, setForwardDraft, setComposerAttachments, handleSendWithDrafts, mediaUrl, setMediaUrl', {
    ...runtime.api, ...draftModel, useI18n: () => i18n, useEndpointConsole: () => ctx, isDemoMode: () => false, useConfirm: () => ({ confirm: async () => true, ConfirmDialog: null }),
    translate, DEFAULT_MUTE_MINUTES: 10, MAX_MUTE_MINUTES: 43200, ENDPOINT_RPC: {}, memberRoleOf: () => 'member', createAttachmentId: type => `${type}-fixture`,
    parseComposerToSegments: text => text ? [{ type: 'text', data: { text } }] : [], hasRenderableComposerSegments: segments => segments.length > 0,
    Alert: 'alert', AlertDescription: 'alert-description',
  })
  const contextFor = selection => ({ valid: true, adapter: 'icqq', endpointId: 'bot', selection, msgContent: '', setMsgContent() {}, sending: false, members: [], membersLoading: false,
    handleSend: options => { sent.push(options) } })
  ctx = contextFor(group('A'))
  runtime.mount(() => EndpointWorkspace()); await runtime.settle()
  const quote = { id: 'q1', senderName: '甲', summary: '群 A 的消息' }
  runtime.value.setQuoteDraft(quote); runtime.render()
  runtime.value.setComposerAttachments(prev => [...prev, { id: 'img', type: 'image', url: 'https://example.invalid/a.png', name: 'a', source: 'url' }]); runtime.render()
  runtime.value.setMediaUrl('https://example.invalid/half'); runtime.render()

  ctx = contextFor(group('B')); runtime.render(); await runtime.settle()
  assert.equal(runtime.value.quoteDraft, null, 'quote from group A is not shown in group B')
  assert.deepEqual(runtime.value.composerAttachments, [])
  assert.equal(runtime.value.mediaUrl, '')
  const forward = { id: 'f1', senderName: '乙', summary: '群 B 的消息' }
  runtime.value.setForwardDraft(forward); runtime.render()

  ctx = contextFor(group('A')); runtime.render(); await runtime.settle()
  assert.deepEqual(runtime.value.quoteDraft, quote, 'returning restores the quote')
  assert.equal(runtime.value.composerAttachments.length, 1)
  assert.equal(runtime.value.forwardDraft, null)

  runtime.value.handleSendWithDrafts(); assert.equal(sent.length, 1)
  ctx = contextFor(group('B')); runtime.render(); await runtime.settle()
  // useMessageHistory reports the conversation the message went to.
  sent[0].onSent?.({ draftKey: draftModel.conversationSelectionKey?.(group('A')) }); runtime.render(); await runtime.settle()
  assert.deepEqual(runtime.value.forwardDraft, forward, 'a finished send in group A leaves group B drafts alone')
  ctx = contextFor(group('A')); runtime.render(); await runtime.settle()
  assert.equal(runtime.value.quoteDraft, null, 'the sent quote is cleared from group A')
  assert.deepEqual(runtime.value.composerAttachments, [])
})

test('Enter during IME composition never sends a message or inserts a media URL', async () => {
  const source = await readFile(new URL('../console-ui/src/pages/endpoint-detail/index.tsx', import.meta.url), 'utf8')
  const mediaInput = source.slice(source.indexOf('value={mediaUrl}'), source.indexOf('/>', source.indexOf('value={mediaUrl}')))
  const composer = source.slice(source.indexOf('value={msgContent}'), source.indexOf('/>', source.indexOf('value={msgContent}')))
  for (const [label, block] of [['media URL', mediaInput], ['message', composer]]) {
    const handler = block.match(/onKeyDown=\{\(e\) => \{([\s\S]*?)\n\s*\}\}/)?.[1]
    assert.ok(handler, `${label} input has a keydown handler`)
    assert.match(handler, /shouldSubmitOnEnter\(e/, `${label} input checks IME composition before submitting`)
  }
  assert.match(composer, /shouldSubmitOnEnter\(e\)/, 'Shift+Enter still inserts a line break in the message box')
})
