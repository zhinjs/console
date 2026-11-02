import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import * as model from '../console-ui/src/pages/schedule-executions-model.mjs'
import * as trace from '../console-ui/src/pages/conversation-trace-model.mjs'
import { createInboxCacheAuthority } from '../console-ui/src/utils/inbox-cache-scope.mjs'

const run = { runId: 'run:/a', jobId: 'task:/a', label: '已删除的一次性任务', source: 'scheduled', queuedAt: 1000, startedAt: 2000, finishedAt: 4000, status: 'succeeded', attemptCount: 1, deliveryStatus: 'unknown' }
const result = { success: true, output: '已生成结果 <script>不能执行</script>', durationMs: 2000, tokenUsage: { input: 4, output: 3 }, delivery: { status: 'unknown', channel: 'im', message: '平台没有确认' }, replay: { disposition: 'committed', operations: [{ id: 'write1', status: 'committed', toolName: 'send' }] } }
const attempt = { runId: run.runId, jobId: run.jobId, attemptId: 'attempt:/1', number: 1, startedAt: 2000, finishedAt: 4000, result, retry: { decision: 'stop', reason: 'committed' }, progress: [{ type: 'attempt_progress', runId: run.runId, jobId: run.jobId, attemptId: 'attempt:/1', at: 2500, phase: 'tool', status: 'unknown', toolName: 'send' }] }
const record = { ...run, version: 1, job: { id: run.jobId }, result, attempts: [attempt] }
const envelope = data => ({ success: true, data: Array.isArray(data?.runs) ? { recordingHealth: { activeWriteFailures: 0, incompleteCompletedRuns: 0 }, ...data } : data })

test('wire identity validation accepts deleted jobs, rejects cross-task/run/attempt contamination and invalid states', () => {
  assert.equal(model.readExecutionPage(envelope({ runs: [run], nextCursor: null }), run.jobId).runs[0], run)
  assert.equal(model.readExecutionPage(envelope({ runs: [run], nextCursor: null })).runs[0], run)
  assert.equal(model.readExecutionDetail(envelope(record), run.jobId, run.runId), record)
  for (const row of [{ ...run, jobId: 'other' }, { ...run, status: 'unknown' }, { ...run, queuedAt: Infinity }]) assert.throws(() => model.readExecutionPage(envelope({ runs: [row], nextCursor: null }), run.jobId))
  for (const changed of [
    { ...record, runId: 'other' }, { ...record, attempts: [{ ...attempt, jobId: 'other' }] },
    { ...record, attempts: [{ ...attempt, progress: [{ ...attempt.progress[0], attemptId: 'other' }] }] },
    { ...record, attempts: [{ ...attempt, retry: { decision: 'replay', reason: 'unknown' } }] },
    { ...record, attemptCount: 2 }, { ...record, result: { ...result, delivery: { status: 'ok', channel: 'im' } } },
  ]) assert.throws(() => model.readExecutionDetail(envelope(changed), run.jobId, run.runId))
  assert.throws(() => model.readExecutionPage(envelope({ runs: [run, run], nextCursor: null })))
  assert.throws(() => model.readExecutionCleanup(envelope({ deleted: -1, cutoff: 2000 })))
})

test('queries retain exact opaque IDs/cursors, bounded pagination and truthful distinct outcomes', () => {
  const page = new URL(model.executionQuery(run.jobId, 'opaque+/='), 'https://host')
  assert.equal(page.searchParams.get('jobId'), run.jobId); assert.equal(page.searchParams.get('cursor'), 'opaque+/='); assert.equal(page.searchParams.get('limit'), '50')
  assert.equal(new URL(model.executionQuery(), 'https://host').searchParams.has('jobId'), false)
  assert.equal(new URL(model.executionDetailQuery(run.jobId, run.runId), 'https://host').searchParams.get('runId'), run.runId)
  assert.match(model.deliveryStatus('unknown'), /未知/); assert.doesNotMatch(model.deliveryStatus('unknown'), /失败|完成/)
  assert.equal(model.deliveryStatus('partial', 'zh-CN', true), '部分投递 · 其余投递结果未知')
  assert.equal(model.executionStatus('unsettled'), '状态待核对'); assert.doesNotMatch(model.executionStatus('unsettled'), /执行中|成功|失败/)
  const partial = { ...record, status: 'budget_partial', result: { ...result, status: 'budget_partial' }, attempts: [{ ...attempt, result: { ...result, status: 'budget_partial' } }] }
  assert.equal(model.readExecutionDetail(envelope(partial), run.jobId, run.runId).status, 'budget_partial')
  assert.equal(model.executionStatus('budget_partial'), '部分完成（预算耗尽）')
  assert.match(model.executionStatus('interrupted'), /未确认/); assert.match(model.executionFailure(403), /权限/); assert.match(model.executionFailure(503), /存储/)
})

