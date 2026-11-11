import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'
import * as approvalModel from '../console-ui/src/pages/tool-approvals-model.mjs'
import * as model from '../console-ui/src/pages/self-changes-model.mjs'

const source = await readFile(new URL('../console-ui/src/pages/HostSelfChangesPanel.tsx', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText

const change = {
  id: 'change-1', status: 'pending', contentHash: 'hash-1',
  files: [{ path: 'commands/ping.ts', op: 'write', sha256: 'x', bytes: 18 }],
  configPaths: ['set ping.apiKey'],
  preview: { version: 1, summary: '加一个 /ping 指令', files: [{ path: 'commands/ping.ts', kind: 'modify', added: 1, removed: 1 }] },
  trial: { passed: true, checks: [{ check: 'syntax', path: 'commands/ping.ts', status: 'passed' }, { check: 'sandbox_load', path: 'commands/ping.ts', status: 'skipped' }] },
  origin: { platform: 'icqq', sceneId: 'group:1', userId: '42' },
  approvalId: 'tap_1', approvedBy: null, error: null, bytes: 18,
  createdAt: 1, updatedAt: 1, submittedAt: 1, terminalAt: null, resolvedAt: null, slimmed: false,
}
const failedChange = { ...change, id: 'change-failed', status: 'failed', approvalId: null, error: 'health check failed', preview: { ...change.preview, summary: '急停的变更' } }
const catalog = (pending = [change], recent = []) => ({ available: true, pending, recent, usageBytes: 2048 })
const detail = (overrides = {}) => ({
  change, bodiesAvailable: true, baseline: 'disk', diffBytes: 80, maxDiffBytes: 65536, diffTruncated: false,
  files: [{ path: 'commands/ping.ts', kind: 'modify', diff: '--- a/commands/ping.ts\n+++ b/commands/ping.ts\n@@ -1,1 +1,1 @@\n-export default 1;\n+export default 2;', truncated: false, unavailableReason: null }],
  configPatch: { expectedRevision: 'rev-1', operations: [{ op: 'set', path: ['ping', 'apiKey'], value: '[redacted]' }] },
  trial: { passed: true, checks: change.trial.checks, pendingStages: ['plugin_tests'], skippedChecks: ['sandbox_load commands/ping.ts'] },
  usageBytes: 2048,
  ...overrides,
})

/** Expands function components too, so nested detail views are part of the rendered text. */
const expand = value => value && typeof value === 'object' && typeof value.type === 'function' ? expand(value.type(value.props)) : value
const elements = value => {
  const node = expand(value)
  return !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(elements)]
}
const text = value => {
  const node = expand(value)
  return node == null || typeof node === 'boolean' ? '' : typeof node !== 'object' ? String(node) : [node.props?.children].flat(Infinity).map(text).join('')
}

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

function fixture({ readOnly = false } = {}) {
  const runtime = hooks(), calls = []
  const connection = { host: 'https://host-a.invalid', credential: 'synthetic-A' }
  let nonce = 0
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
    '../utils/console-access.mjs': { hasConsolePermission: () => !readOnly },
    '../utils/useInboxCacheScope': { useInboxCacheScope: () => authority.current() },
    '../utils/inbox-cache': { isInboxCacheScopeActive: value => authority.active(value) },
    './tool-approvals-model.mjs': approvalModel,
    './self-changes-model.mjs': model,
  }
  const module = { exports: {} }
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
  const scope = authority.current()
  runtime.mount(() => module.exports.HostSelfChangeSession({ scope }))
  return { runtime, calls,
    buttons(label) { return elements(runtime.value).filter(node => node.type === 'button' && (text(node) === label || node.props['aria-label'] === label)) },
    button(label) { const found = this.buttons(label)[0]; assert(found, label); return found },
    dialog() { return elements(runtime.value).find(node => node.type === 'confirm-dialog') },
    answer(method, value, failed = false) { const call = calls.find(item => !item.answered && item.method === method); assert(call, `pending ${method}`); call.answered = true; failed ? call.reject(value) : call.resolve(value); return call },
  }
}
async function loaded(f, value = catalog()) { f.answer('self-changes', value); await f.runtime.settle() }

