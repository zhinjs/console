import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  accountEnvironmentVariable,
  canReferenceEnvironment,
  connectionTestError,
  supportsConnectionTest,
  describeLastCall,
  describeProbe,
  inferenceError,
  inferenceRequest,
  InferenceRequestError,
  newlyBoundLanguageProfiles,
} from '../console-ui/src/pages/inference/model.mjs'

// zhinjs/zhin#1250: Console account forms follow the Host's environment-reference rule.
test('offers env references only to callers the Host allows (owner / local CLI); older Hosts keep their rule', () => {
  assert.equal(canReferenceEnvironment({ hostAdministrator: true, environmentReferences: 'console-owner' }), true)
  assert.equal(canReferenceEnvironment({ hostAdministrator: true, environmentReferences: 'local-cli' }), true)
  assert.equal(canReferenceEnvironment({ hostAdministrator: true, environmentReferences: 'none' }), false)
  assert.equal(canReferenceEnvironment({ hostAdministrator: true }), true)
  assert.equal(canReferenceEnvironment({ hostAdministrator: false }), false)
  assert.equal(accountEnvironmentVariable({ authentication: { method: 'api-key', source: 'env://OPENAI_API_KEY' } }), 'OPENAI_API_KEY')
  assert.equal(accountEnvironmentVariable({ authentication: { method: 'api-key' } }), undefined)
})

test('shows a Host refusal reason as its clear message and ignores unknown reasons', async () => {
  const fetch = async () => new Response(JSON.stringify({ success: false, code: 'forbidden', reason: 'environment-console-user', error: 'x' }), { status: 403 })
  const error = await inferenceRequest(fetch, { path: '/plan', body: {} }).catch((e) => e)
  assert.ok(error instanceof InferenceRequestError)
  assert.equal(error.reason, 'environment-console-user')
  assert.match(inferenceError(error), /Console 用户的账号不能引用 Host 环境变量，请直接填写密钥，或由 Host 管理员在本机用命令添加/)
  assert.match(inferenceError(error, 'en'), /cannot reference Host environment variables/)
  const unknown = await inferenceRequest(async () => new Response(JSON.stringify({ success: false, code: 'forbidden', reason: '<script>' }), { status: 403 }), { path: '/plan', body: {} }).catch((e) => e)
  assert.equal(unknown.reason, undefined)
  assert.equal(inferenceError(unknown), '当前身份无权执行此操作。')
  for (const reason of ['environment-name', 'environment-service-address', 'environment-local-only'])
    assert.notEqual(inferenceError(new InferenceRequestError('forbidden', 403, undefined, reason)), '当前身份无权执行此操作。')
})

test('describes the last real call and connection tests by outcome class only', () => {
  assert.match(describeLastCall({ outcome: 'auth', status: 401, at: 0 }), /^最近调用：鉴权失败 \(HTTP 401\) · /)
  assert.match(describeLastCall({ outcome: 'ok', status: 200, at: 0 }, 'en'), /^Last call: Succeeded · /)
  assert.equal(describeLastCall(undefined), '')
  assert.equal(describeProbe({ status: 'ok', durationMs: 12, at: 0, profileId: 'p' }), '连接正常（12 ms）')
  assert.equal(describeProbe({ status: 'failed', kind: 'timeout', durationMs: 30000, at: 0, profileId: 'p' }), '连接失败：超时')
  assert.equal(describeProbe({ status: 'failed', kind: 'auth', httpStatus: 403, durationMs: 1, at: 0, profileId: 'p' }, 'en'), 'Connection failed: Authentication failed HTTP 403')
})

test('probes only language profiles newly bound by a purposes draft', () => {
  const original = { defaults: { chat: 'old', summary: 'sum' }, adapters: { qq: { chat: 'qq-chat' } } }
  const draft = {
    defaults: { chat: 'relay', summary: 'sum', image: 'img', perception: { profile: 'vision', fallbacks: ['vision-2'] } },
    adapters: { qq: { chat: 'qq-chat' } },
    scenes: { s: { chat: 'scene' } },
    agents: { writer: 'agent-model' },
    decisions: { tools: { profile: 'decide', mode: 'active' } },
  }
  assert.deepEqual(newlyBoundLanguageProfiles(draft, original).sort(), ['agent-model', 'relay', 'scene', 'vision', 'vision-2'])
  assert.deepEqual(newlyBoundLanguageProfiles(original, original), [])
})

test('the account page hides env inputs from callers without authority and keeps a remedy for env accounts', async () => {
  const source = await readFile(new URL('../console-ui/src/pages/inference/Accounts.tsx', import.meta.url), 'utf8')
  assert.match(source, /canReferenceEnvironment\(view\)/)
  assert.match(source, /canReferenceEnvironment\(credential\.source\.view\)/)
  assert.doesNotMatch(source, /view\.hostAdministrator && method === 'api-key'/)
  // 「设置密钥」 stays visible for env:// accounts and explains the remedy instead of disappearing.
  assert.match(source, /account\.authentication\.method === 'api-key' \? \(/)
  assert.match(source, /zhin ai account rename-env/)
  assert.match(source, /'\/account\/test'/)
  const purposes = await readFile(new URL('../console-ui/src/pages/inference/Purposes.tsx', import.meta.url), 'utf8')
  assert.match(purposes, /'\/probe'/)
  assert.match(purposes, /if \(!\(await probeNewBindings\(\)\)\) return/)
})

test('测试连接 appears only on Hosts that have it; a missing route reads as an older Host, not a missing Agent', async () => {
  // Hosts with `/account/test` always send `environmentReferences` (`'none'` included).
  for (const environmentReferences of ['none', 'console-owner', 'local-cli'])
    assert.equal(supportsConnectionTest({ hostAdministrator: false, environmentReferences }), true, environmentReferences)
  assert.equal(supportsConnectionTest({ hostAdministrator: true }), false)
  assert.equal(supportsConnectionTest(undefined), false)
  // An older Host answers the route with 404 (`not-installed`).
  const missing = await inferenceRequest(async () => new Response('Not Found', { status: 404 }), { path: '/account/test', body: { accountId: 'a' } }).catch((e) => e)
  assert.equal(missing.code, 'not-installed')
  assert.equal(connectionTestError(missing), 'Host 版本较旧，暂不支持测试连接')
  assert.equal(connectionTestError(missing, 'en'), 'This Host version is too old to test connections')
  assert.doesNotMatch(connectionTestError(missing), /Agent/)
  // Other failures keep their usual message.
  assert.equal(connectionTestError(new InferenceRequestError('forbidden', 403)), inferenceError(new InferenceRequestError('forbidden', 403)))
  // Both entries (account row and the env:// credential dialog) are gated, and the route uses the mapping.
  const source = await readFile(new URL('../console-ui/src/pages/inference/Accounts.tsx', import.meta.url), 'utf8')
  assert.match(source, /supportsConnectionTest\(view\) && Object\.values\(view\.profiles\)/)
  assert.match(source, /supportsConnectionTest\(credential\.source\.view\) \? \(\s*<Button/)
  assert.match(source, /'\/account\/test', \{ accountId: account\.id \}, connectionTestError\)/)
  assert.equal((source.match(/\{i18n\.t\("测试连接"\)\}/g) ?? []).length, 2)
})
