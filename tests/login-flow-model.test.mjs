import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import { statusFromError } from '../console-ui/src/components/status-state-model.mjs'
import { readSubmitResult } from '../console-ui/src/components/action-receipt-model.mjs'
import { ConsoleTransportError } from '@zhin.js/client'
import * as model from '../console-ui/src/pages/scope/login-flow-model.mjs'

const NOW = 1_800_000_000_000
const DEVICE_JSON = '{\n  "guid": "device-guid-secret"\n}'

/** Snapshots shaped like @zhin.js/core LoginAssist.getFlow() for the icqq descriptors (P2). */
function authChallenge(overrides = {}) {
  return {
    id: 'icqq-auth', kind: 'auth', title: '身份验证',
    help: {
      short: 'QQ 需要验证这台设备。',
      steps: [
        { text: '复制设备 JSON', blockId: 'device-json', doneWhen: 'copied' },
        { text: '打开验证链接，进入发送验证码的页面', blockId: 'verify-link', doneWhen: 'opened' },
        { text: '在该页运行辅助脚本，并粘贴设备 JSON', blockId: 'helper-script', doneWhen: 'copied' },
        { text: '完成验证后点「已完成，继续登录」', doneWhen: 'manual' },
      ],
      warning: '请勿把设备 JSON 粘贴到其他网站或发给他人',
    },
    blocks: [
      { kind: 'copy', id: 'device-json', label: '设备 JSON', content: DEVICE_JSON, format: 'json', sensitive: true, thenOpen: 'verify-link' },
      { kind: 'link', id: 'verify-link', label: '验证链接', url: 'https://accounts.qq.com/login/attack?sid=abc', showQr: true },
      { kind: 'copy', id: 'helper-script', label: '辅助脚本', content: '(function () {\n  alert("x");\n})();', format: 'script', collapsed: true, collapsedLabel: '显示脚本', bookmarklet: true },
      { kind: 'link', id: 'evil', label: 'x', url: 'javascript:alert(1)' },
      { kind: 'unknown' },
    ],
    actions: [{ id: 'continue', label: '已完成，继续登录', variant: 'primary' }],
    ...overrides,
  }
}
function flow(overrides = {}) {
  return {
    id: 'flow-1', adapter: 'icqq', endpointKey: '10001', startedAt: NOW - 60_000, updatedAt: NOW, revision: 4, attempt: 1, state: 'active',
    currentStep: 's2', activeTaskId: 'task-2',
    steps: [
      { id: 's1', kind: 'connect', status: 'done', title: '连接服务器', at: NOW - 60_000, endedAt: NOW - 55_000 },
      { id: 's2', kind: 'challenge', status: 'active', title: '身份验证', at: NOW - 50_000, taskId: 'task-2', challenge: authChallenge() },
    ],
    ...overrides,
  }
}