const source = await readFile(new URL('../console-ui/src/pages/ScheduleExecutions.tsx', import.meta.url), 'utf8')
const require = createRequire(import.meta.url)
function fixture({ component = 'ScheduleExecutions', props = { jobId: run.jobId }, demo = false } = {}) {
  let connection = { host: 'https://host-a', credential: 'a' }, count = 0
  const authority = createInboxCacheAuthority(() => connection, () => `scope-${++count}`)
  const scope = authority.current()
  let slots = [], cursor = 0, dirty = false, tree
  const effects = [], requests = []
  const equal = (a, b) => a && b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]))
  const hooks = {
    useState(initial) { const i = cursor++; if (!(i in slots)) slots[i] = typeof initial === 'function' ? initial() : initial; return [slots[i], value => { slots[i] = typeof value === 'function' ? value(slots[i]) : value; dirty = true }] },
    useRef(initial) { const i = cursor++; return slots[i] ?? (slots[i] = { current: initial }) },
    useEffect(effect, deps) { const i = cursor++; if (!equal(slots[i]?.deps, deps)) { const previous = slots[i]; slots[i] = { deps }; effects.push(() => { previous?.cleanup?.(); slots[i].cleanup = effect() }) } },
  }
  const mocks = {
    react: hooks, 'lucide-react': new Proxy({}, { get: () => 'icon' }), '../utils/auth': { apiFetch: (path, init) => new Promise((resolve, reject) => requests.push({ path, init, resolve, reject })) },
    '../utils/inbox-cache': { isInboxCacheScopeActive: value => authority.active(value) }, '../utils/demo-mode': { isDemoMode: () => demo },
    '../components/ui/button': { Button: 'button' }, '../components/ui/badge': { Badge: 'badge' }, '../components/ui/alert': { Alert: 'alert', AlertDescription: 'p' },
    '../components/ui/dialog': Object.fromEntries(['Dialog', 'DialogContent', 'DialogHeader', 'DialogTitle', 'DialogDescription', 'DialogFooter', 'DialogClose'].map(name => [name, name])),
    '../components/ui/tabs': Object.fromEntries(['Tabs', 'TabsContent', 'TabsList', 'TabsTrigger'].map(name => [name, name])),
    './conversation-trace-model.mjs': trace, './schedule-executions-model.mjs': model, './schedule-executions.css': {},
  }
  const module = { exports: {} }
  const code = ts.transpileModule(source + '\nexport { ExecutionDetail, AttemptTrace };', { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'exports', 'module', code)(name => isLocaleImport(name) ? localeModule : Object.hasOwn(mocks, name) ? mocks[name] : require(name), module.exports, module)
  const f = {
    requests, module: module.exports, scope,
    render() { let passes = 0; do { assert.ok(++passes < 25); dirty = false; cursor = 0; tree = module.exports[component]({ ...props, connectionScope: scope, scope }); effects.splice(0).forEach(effect => effect()) } while (dirty); return tree },
    async settle() { for (let i = 0; i < 16; i++) { await Promise.resolve(); if (dirty) f.render() } return tree },
    respond(index, data, status = 200) { requests[index].resolve({ ok: status >= 200 && status < 300, status, json: async () => data }) },
    change(kind) { connection = kind === 'logout' ? undefined : { host: kind === 'host' ? 'https://host-b' : connection.host, credential: 'b' }; authority.current() },
    close() { slots.forEach(slot => slot?.cleanup?.()) }, get tree() { return tree },
  }
  f.render(); return f
}
const elements = node => node?.type === 'Dialog' && !node.props.open ? [] : node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(elements)] : []
const text = node => node?.type === 'Dialog' && !node.props.open ? '' : node && typeof node === 'object' && typeof node.type === 'function' && ['ReadError', 'ResultContent'].includes(node.type.name) ? text(node.type(node.props)) : typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const button = (tree, label) => elements(tree).find(node => node.type === 'button' && text(node) === label)

test('actual history panel reads lazily, paginates and opens original deleted-job detail without any replay action', async () => {
  const f = fixture({ props: {} }); assert.equal(f.requests.length, 1); assert.equal(new URL(f.requests[0].path, 'https://host').searchParams.has('jobId'), false)
  f.respond(0, envelope({ runs: [run], nextCursor: 'next' })); await f.settle()
  assert.match(text(f.tree), /已删除的一次性任务/); assert.match(text(f.tree), /投递结果未知/)
  assert.doesNotMatch(text(f.tree), /重放|补发|重新执行/)
  const row = elements(f.tree).find(node => node.type === 'button' && node.props.className === 'schedule-execution-row')
  row.props.onClick(); f.render()
  const detail = elements(f.tree).find(node => node.type === f.module.ExecutionDetail)
  assert.equal(detail.props.jobId, run.jobId); assert.equal(detail.props.runId, run.runId)
  assert.equal(f.requests.length, 1, 'detail/trace need their own mounted owner')
  button(f.tree, '加载更早记录').props.onClick(); assert.match(f.requests[1].path, /cursor=next/)
  f.respond(1, envelope({ runs: [{ ...run, runId: 'earlier', queuedAt: 500 }], nextCursor: null })); await f.settle()
  assert.equal(elements(f.tree).filter(node => node.props.className === 'schedule-execution-row').length, 2)
  f.close()
})

