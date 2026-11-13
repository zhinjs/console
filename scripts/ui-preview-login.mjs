/**
 * Login Assist v2 fixture for the UI preview (`ui-preview-host.mjs`, ADR 0058): icqq accounts whose
 * login flows move like a real Host's — QR code → scanned → online, slider with the hosted captcha
 * helper, device lock with SMS and resend cooldown, identity check with device JSON and script, a
 * failed step, a rate limit and a result that stays pending. Enabled with UI_PREVIEW_LOGIN=flows;
 * otherwise `login.flow.*` answers like an older Host (Unknown RPC) and the Console falls back.
 *
 * Every change is pushed as a redacted `endpoint.login.flow` event (no QR image, links or sensitive
 * copy), as the Host does; the Console reads the live material with `login.flow.get`.
 * `/login-assist/tcaptcha.html` is a stand-in helper page: no Tencent script, one button that
 * answers like the real page, and it shows `document.referrer` / `window.opener` for checking.
 */
import { encodeQr, qrSvgPath } from '../console-ui/src/pages/scope/qr-code.mjs'
import { LOGIN_CAPTCHA_MESSAGE_TYPE, parseLoginTicket } from '../console-ui/src/pages/scope/login-assist-helpers.mjs'

export const loginMode = process.env.UI_PREVIEW_LOGIN === 'flows' ? 'flows' : 'legacy'
const SECOND = 1000
const VERIFY_DELAY_MS = Number(process.env.UI_PREVIEW_LOGIN_VERIFY_MS ?? 4000)

let helperOrigin = 'http://localhost:18087'
export function configureLoginFixture({ port }) { helperOrigin = `http://localhost:${port}` }
const helperUrl = () => `${helperOrigin}/login-assist/tcaptcha.html`

const DECLARATION = Object.freeze({ mode: 'interactive', challenges: ['qrcode', 'slider', 'device', 'sms', 'auth'], relogin: true, refreshQr: true })
const ACCOUNTS = ['qr-demo', 'qr-scanned', 'slider-demo', 'device-demo', 'sms-failed', 'rate-limited', 'auth-demo', 'pending-demo']

/** Account rows (`endpoint.list`) of the login accounts, with `login` and `loginStep`. */
export function loginEndpointRows() {
  if (loginMode !== 'flows') return []
  return ACCOUNTS.map(key => {
    const flow = flowOf(key)
    const active = flow.state === 'active' || flow.state === 'expired'
    const index = flow.steps.findIndex(step => step.id === flow.currentStep)
    return {
      name: key, adapter: 'icqq', connected: flow.state === 'online', status: flow.state === 'online' ? 'online' : 'offline', transportState: flow.state === 'online' ? 'open' : 'connecting',
      phase: flow.state === 'online' ? 'ready' : 'starting', endpoint: { adapter: 'icqq', id: key }, managementCapabilities: [], pendingRequestCount: 0, pendingNoticeCount: 0,
      login: DECLARATION,
      ...(active ? { pendingLogin: true, loginStep: { index: Math.max(1, index + 1), total: flow.steps.length, title: flow.steps[Math.max(0, index)]?.title ?? '' } } : {}),
    }
  })
}

// ---------------------------------------------------------------- flows

const flows = new Map()
let seq = 0
const id = prefix => `${prefix}-${(++seq).toString(36)}`