test('TaskCenter mounts the self-change panel next to the tool approvals panel', async () => {
  const taskSource = await readFile(new URL('../console-ui/src/pages/task-center.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('task-center.tsx', taskSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  const entries = []
  const visit = node => { if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(ast) === 'HostSelfChangesPanel') entries.push(node); ts.forEachChild(node, visit) }
  visit(ast)
  assert.equal(entries.length, 1)
})

test('lists pending changes with files, config paths, skipped checks and staging usage — metadata only', async () => {
  const f = fixture()
  assert.deepEqual(f.calls.map(call => [call.plugin, call.method]), [['root', 'self-changes']])
  await loaded(f)
  const view = text(f.runtime.value)
  assert.match(view, /自我变更审批/)
  assert.match(view, /加一个 \/ping 指令/)
  assert.match(view, /modify commands\/ping\.ts（\+1 -1）/)
  assert.match(view, /配置：set ping\.apiKey/)
  assert.match(view, /试跑跳过：sandbox_load commands\/ping\.ts/)
  assert.match(view, /暂存区占用：2\.0 KB/)
  assert.doesNotMatch(view, /export default/)
  f.runtime.unmount()
})

test('detail reads self-change-detail and shows the diff, redacted config, skipped checks and budget', async () => {
  const f = fixture(); await loaded(f)
  const reading = f.button('查看完整 diff').props.onClick(); await f.runtime.settle()
  const call = f.answer('self-change-detail', detail())
  assert.deepEqual(call.data, { id: change.id })
  assert.equal(call.options.context.apiBase, 'https://host-a.invalid')
  await reading; await f.runtime.settle()
  const view = text(f.runtime.value)
  assert.match(view, /-export default 1;/)
  assert.match(view, /\+export default 2;/)
  assert.match(view, /改动前：生产目录现有文件/)
  assert.match(view, /\[redacted\]/)
  assert.match(view, /未执行的阶段：plugin_tests/)
  assert.match(view, /skipped sandbox_load commands\/ping\.ts/)
  f.runtime.unmount()
})

test('a read-only token gets a readable ops:approve error instead of a diff', async () => {
  const f = fixture(); await loaded(f)
  const reading = f.button('查看完整 diff').props.onClick(); await f.runtime.settle()
  f.answer('self-change-detail', Object.assign(new Error('Forbidden'), { code: 'forbidden' }), true)
  await reading; await f.runtime.settle()
  assert.match(text(f.runtime.value), /查看完整 diff 需要 ops:approve 权限（Forbidden）/)
  f.runtime.unmount()
})

test('a slimmed change says its bodies are gone and invents no diff', async () => {
  const done = { ...change, id: 'change-done', status: 'rejected', slimmed: true, terminalAt: 2 }
  const f = fixture(); await loaded(f, catalog([], [done]))
  const reading = f.button('详情').props.onClick(); await f.runtime.settle()
  f.answer('self-change-detail', detail({
    change: done, bodiesAvailable: false, diffBytes: 0, diffTruncated: true,
    files: [{ path: 'commands/ping.ts', kind: 'modify', diff: null, truncated: true, unavailableReason: 'slimmed' }],
  }))
  await reading; await f.runtime.settle()
  assert.match(text(f.runtime.value), /正文已按保留规则清理，无法展示 diff/)
  assert.doesNotMatch(text(f.runtime.value), /export default/)
  f.runtime.unmount()
})

test('approve warns about blind approval, waits for confirmation, sends one decision and re-reads', async () => {
  const f = fixture(); await loaded(f)
  f.button('批准变更').props.onClick(); f.runtime.render()
  assert.equal(f.dialog().props.open, true)
  assert.match(text(f.dialog()), /不要盲批/)
  assert.equal(f.calls.filter(call => call.method === 'resolve-self-change').length, 0)
  const pending = f.dialog().props.onConfirm(); await f.runtime.settle()
  const action = f.answer('resolve-self-change', { ...change, status: 'approved', approvedBy: 'console', approvalId: null })
  assert.deepEqual(action.data, { id: change.id, decision: 'approve' })
  assert.equal(action.options.signal, undefined)
  await f.runtime.settle(); f.answer('self-changes', catalog([])); await pending; await f.runtime.settle()
  assert.match(text(f.runtime.value), /当前没有待审批的自我变更/)
  f.runtime.unmount()
})

test('reject after viewing the diff omits the blind-approval warning and sends reject', async () => {
  const f = fixture(); await loaded(f)
  const reading = f.button('查看完整 diff').props.onClick(); await f.runtime.settle()
  f.answer('self-change-detail', detail()); await reading; await f.runtime.settle()
  f.button('驳回变更').props.onClick(); f.runtime.render()
  assert.doesNotMatch(text(f.dialog()), /不要盲批/)
  const pending = f.dialog().props.onConfirm(); await f.runtime.settle()
  const action = f.answer('resolve-self-change', { ...change, status: 'rejected', slimmed: true })
  assert.deepEqual(action.data, { id: change.id, decision: 'reject' })
  await f.runtime.settle(); f.answer('self-changes', catalog([])); await pending; await f.runtime.settle()
  f.runtime.unmount()
})

test('a failed change can be marked handled through mark-self-change-handled', async () => {
  const f = fixture(); await loaded(f, catalog([], [failedChange]))
  assert.match(text(f.runtime.value), /急停待处理/)
  assert.match(text(f.runtime.value), /health check failed/)
  f.button('标记已处理').props.onClick(); f.runtime.render()
  const pending = f.dialog().props.onConfirm(); await f.runtime.settle()
  const action = f.answer('mark-self-change-handled', { ...failedChange, resolvedAt: 5, slimmed: true })
  assert.deepEqual(action.data, { id: failedChange.id })
  await f.runtime.settle(); f.answer('self-changes', catalog([], [{ ...failedChange, resolvedAt: 5, slimmed: true }])); await pending; await f.runtime.settle()
  assert.doesNotMatch(text(f.runtime.value), /急停待处理/)
  f.runtime.unmount()
})

test('an unknown decision outcome is not retried and locks decisions until a fresh read', async () => {
  const f = fixture(); await loaded(f)
  f.button('批准变更').props.onClick(); f.runtime.render()
  const confirm = f.dialog().props.onConfirm
  const pending = confirm(); await f.runtime.settle()
  f.answer('resolve-self-change', new TypeError('response lost after commit'), true)
  await pending; await f.runtime.settle()
  assert.match(text(f.runtime.value), /审批结果尚未确认/)
  assert.equal(f.button('批准变更').props.disabled, true)
  await confirm(); await f.runtime.settle()
  assert.equal(f.calls.filter(call => call.method === 'resolve-self-change').length, 1)
  f.runtime.unmount()
})

test('an identity without agent.configure mounts read-only without reads or actions', async () => {
  const f = fixture({ readOnly: true }); await f.runtime.settle()
  assert.equal(f.calls.length, 0)
  assert.match(text(f.runtime.value), /只读/)
  f.runtime.unmount()
})

test('model rejects malformed catalogs and detail payloads', () => {
  assert.throws(() => model.readSelfChanges({ available: true, pending: [] }), /自我变更目录/)
  assert.throws(() => model.readSelfChangeDetail({ ...detail(), baseline: 'elsewhere' }), /自我变更详情/)
  assert.throws(() => model.readSelfChangeDetail({ ...detail(), files: [{ path: 'a', kind: 'rename' }] }), /diff/)
  assert.deepEqual(model.skippedCheckNames(change.trial), ['sandbox_load commands/ping.ts'])
  assert.equal(model.diffLineTone('+x'), 'added')
  assert.equal(model.diffLineTone('+++ b/x'), 'header')
  assert.equal(model.formatBytes(65536), '64.0 KB')
})
