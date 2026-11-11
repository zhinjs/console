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

test('verified login honors the session-only choice and bounds both connection probes', async () => {
  const { auth, requests, localStorage, sessionStorage } = harness()
  const pending = auth.verifyAndStoreCredentials('https://host-b.example', 'Bearer session-credential', 'zh-CN', false)
  assert.ok(requests[0].init.signal instanceof AbortSignal)
  requests[0].resolve({ ok: true })
  for (let index = 0; index < 8; index++) await Promise.resolve()
  assert.equal(requests[1].url, 'https://host-b.example/api/system/status')
  assert.ok(requests[1].init.signal instanceof AbortSignal)
  requests[1].resolve({ ok: true })
  assert.equal((await pending).ok, true)
  assert.equal(localStorage.getItem('zhin_api_token'), null)
  assert.equal(sessionStorage.getItem('zhin_api_token'), 'session-credential')
  assert.equal(auth.getApiBase(), 'https://host-b.example')
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

test('a bootstrap token (403 setup_required) is recognised through /auth/me and kept for this browser session only', async () => {
  const { auth, requests, localStorage, sessionStorage } = harness()
  const pending = auth.verifyAndStoreCredentials('https://host-c.example', 'bootstrap-credential', 'zh-CN', true)
  requests[0].resolve({ ok: true })
  for (let index = 0; index < 8; index++) await Promise.resolve()
  assert.equal(requests[1].url, 'https://host-c.example/api/system/status')
  requests[1].resolve({ ok: false, status: 403 })
  for (let index = 0; index < 8; index++) await Promise.resolve()
  assert.equal(requests[2].url, 'https://host-c.example/api/auth/me')
  assert.equal(requests[2].init.headers.Authorization, 'Bearer bootstrap-credential')
  requests[2].resolve({ ok: true, json: async () => ({ success: true, data: { kind: 'bootstrap', open: false, setupRequired: true } }) })
  const result = await pending
  assert.equal(result.ok, true)
  assert.equal(result.kind, 'bootstrap')
  assert.equal(localStorage.getItem('zhin_api_token'), null, 'never persisted, even when remembering was asked')
  assert.equal(sessionStorage.getItem('zhin_api_token'), 'bootstrap-credential')
  assert.equal(auth.getApiBase(), 'https://host-c.example')
})

test('a 403 from a token that is not the bootstrap token stays a failure', async () => {
  const { auth, requests } = harness()
  const pending = auth.verifyAndStoreCredentials('https://host-d.example', 'narrow-token', 'zh-CN', true)
  requests[0].resolve({ ok: true })
  for (let index = 0; index < 8; index++) await Promise.resolve()
  requests[1].resolve({ ok: false, status: 403 })
  for (let index = 0; index < 8; index++) await Promise.resolve()
  requests[2].resolve({ ok: true, json: async () => ({ success: true, data: { kind: 'api-token', setupRequired: false } }) })
  const result = await pending
  assert.equal(result.ok, false)
  assert.equal(result.status, 403)
  assert.equal(auth.getToken(), 'test-credential-a', 'the previous credential is untouched')
})
