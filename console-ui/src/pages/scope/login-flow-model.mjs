/**
 * Login Assist v2 (zhinjs/zhin ADR 0058) in the Console: one login flow per account, a timeline of
 * steps, and the open challenge rendered purely from its descriptor.
 *
 * The published `@zhin.js/console-protocol` (~1.2) predates these wire types, so this module reads
 * the Host's replies defensively (`readLoginFlow`) and mirrors the protocol shapes in
 * `login-flow-model.d.mts`. Everything here is pure: the card (`login-flow-card.tsx`) and the hook
 * (`use-login-flow.ts`) hold the state. Authored copy is Chinese and shown through `i18n.t`.
 */
import { parseLoginTicket, isValidCaptchaHelperUrl } from './login-assist-helpers.mjs'

export const LOGIN_FLOW_EVENT = 'endpoint.login.flow'
export const LOGIN_RPC = Object.freeze({
  LIST: 'login.list',
  SUBMIT: 'login.submit',
  CANCEL: 'login.cancel',
  FLOW_LIST: 'login.flow.list',
  FLOW_GET: 'login.flow.get',
  RELOGIN: 'login.relogin',
  REFRESH: 'login.refresh',
})
/** Fallback re-read while the page is visible (events normally arrive first). */
export const LOGIN_FLOW_POLL_MS = 30_000
/** Bursts of flow events (verifying → outcome → next challenge) become one live read. */
export const LOGIN_FLOW_DEBOUNCE_MS = 350
/** The Host waits up to 15 s for a login result (`wait: true`); the request may take longer. */
export const LOGIN_SUBMIT_TIMEOUT_MS = 25_000
/** Host error code of `login.relogin` / `login.refresh` when the Adapter offers no such action. */
export const LOGIN_UNSUPPORTED_CODE = 'unsupported'

const CHALLENGE_KINDS = ['qrcode', 'link_verify', 'slider', 'sms', 'device', 'auth', 'confirm', 'other']
const FLOW_STATES = ['active', 'online', 'failed', 'cancelled', 'expired']
const STEP_KINDS = ['connect', 'challenge', 'verifying', 'info']
const STEP_STATUSES = ['active', 'done', 'failed', 'skipped']
const ERROR_CODES = ['code_invalid', 'rate_limited', 'challenge_expired', 'risk_blocked', 'credential_invalid', 'network', 'unknown']
const OUTCOME_RESULTS = ['accepted', 'rejected', 'expired', 'needs_new_challenge', 'online', 'failed']
const NEXT_ACTIONS = ['retry_input', 'refresh_challenge', 'relogin', 'wait', 'none']
const INPUT_KINDS = ['none', 'code', 'ticket', 'text']
const VARIANTS = ['primary', 'secondary', 'danger']
const DONE_WHEN = ['copied', 'opened', 'manual']

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, max = 2000) => typeof value === 'string' ? value.slice(0, max) : ''
const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : undefined
const oneOf = (value, list, fallback) => list.includes(value) ? value : fallback

