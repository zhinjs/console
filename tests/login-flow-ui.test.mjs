import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'
import { translate } from '../console-ui/src/i18n/locale.mjs'
import * as receiptModel from '../console-ui/src/components/action-receipt-model.mjs'
import * as flowModel from '../console-ui/src/pages/scope/login-flow-model.mjs'
import * as helpers from '../console-ui/src/pages/scope/login-assist-helpers.mjs'
import * as qrCode from '../console-ui/src/pages/scope/qr-code.mjs'

const require = createRequire(import.meta.url)
const source = path => readFile(new URL(`../console-ui/src/${path}`, import.meta.url), 'utf8')
function compile(code, mocks) {
  const module = { exports: {} }
  const output = ts.transpileModule(code, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX } }).outputText
  new Function('require', 'module', 'exports', output)(name => {
    if (Object.hasOwn(mocks, name)) return mocks[name]
    if (name.endsWith('.css')) return {}
    if (name === 'react/jsx-runtime') return require(name)
    throw new Error(`unmocked import ${name}`)
  }, module, module.exports)
  return module.exports
}
const nodes = node => node && typeof node === 'object' ? [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)] : []
const text = node => typeof node === 'string' || typeof node === 'number' ? String(node) : node && typeof node === 'object' ? [node.props?.children].flat(Infinity).map(text).join('') : ''
const lucide = new Proxy({}, { get: (_target, key) => key === '__esModule' ? false : String(key) })

/** Hooks with state, refs and effects (run after each render); function components are expanded in place. */
function hookRuntime() {
  const slots = []
  let cursor = 0, pending = []
  const equal = (a, b) => !!a && !!b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]))
  const effect = (fn, deps) => {
    const index = cursor++, previous = slots[index]
    if (!previous || !deps || !equal(previous.deps, deps)) {
      slots[index] = { deps, cleanup: previous?.cleanup }
      pending.push(() => { previous?.cleanup?.(); const cleanup = fn(); slots[index].cleanup = typeof cleanup === 'function' ? cleanup : undefined })
    }
  }
  const expand = node => {
    if (Array.isArray(node)) return node.map(expand)
    if (!node || typeof node !== 'object') return node
    if (typeof node.type === 'function') return expand(node.type(node.props))
    const children = node.props?.children
    return children === undefined ? node : { ...node, props: { ...node.props, children: expand(children) } }
  }
  return {
    hooks: {
      useState(initial) { const index = cursor++; if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial; return [slots[index], value => { slots[index] = typeof value === 'function' ? value(slots[index]) : value }] },
      useRef(initial) { const index = cursor++; return slots[index] ?? (slots[index] = { current: initial }) },
      useMemo(fn) { cursor++; return fn() },
      useCallback(fn) { cursor++; return fn },
      useEffect: effect,
    },
    render(fn) { cursor = 0; const tree = expand(fn()); const run = pending; pending = []; run.forEach(item => item()); return tree },
    unmount() { slots.forEach(slot => slot?.cleanup?.()) },
  }
}

function fakeWindow() {
  const listeners = new Map()
  const opened = []
  const win = {
    location: { origin: 'https://console.example' },
    setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
    addEventListener(type, listener) { const set = listeners.get(type) ?? new Set(); set.add(listener); listeners.set(type, set) },
    removeEventListener(type, listener) { listeners.get(type)?.delete(listener) },
    open(...args) {
      const element = () => ({ attributes: {}, setAttribute(name, value) { this.attributes[name] = value }, click() { popup.navigated = this.attributes.href } })
      const popup = { closed: false, close() { this.closed = true }, document: { head: { appendChild() {} }, body: { appendChild() {} }, createElement: element } }
      opened.push({ args, popup })
      return win.blockPopups ? null : popup
    },
    dispatch(type, event) { for (const listener of [...(listeners.get(type) ?? [])]) listener(event) },
    listeners, opened, blockPopups: false,
  }
  return win
}

// Effects (countdowns) use window timers; tests that drive the popup swap in their own window.
globalThis.window = fakeWindow()

const NOW = Date.now()
const qrChallenge = { id: 'icqq-qrcode', kind: 'qrcode', title: '扫码登录', help: { short: '用手机 QQ 扫码', steps: ['打开手机 QQ 扫一扫', '在手机上确认登录'] },
  media: { qrImage: 'data:image/png;base64,iVBORw0KGgo=', refreshable: true, expiresAt: NOW + 90_000 }, actions: [{ id: 'confirm', label: '已扫码，继续', variant: 'primary' }] }