test('403/503/missing history remain errors, never empty success or cleanup authority', async () => {
  for (const status of [403, 404, 503]) {
    const f = fixture(); f.respond(0, {}, status); await f.settle()
    assert.ok(text(f.tree).includes(model.executionFailure(status))); assert.doesNotMatch(text(f.tree), /暂无可用执行记录/)
    assert.equal(button(f.tree, '清理过期记录'), undefined); f.close()
  }
  const empty = fixture(); empty.respond(0, envelope({ runs: [], nextCursor: null })); await empty.settle()
  assert.match(text(empty.tree), /较早的执行可能未保存或已过期/); assert.doesNotMatch(text(empty.tree), /从未执行/); empty.close()
  const incomplete = fixture(); incomplete.respond(0, envelope({ runs: [], nextCursor: null, recordingHealth: { activeWriteFailures: 0, incompleteCompletedRuns: 1 } })); await incomplete.settle()
  assert.match(text(incomplete.tree), /部分执行记录未完整保存/); incomplete.close()
})

for (const change of ['host', 'credential', 'logout', 'unmount']) test(`actual reads and captured mutation callbacks retire on ${change}`, async () => {
  const f = fixture(); f.respond(0, envelope({ runs: [run], nextCursor: null })); await f.settle()
  button(f.tree, '清理过期记录').props.onClick(); f.render()
  const cleanup = elements(f.tree).filter(node => node.type === 'button' && text(node) === '清理过期记录').at(-1).props.onClick
  const refresh = button(f.tree, '刷新记录').props.onClick
  if (change === 'unmount') f.close(); else f.change(change)
  cleanup(); refresh(); await f.settle(); assert.equal(f.requests.length, 1); f.close()
  const pending = fixture(); if (change === 'unmount') pending.close(); else pending.change(change)
  pending.respond(0, envelope({ runs: [run], nextCursor: null })); await pending.settle()
  assert.doesNotMatch(text(pending.tree), /投递结果未知/); pending.close()
})

test('same-connection list refresh rejects late older response and cleanup is expired-only with unconfirmed failures', async () => {
  const f = fixture(); const refresh = button(f.tree, '刷新记录').props.onClick
  refresh(); assert.equal(f.requests[0].init.signal.aborted, true)
  f.respond(1, envelope({ runs: [run], nextCursor: null })); await f.settle()
  f.respond(0, envelope({ runs: [{ ...run, runId: 'old', label: '过时私有内容' }], nextCursor: null })); await f.settle()
  assert.doesNotMatch(text(f.tree), /过时私有内容/)
  button(f.tree, '清理过期记录').props.onClick(); f.render()
  const confirm = () => elements(f.tree).filter(node => node.type === 'button' && text(node) === '清理过期记录').at(-1)
  assert.match(text(f.tree), /当前 Host 所有任务中超过一个自然月的非活动/)
  confirm().props.onClick(); assert.equal(f.requests[2].path, '/api/assistant/executions/cleanup'); assert.equal(f.requests[2].init.method, 'POST'); assert.equal(f.requests[2].init.body, undefined)
  f.requests[2].reject(new Error('disconnected')); await f.settle(); assert.match(text(f.tree), /清理结果尚未确认/); assert.equal(f.requests.length, 3, 'no automatic mutation retry')
  f.close()
})

test('submitted cleanup settling after Host/credential change cannot refresh or publish results to the new connection', async () => {
  for (const change of ['host', 'credential', 'logout']) for (const reject of [false, true]) {
    const f = fixture(); f.respond(0, envelope({ runs: [run], nextCursor: null })); await f.settle()
    button(f.tree, '清理过期记录').props.onClick(); f.render()
    elements(f.tree).filter(node => node.type === 'button' && text(node) === '清理过期记录').at(-1).props.onClick()
    assert.equal(f.requests.length, 2); f.change(change)
    if (reject) f.requests[1].reject(new Error('old failure'))
    else f.respond(1, envelope({ deleted: 2, cutoff: 500 }))
    await f.settle(); assert.equal(f.requests.length, 2); assert.doesNotMatch(text(f.tree), /已清理|old failure/); f.close()
  }
})

