import test from 'node:test'
import assert from 'node:assert/strict'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import {
  CONSOLE_AUTH_ROUTES, authErrorMessage, authUrl, connectionKey, connectionPayload, freshOnboarding, initialConnectionValues,
  isUnsupportedRpcError, markOnboardingStep, meAccessReport, missingConnectionFields, newPasswordProblem, nextOnboardingStep,
  normalizeOnboarding, normalizeUsername, onboardingComplete, onboardingIncomplete, onboardingStorageKey, principalLabel, readAuthResponse,
  readMe, resolveOnboarding, retryAfterSeconds, sessionView, tokenExpiresAt, tokenNameProblem, tokenState, usernameProblem, waitForHost,
} from '../console-ui/src/utils/console-auth-model.mjs'
import { englishMessages } from '../console-ui/src/i18n/messages.en.mjs'

const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)

test('auth routes sit under {apiBase}/api and match the Host contract', () => {
  assert.equal(authUrl('http://127.0.0.1:8086/', CONSOLE_AUTH_ROUTES.LOGIN), 'http://127.0.0.1:8086/api/auth/login')
  assert.deepEqual(Object.values(CONSOLE_AUTH_ROUTES).sort(), [
    '/auth/login', '/auth/logout', '/auth/me', '/auth/password', '/auth/setup', '/auth/setup/database',
    '/auth/setup/database/test', '/auth/tokens', '/auth/tokens/revoke',
  ])
})

test('responses unwrap the Host envelope and map status codes to error codes', () => {
  assert.deepEqual(readAuthResponse({ status: 200, body: { success: true, data: { token: 't' } } }), { ok: true, status: 200, data: { token: 't' } })
  assert.deepEqual(readAuthResponse({ status: 201, body: { success: true, data: 1 } }).data, 1)
  const denied = readAuthResponse({ status: 401, body: { success: false, code: 'unauthorized', error: '用户名或密码错误' } })
  assert.deepEqual(denied, { ok: false, status: 401, code: 'unauthorized', message: '用户名或密码错误' })
  assert.equal(readAuthResponse({ status: 409, body: { success: false, error: '已初始化' } }).code, 'conflict', 'code falls back to the status')
  assert.equal(readAuthResponse({ status: 403, body: { success: false, code: 'setup_required', error: 'x' } }).code, 'setup_required')
  assert.equal(readAuthResponse({ status: 404, body: undefined }).code, 'unsupported', 'an older Host has no /auth routes')
  assert.equal(readAuthResponse({ status: 404, body: { success: false, code: 'not_found', error: '令牌不存在' } }).code, 'not_found')
  assert.equal(readAuthResponse({ status: 500, body: undefined }).code, 'failed')
  assert.equal(readAuthResponse({ status: 200, body: { success: false, error: 'x' } }).ok, false, 'success:false wins over 200')
})

test('429 reads Retry-After as seconds, as an HTTP date, or from the body, and tolerates an unreadable header', () => {
  const now = Date.parse('2026-11-11T00:00:00Z')
  assert.equal(readAuthResponse({ status: 429, body: { success: false, code: 'rate_limited' }, retryAfter: '42' }).retryAfterSec, 42)
  assert.equal(retryAfterSeconds('Wed, 11 Nov 2026 00:01:00 GMT', undefined, now), 60)
  assert.equal(retryAfterSeconds(null, { retryAfterMs: 1500 }), 2)
  assert.equal(retryAfterSeconds('0'), 1)
  // Cross-origin responses hide Retry-After unless the Host exposes it.
  assert.equal(readAuthResponse({ status: 429, body: { success: false }, retryAfter: null }).retryAfterSec, null)
})