const smsChallenge = { id: 'icqq-sms', kind: 'sms', title: '短信验证码', help: { short: '验证码已发送到 138****0000' },
  input: { kind: 'code', label: '短信验证码', length: 6, pattern: '^\\d{6}$', patternHint: '请输入 6 位数字' },
  actions: [{ id: 'submit', label: '提交', variant: 'primary', requiresInput: true }, { id: 'resend', label: '重新发送', variant: 'secondary', cooldownMs: 60_000 }] }
function flowWith(challenge, extra = {}) {
  return flowModel.readLoginFlow({
    id: 'flow-1', adapter: 'icqq', endpointKey: '10001', startedAt: NOW - 60_000, updatedAt: NOW, revision: 3, attempt: 2, state: 'active', currentStep: 's3', activeTaskId: 'task-3',
    steps: [
      { id: 's1', kind: 'connect', status: 'done', title: '连接服务器', at: NOW - 60_000, endedAt: NOW - 58_000 },
      { id: 's2', kind: 'challenge', status: 'failed', title: '短信验证码', at: NOW - 50_000, endedAt: NOW - 40_000, outcome: { result: 'rejected', code: 'code_invalid', message: '验证码错误' } },
      { id: 's3', kind: 'challenge', status: 'active', title: challenge.title, at: NOW - 10_000, taskId: 'task-3', challenge },
      ...(extra.steps ?? []),
    ],
    ...extra.flow,
  })
}
const endpoint = { name: '10001', adapter: 'icqq', connected: false, status: 'offline', login: { mode: 'interactive', relogin: true, refreshQr: true } }

async function cardEnvironment({ locale = 'zh-CN', receiptStates = {}, flow, requests = [], reply = async () => ({}) } = {}) {
  const runtime = hookRuntime()
  const i18n = { locale, t: (message, values) => translate(locale, message, values) }
  const receipts = {}
  const common = { react: runtime.hooks, 'lucide-react': lucide, '@zhin.js/client': { cn: (...names) => names.filter(Boolean).join(' ') }, '../../i18n': { useI18n: () => i18n } }
  const challengeModule = compile(await source('pages/scope/login-challenge.tsx'), {
    ...common, '../../components/ui/button': { Button: 'button' }, '../../components/ui/input': { Input: 'input' },
    '../clipboard-copy.mjs': { copyText: async () => true }, './qr-code.mjs': qrCode, './login-assist-helpers.mjs': helpers, './login-flow-model.mjs': flowModel,
  })
  const flowState = { status: 'ready', flow, refreshing: false, error: null, readAt: NOW }
  const applied = []
  const card = compile(await source('pages/scope/login-flow-card.tsx'), {
    ...common,
    '../../components/ui/badge': { Badge: 'badge' }, '../../components/ui/button': { Button: 'button' }, '../../components/ui/card': { Card: 'card' },
    '../../components/ui/skeleton': { Skeleton: 'skeleton' },
    '../../components/StatusState': { StatusState: props => ({ type: 'status-state', props: { ...props, children: [props.title, props.description] } }) },
    '../../components/ActionReceipt': {
      ActionReceipt: ({ controller }) => ({ type: 'receipt', props: { phase: controller.state.phase } }),
      useActionReceipt: options => {
        const key = options.persistKey
        const calls = receipts[key] ?? (receipts[key] = { options, prepared: [], confirmed: 0, verified: 0 })
        calls.options = options
        return {
          state: receiptStates[key] ?? { phase: 'idle' },
          prepare: plan => calls.prepared.push(plan), confirm: () => { calls.confirmed += 1 }, verify: () => { calls.verified += 1 },
          cancel() {}, reset() {}, canVerify: true,
        }
      },
    },
    '../../components/action-receipt-model.mjs': receiptModel,
    '../../components/log-panel/LogPanel': { useLogPanel: () => ({ available: true, open() {} }) },
    '../../utils/console-rpc': { requestConsole: (request, options) => { requests.push({ request, options }); return reply(request) } },
    './login-tasks': { LoginTaskCard: props => ({ type: 'legacy-card', props: { taskId: props.task.id, readOnly: props.readOnly } }) },
    './login-challenge': challengeModule,
    './use-login-flow': { useLoginFlow: () => ({ state: flowState, refresh() {}, apply: flow => applied.push(flow) }) },
    './login-flow-model.mjs': flowModel,
  })
  return { runtime, card, receipts, requests, applied, flowState, challengeModule, i18n }
}

