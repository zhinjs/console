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
  const exports = {}, requests = [], events = [], window = { location: { origin: 'https://console.example' }, dispatchEvent: event => events.push(event.type) }
  vm.runInNewContext(compiled, { exports, Headers, URL, localStorage: storage(), sessionStorage: storage(), window,
    CustomEvent: class { constructor(type) { this.type = type } },
    fetch: (url, init) => new Promise(resolve => requests.push({ url, init, resolve })) })
  exports.setApiBase('https://host-a.example'); exports.setToken('test-credential-a')
  return { auth: exports, requests, events, window }
}

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
