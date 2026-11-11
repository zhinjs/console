import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'
import * as model from '../console-ui/src/utils/console-auth-model.mjs'

const source = await readFile(new URL('../console-ui/src/utils/console-auth-api.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText

const json = (status, body, headers = {}) => ({ status, headers: new Headers(headers), json: async () => body })

/** Loads the module against a scripted Host. `routes` maps `METHOD path` to a response or a function of the request. */
function harness(routes, { apiBase = 'http://host', token = 'session-1', healthy = true } = {}) {
  const state = { apiBase, token, persistent: true }
  const calls = { requests: [], me: [], expired: 0, legacy: 0, rpc: [] }
  const auth = {
    captureApiRequestContext: () => ({ apiBase: state.apiBase, token: state.token }),
    clearRuntimeToken() {}, getApiBase: () => state.apiBase, getToken: () => state.token, isTokenPersistent: () => state.persistent,
    normalizeApiBase: value => value.trim().replace(/\/+$/, ''), notifyAuthRequired() { calls.expired++; state.token = null },
    probeHealth: async () => healthy ? { ok: true } : { ok: false, message: 'down' },
    setApiBase: value => { state.apiBase = value }, setToken: (value, persistent) => { state.token = value; state.persistent = persistent },
    stripApiBaseUrlFromQuery() {},
  }
  const session = { setConsoleMe: me => calls.me.push(me), setLegacySession: () => { calls.legacy++ } }
  const rpc = { requestConsole: async request => { calls.rpc.push(request); return undefined } }
  const fetch = async (url, init) => {
    const path = new URL(url).pathname
    const request = { url, path, method: init.method, authorization: init.headers.get('authorization'), body: init.body ? JSON.parse(init.body) : undefined }
    calls.requests.push(request)
    const answer = routes[`${init.method} ${path}`]
    if (!answer) throw new TypeError('network down')
    return typeof answer === 'function' ? answer(request) : answer
  }
  const module = { exports: {} }
  const mocks = { './auth': auth, './console-auth-model.mjs': model, './console-session.mjs': session, './console-rpc': rpc }
  new Function('require', 'exports', 'module', 'fetch', 'AbortSignal', 'Headers', compiled)(
    name => { assert.ok(Object.hasOwn(mocks, name), name); return mocks[name] }, module.exports, module, fetch, AbortSignal, Headers)
  return { api: module.exports, state, calls }
}

const owner = { id: 'u1', username: 'alice', displayName: 'Alice' }
const meUser = { success: true, data: { kind: 'user', user: owner, permissions: ['status.view'], bindings: [], setupRequired: false } }

test('password sign-in stores the issued session, then publishes /auth/me', async () => {
  const { api, state, calls } = harness({
    'POST /api/auth/login': json(200, { success: true, data: { token: 'session-new', expiresAt: 1, user: owner } }),
    'GET /api/auth/me': json(200, meUser),
  }, { token: null })
  const result = await api.signInWithPassword('http://host/', ' Alice ', 'correct horse', false)
  assert.equal(result.ok, true)
  assert.deepEqual(calls.requests[0].body, { username: 'alice', password: 'correct horse' })
  assert.equal(calls.requests[0].authorization, null, 'login sends no credential')
  assert.equal(state.token, 'session-new')
  assert.equal(state.persistent, false)
  assert.equal(calls.requests[1].authorization, 'Bearer session-new')
  assert.deepEqual(calls.me.map(me => me.permissions), [['status.view']])
})

test('wrong credentials stay a 401 unless the Host has no owner yet; 429 carries the wait', async () => {
  const denied = json(401, { success: false, code: 'unauthorized', error: '用户名或密码错误' })
  const plain = harness({ 'POST /api/auth/login': denied, 'GET /api/auth/me': json(200, { success: true, data: { kind: 'anonymous', permissions: [], bindings: [], setupRequired: false } }) }, { token: null })
  assert.equal((await plain.api.signInWithPassword('http://host', 'a1', 'x')).code, 'unauthorized')
  assert.equal(plain.state.token, null)

  const fresh = harness({ 'POST /api/auth/login': denied, 'GET /api/auth/me': json(200, { success: true, data: { kind: 'anonymous', permissions: [], bindings: [], setupRequired: true } }) }, { token: null })
  assert.equal((await fresh.api.signInWithPassword('http://host', 'a1', 'x')).code, 'not_initialized')

  const limited = harness({ 'POST /api/auth/login': json(429, { success: false, code: 'rate_limited', error: '…' }, { 'retry-after': '90' }) }, { token: null })
  const result = await limited.api.signInWithPassword('http://host', 'a1', 'x')
  assert.equal(result.code, 'rate_limited')
  assert.equal(result.retryAfterSec, 90)

  const old = harness({ 'POST /api/auth/login': json(404, undefined) }, { token: null })
  assert.equal((await old.api.signInWithPassword('http://host', 'a1', 'x')).code, 'unsupported')
  const down = harness({}, { token: null, healthy: false })
  assert.equal((await down.api.signInWithPassword('http://host', 'a1', 'x')).code, 'unreachable')
})

test('loading the session: /auth/me feeds navigation, an old Host is legacy, an unreachable Host is an error', async () => {
  const signed = harness({ 'GET /api/auth/me': json(200, meUser) })
  assert.equal((await signed.api.loadConsoleSession()).kind, 'me')
  assert.equal(signed.calls.requests[0].authorization, 'Bearer session-1')
  const legacy = harness({ 'GET /api/auth/me': json(404, undefined) })
  assert.equal((await legacy.api.loadConsoleSession()).kind, 'legacy')
  assert.equal(legacy.calls.legacy, 1)
  const down = harness({})
  assert.equal((await down.api.loadConsoleSession()).kind, 'error')
})

test('a wrong current password does not sign out; a changed password swaps in the new session', async () => {
  const wrong = harness({ 'POST /api/auth/password': json(401, { success: false, code: 'unauthorized', error: '当前密码错误' }) })
  assert.equal((await wrong.api.changeOwnPassword('bad', 'new-password-1')).code, 'unauthorized')
  assert.equal(wrong.calls.expired, 0)
  assert.equal(wrong.state.token, 'session-1')

  const ok = harness({ 'POST /api/auth/password': json(200, { success: true, data: { changed: true, token: 'session-2', expiresAt: 9 } }) })
  assert.equal((await ok.api.changeOwnPassword('old-password', 'new-password-1')).ok, true)
  assert.deepEqual(ok.calls.requests[0].body, { currentPassword: 'old-password', newPassword: 'new-password-1' })
  assert.equal(ok.state.token, 'session-2')
  assert.equal(ok.state.persistent, true, 'keeps the storage chosen at sign-in')
})

test('own API tokens: list, create (plaintext once), revoke; an expired session signs out', async () => {
  const record = { id: 't1', userId: 'u1', name: 'deploy', permissions: null, expiresAt: null, lastUsedAt: null, createdAt: 1 }
  const { api, calls } = harness({
    'GET /api/auth/tokens': json(200, { success: true, data: { tokens: [record] } }),
    'POST /api/auth/tokens': json(201, { success: true, data: { token: 'plain', record } }),
    'POST /api/auth/tokens/revoke': json(200, { success: true, data: { revoked: true } }),
  })
  assert.deepEqual((await api.listOwnTokens()).data, [record])
  const created = await api.createOwnToken({ name: 'deploy', expiresAt: null })
  assert.equal(created.data.token, 'plain')
  assert.deepEqual(calls.requests[1].body, { name: 'deploy' }, 'no expiresAt means never')
  await api.createOwnToken({ name: 'ci', expiresAt: 99 })
  assert.deepEqual(calls.requests[2].body, { name: 'ci', expiresAt: 99 })
  assert.equal((await api.revokeOwnToken('t1')).ok, true)
  assert.deepEqual(calls.requests[3].body, { id: 't1' })

  const expired = harness({ 'GET /api/auth/tokens': json(401, { success: false, error: 'Invalid or missing token' }) })
  assert.equal((await expired.api.listOwnTokens()).code, 'unauthorized')
  assert.equal(expired.calls.expired, 1)
})

test('setup uses the bootstrap token; creating the owner replaces it with the new session', async () => {
  const { api, state, calls } = harness({
    'GET /api/auth/setup': json(200, { success: true, data: { setupRequired: true, database: { dialect: 'sqlite', source: 'default', summary: {} } } }),
    'POST /api/auth/setup/database/test': json(200, { success: true, data: { ok: true, latencyMs: 3 } }),
    'POST /api/auth/setup/database': json(200, { success: true, data: { restarting: true, notice: 'n' } }),
    'POST /api/auth/setup': json(201, { success: true, data: { token: 'owner-session', expiresAt: 1, user: owner } }),
    'GET /api/auth/me': json(200, meUser),
  }, { token: 'bootstrap-token' })
  state.persistent = false
  assert.equal((await api.getSetupStatus()).data.setupRequired, true)
  assert.equal(calls.requests[0].authorization, 'Bearer bootstrap-token')
  const input = { dialect: 'pg', connection: { host: 'db', port: 5432 } }
  assert.equal((await api.testSetupDatabase(input)).data.ok, true)
  assert.deepEqual(calls.requests[1].body, input)
  assert.equal((await api.saveSetupDatabase(input)).data.restarting, true)
  const created = await api.createFirstOwner({ username: 'alice', password: 'long-enough-1', displayName: 'Alice' })
  assert.equal(created.ok, true)
  assert.deepEqual(calls.requests[3].body, { username: 'alice', password: 'long-enough-1', displayName: 'Alice' })
  assert.equal(state.token, 'owner-session')
  assert.equal(state.persistent, false)
  assert.equal(calls.me.length, 1)

  const done = harness({ 'GET /api/auth/setup': json(409, { success: false, code: 'conflict', error: '已初始化' }) }, { token: 'bootstrap-token' })
  assert.equal((await done.api.getSetupStatus()).code, 'conflict')
})

test('onboarding.update is sent as a Console RPC', async () => {
  const { api, calls } = harness({})
  await api.updateOnboarding('ai', 'skipped')
  assert.deepEqual(calls.rpc, [{ type: 'onboarding.update', step: 'ai', status: 'skipped' }])
})

test('sign-out revokes a user session on the Host but never an API token', async () => {
  const user = harness({ 'POST /api/auth/logout': json(200, { success: true, data: { loggedOut: true } }) })
  await user.api.signOut({ kind: 'user' })
  assert.equal(user.calls.requests[0].path, '/api/auth/logout')
  assert.equal(user.calls.expired, 1)
  const token = harness({})
  await token.api.signOut({ kind: 'api-token' })
  assert.equal(token.calls.requests.length, 0)
  assert.equal(token.calls.expired, 1)
})
