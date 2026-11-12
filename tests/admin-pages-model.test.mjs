import test from 'node:test'
import assert from 'node:assert/strict'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { resumeAtOwner, setupBlockedTitle, setupNextStep } from '../console-ui/src/pages/setup/setup-model.mjs'
import { displayNameProblem } from '../console-ui/src/pages/access/access-model.mjs'
import { IamRequestError, iamErrorKind, readIamReply } from '../console-ui/src/pages/access/iam-request.mjs'
import { GatewayRequestError, gatewayErrorKind, readGatewayReply } from '../console-ui/src/pages/ops/gateway-model.mjs'
import { statusFromError } from '../console-ui/src/components/status-state-model.mjs'
import { readErrorSummary } from '../console-ui/src/utils/read-error.mjs'
import { authErrorMessage, readAuthResponse } from '../console-ui/src/utils/console-auth-model.mjs'

const zh = (message, values) => translate('zh-CN', message, values)
const en = (message, values) => translate('en', message, values)
const cjk = /[㐀-鿿]/u

test('the setup wizard resumes at the owner step once the database step was saved', () => {
  assert.equal(resumeAtOwner({ version: 1, steps: { database: 'done' } }), true)
  assert.equal(resumeAtOwner({ version: 1, steps: { database: 'skipped' } }), true)
  assert.equal(resumeAtOwner({ version: 1, steps: { database: 'pending' } }), false)
  assert.equal(resumeAtOwner(undefined), false)
  assert.equal(resumeAtOwner('done'), false)
})