function qrDataUrl(text) {
  const qr = encodeQr(text, { ecl: 'M' })
  const size = qr.size + 8
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#fff"/><path fill="#000" d="${qrSvgPath(qr, 4)}"/></svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

const connectStep = at => ({ id: id('step'), kind: 'connect', status: 'done', title: '正在连接 QQ…', at, endedAt: at + 2 * SECOND })

const challenges = {
  qrcode: () => ({
    id: 'icqq-qrcode', kind: 'qrcode', title: '扫码登录',
    help: { short: '用手机 QQ 扫描二维码，然后在手机上确认登录。', steps: ['用手机 QQ 扫码', '在手机上确认登录', '确认后会自动继续；没有继续时点「我已确认登录」'] },
    media: { qrImage: qrDataUrl(`https://txz.qq.com/p?k=preview-${Date.now().toString(36)}&f=716027609`), refreshable: true, expiresAt: Date.now() + 120 * SECOND },
    actions: [{ id: 'confirm', label: '我已确认登录', variant: 'primary' }],
  }),
  slider: () => {
    const url = 'https://ssl.captcha.qq.com/template/wireless_mqq_captcha.html?style=simple&aid=16&uin=10002&sid=preview-sid&cap_cd=preview-cap'
    return {
      id: 'icqq-slider', kind: 'slider', title: '滑块验证',
      help: { short: '完成腾讯滑块验证。在 Console 可以打开验证码辅助页，完成后自动提交，不需要开发者工具。', steps: [
        { text: '打开滑块验证链接', blockId: 'slider-link', doneWhen: 'opened' },
        '按 F12 打开开发者工具的「网络」面板，再拖动滑块完成拼图',
        '在 cap_union_new_verify 请求的响应里复制 ticket；也可以粘贴整段响应或带 ticket 的链接，会自动提取',
      ] },
      blocks: [{ kind: 'link', id: 'slider-link', label: '打开滑块验证', url }],
      media: { captcha: { provider: 'tencent', query: new URL(url).search.slice(1), helperUrl: helperUrl() } },
      input: { kind: 'ticket', label: 'ticket', extract: 'ticket-json-or-url' },
      actions: [{ id: 'submit', label: '提交', variant: 'primary', requiresInput: true }],
    }
  },
  device: () => ({
    id: 'icqq-device', kind: 'device', title: '设备锁验证',
    help: { short: '这台设备需要用绑定的手机确认后才能登录。', steps: [
      { text: '用手机 QQ 扫描验证链接的二维码，或在手机上打开链接', blockId: 'verify-link', doneWhen: 'opened' },
      '按手机上的提示完成验证', '完成后点「我已在手机完成验证」', '无法用链接验证时，可以点「改用短信验证码」',
    ] },
    blocks: [{ kind: 'link', id: 'verify-link', label: '设备锁验证链接', url: 'https://accounts.qq.com/safe/verify?_wv=2&uin=10004&sid=preview-device-sid', showQr: true }],
    actions: [{ id: 'continue', label: '我已在手机完成验证', variant: 'primary' }, { id: 'sms', label: '改用短信验证码', variant: 'secondary' }],
  }),
  sms: () => ({
    id: 'icqq-sms', kind: 'sms', title: '短信验证码',
    help: { short: '验证码已发送到 138****0000，请输入收到的 6 位验证码。' },
    input: { kind: 'code', label: '验证码', length: 6, pattern: '^\\d{6}$', patternHint: '请输入 6 位数字' },
    actions: [{ id: 'submit', label: '提交', variant: 'primary', requiresInput: true }, { id: 'resend', label: '重新发送', variant: 'secondary', cooldownMs: 60 * SECOND }],
  }),
  auth: () => ({
    id: 'icqq-auth', kind: 'auth', title: '身份验证',
    help: {
      short: 'QQ 要求在验证页确认这台设备，需要把设备信息带到验证页。按下面的步骤做。',
      steps: [
        { text: '复制设备 JSON', blockId: 'device-json', doneWhen: 'copied' },
        { text: '打开验证链接，进入发送验证码的页面', blockId: 'verify-link', doneWhen: 'opened' },
        { text: '在该页按 F12 打开开发者工具的 Console 运行辅助脚本（也可以把它拖到书签栏后点击），按提示粘贴设备 JSON，再完成验证', blockId: 'helper-script', doneWhen: 'copied' },
        { text: '完成后点「已完成，继续登录」', doneWhen: 'manual' },
      ],
      warning: '不要把设备 JSON 粘贴到其他网站或发给他人',
    },
    blocks: [
      { kind: 'copy', id: 'device-json', label: '设备 JSON', format: 'json', sensitive: true, thenOpen: 'verify-link',
        content: JSON.stringify({ guid: 'preview-0f1e2d3c4b5a69788796a5b4c3d2e1f0', qimei: 'preview-qimei-not-real', imei: '86xxxxxxxxxxxx', brand: 'Xiaomi', model: 'MI 11', android_id: 'preview-android-id' }, null, 2) },
      { kind: 'link', id: 'verify-link', label: '验证链接', url: 'https://accounts.qq.com/login/attack?sid=preview-auth-sid', showQr: true },
      { kind: 'copy', id: 'helper-script', label: '辅助脚本', format: 'script', collapsed: true, collapsedLabel: '展开辅助脚本', bookmarklet: true,
        content: [
          '(function () {',
          '  if (location.hostname !== "accounts.qq.com" || location.pathname !== "/login/attack") {',
          '    alert("请在 accounts.qq.com/login/attack（发送验证码的页面）运行这段脚本");',
          '    return;',
          '  }',
          '  var raw = prompt("粘贴从 Zhin 复制的设备 JSON");',
          '  if (!raw) return;',
          '  var info;',
          '  try { info = JSON.parse(raw); } catch (error) { alert("设备 JSON 格式不正确，请重新复制"); return; }',
          '  window.__INITIAL_STATE__.deviceInfo = info;',
          '  alert("设备信息已写入。请在页面上继续完成验证，完成后回到 Zhin 点「已完成，继续登录」");',
          '})();',
        ].join('\n') },
    ],
    actions: [{ id: 'continue', label: '已完成，继续登录', variant: 'primary' }],
  }),
}

function challengeStep(kind, at = Date.now()) {
  const taskId = id('task')
  return { id: id('step'), kind: 'challenge', status: 'active', title: challenges[kind]().title, at, taskId, challenge: challenges[kind]() }
}

function newFlow(key, attempt = 1) {
  const now = Date.now()
  const flow = { id: id('flow'), adapter: 'icqq', endpointKey: key, startedAt: now - 95 * SECOND, updatedAt: now, revision: 1, attempt, state: 'active', steps: [connectStep(now - 95 * SECOND)] }
  const open = (kind, at) => { const step = challengeStep(kind, at); flow.steps.push(step); flow.currentStep = step.id; flow.activeTaskId = step.taskId; return step }
  switch (key) {
    case 'qr-demo': open('qrcode', now - 20 * SECOND); break
    case 'qr-scanned': {
      open('qrcode', now - 40 * SECOND)
      const info = { id: id('step'), kind: 'info', status: 'active', title: '已扫码，请在手机上确认登录', at: now - 5 * SECOND }
      flow.steps.push(info)
      break
    }
    case 'slider-demo': open('slider', now - 30 * SECOND); break
    case 'device-demo': open('device', now - 15 * SECOND); break
    case 'sms-failed':
    case 'rate-limited': {
      const device = challengeStep('device', now - 80 * SECOND)
      flow.steps.push({ ...device, status: 'done', endedAt: now - 70 * SECOND })
      const failed = challengeStep('sms', now - 60 * SECOND)
      flow.steps.push({ ...failed, status: 'failed', endedAt: now - 30 * SECOND, outcome: key === 'rate-limited'
        ? { result: 'rejected', code: 'rate_limited', message: '操作过于频繁，请稍后再试', next: 'wait', retryAfterMs: 120 * SECOND }
        : { result: 'rejected', code: 'code_invalid', message: '验证码错误，请重新输入' } })
      open('sms', now - 25 * SECOND)
      flow.attempt = 2
      break
    }
    case 'auth-demo': open('auth', now - 10 * SECOND); break
    case 'pending-demo': open('sms', now - 70 * SECOND); break
  }
  flow.lastOutcome = undefined
  return flow
}

function flowOf(key) {
  if (!flows.has(key)) flows.set(key, newFlow(key))
  return flows.get(key)
}

const clients = new Set()
let eventId = 1000
/** Adds an SSE response that receives `endpoint.login.flow` events. */
export function attachLoginEvents(response, request) {
  clients.add(response)
  request.on('close', () => clients.delete(response))
}

/** Event copy: no QR image, no verification links, sensitive copy blocks emptied (ADR 0058 §3). */
function redacted(flow) {
  const copy = structuredClone(flow)
  for (const step of copy.steps) {
    const challenge = step.challenge
    if (!challenge) continue
    if (challenge.media?.qrImage) { delete challenge.media.qrImage; challenge.media.qrImageOmitted = true }
    const hasLinks = (challenge.blocks ?? []).some(block => block.kind === 'link') || challenge.media?.link || challenge.media?.captcha
    if (hasLinks && challenge.kind !== 'qrcode') {
      challenge.blocks = (challenge.blocks ?? []).filter(block => block.kind !== 'link')
      if (challenge.media) { delete challenge.media.link; delete challenge.media.captcha }
      challenge.media = { ...challenge.media, linkOmitted: true }
    }
    challenge.blocks = (challenge.blocks ?? []).map(block => block.kind === 'copy' && block.sensitive ? { ...block, content: '', redacted: true } : block)
  }
  return copy
}

function changed(flow) {
  flow.revision += 1
  flow.updatedAt = Date.now()
  const frame = `event: endpoint.login.flow\nid: ${++eventId}\nruntime: ui-preview\ndata: ${JSON.stringify(redacted(flow))}\n\n`
  for (const client of clients) client.write(frame)
}

/** Live copy for `login.flow.*`: sensitive content only on the active challenge. */
function live(flow) {
  const copy = structuredClone(flow)
  for (const step of copy.steps) {
    if (step.status === 'active' || !step.challenge) continue
    if (step.challenge.media?.qrImage) delete step.challenge.media.qrImage
    step.challenge.blocks = (step.challenge.blocks ?? []).map(block => block.kind === 'copy' && block.sensitive ? { ...block, content: '', redacted: true } : block)
  }
  return copy
}

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))