test('readLoginFlow keeps the protocol shape and drops unsafe or unknown material', () => {
  const read = model.readLoginFlow(flow())
  assert.equal(read.id, 'flow-1')
  assert.equal(read.steps.length, 2)
  const challenge = read.steps[1].challenge
  assert.deepEqual(challenge.blocks.map(block => block.kind + ':' + (block.id ?? '')), ['copy:device-json', 'link:verify-link', 'copy:helper-script'], 'javascript: links and unknown blocks are dropped')
  assert.equal(challenge.blocks[0].sensitive, true)
  assert.equal(challenge.help.steps[0].doneWhen, 'copied')
  assert.equal(model.readLoginFlow({ ...flow(), revision: 'x' }), null)
  assert.equal(model.readLoginFlow({ ...flow(), adapter: '' }), null)
  assert.equal(model.readLoginFlow(null), null)
  // Unknown kinds / states fall back; actions get the ADR defaults.
  const other = model.readChallenge({ id: 'c', kind: 'weird', title: '', input: { kind: 'code', label: '验证码' } })
  assert.equal(other.kind, 'other')
  assert.equal(other.title, '安全验证')
  assert.deepEqual(other.actions.map(action => [action.id, action.requiresInput === true]), [['submit', true]])
  assert.deepEqual(model.readChallenge({ id: 'c', kind: 'confirm', title: 't' }).actions.map(action => action.id), ['confirm'])
  // A bookmarklet only on script blocks; images only data:image or http(s).
  assert.equal(model.readChallenge({ id: 'c', kind: 'auth', title: 't', blocks: [{ kind: 'copy', id: 'j', label: 'j', content: '{}', format: 'json', bookmarklet: true }] }).blocks[0].bookmarklet, undefined)
  assert.equal(model.readChallenge({ id: 'c', kind: 'qrcode', title: 't', media: { qrImage: 'javascript:alert(1)' } }).media.qrImage, undefined)
  assert.equal(model.readChallenge({ id: 'c', kind: 'qrcode', title: 't', media: { qrImage: 'data:image/png;base64,iVBORw0KGgo=' } }).media.qrImage, 'data:image/png;base64,iVBORw0KGgo=')
  assert.equal(model.readChallenge({ id: 'c', kind: 'slider', title: 't', media: { captcha: { provider: 'tencent', query: 'a=1', helperUrl: 'http://evil.example/x' } } }).media.captcha.helperUrl, undefined)
})

test('list and get replies; the newest flow of the account wins', () => {
  const older = { ...flow(), id: 'flow-0', startedAt: NOW - 600_000, state: 'failed' }
  const other = { ...flow(), id: 'flow-x', endpointKey: '20002' }
  const list = model.readLoginFlowList({ flows: [older, flow(), other, { bad: true }] }, { adapter: 'icqq', endpointKey: '10001' })
  assert.deepEqual(list.map(item => item.id), ['flow-1', 'flow-0'])
  assert.throws(() => model.readLoginFlowList({}), /格式/u)
  assert.equal(model.readLoginFlowGet({ flow: null }), null)
  assert.equal(model.readLoginFlowGet({ flow: flow() }).id, 'flow-1')
  assert.throws(() => model.readLoginFlowGet(null))
  const a = model.readLoginFlow(flow())
  const b = model.readLoginFlow({ ...flow(), revision: 5 })
  assert.equal(model.newerFlow(a, b), b)
  assert.equal(model.newerFlow(b, a), b, 'an older revision never wins')
  assert.equal(model.newerFlow(null, a), a)
})

test('redacted event snapshots keep the live material of the same active step until the live read', () => {
  const live = model.readLoginFlow({
    ...flow(),
    steps: [...flow().steps, { id: 's3', kind: 'challenge', status: 'skipped', title: '扫码', at: NOW - 90_000, challenge: { id: 'q', kind: 'qrcode', title: '扫码', media: { qrImage: 'data:image/png;base64,AAAA' } } }],
  })
  const redacted = model.readLoginFlow({
    ...flow(), revision: 5,
    steps: [
      flow().steps[0],
      { ...flow().steps[1], challenge: authChallenge({ media: { linkOmitted: true }, blocks: [{ kind: 'copy', id: 'device-json', label: '设备 JSON', content: '', format: 'json', sensitive: true, redacted: true }, authChallenge().blocks[2]] }) },
    ],
  })
  assert.equal(model.flowNeedsLiveRead(redacted), true)
  const merged = model.mergeRedactedFlow(live, redacted)
  assert.equal(merged.revision, 5)
  const blocks = merged.steps[1].challenge.blocks
  assert.deepEqual(blocks.map(block => block.id), ['device-json', 'verify-link', 'helper-script'], 'link block back in its place')
  assert.equal(blocks[0].content, DEVICE_JSON)
  assert.equal(model.flowNeedsLiveRead(merged), false)
  // A step that ended never gets its sensitive material back.
  const ended = model.readLoginFlow({ ...flow(), revision: 6, state: 'online', steps: [flow().steps[0], { ...flow().steps[1], status: 'done', challenge: authChallenge({ blocks: [{ kind: 'copy', id: 'device-json', label: '设备 JSON', content: '', format: 'json', sensitive: true, redacted: true }] }) }] })
  assert.equal(model.mergeRedactedFlow(live, ended).steps[1].challenge.blocks[0].content, '')
  assert.equal(model.mergeRedactedFlow(null, redacted), redacted)
  const otherFlow = model.readLoginFlow({ ...flow(), id: 'flow-2' })
  assert.equal(model.mergeRedactedFlow(live, otherFlow), otherFlow)
})

