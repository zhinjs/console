import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { localeModule, isLocaleImport } from './locale-fixture.mjs'

const authSource = await readFile(new URL('../console-ui/src/utils/auth.ts', import.meta.url), 'utf8')
const rpcSource = await readFile(new URL('../console-ui/src/utils/plugin-rpc.ts', import.meta.url), 'utf8')
const compile = source => ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
const authCode = compile(authSource), rpcCode = compile(rpcSource)

function fixture() {
  const items = new Map(), requests = [], auth = {}, rpc = {}
  const storage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }
  const globals = { Headers, URL, localStorage: storage, sessionStorage: storage, window: { location: { origin: 'http://console.invalid' }, dispatchEvent() {} },
    CustomEvent: class {}, fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })) }
  vm.runInNewContext(authCode, { ...globals, exports: auth, require: name => { assert(isLocaleImport(name)); return localeModule } })
  vm.runInNewContext(rpcCode, { ...globals, exports: rpc, require: name => { assert.equal(name, './auth'); return auth } })
  auth.setApiBase('https://host-a.invalid'); auth.setToken('synthetic-A')
  return { auth, rpc, requests }
}

test('actual approval RPC keeps its captured Host/auth and passes the cancellable read signal', async () => {
  const { auth, rpc, requests } = fixture(), controller = new AbortController()
  const context = auth.captureApiRequestContext()
  auth.setApiBase('https://host-b.invalid'); auth.setToken('synthetic-B')
  const reading = rpc.pluginRpc('root', 'tool-approvals', undefined, { context, signal: controller.signal })
  assert.equal(requests[0].url, 'https://host-a.invalid/api/console/request')
  assert.equal(requests[0].init.headers.get('authorization'), 'Bearer synthetic-A')
  assert.equal(requests[0].init.signal, controller.signal)
  assert.equal(JSON.parse(requests[0].init.body).type, 'plugin.root.tool-approvals')
  requests[0].resolve({ status: 200, ok: true, json: async () => ({ success: true, data: { available: true, pending: [], recent: [] } }) })
  assert.deepEqual(JSON.parse(JSON.stringify(await reading)), { available: true, pending: [], recent: [] })
})

test('actual approval RPC preserves denied, missing, conflicting and unavailable server errors without retry', async () => {
  for (const [status, code] of [[403, 'forbidden'], [404, 'not_found'], [409, 'conflict'], [503, 'unavailable']]) {
    const { rpc, requests } = fixture()
    const pending = rpc.pluginRpc('root', 'resolve-tool-approval', { id: 'card-1', decision: 'approve' })
    assert.deepEqual(JSON.parse(requests[0].init.body).data, { id: 'card-1', decision: 'approve' })
    requests[0].resolve({ status, ok: false, json: async () => ({ success: false, code, error: 'original server reason' }) })
    await assert.rejects(pending, error => error.code === code && error.status === status && error.message === 'original server reason')
    assert.equal(requests.length, 1)
  }
})

test('a captured anonymous owner cannot acquire a later Host token and stale 401 cannot revoke it', async () => {
  const { auth, rpc, requests } = fixture()
  auth.clearToken()
  const context = auth.captureApiRequestContext()
  auth.setToken('synthetic-B')
  const pending = rpc.pluginRpc('root', 'tool-approvals', undefined, { context })
  assert.equal(requests[0].init.headers.has('authorization'), false)
  requests[0].resolve({ status: 401, ok: false, json: async () => ({ success: false, error: 'old owner denied' }) })
  await assert.rejects(pending)
  assert.equal(auth.getToken(), 'synthetic-B')
})