test('a Host without login.flow.list shows 需要新版 Host and the legacy task cards', async () => {
  const env = await cardEnvironment()
  env.flowState.status = 'legacy'
  const tree = env.runtime.render(() => env.card.LoginFlowSection({ endpoint, legacyTasks: [{ id: 'legacy-1', adapter: 'icqq', endpointKey: '10001', type: 'qrcode', payload: {} }], canOperate: true, onSettled() {} }))
  const state = nodes(tree).find(node => node.type === 'status-state')
  assert.equal(state.props.kind, 'unsupported')
  assert.equal(state.props.title, '需要新版 Host 才能显示登录进度')
  assert.deepEqual(nodes(tree).filter(node => node.type === 'legacy-card').map(node => node.props), [{ taskId: 'legacy-1', readOnly: false }])
})

test('the operator sees the step timeline, the challenge and the header actions', async () => {
  const env = await cardEnvironment({ flow: flowWith(qrChallenge) })
  const tree = env.runtime.render(() => env.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: true, onSettled() {} }))
  const all = text(tree)
  assert.match(all, /扫码登录/u)
  assert.match(all, /第 2 次尝试/u)
  assert.match(all, /第 1 \/ 2 步/u, 'the guided checklist counts its own steps')
  const timeline = nodes(tree).find(node => node.props?.className === 'console-login-timeline')
  const steps = nodes(timeline).filter(node => node.type === 'li')
  assert.equal(steps.length, 3)
  assert.match(steps[0].props.className, /is-done/u)
  assert.match(steps[0].props.className, /is-collapsed/u)
  assert.match(steps[1].props.className, /is-failed/u)
  assert.match(text(steps[1]), /验证码或 ticket 不正确/u)
  assert.equal(steps[2].props['aria-current'], 'step')
  const buttons = nodes(tree).filter(node => node.type === 'button').map(text)
  for (const label of ['刷新二维码', '重新登录', '取消', '已扫码，继续']) assert.ok(buttons.includes(label), `${label} in ${buttons.join(' | ')}`)
  assert.ok(nodes(tree).some(node => node.type === 'img' && node.props.src === qrChallenge.media.qrImage), 'large QR code')
  assert.match(all, /后过期/u, 'countdown to expiresAt')
})

test('read-only principals see the timeline and status but no actions, inputs or QR code', async () => {
  const env = await cardEnvironment({ flow: flowWith(smsChallenge) })
  const tree = env.runtime.render(() => env.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: false, onSettled() {} }))
  assert.ok(nodes(tree).some(node => node.props?.className === 'console-login-timeline'))
  assert.match(text(tree), /完成验证需要 endpoint\.operate 权限/u)
  assert.deepEqual(nodes(tree).filter(node => node.type === 'button').map(text), ['日志'], 'only the log shortcut')
  assert.equal(nodes(tree).filter(node => node.type === 'input').length, 0)
  assert.equal(nodes(tree).filter(node => node.type === 'img').length, 0)
  // The failed step shows its reason without the next-action button.
  const failed = nodes(tree).find(node => node.type === 'div' && node.props?.className === 'console-login-outcome')
  assert.match(text(failed), /验证码错误/u)
  assert.equal(nodes(failed).filter(node => node.type === 'button').length, 0)
})

