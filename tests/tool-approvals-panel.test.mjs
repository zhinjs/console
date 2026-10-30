import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'
import * as model from '../console-ui/src/pages/tool-approvals-model.mjs'

const source = await readFile(new URL('../console-ui/src/pages/HostToolApprovalsPanel.tsx', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
const card = { id: 'card-1', toolName: 'synthetic_tool', category: 'system', sessionKey: 'sandbox:bot:group:room', requesterId: 'requester',
  args: { command: 'synthetic command', path: '/synthetic/file' }, createdAt: 1, expiresAt: 1_900_000_000_000, status: 'pending', decidedAt: null, decidedBy: null, channel: null }
const catalog = (pending = [card]) => ({ available: true, pending, recent: [{ ...card, toolName: 'recent-tool', status: 'approved' }] })
const elements = value => !value || typeof value !== 'object' ? [] : [value, ...[value.props?.children].flat(Infinity).flatMap(elements)]
const text = value => value == null || typeof value === 'boolean' ? '' : typeof value !== 'object' ? String(value) : [value.props?.children].flat(Infinity).map(text).join('')

function hooks() {
  const slots = []; let cursor = 0, dirty = false, effects = [], render, value
  const equal = (a, b) => a && b && a.length === b.length && a.every((entry, index) => Object.is(entry, b[index]))
  const react = {
    useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => { const result = typeof next === 'function' ? next(slots[index]) : next; if (!Object.is(slots[index], result)) { slots[index] = result; dirty = true } }] },
    useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
    useCallback(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) slots[index] = { deps, fn }; return slots[index].fn },
    useEffect(fn, deps) { const index = cursor++; if (!equal(slots[index]?.deps, deps)) { const old = slots[index]; slots[index] = { deps, cleanup: old?.cleanup }
      effects.push(() => { old?.cleanup?.(); slots[index].cleanup = fn() }) } },
  }
  return { react,
    mount(fn) { render = fn; return this.render() },
    render() { let count = 0; do { assert(++count < 30); dirty = false; cursor = 0; value = render(); const next = effects; effects = []; next.forEach(run => run()) } while (dirty); return value },
    async settle() { for (let i = 0; i < 16; i++) { await Promise.resolve(); this.render() } },
    unmount() { for (const slot of slots) slot?.cleanup?.(); slots.length = 0; effects = [] },
    get value() { return value },
  }
}

function fixture({ demo = false } = {}) {
  const runtime = hooks(), calls = []
  let connection = { host: 'https://host-a.invalid', credential: 'synthetic-A' }, nonce = 0
  const authority = createInboxCacheAuthority(() => connection, () => `scope-${++nonce}`)
  const request = (plugin, method, data, options) => new Promise((resolve, reject) => calls.push({ plugin, method, data, options, resolve, reject, answered: false }))
  const mocks = {
    react: runtime.react,
    'lucide-react': { RefreshCw: 'icon' },
    '../components/ui/button': { Button: 'button' },
    '../components/ui/card': { Card: 'article', CardHeader: 'header', CardTitle: 'h2', CardContent: 'section' },
    '../components/ui/alert': { Alert: 'aside', AlertDescription: 'p' },
    '../components/confirm-dialog': { ConfirmDialog: 'confirm-dialog' },
    '../utils/auth': { captureApiRequestContext: () => ({ apiBase: connection.host, token: connection.credential }) },
    '../utils/plugin-rpc': { pluginRpc: request },
    '../utils/demo-mode': { isDemoMode: () => demo },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() },
    '../utils/inbox-cache': { isInboxCacheScopeActive: value => authority.active(value) },
    './tool-approvals-model.mjs': model,
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
  let scope = authority.current()
  const mount = () => runtime.mount(() => module.exports.HostToolApprovalSession({ scope }))
  mount()
  return { runtime, calls,
    button(label) { const found = elements(runtime.value).find(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label)); assert(found, label); return found },
    dialog() { return elements(runtime.value).find(node => node.type === 'confirm-dialog') },
    answer(method, value, failed = false) { const call = calls.find(item => !item.answered && item.method === method); assert(call, `pending ${method}`); call.answered = true; failed ? call.reject(value) : call.resolve(value); return call },
    switchHost() { connection = { host: 'https://host-b.invalid', credential: 'synthetic-B' } },
    switchCredential() { connection = { ...connection, credential: 'synthetic-B' } },
    remount() { runtime.unmount(); scope = authority.current(); mount() },
  }
}
async function loaded(f, value = catalog()) { f.answer('tool-approvals', value); await f.runtime.settle() }
async function startDecision(f, label = '批准一次') {
  f.button(label).props.onClick(); f.runtime.render()
  assert.equal(f.dialog().props.open, true)
  const confirm = f.dialog().props.onConfirm
  const pending = confirm(); await f.runtime.settle()
  return { pending, confirm }
}