test('timeline: done steps collapse, the current step is marked, failures carry copy and the next action', () => {
  const failed = model.readLoginFlow(flow({
    currentStep: 's4', activeTaskId: 'task-4',
    steps: [
      flow().steps[0],
      { id: 's2', kind: 'challenge', status: 'skipped', title: '扫码登录', at: NOW - 50_000 },
      { id: 's3', kind: 'challenge', status: 'failed', title: '短信验证码', at: NOW - 40_000, endedAt: NOW - 30_000, outcome: { result: 'rejected', code: 'code_invalid', message: '验证码错误' } },
      { id: 's4', kind: 'challenge', status: 'active', title: '短信验证码', at: NOW - 20_000, taskId: 'task-4', challenge: { id: 'icqq-sms', kind: 'sms', title: '短信验证码', input: { kind: 'code', label: '验证码', length: 6, pattern: '^\\d{6}$', patternHint: '请输入 6 位数字' } } },
    ],
  }))
  const timeline = model.flowTimeline(failed)
  assert.equal(timeline.total, 4)
  assert.equal(timeline.currentIndex, 3)
  assert.deepEqual(timeline.steps.map(step => step.collapsed), [true, true, false, false])
  assert.deepEqual(timeline.steps[2].outcome, { tone: 'destructive', title: '验证码或 ticket 不正确', description: '请检查后重新输入。验证码区分大小写时注意大小写。', message: '验证码错误', next: 'retry_input', code: 'code_invalid' })
  assert.equal(model.activeChallengeStep(failed).id, 's4')
  assert.equal(model.flowTimeline(null).total, 0)
  assert.equal(model.flowStateBadge(failed).label, '等待登录')
  assert.equal(model.flowStateBadge({ ...failed, pendingConfirmation: true }).label, '结果待确认')
  assert.equal(model.flowStateBadge({ ...failed, state: 'online' }).tone, 'success')
})

test('every standard error code has Chinese and English copy and a default next action', () => {
  const codes = ['code_invalid', 'rate_limited', 'challenge_expired', 'risk_blocked', 'credential_invalid', 'network', 'unknown']
  assert.deepEqual(Object.keys(model.LOGIN_ERROR_COPY), codes)
  const nextByCode = { code_invalid: 'retry_input', rate_limited: 'wait', challenge_expired: 'refresh_challenge', risk_blocked: undefined, credential_invalid: 'relogin', network: 'wait', unknown: 'relogin' }
  for (const code of codes) {
    const view = model.outcomeView({ result: 'failed', code })
    assert.equal(view.next, nextByCode[code], code)
    for (const text of [view.title, view.description]) assert.notEqual(translate('en', text), text, `English for ${text}`)
  }
  // The Host's `next` wins over the code default; `none` means no button.
  assert.equal(model.outcomeView({ result: 'rejected', code: 'code_invalid', next: 'relogin' }).next, 'relogin')
  assert.equal(model.outcomeView({ result: 'rejected', code: 'code_invalid', next: 'none' }).next, undefined)
  assert.equal(model.outcomeView({ result: 'expired' }).code, 'challenge_expired')
  assert.equal(model.outcomeView(null), null)
  assert.deepEqual(model.outcomeView({ result: 'failed' }), { tone: 'destructive', title: '登录失败', next: 'relogin' }, 'no code: the result alone decides')
  assert.deepEqual(model.outcomeView({ result: 'failed', code: 'rate_limited', retryAfterMs: 30_000 }).retryAfterMs, 30_000)
  assert.equal(model.outcomeView({ result: 'online' }).tone, 'success')
  for (const next of ['retry_input', 'refresh_challenge', 'relogin', 'wait']) assert.notEqual(translate('en', model.NEXT_ACTION_COPY[next].label), model.NEXT_ACTION_COPY[next].label)
})