test('submitting goes through the receipt with wait: true and maps every reply', async () => {
  let answer
  const env = await cardEnvironment({ flow: flowWith(smsChallenge), reply: async () => answer() })
  const tree = env.runtime.render(() => env.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: true, onSettled() {} }))
  // The rejected previous answer is repeated next to the input.
  const notice = nodes(tree).find(node => node.props?.className === 'console-login-callout console-login-callout--danger')
  assert.match(text(notice), /上次提交没有通过：验证码或 ticket 不正确/u)
  assert.match(text(notice), /验证码错误/u)
  // The submit button waits for a valid code.
  const submitButton = () => nodes(env.runtime.render(() => env.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: true, onSettled() {} }))).find(node => node.type === 'button' && node.props['data-action-id'] === 'submit')
  assert.equal(submitButton().props.disabled, true)
  const input = nodes(tree).find(node => node.type === 'input')
  input.props.onChange({ target: { value: '123456' } })
  const button = submitButton()
  assert.equal(button.props.disabled, false)
  button.props.onClick()
  const receipt = env.receipts['login-flow:icqq:10001']
  assert.equal(receipt.prepared.length, 1)
  assert.equal(receipt.confirmed, 1, 'answering is one click')
  const plan = receipt.prepared[0]
  assert.deepEqual(plan.payload, { taskId: 'task-3', value: { action: 'submit', values: { input: '123456' } }, adapter: 'icqq', endpointKey: '10001' })
  assert.doesNotMatch(JSON.stringify(plan.changes), /123456/u, 'the value is never shown in the receipt')

  answer = async () => ({ accepted: true, outcome: { result: 'rejected', code: 'code_invalid', message: '验证码错误' }, flow: { ...flowWith(smsChallenge), revision: 9 } })
  assert.deepEqual(await receipt.options.submit(plan), { status: 'failed', message: '验证码或 ticket 不正确：验证码错误' })
  const sent = env.requests.at(-1)
  assert.deepEqual(sent.request, { type: 'login.submit', taskId: 'task-3', value: { action: 'submit', values: { input: '123456' } }, wait: true, adapter: 'icqq', endpointKey: '10001' })
  assert.equal(sent.options.timeoutMs, flowModel.LOGIN_SUBMIT_TIMEOUT_MS)
  assert.ok(flowModel.LOGIN_SUBMIT_TIMEOUT_MS > 15_000, 'longer than the Host waits')
  assert.equal(env.applied.at(-1).revision, 9, 'the reply flow is applied')
  answer = async () => ({ accepted: true, outcome: { result: 'online' } })
  assert.equal(receiptModel.readSubmitResult(await receipt.options.submit(plan)).phase, 'succeeded')
  answer = async () => ({ accepted: true, pending: true })
  assert.equal(receiptModel.readSubmitResult(await receipt.options.submit(plan)).phase, 'unknown', '结果待确认')
  // A refused answer (LoginSubmissionError) is 未执行 with its reason; a transport failure stays an error (→ 结果未知).
  answer = async () => { throw Object.assign(new Error('JSON 中没有 ticket 字段'), { details: { dataCode: 'input_invalid' } }) }
  assert.deepEqual(await receipt.options.submit(plan), { status: 'failed', message: '输入的格式不正确：JSON 中没有 ticket 字段' })
  answer = async () => { throw Object.assign(new Error('REST request failed'), { code: 'MESSAGE_ERROR' }) }
  await assert.rejects(receipt.options.submit(plan), /REST request failed/u)

  // The check reads the flow (login.flow.get), never the task list.
  answer = async () => ({ flow: { ...flowWith(smsChallenge), state: 'online', activeTaskId: undefined, revision: 12 } })
  assert.deepEqual(await receipt.options.verify(plan), { applied: true, message: '账号已上线。' })
  assert.deepEqual(env.requests.at(-1).request, { type: 'login.flow.get', adapter: 'icqq', endpointKey: '10001' })
  answer = async () => ({ flow: flowWith(smsChallenge) })
  const undecided = await receipt.options.verify(plan)
  assert.equal(undecided.applied, undefined, 'still open: not success')
})

test('while waiting: 提交中 → 验证中 replaces the receipt; an unknown result is re-checked when the flow moves', async () => {
  const verifying = flowWith(smsChallenge, { steps: [{ id: 's4', kind: 'verifying', status: 'active', title: '正在校验短信验证码', at: NOW }] })
  const env = await cardEnvironment({ flow: verifying, receiptStates: { 'login-flow:icqq:10001': { phase: 'submitting' } } })
  let tree = env.runtime.render(() => env.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: true, onSettled() {} }))
  const progress = nodes(tree).find(node => node.props?.className === 'console-login-progress')
  assert.ok(progress, 'submit progress shown')
  assert.match(text(progress), /已提交.*正在校验短信验证码.*等待结果/u)
  assert.ok(!nodes(tree).some(node => node.type === 'receipt' && node.props.phase === 'submitting'), 'no duplicate 正在提交 receipt')
  assert.equal(nodes(tree).find(node => node.props?.['data-action-id'] === 'submit').props.disabled, true, 'no second submission')

  const receiptStates = { 'login-flow:icqq:10001': { phase: 'unknown' } }
  const unknown = await cardEnvironment({ flow: flowWith(smsChallenge), receiptStates })
  tree = unknown.runtime.render(() => unknown.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: true, onSettled() {} }))
  assert.ok(nodes(tree).some(node => node.type === 'receipt' && node.props.phase === 'unknown'))
  assert.equal(unknown.receipts['login-flow:icqq:10001'].verified, 1, 'checked once on mount')
  // A check that came back undecided returns to 结果未知; the same revision is not checked again (no loop).
  receiptStates['login-flow:icqq:10001'] = { phase: 'verifying' }
  unknown.runtime.render(() => unknown.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: true, onSettled() {} }))
  receiptStates['login-flow:icqq:10001'] = { phase: 'unknown' }
  unknown.runtime.render(() => unknown.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: true, onSettled() {} }))
  assert.equal(unknown.receipts['login-flow:icqq:10001'].verified, 1, 'no re-check without a flow change')
  unknown.flowState.flow = { ...unknown.flowState.flow, revision: 4 }
  unknown.runtime.render(() => unknown.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: true, onSettled() {} }))
  assert.equal(unknown.receipts['login-flow:icqq:10001'].verified, 2, 'checked again when the flow changes')
})