test('a blocked setup names its state and the exact next step in both languages', () => {
  for (const code of ['conflict', 'forbidden', 'unreachable', 'database_busy', 'unavailable', 'failed']) {
    const failure = { ok: false, status: 0, code, message: '' }
    assert.match(setupBlockedTitle(failure, zh), cjk, code)
    assert.match(setupNextStep(failure, zh), cjk, code)
    assert.doesNotMatch(setupBlockedTitle(failure, en), cjk, code)
    assert.doesNotMatch(setupNextStep(failure, en), cjk, code)
  }
  assert.match(setupNextStep({ code: 'conflict' }, zh), /zhin console user passwd/u)
  assert.match(setupNextStep({ code: 'forbidden' }, zh), /#token=/u)
  assert.match(setupNextStep({ code: 'unavailable' }, zh), /zhin console init --status/u)
})

test('display names follow the Host rule (required, at most 128 characters, no control characters)', () => {
  assert.equal(displayNameProblem('值班同事 Alice', zh), null)
  assert.match(displayNameProblem('   ', zh), /请填写/u)
  assert.equal(displayNameProblem('x'.repeat(128), zh), null)
  assert.match(displayNameProblem('x'.repeat(129), zh), /128/u)
  assert.match(displayNameProblem('a\u0007b', zh), /控制字符/u)
  assert.doesNotMatch(displayNameProblem('', en), cjk)
})

test('iam.* and gateway.* replies keep database_busy with its Retry-After for StatusState', () => {
  const body = { success: false, code: 'database_busy', error: '数据库正忙，请稍后重试' }
  assert.throws(() => readIamReply(503, body, zh, '3'), error => {
    assert.ok(error instanceof IamRequestError)
    assert.equal(iamErrorKind(error), 'database_busy')
    assert.equal(error.retryAfter, 3)
    const reading = statusFromError(error)
    assert.equal(reading.kind, 'database-busy')
    assert.equal(reading.retryAfterSeconds, 3)
    return /3 秒/u.test(error.message)
  })
  assert.throws(() => readGatewayReply(503, body, en, '7'), error => {
    assert.ok(error instanceof GatewayRequestError)
    assert.equal(gatewayErrorKind(error), 'database_busy')
    assert.equal(statusFromError(error).retryAfterSeconds, 7)
    return !cjk.test(error.message)
  })
})

test('a gateway 409 reads as a running transaction and as 内容已被修改 for StatusState', () => {
  assert.throws(() => readGatewayReply(409, { success: false, code: 'conflict', error: '' }, zh), error => {
    assert.equal(gatewayErrorKind(error), 'conflict')
    assert.equal(statusFromError(error).kind, 'conflict')
    return /另一个依赖事务/u.test(error.message)
  })
})

test('instance replies keep their request outcome: not-dispatched may be retried, unknown only verified', () => {
  const reply = outcome => ({ success: false, code: 'instance_timeout', requestOutcome: outcome, state: 'running', error: 'The instance did not answer in time' })
  assert.throws(() => readGatewayReply(504, reply('unknown'), zh), error => {
    assert.equal(gatewayErrorKind(error), 'instance')
    const reading = statusFromError(error)
    return reading.kind === 'instance-unavailable' && reading.outcome === 'unknown'
  })
  assert.throws(() => readGatewayReply(502, { ...reply('not-dispatched'), code: 'instance_error' }, zh, '2'),
    error => statusFromError(error).outcome === 'not-dispatched' && statusFromError(error).retryAfterSeconds === 2)
})

test('read failures of instance-served pages say the instance is down or the database is busy', () => {
  assert.match(readErrorSummary('The Zhin instance is not running', '数据库信息'), /数据库信息由 Zhin 实例提供/u)
  assert.match(readErrorSummary('数据库正忙，请稍后重试', '环境变量文件列表'), /数据库正忙，暂时读不到环境变量文件列表/u)
  assert.doesNotMatch(readErrorSummary('The Zhin instance is not running', 'database info', 'en'), cjk)
  assert.match(readErrorSummary('HTTP 403', '配置'), /当前身份无权读取配置/u)
})

test('/auth/* failures: database_busy keeps Retry-After, instance codes point to the instance page', () => {
  const busy = readAuthResponse({ status: 503, body: { success: false, code: 'database_busy', error: '数据库正忙' }, retryAfter: '4' })
  assert.equal(busy.code, 'database_busy')
  assert.equal(busy.retryAfterSec, 4)
  assert.match(authErrorMessage(busy, zh), /4 秒/u)
  assert.doesNotMatch(authErrorMessage(busy, en), cjk)
  const offline = readAuthResponse({ status: 503, body: { success: false, code: 'instance_unavailable', error: 'x' }, retryAfter: null })
  assert.match(authErrorMessage(offline, zh), /运维 → 实例/u)
})

test('the instance page sections are linkable anchors (机器人状态 and 首页 link to the running state)', async () => {
  const { INSTANCE_SECTION_IDS, instanceSectionHref } = await import('../console-ui/src/pages/ops/instance-sections.mjs')
  assert.equal(instanceSectionHref(), '/ops/instance#instance-status')
  assert.equal(instanceSectionHref('logs'), '/ops/instance#instance-logs')
  assert.equal(instanceSectionHref('nope'), '/ops/instance')
  const { readFileSync } = await import('node:fs')
  const read = path => readFileSync(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
  for (const id of Object.values(INSTANCE_SECTION_IDS)) assert.match(read('pages/ops/instance.tsx'), /INSTANCE_SECTION_IDS\.(status|logs|dependencies)/u, id)
  assert.match(read('pages/agent-workbench.tsx'), /instanceSectionHref\('status'/u)
})

test('a receipt that was not executed never reads as 读取失败', async () => {
  const { readFileSync } = await import('node:fs')
  const source = readFileSync(new URL('../console-ui/src/components/ActionReceipt.tsx', import.meta.url), 'utf8')
  const failed = source.slice(source.indexOf("state.phase === 'failed' && state.status"), source.indexOf('<footer'))
  assert.equal((failed.match(/kind="error"/gu) ?? []).length, (failed.match(/title=\{i18n\.t\('操作没有完成'\)\}/gu) ?? []).length)
})