test('the guided checklist ticks itself on copy / open and counts the current step', () => {
  const challenge = model.readChallenge(authChallenge())
  let progress = {}
  let list = model.helpChecklist(challenge, progress)
  assert.equal(list.total, 4)
  assert.equal(list.current, 1)
  assert.deepEqual(list.items.map(item => item.auto), [true, true, true, false])
  progress = model.recordProgress(progress, { type: 'copied', blockId: 'device-json' })
  list = model.helpChecklist(challenge, progress)
  assert.equal(list.current, 2, 'copying the device JSON ticks step 1')
  progress = model.recordProgress(progress, { type: 'opened', blockId: 'verify-link' })
  progress = model.recordProgress(progress, { type: 'copied', blockId: 'device-json' })
  assert.equal(model.helpChecklist(challenge, progress).current, 3)
  assert.deepEqual(progress.copied, ['device-json'], 'no duplicates')
  // A copy of an unrelated block does not tick the "opened" step.
  assert.equal(model.helpChecklist(challenge, model.recordProgress({}, { type: 'copied', blockId: 'verify-link' })).current, 1)
  progress = model.recordProgress(progress, { type: 'copied', blockId: 'helper-script' })
  progress = model.recordProgress(progress, { type: 'tick', number: 4 })
  list = model.helpChecklist(challenge, progress)
  assert.equal(list.current, null)
  assert.equal(list.doneCount, 4)
  // Ticking again unticks; a step can always be ticked by hand (e.g. scanned with the phone).
  assert.equal(model.helpChecklist(challenge, model.recordProgress(progress, { type: 'tick', number: 4 })).current, 4)
  assert.equal(model.helpChecklist(challenge, model.recordProgress({}, { type: 'tick', number: 1 })).current, 2)
  assert.equal(model.helpChecklist(null).total, 0)
})

test('blocks: copy-and-open merges a copy block with its link; bookmarklets come only from static scripts', () => {
  const challenge = model.readChallenge(authChallenge())
  const blocks = model.challengeBlocks(challenge)
  assert.equal(blocks[0].openLink.url, 'https://accounts.qq.com/login/attack?sid=abc')
  assert.equal(blocks[1].kind, 'link', 'the link keeps its own row (QR)')
  assert.equal(blocks[2].openLink, undefined)
  const href = model.bookmarkletHref(blocks[2])
  assert.ok(href.startsWith('javascript:'))
  assert.equal(decodeURIComponent(href.slice('javascript:'.length)), '(function () {\n  alert("x");\n})();')
  assert.equal(model.bookmarkletHref(blocks[0]), null, 'never from device data')
  assert.equal(model.bookmarkletHref({ ...blocks[2], redacted: true }), null)
  assert.equal(model.bookmarkletHref({ ...blocks[2], content: '  ' }), null)
  assert.equal(model.bookmarkletHref({ ...blocks[2], bookmarklet: false }), null)
})