test('header actions: refresh is one click; cancel and relogin ask first and carry the target', async () => {
  const env = await cardEnvironment({ flow: flowWith(qrChallenge), reply: async () => ({ accepted: true }) })
  const tree = env.runtime.render(() => env.card.LoginFlowSection({ endpoint, legacyTasks: [], canOperate: true, onSettled() {} }))
  const click = label => nodes(tree).find(node => node.type === 'button' && text(node) === label).props.onClick()
  click('刷新二维码')
  const control = env.receipts['login-control:icqq:10001']
  assert.equal(control.confirmed, 1)
  assert.equal(control.prepared[0].payload.kind, 'refresh')
  click('重新登录')
  click('取消')
  assert.equal(control.confirmed, 1, 'cancel and relogin wait for 确认')
  assert.deepEqual(control.prepared.map(plan => plan.payload.kind), ['refresh', 'relogin', 'cancel'])
  await control.options.submit(control.prepared[0])
  assert.deepEqual(env.requests.at(-1).request, { type: 'login.refresh', adapter: 'icqq', endpointKey: '10001' })
  await control.options.submit(control.prepared[2])
  assert.deepEqual(env.requests.find(item => item.request.type === 'login.cancel').request, { type: 'login.cancel', taskId: 'task-3', reason: 'console_cancelled', adapter: 'icqq', endpointKey: '10001' })
})

test('hosted captcha: one reply from the helper origin with the nonce is submitted as ticket,randstr', async () => {
  const win = fakeWindow()
  const previous = globalThis.window
  globalThis.window = win
  try {
    const env = await cardEnvironment()
    const replies = []
    const props = { captcha: { provider: 'tencent', query: 'uin=1&sid=x', helperUrl: 'https://helper.example/tcaptcha.html' }, busy: false, onReply: reply => replies.push(reply) }
    let tree = env.runtime.render(() => env.challengeModule.CaptchaHelper(props))
    const start = nodes(tree).find(node => node.props?.['data-captcha-start'])
    assert.equal(text(start), '开始验证')
    start.props.onClick()
    const [{ args, popup }] = win.opened
    assert.deepEqual(args.slice(0, 2), ['about:blank', 'zhin-login-captcha'], 'no referrer: prepared about:blank first')
    const url = new URL(popup.navigated)
    assert.equal(url.origin, 'https://helper.example')
    const payload = helpers.parseCaptchaHelperPayload(url.hash)
    assert.equal(payload.o, 'https://console.example')
    assert.equal(payload.q, 'uin=1&sid=x')
    assert.ok(helpers.isValidCaptchaNonce(payload.n))
    const data = { type: helpers.LOGIN_CAPTCHA_MESSAGE_TYPE, nonce: payload.n, ticket: 't03abc', randstr: '@r' }
    win.dispatch('message', { origin: 'https://evil.example', data })
    win.dispatch('message', { origin: 'https://helper.example', data: { ...data, nonce: 'wrong-nonce-123456' } })
    assert.deepEqual(replies, [], 'wrong origin and wrong nonce are ignored')
    win.dispatch('message', { origin: 'https://helper.example', data })
    assert.deepEqual(replies, [{ ticket: 't03abc', randstr: '@r' }])
    assert.equal(popup.closed, true)
    win.dispatch('message', { origin: 'https://helper.example', data })
    assert.equal(replies.length, 1, 'a replay is ignored and the listener is gone')
    assert.equal(win.listeners.get('message').size, 0)
    assert.deepEqual(flowModel.captchaSubmitValue(replies[0]), { action: 'submit', values: { ticket: 't03abc,@r' } })
    tree = env.runtime.render(() => env.challengeModule.CaptchaHelper(props))
    assert.match(text(tree), /已收到验证结果/u)

    // A blocked popup gets a link that keeps window.opener and sends no referrer.
    const blocked = await cardEnvironment()
    win.blockPopups = true
    let blockedTree = blocked.runtime.render(() => blocked.challengeModule.CaptchaHelper(props))
    nodes(blockedTree).find(node => node.props?.['data-captcha-start']).props.onClick()
    blockedTree = blocked.runtime.render(() => blocked.challengeModule.CaptchaHelper(props))
    const link = nodes(blockedTree).find(node => node.type === 'a')
    assert.equal(link.props.rel, 'opener')
    assert.equal(link.props.referrerPolicy, 'no-referrer')
    assert.equal(new URL(link.props.href).origin, 'https://helper.example')
  } finally {
    globalThis.window = previous
  }
})