function activeStep(flow) { return flow.steps.find(step => step.taskId === flow.activeTaskId && step.status === 'active') }

function beginVerifying(flow, step, title) {
  step.status = 'done'
  step.endedAt = Date.now()
  delete flow.activeTaskId
  for (const info of flow.steps) if (info.kind === 'info' && info.status === 'active') { info.status = 'done'; info.endedAt = Date.now() }
  const verifying = { id: id('step'), kind: 'verifying', status: 'active', title, at: Date.now() }
  flow.steps.push(verifying)
  flow.currentStep = verifying.id
  changed(flow)
  return verifying
}

function finishOnline(flow, verifying) {
  verifying.status = 'done'
  verifying.endedAt = Date.now()
  verifying.outcome = { result: 'online' }
  flow.state = 'online'
  flow.lastOutcome = { result: 'online' }
  delete flow.currentStep
  changed(flow)
  return { result: 'online' }
}

function openNext(flow, kind) {
  const step = challengeStep(kind)
  flow.steps.push(step)
  flow.currentStep = step.id
  flow.activeTaskId = step.taskId
  changed(flow)
}

class Refusal extends Error { constructor(message, code) { super(message); this.code = code } }

async function submit(flow, step, value) {
  const action = typeof value === 'object' && value ? value.action : 'submit'
  const values = typeof value === 'object' && value?.values ? value.values : { input: String(value ?? '') }
  const kind = step.challenge.kind
  if (!step.challenge.actions.some(item => item.id === action)) throw new Refusal(`unknown login action: ${action}`, 'invalid_action')
  if (kind === 'sms' && action === 'resend') {
    step.status = 'skipped'
    step.endedAt = Date.now()
    openNext(flow, 'sms')
    return { result: 'accepted' }
  }
  if (kind === 'device' && action === 'sms') {
    step.status = 'done'
    step.endedAt = Date.now()
    openNext(flow, 'sms')
    return { result: 'accepted' }
  }
  if (kind === 'slider') {
    const parsed = parseLoginTicket(values.input ?? values.ticket ?? '')
    if (!parsed.ok) throw new Refusal(parsed.error, 'input_invalid')
  }
  if (kind === 'sms') {
    const code = String(values.input ?? '').trim()
    if (!code) throw new Refusal('验证码 is required', 'input_required')
    if (!/^\d{6}$/u.test(code)) throw new Refusal('请输入 6 位数字', 'input_invalid')
    const verifying = beginVerifying(flow, step, '正在校验短信验证码…')
    await wait(VERIFY_DELAY_MS)
    if (flow.endpointKey === 'pending-demo') {
      // No answer within the wait: the Host replies pending and keeps the step open.
      flow.pendingConfirmation = true
      changed(flow)
      setTimeout(() => { delete flow.pendingConfirmation; finishOnline(flow, verifying) }, 20 * SECOND)
      return null
    }
    if (code === '000000') {
      verifying.status = 'failed'
      verifying.endedAt = Date.now()
      verifying.outcome = { result: 'rejected', code: 'code_invalid', message: '验证码错误，请重新输入' }
      flow.lastOutcome = verifying.outcome
      openNext(flow, 'sms')
      return verifying.outcome
    }
    return finishOnline(flow, verifying)
  }
  const title = { qrcode: '正在登录…', slider: '正在提交滑块结果…', device: '正在确认设备验证…', auth: '正在继续登录…' }[kind] ?? '正在登录…'
  const verifying = beginVerifying(flow, step, title)
  await wait(VERIFY_DELAY_MS)
  return finishOnline(flow, verifying)
}