test('error messages follow the ADR cases and exist in English', () => {
  const cases = [
    [{ code: 'unauthorized', status: 401 }, 'login', /用户名或密码错误/],
    [{ code: 'unauthorized', status: 401 }, 'password', /当前密码错误/],
    [{ code: 'unauthorized', status: 401 }, 'tokens', /登录已失效/],
    [{ code: 'conflict', status: 409 }, 'setup', /已完成初始化/],
    [{ code: 'rate_limited', status: 429, retryAfterSec: 30 }, 'login', /30 秒后/],
    [{ code: 'rate_limited', status: 429, retryAfterSec: null }, 'login', /稍后再试/],
    [{ code: 'forbidden', status: 403 }, 'setup', /初始化令牌/],
    [{ code: 'unsupported', status: 404 }, 'login', /访问令牌/],
    [{ code: 'not_initialized', status: 401 }, 'login', /尚未初始化/],
    [{ code: 'unreachable', status: 0 }, 'login', /无法连接 Host/],
  ]
  for (const [error, context, pattern] of cases) {
    const message = authErrorMessage({ ok: false, message: '', ...error }, zh, context)
    assert.match(message, pattern, `${error.code}/${context}`)
    assert.doesNotMatch(authErrorMessage({ ok: false, message: '', ...error }, en, context), /[㐀-鿿]/, `${error.code}/${context} English`)
  }
  // 400/503 show the Host's explanation.
  assert.equal(authErrorMessage({ ok: false, status: 400, code: 'invalid_input', message: 'password 至少 10 位' }, zh), 'password 至少 10 位')
  assert.equal(authErrorMessage({ ok: true }, zh), '')
  assert.ok(Object.hasOwn(englishMessages, '尝试次数过多，请在 {0} 秒后重试。'))
})

test('username and password rules mirror the Host', () => {
  assert.equal(normalizeUsername('  Alice '), 'alice')
  assert.equal(usernameProblem(''), 'empty')
  assert.equal(usernameProblem('a'), 'format')
  assert.equal(usernameProblem('Alice.Ops'), null, 'checked after lower-casing')
  assert.equal(usernameProblem('-bad'), 'format')
  assert.equal(usernameProblem('有中文'), 'format')
  assert.equal(newPasswordProblem(''), 'empty')
  assert.equal(newPasswordProblem('short-pw1'), 'short')
  assert.equal(newPasswordProblem('long-enough-1', 'other'), 'mismatch')
  assert.equal(newPasswordProblem('long-enough-1', 'long-enough-1'), null)
  assert.equal(newPasswordProblem('密码密码密码密码密码'), null, 'length counts characters, not bytes')
})

test('/auth/me decides between the wizard, the shell and sign-in, and what navigation may show', () => {
  const me = data => readMe(data)
  const user = me({ kind: 'user', user: { id: 'u1', username: 'alice', displayName: 'Alice' }, permissions: ['status.view', 7], bindings: [{ role: 'viewer', scope: { kind: 'global' }, permissions: [] }], setupRequired: false })
  assert.deepEqual(user.permissions, ['status.view'])
  assert.equal(sessionView(user), 'shell')
  assert.deepEqual(meAccessReport(user), { permissions: ['status.view'], bindings: [{ role: 'viewer', scope: { kind: 'global' }, permissions: [] }] })
  assert.equal(principalLabel(user, zh), 'Alice')

  const bootstrap = me({ kind: 'bootstrap', open: false, permissions: [], bindings: [], setupRequired: true })
  assert.equal(sessionView(bootstrap), 'setup')
  assert.deepEqual(meAccessReport(bootstrap), { permissions: [] })
  const open = me({ kind: 'bootstrap', open: true, permissions: ['status.view'], bindings: [], setupRequired: true })
  assert.equal(sessionView(open), 'shell', 'an open local Host keeps working without setup')
  assert.equal(meAccessReport(open), null, 'unrestricted')
  assert.equal(sessionView(me({ kind: 'anonymous', permissions: [], bindings: [], setupRequired: false })), 'signed-out')
  assert.equal(sessionView(me({ kind: 'bootstrap', open: false, permissions: [], bindings: [], setupRequired: false })), 'signed-out')
  assert.equal(readMe({ kind: 'root' }), null)
  assert.equal(readMe(null), null)
  assert.deepEqual(me({ kind: 'user', permissions: [], bindings: [], setupRequired: false, onboarding: { version: 1, steps: { ai: 'done' } } }).onboarding, { version: 1, steps: { ai: 'done' } })
})

const mysql = {
  dialect: 'mysql', label: 'MySQL', description: '', available: true,
  fields: [
    { name: 'host', type: 'string', required: true, secret: false, default: 'localhost' },
    { name: 'port', type: 'integer', required: false, secret: false, default: 3306 },
    { name: 'user', type: 'string', required: true, secret: false },
    { name: 'password', type: 'string', required: false, secret: true, env: 'ZHIN_DATABASE_PASSWORD' },
    { name: 'database', type: 'string', required: true, secret: false },
  ],
}