test('copy blocks: sensitive content stays hidden until 显示; copy-and-open and the bookmarklet are offered', async () => {
  const win = fakeWindow()
  const previous = globalThis.window
  globalThis.window = win
  globalThis.document ??= { visibilityState: 'visible' }
  try {
    const env = await cardEnvironment()
    const challenge = flowModel.readChallenge({
      id: 'icqq-auth', kind: 'auth', title: '身份验证', help: { short: 's', steps: [{ text: '复制设备 JSON', blockId: 'device-json', doneWhen: 'copied' }, { text: '打开链接', blockId: 'verify-link', doneWhen: 'opened' }], warning: '请勿外传' },
      blocks: [
        { kind: 'copy', id: 'device-json', label: '设备 JSON', content: '{"guid":"secret-guid"}', format: 'json', sensitive: true, thenOpen: 'verify-link' },
        { kind: 'link', id: 'verify-link', label: '验证链接', url: 'https://accounts.qq.com/login/attack?sid=a', showQr: true },
        { kind: 'copy', id: 'helper-script', label: '辅助脚本', content: '(function () { alert(1) })();', format: 'script', collapsed: true, collapsedLabel: '显示脚本', bookmarklet: true },
      ],
      actions: [{ id: 'continue', label: '已完成，继续登录', variant: 'primary' }],
    })
    const step = { id: 's', kind: 'challenge', status: 'active', title: 't', at: NOW, challenge }
    const events = []
    const tree = env.runtime.render(() => env.challengeModule.ChallengePanel({ step, progress: {}, onProgress: event => events.push(event), onSubmit() {}, busy: false, canOperate: true, infoSteps: [] }))
    const all = text(tree)
    assert.doesNotMatch(all, /secret-guid/u, 'hidden until 显示')
    assert.match(all, /请勿外传/u)
    assert.match(all, /第 1 \/ 2 步/u)
    assert.ok(nodes(tree).some(node => node.props?.['data-copy-open']))
    // Blocks carry the guided step they belong to; the current step's block is highlighted.
    const frames = nodes(tree).filter(node => node.props?.className?.startsWith?.('console-login-block-frame'))
    assert.deepEqual(frames.map(frame => [frame.props['data-step'], /is-current/u.test(frame.props.className)]), [[1, true], [2, false], [undefined, false]])
    assert.match(text(frames[0]), /第 1 步/u)
    const bookmarklet = nodes(tree).find(node => node.props?.['data-bookmarklet'])
    assert.equal(bookmarklet.props['data-bookmarklet'], `javascript:${encodeURIComponent('(function () { alert(1) })();')}`)
    assert.equal(bookmarklet.props.href, undefined, 'set on the element, not through React')
    assert.ok(nodes(tree).some(node => node.type === 'svg' && node.props.role === 'img'), 'the link is drawn as a QR code')
    nodes(tree).find(node => node.props?.['data-copy-open']).props.onClick()
    assert.deepEqual(win.opened.at(-1).args, ['https://accounts.qq.com/login/attack?sid=a', '_blank', 'noopener,noreferrer'])
    await new Promise(resolve => setImmediate(resolve))
    assert.deepEqual(events, [{ type: 'opened', blockId: 'verify-link' }, { type: 'copied', blockId: 'device-json' }])
  } finally {
    globalThis.window = previous
  }
})

test('every new login string has an English translation', async () => {
  for (const key of ['需要新版 Host 才能显示登录进度', '复制并打开验证页', '拖到书签栏', '开始验证', '已扫码，请在手机上确认', '结果待确认：平台还没有给出结果。页面会继续等待，结果出来后自动更新，不需要重复提交。']) {
    assert.notEqual(translate('en', key), key, key)
  }
})