/** Answers `login.flow.*`, `login.submit`, `login.cancel`, `login.relogin`, `login.refresh`. Returns false for other RPCs. */
export async function answerLoginRpc(type, body, json, envelope) {
  if (!/^login\.(?:flow\.list|flow\.get|submit|cancel|relogin|refresh)$/u.test(type)) return false
  if (loginMode !== 'flows') {
    if (type.startsWith('login.flow.') || type === 'login.relogin' || type === 'login.refresh') { json({ success: false, error: `Unknown RPC type: ${type}` }, 400); return true }
    return false
  }
  const key = String(body.endpointKey ?? body.data?.endpointKey ?? '')
  if (type === 'login.flow.list') {
    const keys = key ? [key] : ACCOUNTS
    json(envelope({ flows: keys.filter(item => ACCOUNTS.includes(item)).map(item => live(flowOf(item))), count: keys.length }))
    return true
  }
  if (!ACCOUNTS.includes(key)) {
    if (type === 'login.flow.get') { json(envelope({ flow: null })); return true }
    json({ success: false, error: `Endpoint not found: icqq/${key}` }, 404); return true
  }
  const flow = flowOf(key)
  if (type === 'login.flow.get') { json(envelope({ flow: live(flow) })); return true }
  if (type === 'login.relogin') {
    const next = newFlow(key, flow.attempt + (flow.state === 'online' ? 0 : 1))
    next.startedAt = Date.now()
    flows.set(key, next)
    changed(next)
    json(envelope({ accepted: true })); return true
  }
  if (type === 'login.refresh') {
    const step = activeStep(flow) ?? [...flow.steps].reverse().find(item => item.challenge?.media?.refreshable)
    if (!step?.challenge?.media?.refreshable) { json({ success: false, error: 'unsupported: icqq does not support refresh challenge', data: { code: 'unsupported' } }, 400); return true }
    if (step.status === 'active') { step.status = 'skipped'; step.endedAt = Date.now() }
    for (const info of flow.steps) if (info.kind === 'info' && info.status === 'active') { info.status = 'skipped'; info.endedAt = Date.now() }
    flow.state = 'active'
    openNext(flow, step.challenge.kind)
    json(envelope({ accepted: true })); return true
  }
  const step = activeStep(flow)
  if (!step || body.taskId !== step.taskId) { json({ success: false, error: `login task not found: ${body.taskId}` }, 404); return true }
  if (type === 'login.cancel') {
    step.status = 'failed'
    step.endedAt = Date.now()
    flow.state = 'cancelled'
    delete flow.activeTaskId
    delete flow.currentStep
    changed(flow)
    json(envelope({ success: true })); return true
  }
  try {
    const outcome = await submit(flow, step, body.value)
    json(envelope(outcome ? { accepted: true, outcome, flow: live(flow) } : { accepted: true, pending: true, flow: live(flow) }))
  } catch (error) {
    if (error instanceof Refusal) { json({ success: false, error: error.message, data: { code: error.code } }, 400); return true }
    throw error
  }
  return true
}