test('a successful cleanup refreshes once without recreating or replaying a task; demo never exposes cleanup', async () => {
  const f = fixture(); f.respond(0, envelope({ runs: [run], nextCursor: null })); await f.settle()
  button(f.tree, '清理过期记录').props.onClick(); f.render()
  elements(f.tree).filter(node => node.type === 'button' && text(node) === '清理过期记录').at(-1).props.onClick()
  f.respond(1, envelope({ deleted: 1, cutoff: 500 })); await f.settle()
  assert.equal(f.requests.length, 3); assert.match(f.requests[2].path, /^\/api\/assistant\/executions\?/)
  assert.equal(f.requests.filter(request => request.init.method === 'POST').length, 1); assert.match(text(f.tree), /已清理 1 条/); f.close()
  const demo = fixture({ demo: true }); demo.respond(0, envelope({ runs: [run], nextCursor: null })); await demo.settle(); assert.equal(button(demo.tree, '清理过期记录'), undefined); demo.close()
})

test('a hung cleanup leaves dismissal available without cancelling it or admitting a duplicate submission', async () => {
  const f = fixture(); f.respond(0, envelope({ runs: [run], nextCursor: null })); await f.settle()
  const open = button(f.tree, '清理过期记录').props.onClick
  open(); f.render()
  const submit = elements(f.tree).filter(node => node.type === 'button' && text(node) === '清理过期记录').at(-1).props.onClick
  submit(); submit(); await f.settle()
  assert.equal(f.requests.filter(request => request.init.method === 'POST').length, 1)
  const dialog = elements(f.tree).find(node => node.type === 'Dialog' && node.props.open && text(node).includes('清理过期记录'))
  assert.equal(button(dialog, '关闭').props.disabled, undefined)
  assert.equal(button(dialog, '清理中…').props.disabled, true)
  // Radix Escape, its X and DialogClose all use this controlled dismissal callback.
  // Native focus/keyboard behavior is accepted separately in the real browser.
  dialog.props.onOpenChange(false); f.render()
  assert.equal(elements(f.tree).some(node => node.type === 'Dialog' && node.props.open), false)
  assert.equal(f.requests[1].init.signal.aborted, false, 'closing the display is not backend cancellation')
  assert.equal(button(f.tree, '清理过期记录').props.disabled, true)
  open(); submit(); await f.settle()
  assert.equal(f.requests.length, 2, 'retained callbacks cannot reopen or repeat an in-flight cleanup')
  assert.equal(elements(f.tree).some(node => node.type === 'Dialog' && node.props.open), false)
  f.respond(1, envelope({ deleted: 1, cutoff: 500 })); await f.settle()
  assert.match(text(f.tree), /已清理 1 条/)
  assert.equal(f.requests.length, 3, 'late success performs its existing single refresh')
  assert.equal(elements(f.tree).some(node => node.type === 'Dialog' && node.props.open), false)
  f.close()
})

test('detail presents generated result separately from unknown delivery and actual stop decision; trace is on demand', async () => {
  const f = fixture({ component: 'ExecutionRecordContent', props: { record } })
  assert.equal(f.requests.length, 0); assert.match(text(f.tree), /操作已提交，避免重复执行/); assert.match(text(f.tree), /投递结果未知/)
  assert.match(text(f.tree), /最终尝试：输入 4 \/ 输出 3 tokens/)
  assert.equal(elements(f.tree).some(node => node.type === f.module.AttemptTrace), false)
  button(f.tree, '查看诊断轨迹').props.onClick(); f.render()
  const traceNode = elements(f.tree).find(node => node.type === f.module.AttemptTrace); assert.equal(traceNode.props.attempt.attemptId, attempt.attemptId)
  assert.equal(f.requests.length, 0); f.close()
  const detail = fixture({ component: 'ExecutionDetail', props: { jobId: run.jobId, runId: run.runId } })
  assert.equal(detail.requests[0].path, model.executionDetailQuery(run.jobId, run.runId))
  detail.respond(0, envelope({ ...record, runId: 'different' })); await detail.settle(); assert.match(text(detail.tree), /不匹配/); detail.close()
  const diagnostic = fixture({ component: 'AttemptTrace', props: { attempt } })
  const path = new URL(diagnostic.requests[0].path, 'https://host')
  assert.equal(path.pathname, '/api/agent/trace-archive/turn'); assert.equal(path.searchParams.get('sessionKey'), `schedule:${run.jobId}`); assert.equal(path.searchParams.get('turnId'), attempt.attemptId)
  diagnostic.respond(0, {}, 404); await diagnostic.settle(); assert.ok(text(diagnostic.tree).includes(trace.traceFailure(404))); diagnostic.close()
})