test('input checks: length, pattern with hint, and ticket extraction from anything pasted', () => {
  const sms = { kind: 'code', label: '验证码', length: 6, pattern: '^\\d{6}$', patternHint: '请输入 6 位数字' }
  assert.equal(model.checkLoginInput(sms, '').state, 'empty')
  assert.deepEqual(model.checkLoginInput(sms, '123'), { state: 'partial', remaining: 3, value: '123' })
  assert.deepEqual(model.checkLoginInput(sms, '12a'), { state: 'invalid', message: '请输入 6 位数字', value: '12a' })
  assert.deepEqual(model.checkLoginInput(sms, ' 123456 '), { state: 'ok', value: '123456' })
  assert.equal(model.checkLoginInput(sms, '1234567').state, 'invalid')
  assert.deepEqual(model.checkLoginInput({ kind: 'code', label: 'x', length: 4 }, '12345'), { state: 'invalid', message: '长度应为 {0} 位', messageValues: ['4'], value: '12345' })
  assert.equal(model.checkLoginInput({ kind: 'text', label: 'x', pattern: '^[a-z]+$' }, 'ABC').state, 'invalid')
  assert.equal(model.checkLoginInput({ kind: 'text', label: 'x', pattern: '(' }, 'any').state, 'ok', 'a broken pattern never blocks')
  const ticket = { kind: 'ticket', label: 'ticket', extract: 'ticket-json-or-url' }
  const json = model.checkLoginInput(ticket, '{"ret":0,"ticket":"t03abcdefghijklmnopqrstuvwxyz","randstr":"@r"}')
  assert.equal(json.state, 'ok')
  assert.equal(json.source, 'json')
  assert.equal(json.value, 't03abcdefghijklmnopqrstuvwxyz,@r')
  assert.equal(model.ticketPreview(json.ticket.ticket), 't03abcdefghi…uvwxyz')
  assert.equal(model.checkLoginInput(ticket, 'https://x.example/cb?ticket=t1').source, 'url')
  assert.deepEqual(model.checkLoginInput(ticket, '{"ret":0}'), { state: 'invalid', message: 'JSON 中没有 ticket 字段', value: '{"ret":0}' })
  assert.equal(model.checkLoginInput(undefined, 'x').state, 'ok')
})

test('submit values, cooldowns and deadlines', () => {
  const sms = model.readChallenge({ id: 'icqq-sms', kind: 'sms', title: '短信', input: { kind: 'code', label: '验证码', length: 6 },
    actions: [{ id: 'submit', label: '提交', variant: 'primary', requiresInput: true }, { id: 'resend', label: '重新发送', variant: 'secondary', cooldownMs: 60_000 }] })
  assert.deepEqual(model.submitValueFor(sms, sms.actions[0], ' 123456 '), { action: 'submit', values: { input: '123456' } })
  assert.deepEqual(model.submitValueFor(sms, sms.actions[1]), { action: 'resend', values: {} })
  assert.deepEqual(model.captchaSubmitValue({ ticket: 't03', randstr: '@r' }), { action: 'submit', values: { ticket: 't03,@r' } })
  assert.deepEqual(model.captchaSubmitValue({ ticket: 't03', randstr: '' }), { action: 'submit', values: { ticket: 't03' } })
  const resend = sms.actions[1]
  assert.equal(model.cooldownRemaining(resend, { openedAt: NOW - 10_000, now: NOW }), 50_000, 'the SMS was just sent when the challenge opened')
  assert.equal(model.cooldownRemaining(resend, { openedAt: NOW - 70_000, now: NOW }), 0)
  assert.equal(model.cooldownRemaining(resend, { openedAt: NOW - 70_000, lastUsedAt: NOW - 1_000, now: NOW }), 59_000)
  assert.equal(model.cooldownRemaining(sms.actions[0], { openedAt: NOW, now: NOW }), 0)
  assert.deepEqual(model.deadlineProgress(NOW + 30_000, { startedAt: NOW - 90_000, now: NOW }), { secondsLeft: 30, fraction: 0.25, expired: false })
  assert.equal(model.deadlineProgress(NOW - 1, { now: NOW }).expired, true)
  assert.equal(model.deadlineProgress(undefined), null)
  assert.equal(model.formatCountdown(65), '1:05')
  assert.equal(model.formatCountdown(-3), '0:00')
})