/** Stand-in for docs/public/login-assist/tcaptcha.html (no Tencent script). */
export function captchaHelperPage() {
  return `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>滑块验证（预览）</title>
<style>body{font:14px/1.5 system-ui,sans-serif;margin:0;padding:24px;background:#f4f6fa;color:#111}main{max-width:360px;margin:auto;background:#fff;border-radius:16px;padding:20px;box-shadow:0 4px 16px #0001}
.track{position:relative;height:44px;border-radius:22px;background:#e8edf5;margin:16px 0}.knob{position:absolute;left:4px;top:4px;width:36px;height:36px;border-radius:50%;background:#2563eb;border:0;color:#fff;font-size:18px;cursor:pointer}
code{background:#eef;padding:1px 4px;border-radius:4px}#out{color:#555;font-size:12px;word-break:break-all}</style></head>
<body><main><h1 style="font-size:18px;margin:0 0 4px">拖动滑块完成拼图</h1><p style="margin:0;color:#555">本地预览：点击滑块即视为完成。</p>
<div class="track"><button class="knob" id="knob" aria-label="完成滑块">→</button></div>
<p id="out"></p></main>
<script>
(function () {
  var out = document.getElementById('out');
  var payload = null;
  try {
    var raw = location.hash.slice(1).replace(/-/g, '+').replace(/_/g, '/');
    var bin = atob(raw + '==='.slice((raw.length + 3) % 4));
    payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, function (c) { return c.charCodeAt(0); })));
  } catch (e) {}
  var referrer = document.referrer;
  out.textContent = 'document.referrer = ' + (referrer ? JSON.stringify(referrer) : '(空)') + ' · window.opener = ' + (window.opener ? '可用' : '无') + (payload ? ' · nonce 长度 ' + payload.n.length : ' · 参数无效');
  document.documentElement.dataset.referrer = referrer;
  document.documentElement.dataset.opener = window.opener ? 'yes' : 'no';
  document.getElementById('knob').onclick = function () {
    if (!payload || !window.opener || !/^[A-Za-z0-9._~-]{16,64}$/.test(payload.n)) { out.textContent = '无法交回结果'; return; }
    window.opener.postMessage({ type: ${JSON.stringify(LOGIN_CAPTCHA_MESSAGE_TYPE)}, nonce: payload.n, ticket: 't03PreviewTicket' + Date.now().toString(36), randstr: '@pRv' }, payload.o);
    out.textContent = '已交回结果，可以关闭这个窗口。';
  };
})();
</script></body></html>`
}
