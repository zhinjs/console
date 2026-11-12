import { localeModule, isLocaleImport } from './locale-fixture.mjs'
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'

const source = await readFile(new URL('../console-ui/src/utils/auth.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText
function storage() {
  const items = new Map()
  return { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value), removeItem: key => items.delete(key) }
}
function harness() {
  const exports = {}, requests = [], events = [], localStorage = storage(), sessionStorage = storage()
  const window = { location: { origin: 'https://console.example', href: 'https://console.example/login' }, dispatchEvent: event => events.push(event.type) }
  vm.runInNewContext(compiled, { require: name => { assert.ok(isLocaleImport(name)); return localeModule }, exports, Headers, URL, AbortSignal, localStorage, sessionStorage, window,
    CustomEvent: class { constructor(type) { this.type = type } },
    fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })) })
  exports.setApiBase('https://host-a.example'); exports.setToken('test-credential-a')
  return { auth: exports, requests, events, window, localStorage, sessionStorage }
}

test('a session-only token replaces stale persistent credentials and remains available to authenticated reads', () => {
  const { auth, localStorage, sessionStorage } = harness()
  auth.setToken('session-credential', false)
  assert.equal(localStorage.getItem('zhin_api_token'), null)
  assert.equal(sessionStorage.getItem('zhin_api_token'), 'session-credential')
  assert.equal(auth.getToken(), 'session-credential')
  auth.setToken('remembered-credential', true)
  assert.equal(localStorage.getItem('zhin_api_token'), 'remembered-credential')
  assert.equal(sessionStorage.getItem('zhin_api_token'), null)
  auth.clearToken()
  assert.equal(auth.getToken(), null)
})

const me = data => ({ ok: true, status: 200, json: async () => ({ success: true, data }) })
const settle = async () => { for (let index = 0; index < 12; index++) await Promise.resolve() }

test('verified login honors the session-only choice and checks the token with the gateway /auth/me', async () => {
  const { auth, requests, localStorage, sessionStorage } = harness()
  const pending = auth.verifyAndStoreCredentials('https://host-b.example', 'Bearer session-credential', 'zh-CN', false)
  assert.ok(requests[0].init.signal instanceof AbortSignal)
  requests[0].resolve({ ok: true })
  await settle()
  assert.equal(requests[1].url, 'https://host-b.example/api/auth/me')
  assert.equal(requests[1].init.headers.Authorization, 'Bearer session-credential')
  assert.ok(requests[1].init.signal instanceof AbortSignal)
  requests[1].resolve(me({ kind: 'api-token', permissions: ['status.view'], bindings: [], setupRequired: false }))
  assert.equal((await pending).ok, true)
  assert.equal(requests.length, 2, 'the instance status route is not needed to sign in')
  assert.equal(localStorage.getItem('zhin_api_token'), null)
  assert.equal(sessionStorage.getItem('zhin_api_token'), 'session-credential')
  assert.equal(auth.getApiBase(), 'https://host-b.example')
})

test('an API token signs in while the instance is stopped: /pub/health reports it, /auth/me answers from the gateway', async () => {
  const { auth, requests } = harness()
  const pending = auth.verifyAndStoreCredentials('https://host-e.example', 'api-credential', 'zh-CN', true)
  requests[0].resolve({ ok: true, json: async () => ({ success: true, status: 'ok', instance: { state: 'crashed', ready: false } }) })
  await settle()
  requests[1].resolve(me({ kind: 'api-token', permissions: [], bindings: [], setupRequired: false }))
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(JSON.stringify(result.instance), JSON.stringify({ state: 'crashed', ready: false }))
  assert.equal(requests.length, 2)
  assert.equal(auth.getToken(), 'api-credential')
})

test('an unknown token reads as anonymous and fails as 401 with the next step; the previous credential stays', async () => {
  for (const setupRequired of [false, true]) {
    const { auth, requests } = harness()
    const pending = auth.verifyAndStoreCredentials('https://host-f.example', 'stale-token', 'zh-CN', true)
    requests[0].resolve({ ok: true })
    await settle()
    requests[1].resolve(me({ kind: 'anonymous', permissions: [], bindings: [], setupRequired }))
    const result = await pending
    assert.equal(result.ok, false)
    assert.equal(result.status, 401)
    assert.match(result.message, setupRequired ? /初始化链接|HTTP_TOKEN/u : /账号登录|API 令牌/u)
    assert.equal(auth.getToken(), 'test-credential-a')
  }
})