test('TaskCenter actually mounts a distinct Host tool approval panel; original task sources had no G6 entry', async () => {
  const taskSource = await readFile(new URL('../console-ui/src/pages/task-center.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('task-center.tsx', taskSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const entries = []
  const visit = node => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'HostToolApprovalsPanel') entries.push(node); ts.forEachChild(node, visit) }
  visit(ast)
  assert.equal(entries.length, 1)
})

test('reads pending cards, shows actual arguments and triggering session, and waits for explicit dialog confirmation', async () => {
  const f = fixture()
  assert.equal(f.calls.length, 1); await loaded(f)
  assert.match(text(f.runtime.value), /Host 工具审批/)
  assert.match(text(f.runtime.value), /synthetic command/); assert.match(text(f.runtime.value), /发起会话：sandbox:bot:group:room/)
  assert.doesNotMatch(text(f.runtime.value), /recent-tool|投递账号/)
  f.button('批准一次').props.onClick(); f.runtime.render()
  assert.equal(f.dialog().props.open, true)
  assert.match(text(f.dialog()), /synthetic command/)
  assert.equal(f.calls.filter(call => call.method === 'resolve-tool-approval').length, 0)
  const staleConfirm = f.dialog().props.onConfirm
  f.dialog().props.onOpenChange(false); f.runtime.render()
  await staleConfirm()
  assert.equal(f.calls.filter(call => call.method === 'resolve-tool-approval').length, 0)
  f.runtime.unmount()
})

test('executes one confirmed decision under the captured owner, then reads current queue without remember or auto approval', async () => {
  const f = fixture(); await loaded(f)
  const { pending, confirm } = await startDecision(f)
  await confirm()
  const actions = f.calls.filter(call => call.method === 'resolve-tool-approval')
  assert.equal(actions.length, 1)
  assert.equal(actions[0].plugin, 'root'); assert.deepEqual(actions[0].data, { id: card.id, decision: 'approve' })
  assert.equal(actions[0].options.context.apiBase, 'https://host-a.invalid')
  assert.equal(actions[0].options.signal, undefined)
  f.answer('resolve-tool-approval', { ...card, status: 'approved', decidedBy: 'console', channel: 'console' })
  await f.runtime.settle(); f.answer('tool-approvals', catalog([])); await pending; await f.runtime.settle()
  assert.match(text(f.runtime.value), /当前没有待审批/)
  assert.equal(f.calls.length, 3)
  f.runtime.unmount()
})

test('refresh retires an open review so an old confirmation cannot use a changed or unreadable catalog', async () => {
  const f = fixture(); await loaded(f)
  f.button('批准一次').props.onClick(); f.runtime.render()
  const stale = f.dialog().props.onConfirm
  const refreshing = f.button('刷新工具审批').props.onClick(); await f.runtime.settle()
  assert.equal(f.dialog().props.open, false)
  f.answer('tool-approvals', new Error('catalog unavailable'), true)
  await refreshing; await f.runtime.settle(); await stale()
  assert.equal(f.calls.filter(call => call.method === 'resolve-tool-approval').length, 0)
  f.runtime.unmount()
})

