import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { accountFailureDetails, inferenceError, inferenceRequest, InferenceRequestError } from '../console-ui/src/pages/inference/model.mjs'
import { translate } from '../console-ui/src/i18n/locale.mjs'

// #64 `inference-error-details-ignored`: since 1.3.0 (zhinjs/zhin#1260, #1270) a failed 「完成准备」 answers
// 424 with `details.step` / `details.reason` / `details.upstreamStatus`, but `project-unavailable` fell
// through to 「操作未完成，请稍后重新读取。」 and the reason was only in the instance log.
const reply = (status, body) => async () => ({ ok: status < 400, status, json: async () => body })
const preparationFailure = {
  success: false,
  code: 'project-unavailable',
  error: '账号准备失败',
  details: { step: 'onboard-operation', reason: 'UNSUPPORTED_CLIENT', upstreamStatus: 400 },
}

async function rejection(fetch) {
  try { await inferenceRequest(fetch, { path: '/accounts/a/prepare', body: {} }) } catch (error) { return error }
  assert.fail('expected a rejection')
}

test('a preparation failure names the step and the upstream reason', async () => {
  const error = await rejection(reply(424, preparationFailure))
  assert.ok(error instanceof InferenceRequestError)
  assert.deepEqual(error.details, { step: 'onboard-operation', reason: 'UNSUPPORTED_CLIENT', upstreamStatus: 400 })
  const message = inferenceError(error)
  assert.notEqual(message, '操作未完成，请稍后重新读取。')
  assert.match(message, /^完成准备失败：服务没有为这个账号开通项目/)
  assert.match(message, /UNSUPPORTED_CLIENT/)
  assert.match(message, /onboard-operation/)
  assert.match(message, /HTTP 400/)
  const english = inferenceError(error, 'en')
  assert.match(english, /UNSUPPORTED_CLIENT/)
  assert.doesNotMatch(english, /[一-鿿]/u, 'fully translated')
})

test('identity failures and a driver code sent in details.preparationCode are recognised too', async () => {
  const identity = await rejection(reply(424, { success: false, code: 'identity-unavailable', details: { step: 'identity' } }))
  assert.match(inferenceError(identity), /^完成准备失败：无法读取账号身份/)
  const nested = await rejection(reply(424, { success: false, code: 'unavailable', details: { preparationCode: 'project-unavailable', reason: 'PERMISSION_DENIED' } }))
  assert.match(inferenceError(nested), /^完成准备失败：服务没有为这个账号开通项目.*PERMISSION_DENIED/)
})

test('other failures keep their text and only gain the diagnostics', async () => {
  const error = await rejection(reply(503, { success: false, code: 'rejected', details: { reason: 'invalid_client', upstreamStatus: 401 } }))
  assert.match(inferenceError(error), /^服务拒绝了本次授权，请检查登录信息。/)
  assert.match(inferenceError(error), /invalid_client/)
  assert.equal(inferenceError(new InferenceRequestError('rejected')), '服务拒绝了本次授权，请检查登录信息。', 'no details, no suffix')
})

test('only short codes are shown: free text, URLs and odd numbers are dropped', async () => {
  const error = await rejection(reply(424, {
    success: false,
    code: 'project-unavailable',
    details: { step: 'see https://evil.example/?token=x', reason: 'a'.repeat(200), upstreamStatus: 'four hundred' },
  }))
  assert.equal(error.details, undefined)
  assert.equal(inferenceError(error), translate('zh-CN', '完成准备失败：服务没有为这个账号开通项目。请确认这个账号已在对应服务中使用过，然后重试「完成准备」。'))
})

test('「认证响应异常」 has details to expand', () => {
  assert.deepEqual(accountFailureDetails({ kind: 'invalid-response', status: 502 }), [
    '认证服务的回复无法识别。',
    '认证服务返回 HTTP 502',
    '可以重新「登录」这个账号；已经登录过的，先试「完成准备」。',
  ])
  assert.deepEqual(accountFailureDetails({ kind: 'response-error', status: 400, oauthError: 'invalid_grant' }), [
    '认证服务返回了错误。',
    '认证服务返回 HTTP 400',
    '错误码 invalid_grant',
    '可以重新「登录」这个账号；已经登录过的，先试「完成准备」。',
  ])
  assert.equal(accountFailureDetails({ kind: 'response-error', oauthError: 'not a code <script>' }).some(line => line.includes('script')), false)
  // Temporary and unknown outcomes have their own labels and need nothing extra.
  assert.equal(accountFailureDetails({ kind: 'temporary-response' }), null)
  assert.equal(accountFailureDetails({ kind: 'transport-unknown' }), null)
  assert.equal(accountFailureDetails(undefined), null)
  const english = accountFailureDetails({ kind: 'response-error', status: 400, oauthError: 'invalid_grant' }, 'en')
  assert.doesNotMatch(english.join(' '), /[一-鿿]/u)
})

test('the account card shows the details next to 「认证响应异常」', () => {
  const source = readFileSync(new URL('../console-ui/src/pages/inference/Accounts.tsx', import.meta.url), 'utf8')
  assert.match(source, /accountFailureDetails\(status\?\.status === 'uncertain' \? status\.failure : undefined, i18n\.locale\)/)
  assert.match(source, /<details[^>]*>\s*<summary[^>]*>\{i18n\.t\("查看详情"\)\}<\/summary>/)
})