test('a busy gateway database is reported with its Retry-After, not as a wrong token', async () => {
  const { auth, requests } = harness()
  const pending = auth.verifyAndStoreCredentials('https://host-g.example', 'api-credential', 'zh-CN', true)
  requests[0].resolve({ ok: true })
  await settle()
  requests[1].resolve({ ok: false, status: 503, headers: new Headers({ 'retry-after': '3' }), json: async () => ({ success: false, code: 'database_busy', error: '数据库正忙' }) })
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.code, 'database_busy')
  assert.equal(result.retryAfterSec, 3)
  assert.match(result.message, /3 秒/u)
})

test('Hosts without /auth/* fall back to the instance status route', async () => {
  const { auth, requests } = harness()
  const pending = auth.verifyAndStoreCredentials('https://host-h.example', 'legacy-token', 'zh-CN', true)
  requests[0].resolve({ ok: true })
  await settle()
  requests[1].resolve({ ok: false, status: 404, json: async () => { throw new Error('not json') } })
  await settle()
  assert.equal(requests[2].url, 'https://host-h.example/api/system/status')
  requests[2].resolve({ ok: true, status: 200 })
  assert.equal((await pending).ok, true)
  assert.equal(auth.getToken(), 'legacy-token')
})

test('a delayed 401 from Host A cannot clear Host B credentials or require B to sign in', async () => {
  const { auth, requests, events } = harness()
  const pending = auth.apiFetch('/api/messages/diagnostics')
  auth.setApiBase('https://host-b.example'); auth.setToken('test-credential-b')
  requests[0].resolve({ status: 401 }); await pending
  assert.equal(auth.getApiBase(), 'https://host-b.example'); assert.equal(auth.getToken(), 'test-credential-b')
  assert.equal(events.length, 0)
})

test('a delayed 401 cannot revoke a new token on the same Host, including runtime tokens', async () => {
  const { auth, requests, events, window } = harness()
  const pending = auth.apiFetch('/api/messages/diagnostics')
  window.__ZHIN_API_TOKEN = 'test-runtime-credential-b'
  requests[0].resolve({ status: 401 }); await pending
  assert.equal(auth.getToken(), 'test-runtime-credential-b'); assert.equal(events.length, 0)
})

test('a current Host 401 expires only the credentials that issued the request', async () => {
  const { auth, requests, events } = harness()
  const pending = auth.apiFetch('/api/messages/diagnostics')
  assert.equal(requests[0].url, 'https://host-a.example/api/messages/diagnostics')
  assert.equal(requests[0].init.headers.has('Authorization'), true)
  requests[0].resolve({ status: 401 }); await pending
  assert.equal(auth.getToken(), null); assert.deepEqual(events, ['zhin:auth-required'])
})

test('external absolute URL, URL object and Request input cannot receive the Host token or invalidate its session', async () => {
  for (const input of ['https://external.example/health', new URL('https://external.example/health'), new Request('https://external.example/health')]) {
    const { auth, requests, events } = harness()
    const pending = auth.apiFetch(input)
    assert.equal(requests[0].init.headers.has('Authorization'), false)
    requests[0].resolve({ status: 401 }); await pending
    assert.equal(auth.getToken(), 'test-credential-a'); assert.equal(events.length, 0)
  }
})

test('absolute URLs in the configured Host path can expire that session, but sibling applications cannot', async () => {
  for (const [url, owned] of [['https://host-a.example/bot/api/messages/diagnostics', true], ['https://host-a.example/other/api', false], ['https://host-a.example/bot-other/api', false]]) {
    const { auth, requests, events } = harness()
    auth.setApiBase('https://host-a.example/bot')
    const pending = auth.apiFetch(url)
    assert.equal(requests[0].init.headers.has('Authorization'), owned)
    requests[0].resolve({ status: 401 }); await pending
    assert.equal(events.length, owned ? 1 : 0)
  }
})

test('a bootstrap token is recognised through /auth/me and kept for this browser session only', async () => {
  const { auth, requests, localStorage, sessionStorage } = harness()
  const pending = auth.verifyAndStoreCredentials('https://host-c.example', 'bootstrap-credential', 'zh-CN', true)
  requests[0].resolve({ ok: true })
  await settle()
  assert.equal(requests[1].url, 'https://host-c.example/api/auth/me')
  assert.equal(requests[1].init.headers.Authorization, 'Bearer bootstrap-credential')
  requests[1].resolve(me({ kind: 'bootstrap', open: false, permissions: [], bindings: [], setupRequired: true }))
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'bootstrap')
  assert.equal(localStorage.getItem('zhin_api_token'), null, 'never persisted, even when remembering was asked')
  assert.equal(sessionStorage.getItem('zhin_api_token'), 'bootstrap-credential')
  assert.equal(auth.getApiBase(), 'https://host-c.example')
})