test('old dialog callbacks cannot settle after a Host or credential change, even before the event rerenders the page', async () => {
  for (const change of ['switchHost', 'switchCredential']) {
    const f = fixture(); await loaded(f)
    f.button('拒绝').props.onClick(); f.runtime.render()
    const staleConfirm = f.dialog().props.onConfirm
    f[change]()
    await staleConfirm()
    assert.equal(f.calls.filter(call => call.method === 'resolve-tool-approval').length, 0)
    f.runtime.render(); assert.equal(f.dialog().props.open, false)
    assert.doesNotMatch(text(f.runtime.value), /synthetic command/)
    f.runtime.unmount()
  }
})

test('retiring the view aborts old reads and ignores a delayed response after the new owner mounts', async () => {
  const f = fixture(), old = f.calls[0]
  f.switchHost(); f.remount()
  assert.equal(old.options.signal.aborted, true)
  const fresh = f.calls[1]
  fresh.answered = true; fresh.resolve(catalog([{ ...card, id: 'new-card', toolName: 'new-owner-tool' }]))
  await f.runtime.settle()
  old.answered = true; old.resolve(catalog([{ ...card, toolName: 'old-owner-tool' }]))
  await f.runtime.settle()
  assert.match(text(f.runtime.value), /new-owner-tool/); assert.doesNotMatch(text(f.runtime.value), /old-owner-tool/)
  f.runtime.unmount()
})

test('unknown mutation outcome is not retried and requires a fresh read before another explicit decision', async () => {
  const f = fixture(); await loaded(f)
  const { pending, confirm } = await startDecision(f)
  f.answer('resolve-tool-approval', new TypeError('response lost after commit'), true)
  await pending; await f.runtime.settle()
  assert.match(text(f.runtime.value), /审批结果尚未确认/)
  assert.equal(f.button('批准一次').props.disabled, true)
  await confirm(); await f.runtime.settle()
  assert.equal(f.calls.length, 2)
  const refreshing = f.button('刷新工具审批').props.onClick(); await f.runtime.settle()
  f.answer('tool-approvals', catalog([])); await refreshing; await f.runtime.settle()
  assert.equal(f.calls.filter(call => call.method === 'resolve-tool-approval').length, 1)
  assert.match(text(f.runtime.value), /当前没有待审批/)
  f.runtime.unmount()
})

test('a definite conflict preserves the server reason and reads current queue without retrying the action', async () => {
  const f = fixture(); await loaded(f)
  const { pending } = await startDecision(f, '拒绝')
  f.answer('resolve-tool-approval', Object.assign(new Error('card is already approved'), { code: 'conflict' }), true)
  await f.runtime.settle(); f.answer('tool-approvals', catalog([])); await pending; await f.runtime.settle()
  assert.match(text(f.runtime.value), /card is already approved/)
  assert.match(text(f.runtime.value), /当前没有待审批/)
  assert.equal(f.calls.filter(call => call.method === 'resolve-tool-approval').length, 1)
  f.runtime.unmount()
})

test('permission and unavailable reads stay errors/unavailable states rather than silently empty catalogs', async () => {
  const denied = fixture()
  denied.answer('tool-approvals', Object.assign(new Error('read permission denied'), { code: 'forbidden' }), true)
  await denied.runtime.settle()
  assert.match(text(denied.runtime.value), /read permission denied/); assert.doesNotMatch(text(denied.runtime.value), /当前没有待审批/)
  denied.runtime.unmount()
  const unavailable = fixture(); await loaded(unavailable, { available: false, pending: [], recent: [] })
  assert.match(text(unavailable.runtime.value), /未提供工具审批队列/)
  unavailable.runtime.unmount()
})

test('Demo mounts a read-only panel without issuing approval reads, actions, or recurring work', async () => {
  const f = fixture({ demo: true }); await f.runtime.settle()
  assert.equal(f.calls.length, 0)
  assert.match(text(f.runtime.value), /Demo 只读/)
  assert.equal(f.dialog().props.open, false)
  f.runtime.unmount()
})
