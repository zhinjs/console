import { defaultI18n } from './locale-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import { readTaskMutation, readTaskProviders, reconcileTaskMutation, taskBusinessError } from '../console-ui/src/pages/task-center-model.mjs'
import { createDiagnosticRequestGate } from '../console-ui/src/pages/endpoint-detail/message-diagnostics.mjs'

async function pageHandler(name, bindings) {
  const source = await readFile(new URL('../console-ui/src/pages/task-center.tsx', import.meta.url), 'utf8')
  const ast = ts.createSourceFile('task-center.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
  let declaration
  const visit = node => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name) declaration = node; ts.forEachChild(node, visit) }
  visit(ast); assert.ok(declaration)
  const compiled = ts.transpileModule(`const ${declaration.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText
  return Function('i18n', ...Object.keys(bindings), `${compiled}; return ${name};`)(defaultI18n, ...Object.values(bindings))
}
const submitHandler = bindings => pageHandler('submit', bindings)
const noop = () => {}
function setup(fetcher) {
  const values = { pending: null, error: null, catalog: null, storage: new Map(), busy: false, notices: [] }
  let active = true, calls = 0
  const operation = { action: 'create', target: {}, effects: [], title: '确认', body: { owner: 'root/reminder', generation: 3, expectedRevision: 'r1', requestId: '0f920707-2b3f-41fa-ac6a-04f59071b392', target: {}, parameters: { text: 'private task content' } } }
  const writing = { current: false }
  const bindings = { review: operation, disabled: false, writing, pendingRef: { current: null }, scope: 'scope-a', isInboxCacheScopeActive: () => active,
    mutationEpoch: { current: 1 }, scopeRef: { current: 'scope-a' }, getApiBase: () => 'https://host.example',
    sessionStorage: { setItem: (key, value) => values.storage.set(key, value), removeItem: key => values.storage.delete(key) }, pendingStorageKey: () => 'pending-key',
    reads: { current: { cancel: noop } }, setLoading: noop, setBusy: value => { values.busy = value }, setPending: value => { values.pending = value }, setReview: noop,
    setError: value => { values.error = value }, setNotice: value => { values.notices.push(value) },
    CONSOLE_REST: { TASK_CREATE: '/api/tasks/create', TASK_CHANGE: '/api/tasks/change' },
    apiFetch: async (...args) => { calls++; return fetcher(...args) }, readTaskMutation, taskBusinessError,
    setCatalog: value => { values.catalog = value }, setCatalogReadable: noop, setBase: noop, setEditTask: noop, setParameters: noop,
  }
  return { values, bindings, writing, operation, calls: () => calls, disconnect: () => { active = false } }
}

test('actual page keeps the original operation after a lost response and never automatically resubmits', async () => {
  const harness = setup(async () => { throw new Error('reply lost') })
  const submit = await submitHandler(harness.bindings)
  await submit()
  assert.equal(harness.calls(), 1)
  assert.equal(harness.values.pending.requestId, harness.operation.body.requestId)
  const saved = JSON.parse(harness.values.storage.get('pending-key'))
  assert.equal(saved.requestId, harness.operation.body.requestId)
  assert.equal(Object.hasOwn(saved, 'target'), false); assert.equal(Object.hasOwn(saved, 'parameters'), false)
  assert.equal(harness.values.pending.operation, 'create')
  await submit(); assert.equal(harness.calls(), 1)
})

test('a deferred mutation result from an old connection cannot publish into the new connection', async () => {
  let finish
  const harness = setup(() => new Promise(resolve => { finish = resolve }))
  const submit = await submitHandler(harness.bindings), running = submit()
  harness.disconnect(); finish({ ok: true, json: async () => ({ success: true, data: {} }) })
  await running
  assert.equal(harness.values.catalog, null)
  assert.equal(harness.values.error, null)
  assert.ok(harness.values.pending)
})

test('duplicate confirms while the first mutation is in flight issue only one POST', async () => {
  let finish
  const harness = setup(() => new Promise(resolve => { finish = resolve }))
  const submit = await submitHandler(harness.bindings), first = submit()
  await submit(); assert.equal(harness.calls(), 1)
  finish({ ok: false, status: 409, json: async () => ({ success: false, code: 'conflict', error: '任务版本已变化' }) }); await first
  assert.equal(harness.values.pending, null); assert.equal(harness.values.storage.size, 0)
  assert.match(harness.values.error, /草稿已保留/)
})

test('actual read-only page refresh only unlocks a matching durable receipt and never replaces the draft baseline', async () => {
  const operation = { owner: 'root/reminder', generation: 3, requestId: 'request', operation: 'create', scope: 'scope-a', host: 'https://host.example' }
  const provider = { owner: operation.owner, title: '提醒', description: '', schema: { type: 'object', properties: {} }, effects: [], revision: 'r2', tasks: [], receipts: [] }
  const values = { pending: operation, cleared: 0, notices: [], baselineWrites: 0 }
  let body = { success: true, data: { generation: 3, providers: [provider] } }
  const pendingRef = { current: operation }, scope = 'scope-a'
  const bindings = { useCallback: fn => fn, scope, writing: { current: false }, reads: { current: createDiagnosticRequestGate(() => scope) },
    isInboxCacheScopeActive: value => value === scope, setLoading: noop, setError: noop,
    apiFetch: async () => ({ ok: true, json: async () => body }), CONSOLE_REST: { TASK_PROVIDERS: '/api/tasks/providers' },
    readTaskProviders, setCatalog: noop, setCatalogReadable: noop, pendingRef, getApiBase: () => 'https://host.example', reconcileTaskMutation,
    sessionStorage: { removeItem: () => { values.cleared++ } }, pendingStorageKey: () => 'pending-key',
    setPending: value => { values.pending = value }, setNotice: value => values.notices.push(value), setBase: () => { values.baselineWrites++ },
  }
  const refresh = await pageHandler('refresh', bindings)
  await refresh(); assert.equal(values.pending, operation); assert.equal(values.cleared, 0)
  body = { success: true, data: { generation: 3, providers: [{ ...provider, receipts: [{ requestId: 'request', taskId: 'server-task-id', operation: 'create' }] }] } }
  pendingRef.current = { ...operation, scope: 'old-login-scope' }
  await refresh(); assert.equal(values.pending, operation); assert.equal(values.cleared, 0)
  pendingRef.current = operation
  await refresh(); assert.equal(values.pending, null); assert.equal(values.cleared, 1)
  assert.match(values.notices.at(-1), /server-task-id/); assert.match(values.notices.at(-1), /不是平台消息投递确认/)
  assert.equal(values.baselineWrites, 0)
})

test('an actual catalog refresh error revokes write readiness instead of letting stale tasks appear writable', async () => {
  let readable = true, error
  const scope = 'scope-a'
  const refresh = await pageHandler('refresh', {
    useCallback: fn => fn, scope, writing: { current: false }, reads: { current: createDiagnosticRequestGate(() => scope) },
    isInboxCacheScopeActive: value => value === scope, setLoading: noop, setError: value => { error = value },
    setCatalogReadable: value => { readable = value }, apiFetch: async () => ({ ok: false, status: 503 }),
    CONSOLE_REST: { TASK_PROVIDERS: '/api/tasks/providers' },
  })
  await refresh()
  assert.equal(readable, false); assert.match(error, /503/)
})