test('submit replies map to receipt phases; pending never reads as success', () => {
  const online = model.readSubmitReply({ accepted: true, outcome: { result: 'online' }, flow: flow({ state: 'online', revision: 9 }) })
  assert.equal(online.kind, 'outcome')
  assert.equal(online.flow.revision, 9)
  assert.equal(readSubmitResult(model.submitReceiptResult(online)).phase, 'succeeded')
  const rejected = model.readSubmitReply({ accepted: true, outcome: { result: 'rejected', code: 'code_invalid', message: '验证码错误' } })
  const rejectedResult = model.submitReceiptResult(rejected)
  assert.deepEqual(rejectedResult, { status: 'failed', message: '验证码或 ticket 不正确', detail: '验证码错误', detailFromHost: true })
  assert.equal(readSubmitResult(rejectedResult).phase, 'failed')
  const pending = model.readSubmitReply({ accepted: true, pending: true })
  assert.equal(pending.kind, 'pending')
  const pendingReceipt = readSubmitResult(model.submitReceiptResult(pending))
  assert.equal(pendingReceipt.phase, 'unknown', '结果待确认 is settled only by a read-only check')
  assert.equal(model.readSubmitReply({ success: true }).kind, 'accepted')
  assert.equal(model.readSubmitReply(null).kind, 'accepted')
})

test('verifying an unknown result goes by the answered step (core drops its taskId), never by the task disappearing', () => {
  // As core reports it: once answered, the challenge step has no taskId.
  const answered = (step, extra = {}) => model.readLoginFlow(flow({ activeTaskId: undefined, steps: [flow().steps[0], { ...flow().steps[1], taskId: undefined, ...step }], ...extra }))
  assert.equal(model.verifySubmission(model.readLoginFlow(flow()), 's2'), undefined, 'still open')
  // Answered, verifying with no result yet: still undecided.
  assert.equal(model.verifySubmission(answered({ status: 'done' }, { steps: [flow().steps[0], { ...flow().steps[1], taskId: undefined, status: 'done' }, { id: 's3', kind: 'verifying', status: 'active', title: '验证中…', at: NOW }] }), 's2'), undefined)
  assert.deepEqual(model.verifySubmission(answered({ status: 'done', outcome: { result: 'accepted' } }), 's2'), { applied: true, message: '验证通过，正在继续登录。' })
  assert.deepEqual(model.verifySubmission(answered({ status: 'failed', outcome: { result: 'rejected', code: 'code_invalid' } }), 's2'), { applied: false, message: '验证码或 ticket 不正确' })
  assert.equal(model.verifySubmission(answered({ status: 'done' }, { state: 'online' }), 's2').applied, true)
  assert.equal(model.verifySubmission(answered({ status: 'failed' }), 's2').applied, false)
  assert.equal(model.verifySubmission(answered({ status: 'skipped' }), 's2').applied, false, 'replaced')
  assert.equal(model.verifySubmission(answered({ status: 'done' }, { state: 'cancelled' }), 's2').applied, false, 'flow ended')
  assert.equal(model.verifySubmission(model.readLoginFlow(flow()), 'gone-step').applied, false, 'the answered step is gone')
  // The verdict on the verifying step that followed the answer counts too.
  const viaVerifying = model.readLoginFlow(flow({ activeTaskId: undefined, steps: [flow().steps[0], { ...flow().steps[1], taskId: undefined, status: 'done' }, { id: 's3', kind: 'verifying', status: 'failed', title: '验证中', at: NOW, outcome: { result: 'rejected', code: 'risk_blocked' } }] }))
  assert.deepEqual(model.verifySubmission(viaVerifying, 's2'), { applied: false, message: '平台风控拒绝了这次登录' })
  assert.equal(model.verifySubmission(null, 's2'), undefined)
  // Expired while verifying, then reopened with a new challenge (core: expired is not terminal): not taken.
  const reopened = model.readLoginFlow(flow({ steps: [flow().steps[0], { ...flow().steps[1], taskId: undefined, status: 'done' },
    { id: 's3', kind: 'verifying', status: 'skipped', title: '验证中', at: NOW },
    { id: 's4', kind: 'challenge', status: 'active', title: '再次验证', at: NOW, taskId: 't4' }] }))
  assert.equal(model.verifySubmission(reopened, 's2').applied, false, 'abandoned verification')
  // A later answer's verdict is not this answer's.
  const laterVerdict = model.readLoginFlow(flow({ steps: [flow().steps[0], { ...flow().steps[1], taskId: undefined, status: 'done' },
    { id: 's3', kind: 'verifying', status: 'done', title: '验证中', at: NOW },
    { id: 's4', kind: 'challenge', status: 'done', title: '再次验证', at: NOW },
    { id: 's5', kind: 'verifying', status: 'failed', title: '验证中', at: NOW, outcome: { result: 'rejected', code: 'risk_blocked' } }] }))
  assert.equal(model.verifySubmission(laterVerdict, 's2').applied, true, 'own verification finished; the next challenge followed')
})