test('database forms start from defaults, send typed values and bind a test result to the exact input', () => {
  const values = initialConnectionValues(mysql)
  assert.deepEqual(values, { host: 'localhost', port: '3306', user: '', password: '', database: '' })
  assert.deepEqual(missingConnectionFields(mysql, values), ['user', 'database'])
  const filled = { ...values, user: ' bot ', password: ' p@ss ', database: 'zhin' }
  const payload = connectionPayload(mysql, filled)
  assert.deepEqual(payload, { dialect: 'mysql', connection: { host: 'localhost', port: 3306, user: 'bot', password: ' p@ss ', database: 'zhin' } }, 'secrets are not trimmed')
  assert.equal(connectionKey(payload), connectionKey(connectionPayload(mysql, { ...filled })))
  assert.notEqual(connectionKey(payload), connectionKey(connectionPayload(mysql, { ...filled, database: 'other' })))
  assert.deepEqual(connectionPayload(mysql, { ...filled, port: '' }).connection.port, undefined, 'empty optional fields are left to the Host default')
})

test('waiting for a restart polls until the Host answers, and gives up on timeout or abort', async () => {
  let clock = 0, calls = 0
  const sleep = async ms => { clock += ms }
  assert.equal(await waitForHost({ probe: async () => ++calls >= 3, sleep, now: () => clock, intervalMs: 1000, timeoutMs: 10_000 }), true)
  assert.equal(calls, 3)
  clock = 0
  assert.equal(await waitForHost({ probe: async () => { throw new Error('down') }, sleep, now: () => clock, intervalMs: 1000, timeoutMs: 3000 }), false)
  const controller = new AbortController(); controller.abort()
  assert.equal(await waitForHost({ probe: async () => true, sleep, signal: controller.signal }), false)
})

test('onboarding state: Host first, fresh after setup, steps can be skipped and finish completes it', () => {
  assert.equal(normalizeOnboarding(undefined), null)
  assert.deepEqual(normalizeOnboarding({ version: 1, steps: { ai: 'done', adapters: 'bogus', owner: 'done' } }), { version: 1, steps: { ai: 'done', owner: 'done' } })
  const fresh = freshOnboarding()
  assert.equal(onboardingIncomplete(fresh), true)
  assert.equal(nextOnboardingStep(fresh), 'ai')
  const skipped = markOnboardingStep(fresh, 'ai', 'skipped')
  assert.equal(nextOnboardingStep(skipped), 'adapters')
  const both = markOnboardingStep(skipped, 'adapters', 'done')
  assert.equal(nextOnboardingStep(both), 'finish')
  assert.equal(onboardingComplete(both), false)
  const done = markOnboardingStep(both, 'finish', 'done', 123)
  assert.equal(done.completedAt, 123)
  assert.equal(onboardingIncomplete(done), false)
  assert.equal(onboardingIncomplete(null), false, 'no known state, no banner')
  assert.deepEqual(resolveOnboarding({ version: 1, steps: { ai: 'done' } }, fresh).steps, { ai: 'done' })
  assert.deepEqual(resolveOnboarding(undefined, fresh), fresh)
  assert.equal(onboardingStorageKey('http://h:1/'), 'zhin.console.onboarding:http://h:1')
  assert.equal(isUnsupportedRpcError(new Error('Unknown RPC type: onboarding.update')), true)
  assert.equal(isUnsupportedRpcError(new Error('RPC "onboarding.update" 未登记权限')), true)
  assert.equal(isUnsupportedRpcError(new Error('缺少权限 plugin.manage')), false)
})

test('personal token helpers', () => {
  assert.equal(tokenExpiresAt(0), null)
  assert.equal(tokenExpiresAt(30, 0), 30 * 86_400_000)
  assert.equal(tokenState({ expiresAt: 5 }, 10), 'expired')
  assert.equal(tokenState({ expiresAt: null }, 10), 'active')
  assert.equal(tokenNameProblem('  '), 'empty')
  assert.equal(tokenNameProblem('x'.repeat(129)), 'long')
  assert.equal(tokenNameProblem('deploy'), null)
})