/** Whether a link is http(s) (the only links a challenge may carry). */
export function isSafeHttpUrl(value) {
  if (typeof value !== 'string') return false
  try {
    const url = new URL(value.trim())
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

/** A QR image the page may show: a raster/SVG data URL or an http(s) URL. */
export function isSafeImageSource(value) {
  return typeof value === 'string' && (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml|bmp);base64,[A-Za-z0-9+/=\s]+$/iu.test(value) || isSafeHttpUrl(value))
}

function readOutcome(raw) {
  if (!isRecord(raw) || !OUTCOME_RESULTS.includes(raw.result)) return undefined
  const retryAfterMs = finite(raw.retryAfterMs)
  return Object.freeze({
    result: raw.result,
    ...(ERROR_CODES.includes(raw.code) ? { code: raw.code } : {}),
    ...(typeof raw.message === 'string' && raw.message.trim() ? { message: raw.message.trim().slice(0, 500) } : {}),
    ...(NEXT_ACTIONS.includes(raw.next) ? { next: raw.next } : {}),
    ...(retryAfterMs !== undefined && retryAfterMs > 0 ? { retryAfterMs } : {}),
  })
}

function readHelpStep(raw) {
  if (typeof raw === 'string') return raw.trim() ? Object.freeze({ text: raw.trim() }) : null
  if (!isRecord(raw) || typeof raw.text !== 'string' || !raw.text.trim()) return null
  return Object.freeze({
    text: raw.text.trim(),
    ...(typeof raw.blockId === 'string' && raw.blockId ? { blockId: raw.blockId } : {}),
    ...(DONE_WHEN.includes(raw.doneWhen) ? { doneWhen: raw.doneWhen } : {}),
  })
}

function readBlock(raw) {
  if (!isRecord(raw)) return null
  const id = typeof raw.id === 'string' && raw.id ? raw.id : undefined
  if (raw.kind === 'copy') {
    if (!id) return null
    const format = oneOf(raw.format, ['json', 'script', 'text'], 'text')
    return Object.freeze({
      kind: 'copy', id, label: text(raw.label, 120) || id, content: text(raw.content, 64_000), format,
      ...(raw.sensitive === true ? { sensitive: true } : {}),
      ...(raw.collapsed === true ? { collapsed: true } : {}),
      ...(typeof raw.collapsedLabel === 'string' && raw.collapsedLabel ? { collapsedLabel: raw.collapsedLabel.slice(0, 120) } : {}),
      // A bookmarklet is only ever built from a static script block.
      ...(raw.bookmarklet === true && format === 'script' ? { bookmarklet: true } : {}),
      ...(typeof raw.thenOpen === 'string' && raw.thenOpen ? { thenOpen: raw.thenOpen } : {}),
      ...(raw.redacted === true ? { redacted: true } : {}),
    })
  }
  if (raw.kind === 'link') {
    if (!isSafeHttpUrl(raw.url)) return null
    return Object.freeze({ kind: 'link', ...(id ? { id } : {}), label: text(raw.label, 120) || raw.url, url: raw.url.trim(), ...(raw.showQr === true ? { showQr: true } : {}) })
  }
  if (raw.kind === 'note') {
    if (typeof raw.text !== 'string' || !raw.text.trim()) return null
    return Object.freeze({ kind: 'note', ...(id ? { id } : {}), text: raw.text.trim().slice(0, 1000), tone: raw.tone === 'warning' ? 'warning' : 'info' })
  }
  return null
}

function readMedia(raw) {
  if (!isRecord(raw)) return undefined
  const expiresAt = finite(raw.expiresAt)
  const captcha = isRecord(raw.captcha) && raw.captcha.provider === 'tencent' && typeof raw.captcha.query === 'string' && raw.captcha.query
    ? Object.freeze({ provider: 'tencent', query: raw.captcha.query, ...(isValidCaptchaHelperUrl(raw.captcha.helperUrl) ? { helperUrl: raw.captcha.helperUrl } : {}) })
    : undefined
  const link = isRecord(raw.link) && isSafeHttpUrl(raw.link.url) ? Object.freeze({ url: raw.link.url.trim(), label: text(raw.link.label, 120) || raw.link.url }) : undefined
  return Object.freeze({
    ...(isSafeImageSource(raw.qrImage) ? { qrImage: raw.qrImage } : {}),
    ...(raw.qrImageOmitted === true ? { qrImageOmitted: true } : {}),
    ...(raw.linkOmitted === true ? { linkOmitted: true } : {}),
    ...(link ? { link } : {}),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    ...(raw.refreshable === true ? { refreshable: true } : {}),
    ...(captcha ? { captcha } : {}),
  })
}

function readInput(raw) {
  if (!isRecord(raw) || !INPUT_KINDS.includes(raw.kind) || raw.kind === 'none') return undefined
  const length = finite(raw.length)
  return Object.freeze({
    kind: raw.kind, label: text(raw.label, 80) || '输入',
    ...(typeof raw.pattern === 'string' && raw.pattern ? { pattern: raw.pattern } : {}),
    ...(typeof raw.patternHint === 'string' && raw.patternHint ? { patternHint: raw.patternHint.slice(0, 200) } : {}),
    ...(length !== undefined && length > 0 && Number.isInteger(length) ? { length } : {}),
    ...(raw.secret === true ? { secret: true } : {}),
    ...(raw.extract === 'ticket-json-or-url' ? { extract: 'ticket-json-or-url' } : {}),
  })
}

function readAction(raw) {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const cooldownMs = finite(raw.cooldownMs)
  return Object.freeze({
    id: raw.id.slice(0, 64), label: text(raw.label, 80) || raw.id, variant: oneOf(raw.variant, VARIANTS, 'secondary'),
    ...(raw.requiresInput === true ? { requiresInput: true } : {}),
    ...(cooldownMs !== undefined && cooldownMs > 0 ? { cooldownMs } : {}),
  })
}

/** Actions of a challenge; when the Host sent none: 提交 with an input, 已完成 without (ADR 0058 §2). */
export function challengeActions(challenge) {
  if (challenge?.actions?.length) return challenge.actions
  return challenge?.input
    ? [Object.freeze({ id: 'submit', label: '提交', variant: 'primary', requiresInput: true })]
    : [Object.freeze({ id: 'confirm', label: '已完成', variant: 'primary' })]
}

/** One challenge descriptor, sanitized; unknown kinds read as `other`. */
export function readChallenge(raw) {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return undefined
  const help = isRecord(raw.help) ? Object.freeze({
    short: text(raw.help.short, 500),
    steps: Object.freeze((Array.isArray(raw.help.steps) ? raw.help.steps : []).map(readHelpStep).filter(Boolean).slice(0, 12)),
    ...(typeof raw.help.warning === 'string' && raw.help.warning.trim() ? { warning: raw.help.warning.trim().slice(0, 500) } : {}),
  }) : undefined
  const expiresAt = finite(raw.expiresAt)
  const input = readInput(raw.input)
  const media = readMedia(raw.media)
  const challenge = {
    id: raw.id, kind: oneOf(raw.kind, CHALLENGE_KINDS, 'other'), title: text(raw.title, 200) || '安全验证',
    ...(help ? { help } : {}),
    blocks: Object.freeze((Array.isArray(raw.blocks) ? raw.blocks : []).map(readBlock).filter(Boolean)),
    ...(media ? { media } : {}),
    ...(input ? { input } : {}),
    actions: Object.freeze((Array.isArray(raw.actions) ? raw.actions : []).map(readAction).filter(Boolean)),
    ...(expiresAt !== undefined ? { expiresAt } : {}),
  }
  return Object.freeze({ ...challenge, actions: Object.freeze([...challengeActions(challenge)]) })
}

function readStep(raw) {
  if (!isRecord(raw) || typeof raw.id !== 'string' || !raw.id) return null
  const at = finite(raw.at) ?? 0
  const endedAt = finite(raw.endedAt)
  const challenge = readChallenge(raw.challenge)
  const outcome = readOutcome(raw.outcome)
  return Object.freeze({
    id: raw.id, kind: oneOf(raw.kind, STEP_KINDS, 'info'), status: oneOf(raw.status, STEP_STATUSES, 'done'),
    title: text(raw.title, 200) || (challenge?.title ?? ''),
    ...(typeof raw.titleKey === 'string' && raw.titleKey ? { titleKey: raw.titleKey } : {}),
    ...(typeof raw.detail === 'string' && raw.detail.trim() ? { detail: raw.detail.trim().slice(0, 500) } : {}),
    at,
    ...(endedAt !== undefined ? { endedAt } : {}),
    ...(challenge ? { challenge } : {}),
    ...(typeof raw.taskId === 'string' && raw.taskId ? { taskId: raw.taskId } : {}),
    ...(outcome ? { outcome } : {}),
  })
}

/** A `ConsoleLoginFlow` (event payload or `login.flow.*` row), sanitized; `null` when unusable. */
export function readLoginFlow(raw) {
  if (!isRecord(raw)) return null
  if (typeof raw.id !== 'string' || !raw.id || typeof raw.adapter !== 'string' || !raw.adapter || typeof raw.endpointKey !== 'string' || !raw.endpointKey) return null
  const revision = finite(raw.revision)
  if (revision === undefined) return null
  const lastOutcome = readOutcome(raw.lastOutcome)
  const identity = isRecord(raw.endpointIdentity) && typeof raw.endpointIdentity.canonicalId === 'string' && typeof raw.endpointIdentity.instanceId === 'string'
    && typeof raw.endpointIdentity.incarnationId === 'string' && Number.isSafeInteger(raw.endpointIdentity.epoch)
    ? Object.freeze({ canonicalId: raw.endpointIdentity.canonicalId, instanceId: raw.endpointIdentity.instanceId, epoch: raw.endpointIdentity.epoch, incarnationId: raw.endpointIdentity.incarnationId })
    : undefined
  return Object.freeze({
    id: raw.id, adapter: raw.adapter, endpointKey: raw.endpointKey,
    ...(identity ? { endpointIdentity: identity } : {}),
    startedAt: finite(raw.startedAt) ?? 0,
    updatedAt: finite(raw.updatedAt) ?? finite(raw.startedAt) ?? 0,
    revision,
    attempt: Math.max(1, Math.floor(finite(raw.attempt) ?? 1)),
    state: oneOf(raw.state, FLOW_STATES, 'active'),
    ...(typeof raw.currentStep === 'string' && raw.currentStep ? { currentStep: raw.currentStep } : {}),
    steps: Object.freeze((Array.isArray(raw.steps) ? raw.steps : []).map(readStep).filter(Boolean).slice(-20)),
    ...(lastOutcome ? { lastOutcome } : {}),
    ...(raw.pendingConfirmation === true ? { pendingConfirmation: true } : {}),
    ...(typeof raw.activeTaskId === 'string' && raw.activeTaskId ? { activeTaskId: raw.activeTaskId } : {}),
  })
}

/** `login.flow.list` reply → flows of one account (newest first), or every flow without a target. */
export function readLoginFlowList(reply, target) {
  const rows = isRecord(reply) && Array.isArray(reply.flows) ? reply.flows : null
  if (!rows) throw new Error('登录流程列表的格式不正确。')
  return rows.map(readLoginFlow).filter(flow => flow && (!target || (flow.adapter === target.adapter && flow.endpointKey === target.endpointKey)))
    .sort((a, b) => b.startedAt - a.startedAt || b.revision - a.revision)
}

/** `login.flow.get` reply → the flow or `null`. */
export function readLoginFlowGet(reply) {
  if (!isRecord(reply) || !('flow' in reply)) throw new Error('登录流程的格式不正确。')
  return reply.flow === null ? null : readLoginFlow(reply.flow)
}

/** Which of two snapshots to keep: same flow → the higher revision; another flow → the later start. */
export function newerFlow(current, incoming) {
  if (!incoming) return current ?? null
  if (!current) return incoming
  if (current.id === incoming.id) return incoming.revision >= current.revision ? incoming : current
  return incoming.startedAt >= current.startedAt ? incoming : current
}

/**
 * An event snapshot has no QR image, verification links or sensitive copy (ADR 0058 §3). Until the
 * live read lands, keep the material the page already shows for the same, still active step, so the
 * QR code does not flicker away; a step that ended never gets its material back.
 */
export function mergeRedactedFlow(previous, incoming) {
  if (!incoming) return previous ?? null
  if (!previous || previous.id !== incoming.id) return incoming
  const before = new Map(previous.steps.map(step => [step.id, step]))
  let changed = false
  const steps = incoming.steps.map(step => {
    const old = before.get(step.id)
    if (step.status !== 'active' || !step.challenge || !old?.challenge || old.challenge.id !== step.challenge.id) return step
    const media = step.challenge.media ?? {}
    const oldMedia = old.challenge.media ?? {}
    const restoredMedia = {
      ...media,
      ...(media.qrImageOmitted && oldMedia.qrImage ? { qrImage: oldMedia.qrImage } : {}),
      ...(media.linkOmitted && oldMedia.link ? { link: oldMedia.link } : {}),
      ...(media.linkOmitted && oldMedia.captcha ? { captcha: oldMedia.captcha } : {}),
    }
    const oldBlocks = new Map(old.challenge.blocks.filter(block => block.id).map(block => [block.id, block]))
    const blocks = step.challenge.blocks.map(block => {
      const prior = block.id ? oldBlocks.get(block.id) : undefined
      if (block.kind === 'copy' && block.redacted && prior?.kind === 'copy' && !prior.redacted) return prior
      return block
    })
    // Link blocks dropped from the event come back in their old place.
    const links = media.linkOmitted ? old.challenge.blocks.filter(block => block.kind === 'link' && !blocks.some(item => item.id && item.id === block.id)) : []
    changed = true
    return Object.freeze({
      ...step,
      challenge: Object.freeze({
        ...step.challenge,
        media: Object.freeze(restoredMedia),
        blocks: Object.freeze(links.length ? mergeBlockOrder(old.challenge.blocks, [...blocks, ...links]) : blocks),
      }),
    })
  })
  return changed ? Object.freeze({ ...incoming, steps: Object.freeze(steps) }) : incoming
}

function mergeBlockOrder(order, blocks) {
  const rank = new Map(order.map((block, index) => [block.id ?? `#${index}`, index]))
  return [...blocks].sort((a, b) => (rank.get(a.id) ?? 999) - (rank.get(b.id) ?? 999))
}

/** Whether a snapshot lacks live material (QR image, links, sensitive copy): read it with `login.flow.get`. */
export function flowNeedsLiveRead(flow) {
  const step = activeChallengeStep(flow)
  if (!step) return false
  const media = step.challenge.media ?? {}
  return Boolean((media.qrImageOmitted && !media.qrImage) || (media.linkOmitted && !media.link && !media.captcha && !step.challenge.blocks.some(block => block.kind === 'link'))
    || step.challenge.blocks.some(block => block.kind === 'copy' && block.redacted))
}

/** The step whose challenge is waiting for an answer (an active flow only). */
export function activeChallengeStep(flow) {
  if (!flow || flow.state !== 'active') return null
  const steps = flow.steps.filter(step => step.kind === 'challenge' && step.status === 'active' && step.challenge)
  return steps.length ? steps[steps.length - 1] : null
}

/** The active `verifying` step (a submission is being checked). */
export function activeVerifyingStep(flow) {
  if (!flow || flow.state !== 'active') return null
  return [...flow.steps].reverse().find(step => step.kind === 'verifying' && step.status === 'active') ?? null
}

/** Active `info` steps after the open challenge (e.g. 已扫码，请在手机上确认). */
export function activeInfoSteps(flow) {
  if (!flow || flow.state !== 'active') return []
  return flow.steps.filter(step => step.kind === 'info' && step.status === 'active')
}

// ---------------------------------------------------------------- copy tables

/** Badge of the flow state. */
export const FLOW_STATE_COPY = Object.freeze({
  active: Object.freeze({ label: '等待登录', tone: 'warning' }),
  online: Object.freeze({ label: '已上线', tone: 'success' }),
  failed: Object.freeze({ label: '登录失败', tone: 'destructive' }),
  cancelled: Object.freeze({ label: '已取消', tone: 'muted' }),
  expired: Object.freeze({ label: '验证已过期', tone: 'warning' }),
})

export function flowStateBadge(flow) {
  if (!flow) return null
  if (flow.state === 'active' && flow.pendingConfirmation) return Object.freeze({ label: '结果待确认', tone: 'info' })
  if (flow.state === 'active' && activeVerifyingStep(flow)) return Object.freeze({ label: '验证中', tone: 'info' })
  return FLOW_STATE_COPY[flow.state]
}

/** Standard error codes → title, next step and the default next action (ADR 0058 §5). */
export const LOGIN_ERROR_COPY = Object.freeze({
  code_invalid: Object.freeze({ title: '验证码或 ticket 不正确', description: '请检查后重新输入。验证码区分大小写时注意大小写。', next: 'retry_input' }),
  rate_limited: Object.freeze({ title: '操作太频繁', description: '平台暂时限制了这个账号的请求，请等待倒计时结束后再试。', next: 'wait' }),
  challenge_expired: Object.freeze({ title: '验证已过期', description: '这一步的二维码或链接已失效，刷新后会得到新的验证。', next: 'refresh_challenge' }),
  risk_blocked: Object.freeze({ title: '平台风控拒绝了这次登录', description: '通常需要先在常用设备上登录，或过一段时间再试。Zhin 无法绕过平台的风控。', next: 'none' }),
  credential_invalid: Object.freeze({ title: '密码或令牌无效', description: '请在适配器的连接管理里检查这个账号的凭据，然后重新登录。', next: 'relogin' }),
  network: Object.freeze({ title: '网络错误', description: '连接平台失败。请检查网络，稍后再试。', next: 'wait' }),
  unknown: Object.freeze({ title: '登录失败', description: '平台没有说明原因。可以重新登录再试一次，详情见日志。', next: 'relogin' }),
})

const RESULT_COPY = Object.freeze({
  accepted: Object.freeze({ title: '已通过', tone: 'success' }),
  online: Object.freeze({ title: '已上线', tone: 'success' }),
  rejected: Object.freeze({ title: '没有通过验证', tone: 'destructive' }),
  expired: Object.freeze({ title: '验证已过期', tone: 'warning' }),
  needs_new_challenge: Object.freeze({ title: '需要新的验证', tone: 'warning' }),
  failed: Object.freeze({ title: '登录失败', tone: 'destructive' }),
})

/** The button for an outcome's `next` (`none` and missing → no button). */
export const NEXT_ACTION_COPY = Object.freeze({
  retry_input: Object.freeze({ label: '重新输入', hint: '修改输入后再次提交' }),
  refresh_challenge: Object.freeze({ label: '刷新验证', hint: '向平台要一个新的二维码或验证链接' }),
  relogin: Object.freeze({ label: '重新登录', hint: '从头开始一次新的登录' }),
  wait: Object.freeze({ label: '稍后再试', hint: '倒计时结束后可以再试' }),
})

/**
 * How to show an outcome: `{ tone, title, description?, message?, next?, retryAfterMs?, code? }`.
 * A host message (sanitized single line) is shown as the reason; the standard code supplies the
 * title, the next step and the default next action.
 */
export function outcomeView(outcome) {
  if (!outcome) return null
  const base = RESULT_COPY[outcome.result] ?? RESULT_COPY.failed
  const failed = outcome.result !== 'accepted' && outcome.result !== 'online'
  const code = outcome.code ?? (outcome.result === 'expired' ? 'challenge_expired' : undefined)
  const copy = failed && code ? LOGIN_ERROR_COPY[code] : undefined
  const next = outcome.next ?? copy?.next ?? (outcome.result === 'expired' || outcome.result === 'needs_new_challenge' ? 'refresh_challenge' : outcome.result === 'rejected' ? 'retry_input' : outcome.result === 'failed' ? 'relogin' : undefined)
  return Object.freeze({
    tone: base.tone,
    title: copy?.title ?? base.title,
    ...(copy ? { description: copy.description } : {}),
    ...(outcome.message ? { message: outcome.message } : {}),
    ...(next && next !== 'none' ? { next } : {}),
    ...(outcome.retryAfterMs ? { retryAfterMs: outcome.retryAfterMs } : {}),
    ...(code ? { code } : {}),
  })
}

// ---------------------------------------------------------------- timeline

const STEP_KIND_COPY = Object.freeze({ connect: '连接平台', verifying: '验证中', info: '提示', challenge: '安全验证' })

/**
 * Timeline rows: `{ id, kind, status, title, at, endedAt?, detail?, outcome?, current, collapsed }`.
 * Done and replaced steps collapse to one line; the current step is the flow's `currentStep`, else
 * the last active one.
 */
export function flowTimeline(flow) {
  if (!flow) return Object.freeze({ steps: [], currentIndex: -1, total: 0 })
  const lastActive = [...flow.steps].reverse().find(step => step.status === 'active')
  const currentId = flow.state === 'active' ? (flow.steps.some(step => step.id === flow.currentStep && step.status === 'active') ? flow.currentStep : lastActive?.id) : undefined
  const steps = flow.steps.map(step => Object.freeze({
    id: step.id, kind: step.kind, status: step.status,
    title: step.title || STEP_KIND_COPY[step.kind],
    at: step.at,
    ...(step.endedAt ? { endedAt: step.endedAt } : {}),
    ...(step.detail ? { detail: step.detail } : {}),
    ...(step.outcome ? { outcome: outcomeView(step.outcome) } : {}),
    ...(step.challenge ? { challengeKind: step.challenge.kind } : {}),
    current: step.id === currentId,
    collapsed: step.status === 'done' || step.status === 'skipped',
  }))
  return Object.freeze({ steps: Object.freeze(steps), currentIndex: steps.findIndex(step => step.current), total: steps.length })
}

/** Overview badge text for an account row with `loginStep { index, total, title }` (ADR 0058 §7). */
export function loginStepBadge(endpoint) {
  const step = endpoint?.loginStep
  if (!isRecord(step)) return null
  const index = finite(step.index)
  const total = finite(step.total)
  if (!index || !total || index < 1 || total < 1 || index > total) return null
  return Object.freeze({ index: Math.floor(index), total: Math.floor(total), title: text(step.title, 120) })
}

// ---------------------------------------------------------------- guided steps

/**
 * The challenge's `help.steps` as a checklist. `progress` is `{ copied, opened, ticked }` (block ids
 * copied / opened, step numbers ticked by hand). A step with `blockId` + `doneWhen` ticks itself
 * when that block was copied or opened; every other step is ticked by hand. `current` is the first
 * open step (1-based), `null` when all are done.
 */
export function helpChecklist(challenge, progress = {}) {
  const copied = new Set(progress.copied ?? [])
  const opened = new Set(progress.opened ?? [])
  const ticked = new Set(progress.ticked ?? [])
  const items = (challenge?.help?.steps ?? []).map((step, index) => {
    const number = index + 1
    const auto = step.blockId && (step.doneWhen === 'copied' || step.doneWhen === 'opened')
    const done = ticked.has(number)
      || (auto && step.doneWhen === 'copied' && copied.has(step.blockId))
      || (auto && step.doneWhen === 'opened' && opened.has(step.blockId))
    return { number, text: step.text, ...(step.blockId ? { blockId: step.blockId } : {}), ...(step.doneWhen ? { doneWhen: step.doneWhen } : {}), done: Boolean(done), auto: Boolean(auto) }
  })
  const current = items.find(item => !item.done)?.number ?? null
  return Object.freeze({
    items: Object.freeze(items.map(item => Object.freeze({ ...item, current: item.number === current }))),
    current,
    total: items.length,
    doneCount: items.filter(item => item.done).length,
  })
}

/** Progress after copying / opening a block, or ticking a step (pure; returns a new object). */
export function recordProgress(progress = {}, event) {
  const next = { copied: [...(progress.copied ?? [])], opened: [...(progress.opened ?? [])], ticked: [...(progress.ticked ?? [])] }
  if (event.type === 'copied' && event.blockId && !next.copied.includes(event.blockId)) next.copied.push(event.blockId)
  if (event.type === 'opened' && event.blockId && !next.opened.includes(event.blockId)) next.opened.push(event.blockId)
  if (event.type === 'tick' && Number.isInteger(event.number)) {
    next.ticked = next.ticked.includes(event.number) ? next.ticked.filter(number => number !== event.number) : [...next.ticked, event.number]
  }
  return next
}

/**
 * Blocks in render order. A copy block with `thenOpen` naming a link block of the same challenge
 * gets `openLink` (one 「复制并打开验证页」 button); the link block keeps its own row (open, QR).
 */
export function challengeBlocks(challenge) {
  const blocks = challenge?.blocks ?? []
  const links = new Map(blocks.filter(block => block.kind === 'link' && block.id).map(block => [block.id, block]))
  return blocks.map(block => block.kind === 'copy' && block.thenOpen && links.has(block.thenOpen)
    ? Object.freeze({ ...block, openLink: links.get(block.thenOpen) })
    : block)
}

/**
 * `javascript:` URL of a static script block for 「拖到书签栏」. Only `format: 'script'` blocks with
 * `bookmarklet` qualify (the Adapter's static text, never user or device data — ADR 0058 §3);
 * redacted or empty scripts give `null`.
 */
export function bookmarkletHref(block) {
  if (!block || block.kind !== 'copy' || block.format !== 'script' || !block.bookmarklet || block.redacted) return null
  const script = block.content.trim()
  if (!script) return null
  return `javascript:${encodeURIComponent(script)}`
}

// ---------------------------------------------------------------- input and actions

/**
 * Live check of the challenge input: `{ state: 'empty' | 'partial' | 'ok' | 'invalid', message?,
 * ticket?, value }`. `value` is what gets submitted (`ticket,randstr` for ticket extraction).
 * `partial` = shorter than the required length so far (no error while typing).
 */
export function checkLoginInput(input, raw) {
  const value = typeof raw === 'string' ? raw.trim() : ''
  if (!input) return Object.freeze({ state: 'ok', value: '' })
  if (!value) return Object.freeze({ state: 'empty', value: '' })
  if (input.extract === 'ticket-json-or-url') {
    const parsed = parseLoginTicket(value)
    if (!parsed.ok) return Object.freeze({ state: 'invalid', message: parsed.error, value })
    return Object.freeze({
      state: 'ok',
      ticket: Object.freeze({ ticket: parsed.ticket, ...(parsed.randstr ? { randstr: parsed.randstr } : {}) }),
      source: value.startsWith('{') ? 'json' : /^https?:\/\//iu.test(value) ? 'url' : 'text',
      value: parsed.randstr ? `${parsed.ticket},${parsed.randstr}` : parsed.ticket,
    })
  }
  if (input.length && value.length < input.length && (!input.pattern || patternAccepts(input.pattern, value, true))) {
    return Object.freeze({ state: 'partial', remaining: input.length - value.length, value })
  }
  if (input.length && value.length !== input.length) {
    return Object.freeze(input.patternHint ? { state: 'invalid', message: input.patternHint, value } : { state: 'invalid', message: '长度应为 {0} 位', messageValues: [String(input.length)], value })
  }
  if (input.pattern && !patternAccepts(input.pattern, value)) return Object.freeze({ state: 'invalid', message: input.patternHint ?? '格式不正确', value })
  return Object.freeze({ state: 'ok', value })
}

/** Whether `value` matches the pattern (`prefix`: could still match once complete — digits only). */
function patternAccepts(pattern, value, prefix = false) {
  try {
    if (prefix) return /^\\d\{\d+\}$/u.test(pattern.replace(/^\^|\$$/gu, '')) ? /^\d*$/u.test(value) : true
    return new RegExp(pattern, 'u').test(value)
  } catch {
    return true
  }
}

/** Short preview of a ticket (start … end, length) — enough to recognise it, not to copy it. */
export function ticketPreview(ticket) {
  if (typeof ticket !== 'string' || !ticket) return ''
  return ticket.length <= 24 ? ticket : `${ticket.slice(0, 12)}…${ticket.slice(-6)}`
}

/**
 * The `login.submit` value for an action: `{ action, values }`; an action that takes input (or the
 * challenge's only input) carries `values.input`.
 */
export function submitValueFor(challenge, action, inputValue) {
  const takesInput = Boolean(challenge?.input) && (action.requiresInput || (typeof inputValue === 'string' && inputValue.trim() !== ''))
  return Object.freeze({ action: action.id, values: Object.freeze(takesInput && inputValue ? { input: inputValue.trim() } : {}) })
}

/** The `login.submit` value of a hosted captcha reply (`ticket,randstr`, ADR 0058 §3). */
export function captchaSubmitValue(reply) {
  return Object.freeze({ action: 'submit', values: Object.freeze({ ticket: reply.randstr ? `${reply.ticket},${reply.randstr}` : reply.ticket }) })
}

/**
 * Milliseconds until an action with `cooldownMs` may be used again: counted from the later of the
 * challenge opening (e.g. the SMS just sent) and the last time it was used here.
 */
export function cooldownRemaining(action, { openedAt, lastUsedAt, now = Date.now() } = {}) {
  if (!action?.cooldownMs) return 0
  const since = Math.max(finite(openedAt) ?? 0, finite(lastUsedAt) ?? 0)
  if (!since) return 0
  return Math.max(0, since + action.cooldownMs - now)
}

/** `{ secondsLeft, fraction, expired }` of a deadline (`fraction` of the time left, 1 → 0). */
export function deadlineProgress(expiresAt, { startedAt, now = Date.now() } = {}) {
  if (!finite(expiresAt)) return null
  const left = Math.max(0, expiresAt - now)
  const span = Math.max(1, expiresAt - (finite(startedAt) ?? now))
  return Object.freeze({ secondsLeft: Math.ceil(left / 1000), fraction: Math.max(0, Math.min(1, left / span)), expired: left <= 0 })
}

/** `m:ss` of a number of seconds. */
export function formatCountdown(seconds) {
  const value = Math.max(0, Math.ceil(seconds))
  return `${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}`
}

// ---------------------------------------------------------------- submit reply and checks

/**
 * `login.submit { wait: true }` reply → `{ kind: 'outcome', outcome, flow? } | { kind: 'pending', flow? }
 * | { kind: 'accepted' }` (an older Host answering `{ success: true }`).
 */
export function readSubmitReply(reply) {
  const flow = isRecord(reply) ? readLoginFlow(reply.flow) : null
  if (isRecord(reply) && reply.pending === true) return Object.freeze({ kind: 'pending', ...(flow ? { flow } : {}) })
  const outcome = isRecord(reply) ? readOutcome(reply.outcome) : undefined
  if (outcome) return Object.freeze({ kind: 'outcome', outcome, ...(flow ? { flow } : {}) })
  return Object.freeze({ kind: 'accepted', ...(flow ? { flow } : {}) })
}

/** Copy of the waiting result (the Host had no answer within 15 s; the page keeps listening). */
export const PENDING_RESULT_COPY = '结果待确认：平台还没有给出结果。页面会继续等待，结果出来后自动更新，不需要重复提交。'

/**
 * What the ActionReceipt should show for a submit reply: `{ status, message, detail? }` with
 * authored copy (`detail` may be the Host's sanitized reason); the card translates both and hands
 * the result to `readSubmitResult`. An accepted / online outcome is 已完成, any other outcome is 未执行
 * with its reason, `pending` is 结果未知 (only a read-only check settles it — the page runs it when
 * the flow changes).
 */
export function submitReceiptResult(read) {
  if (read.kind === 'outcome') {
    if (read.outcome.result === 'online') return Object.freeze({ status: 'saved', message: '验证通过，账号已上线。' })
    if (read.outcome.result === 'accepted') return Object.freeze({ status: 'saved', message: '验证通过，正在继续登录。' })
    const view = outcomeView(read.outcome)
    const detail = view.message ?? view.description
    return Object.freeze({ status: 'failed', message: view.title, ...(detail ? { detail, detailFromHost: Boolean(view.message) } : {}) })
  }
  // No outcome: core also wakes waiters without one when the flow ends (cancelled, superseded,
  // expired). The flow that came with the reply decides; only a flow-less legacy reply is 已提交.
  const flow = read.flow
  if (flow?.state === 'online') return Object.freeze({ status: 'saved', message: '验证通过，账号已上线。' })
  if (flow && (flow.state === 'failed' || flow.state === 'cancelled' || flow.state === 'expired')) {
    const view = outcomeView(flow.lastOutcome)
    const detail = view?.message ?? view?.description
    return Object.freeze({ status: 'failed', message: view?.title ?? FLOW_STATE_COPY[flow.state].label, ...(detail ? { detail, detailFromHost: Boolean(view?.message) } : {}) })
  }
  if (read.kind === 'pending' || flow) return Object.freeze({ status: 'unknown', message: PENDING_RESULT_COPY })
  return Object.freeze({ status: 'saved', message: '已提交。平台的结果会显示在时间线上。' })
}

/**
 * Read-only check of a submission whose result was unknown, by the challenge step that was answered
 * (`stepId`; core drops the step's `taskId` once it is answered, rejected or expired):
 * `{ applied: true }` once the flow is online or the answer was accepted (a verdict on the step or
 * the verifying step after it, or the flow moved on to a new challenge without a failure);
 * `{ applied: false }` once it was rejected, the step failed or was replaced, the step is gone, or
 * the flow failed / was cancelled / expired; `undefined` while still undecided. Never inferred from
 * the task merely disappearing.
 */
export function verifySubmission(flow, stepId) {
  if (!flow) return undefined
  if (flow.state === 'online') return Object.freeze({ applied: true, message: '账号已上线。' })
  const index = flow.steps.findIndex(step => step.id === stepId)
  const ended = flow.state === 'failed' || flow.state === 'cancelled' || flow.state === 'expired'
  if (index < 0) return Object.freeze({ applied: false, message: ended ? FLOW_STATE_COPY[flow.state].label : '这一步已结束，请按当前步骤继续。' })
  const step = flow.steps[index]
  const later = flow.steps.slice(index + 1)
  const verdict = [step.outcome, ...later.filter(item => item.kind === 'verifying').map(item => item.outcome)].find(Boolean)
  if (verdict?.result === 'accepted' || verdict?.result === 'online') return Object.freeze({ applied: true, message: '验证通过，正在继续登录。' })
  if (verdict) return Object.freeze({ applied: false, message: outcomeView(verdict).title })
  if (step.status === 'failed') return Object.freeze({ applied: false, message: '这次验证没有通过。' })
  if (step.status === 'skipped') return Object.freeze({ applied: false, message: '这一步已被新的验证替换。' })
  if (ended) return Object.freeze({ applied: false, message: FLOW_STATE_COPY[flow.state].label })
  if (step.status === 'active') return undefined
  // Answered (done) and the flow already asks for the next challenge: the answer was taken.
  if (later.some(item => item.kind === 'challenge')) return Object.freeze({ applied: true, message: '验证通过，正在继续登录。' })
  return undefined
}

/**
 * Server clock offset (ms, server − local) from a fresh server timestamp (an event or reply that
 * was just produced). Differences below 1.5 s are latency, not skew (0).
 */
export function serverClockOffset(previous, serverTimestamp, localNow = Date.now()) {
  if (typeof serverTimestamp !== 'number' || !Number.isFinite(serverTimestamp) || serverTimestamp <= 0) return previous ?? 0
  const delta = serverTimestamp - localNow
  return Math.abs(delta) < 1500 ? 0 : delta
}

/** Copy for a refused submission (`LoginSubmissionError` codes in `data.code`). */
export const SUBMIT_ERROR_COPY = Object.freeze({
  input_invalid: '输入的格式不正确',
  input_required: '请先填写输入框',
  invalid_action: '这个操作已失效，请等待页面刷新后再试',
  unsupported: '这个账号的适配器不支持这项操作',
})

/**
 * Whether a `login.flow.list` failure means the Host predates Login Assist v2: an unregistered RPC
 * is refused for everyone (403), an older instance answers `Unknown RPC type`, and a Host whose
 * LoginAssist cannot list flows answers `unsupported`.
 */
export function flowsUnsupported(status) {
  if (!status) return false
  if (status.kind === 'unsupported' || status.kind === 'forbidden') return true
  return status.serverCode === LOGIN_UNSUPPORTED_CODE || /^unsupported:/u.test(status.message ?? '')
}

/**
 * Which header actions the account offers: `relogin` when the Adapter declares it, `refresh` when it
 * declares `refreshQr` and the open challenge can be refreshed (or just expired), `cancel` while a
 * challenge is open. All need `endpoint.operate`.
 */
export function flowControls(flow, declaration, canOperate) {
  if (!canOperate) return Object.freeze({ relogin: false, refresh: false, cancel: false })
  const challenge = activeChallengeStep(flow)?.challenge
  const lastChallenge = flow ? [...flow.steps].reverse().find(step => step.challenge)?.challenge : undefined
  const refreshable = Boolean(challenge?.media?.refreshable) || (flow?.state === 'expired' && Boolean(lastChallenge?.media?.refreshable))
  return Object.freeze({
    relogin: declaration?.relogin === true,
    refresh: declaration?.refreshQr === true && refreshable,
    cancel: Boolean(flow && flow.state === 'active' && flow.activeTaskId && challenge),
  })
}

/** The Adapter's login declaration from an account row (`login`), sanitized. */
export function readLoginDeclaration(endpoint) {
  const raw = endpoint?.login
  if (!isRecord(raw) || !['interactive', 'credential', 'external'].includes(raw.mode)) return undefined
  return Object.freeze({
    mode: raw.mode,
    ...(Array.isArray(raw.challenges) ? { challenges: Object.freeze(raw.challenges.filter(kind => CHALLENGE_KINDS.includes(kind))) } : {}),
    ...(raw.relogin === true ? { relogin: true } : {}),
    ...(raw.refreshQr === true ? { refreshQr: true } : {}),
  })
}

/** Label of a challenge kind (icons and fallbacks). */
export const CHALLENGE_KIND_COPY = Object.freeze({
  qrcode: '扫码登录', link_verify: '链接验证', slider: '滑块验证', sms: '短信验证码', device: '设备锁验证', auth: '身份验证', confirm: '确认登录', other: '安全验证',
})