test('real core snapshots: every submission settles (no receipt locked as 结果未知)', () => {
  const fixture = JSON.parse(readFileSync(new URL('./fixtures/login-core-snapshots.json', import.meta.url), 'utf8'))
  assert.ok(fixture.cases.length >= 7)
  for (const item of fixture.cases) {
    const snapshot = model.readLoginFlow(item.flow)
    assert.ok(snapshot, item.name)
    const answered = snapshot.steps.find(step => step.id === item.stepId)
    if (answered && answered.status !== 'active') assert.equal(answered.taskId, undefined, `${item.name}: core drops the taskId`)
    const verdict = model.verifySubmission(snapshot, item.stepId)
    assert.equal(verdict?.applied ?? null, item.expectedApplied, item.name)
    // The old lookup by taskId would never have found the step.
    assert.equal(snapshot.steps.some(step => step.taskId === item.taskId && step.status !== 'active'), false, item.name)
    if (item.reply) {
      const receipt = model.submitReceiptResult(model.readSubmitReply(item.reply))
      assert.equal(readSubmitResult(receipt).phase, { unknown: 'unknown', failed: 'failed', saved: 'succeeded' }[item.expectedReceipt], item.name)
    }
  }
})

test('replies without an outcome are decided by the flow that came with them (core wakes waiters with none when a flow ends)', () => {
  const ended = model.readSubmitReply({ accepted: true, flow: flow({ state: 'cancelled', activeTaskId: undefined }) })
  assert.equal(ended.kind, 'accepted')
  assert.deepEqual(model.submitReceiptResult(ended), { status: 'failed', message: '已取消' })
  const failed = model.submitReceiptResult(model.readSubmitReply({ accepted: true, pending: true, flow: flow({ state: 'failed', lastOutcome: { result: 'failed', code: 'network', message: '连接断开' } }) }))
  assert.deepEqual(failed, { status: 'failed', message: '网络错误', detail: '连接断开', detailFromHost: true })
  assert.equal(model.submitReceiptResult(model.readSubmitReply({ accepted: true, flow: flow({ state: 'expired' }) })).status, 'failed')
  assert.equal(model.submitReceiptResult(model.readSubmitReply({ accepted: true, flow: flow({ state: 'online' }) })).status, 'saved')
  assert.equal(model.submitReceiptResult(model.readSubmitReply({ accepted: true, flow: flow() })).status, 'unknown', 'still active: wait')
  assert.equal(model.submitReceiptResult(model.readSubmitReply({ success: true })).status, 'saved', 'only a flow-less legacy reply is 已提交')
  // lastOutcome outlives the flow: a cancelled / expired flow never borrows an earlier rejection.
  const stale = { result: 'rejected', code: 'code_invalid' }
  assert.deepEqual(model.submitReceiptResult(model.readSubmitReply({ accepted: true, flow: flow({ state: 'cancelled', lastOutcome: stale }) })), { status: 'failed', message: '已取消' })
  assert.equal(model.submitReceiptResult(model.readSubmitReply({ accepted: true, flow: flow({ state: 'expired', lastOutcome: stale }) })).message, model.FLOW_STATE_COPY.expired.label)
})

test('server clock offset: skew counts, latency does not', () => {
  assert.equal(model.serverClockOffset(0, NOW + 600, NOW), 0)
  assert.equal(model.serverClockOffset(0, NOW - 1200, NOW), 0)
  assert.equal(model.serverClockOffset(0, NOW + 5 * 60_000, NOW), 5 * 60_000)
  assert.equal(model.serverClockOffset(0, NOW - 90_000, NOW), -90_000)
  assert.equal(model.serverClockOffset(42_000, undefined, NOW), 42_000, 'no timestamp keeps the last offset')
  assert.equal(model.serverClockOffset(undefined, 'x', NOW), 0)
})

test('an older Host is detected from the refusal; controls follow the declaration and permission', () => {
  assert.equal(model.flowsUnsupported(statusFromError(new ConsoleTransportError('Unknown RPC type: login.flow.list', 'SERVER_ERROR'))), true)
  assert.equal(model.flowsUnsupported(statusFromError(Object.assign(new ConsoleTransportError('Forbidden', 'SERVER_ERROR'), { details: { httpStatus: 403 } }))), true)
  assert.equal(model.flowsUnsupported(statusFromError(new ConsoleTransportError('unsupported: login flows not available on this host', 'SERVER_ERROR'))), true)
  assert.equal(model.flowsUnsupported(statusFromError(new ConsoleTransportError('登录辅助未接线', 'SERVER_ERROR'))), false)
  assert.equal(model.flowsUnsupported(null), false)
  const qr = model.readLoginFlow(flow({ steps: [{ id: 'q', kind: 'challenge', status: 'active', title: '扫码', at: NOW, taskId: 'task-2', challenge: { id: 'icqq-qrcode', kind: 'qrcode', title: '扫码', media: { refreshable: true } } }] }))
  const declaration = model.readLoginDeclaration({ login: { mode: 'interactive', challenges: ['qrcode', 'bogus'], relogin: true, refreshQr: true } })
  assert.deepEqual(declaration, { mode: 'interactive', challenges: ['qrcode'], relogin: true, refreshQr: true })
  assert.deepEqual(model.flowControls(qr, declaration, true), { relogin: true, refresh: true, cancel: true })
  assert.deepEqual(model.flowControls(qr, declaration, false), { relogin: false, refresh: false, cancel: false }, 'read-only principals get no actions')
  assert.deepEqual(model.flowControls(qr, { mode: 'interactive' }, true), { relogin: false, refresh: false, cancel: true }, 'undeclared = unsupported')
  assert.equal(model.flowControls(model.readLoginFlow(flow()), declaration, true).refresh, false, 'auth challenges are not refreshable')
  assert.equal(model.readLoginDeclaration({ login: { mode: 'bogus' } }), undefined)
})

test('overview badge reads loginStep from the account row', () => {
  assert.deepEqual(model.loginStepBadge({ loginStep: { index: 2, total: 4, title: '短信验证码' } }), { index: 2, total: 4, title: '短信验证码' })
  assert.equal(model.loginStepBadge({ loginStep: { index: 5, total: 4, title: 'x' } }), null)
  assert.equal(model.loginStepBadge({}), null)
  assert.equal(translate('en', '等待登录（第 {0}/{1} 步）', ['2', '4']), 'Waiting to sign in (step 2/4)')
  assert.equal(translate('zh-CN', '等待登录（第 {0}/{1} 步）', ['2', '4']), '等待登录（第 2/4 步）')
})

test('clock offset: only a live, newer snapshot calibrates (history replay and timed-out replies never do)', () => {
  const now = 1_000_000_000
  const incoming = model.readLoginFlow(flow({ updatedAt: now + 60_000, revision: 9 }))
  const older = model.readLoginFlow(flow({ updatedAt: now - 3_600_000, revision: 1 }))
  assert.equal(model.nextClockOffset(0, { incoming, chosen: incoming, fresh: true, localNow: now }), 60_000)
  assert.equal(model.nextClockOffset(5_000, { incoming: older, chosen: older, fresh: false, localNow: now }), 5_000, 'history / pending reply')
  assert.equal(model.nextClockOffset(5_000, { incoming: older, chosen: incoming, fresh: true, localNow: now }), 5_000, 'stale revision')
  assert.equal(model.isLiveEnvelope({ delivery: 'history', data: {} }), false)
  assert.equal(model.isLiveEnvelope({ data: {} }), true)
  assert.equal(model.isLiveEnvelope({ delivery: 'live' }), true)
})
