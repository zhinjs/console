import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import {
  AlertTriangle, Bookmark, Check, CheckCircle2, ClipboardCopy, Copy, ExternalLink, Eye, EyeOff, Info, KeyRound, Loader2,
  QrCode, RefreshCw, ShieldCheck, Smartphone,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { copyText } from '../clipboard-copy.mjs'
import { encodeQr, qrSvgPath } from './qr-code.mjs'
import {
  DEFAULT_CAPTCHA_HELPER_URL, buildCaptchaHelperUrl, createCaptchaNonce, createCaptchaReplyGate, isValidCaptchaNonce, openCaptchaPopup, type CaptchaReply,
} from './login-assist-helpers.mjs'
import {
  bookmarkletHref, challengeBlocks, checkLoginInput, cooldownRemaining, deadlineProgress, formatCountdown, helpChecklist,
  ticketPreview, submitValueFor, captchaSubmitValue,
  type LoginChallenge, type LoginChallengeAction, type LoginCopyBlock, type LoginLinkBlock, type LoginProgress, type LoginRenderBlock,
  type LoginStep, type LoginSubmitValue, type OutcomeView,
} from './login-flow-model.mjs'

/** Re-renders every `intervalMs` while `active` (countdowns). */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), intervalMs)
    return () => window.clearInterval(timer)
  }, [active, intervalMs])
  return now
}

/** The step with its server timestamps (opened, deadlines) moved onto the local clock. */
function localizeStep<S extends LoginStep & { readonly challenge: LoginChallenge }>(step: S, offset: number): S {
  const challenge = step.challenge
  const media = challenge.media?.expiresAt ? { ...challenge.media, expiresAt: challenge.media.expiresAt - offset } : challenge.media
  return {
    ...step,
    at: step.at - offset,
    challenge: { ...challenge, ...(media ? { media } : {}), ...(challenge.expiresAt ? { expiresAt: challenge.expiresAt - offset } : {}) },
  }
}

export type ProgressEvent = { type: 'copied' | 'opened'; blockId: string } | { type: 'tick'; number: number }

export interface ChallengePanelProps {
  readonly step: LoginStep & { readonly challenge: LoginChallenge }
  readonly progress: LoginProgress
  readonly onProgress: (event: ProgressEvent) => void
  /**
   * Sends `login.submit` through the card's ActionReceipt; `summary` names what is sent (never the
   * value). `false`: not sent now (another write is open).
   */
  readonly onSubmit: (value: LoginSubmitValue, summary: string) => boolean
  /** Server − local clock (ms); the step's server timestamps are shifted onto this clock. */
  readonly clockOffset?: number
  /** A submission is in flight or its result is unknown. */
  readonly busy: boolean
  readonly canOperate: boolean
  /** Active `info` steps (e.g. 已扫码，请在手机上确认). */
  readonly infoSteps: readonly LoginStep[]
  /** `login.refresh` when the Adapter offers it (QR codes). */
  readonly onRefresh?: () => void
  readonly refreshing?: boolean
  /** Remaining wait after `rate_limited` (ms): submit buttons stay closed. */
  readonly waitUntil?: number
  readonly inputRef?: RefObject<HTMLInputElement | null>
  /** The previous answer was rejected (shown above the input). */
  readonly retryNotice?: OutcomeView | null
}

/**
 * The open challenge, rendered only from its descriptor (ADR 0058 §2–3): the guided steps as a
 * checklist that ticks itself, the warning, the materials (copy / link / note blocks), the QR code
 * with its deadline, the hosted captcha helper, the input with live checks and the actions.
 */
export function ChallengePanel(props: ChallengePanelProps) {
  const i18n = useI18n()
  const { progress, onProgress, onSubmit, busy, canOperate, infoSteps } = props
  const clockOffset = props.clockOffset ?? 0
  // Deadlines and the opening time come from the server: put them on this browser's clock.
  const step = useMemo(() => clockOffset ? localizeStep(props.step, clockOffset) : props.step, [props.step, clockOffset])
  const challenge = step.challenge
  const checklist = helpChecklist(challenge, progress)
  const blocks = challengeBlocks(challenge)
  const media = challenge.media ?? {}
  const checklistNode = checklist.total ? (
    <section className="console-login-checklist" aria-label={i18n.t('验证步骤')}>
      <p className="console-login-checklist-progress" aria-live="polite">
        {checklist.current ? i18n.t('第 {0} / {1} 步', [String(checklist.current), String(checklist.total)]) : i18n.t('步骤都已完成')}
      </p>
      <ol>
        {checklist.items.map(item => (
          <li key={item.number} className={cn(item.done && 'is-done', item.current && 'is-current')} aria-current={item.current ? 'step' : undefined}>
            {canOperate ? (
              <button type="button" role="checkbox" aria-checked={item.done} className="console-login-check"
                aria-label={item.done ? i18n.t('取消勾选第 {0} 步', [String(item.number)]) : i18n.t('勾选第 {0} 步为已完成', [String(item.number)])}
                onClick={() => onProgress({ type: 'tick', number: item.number })}>
                {item.done ? <Check aria-hidden="true" /> : <span aria-hidden="true">{item.number}</span>}
              </button>
            ) : (
              <span className="console-login-check" aria-hidden="true">{item.done ? <Check /> : item.number}</span>
            )}
            <span className="console-login-checklist-text">
              {i18n.t(item.text)}
              {item.auto && !item.done ? <span className="console-login-checklist-auto">{item.doneWhen === 'copied' ? i18n.t('复制后自动勾选') : i18n.t('打开后自动勾选')}</span> : null}
            </span>
          </li>
        ))}
      </ol>
    </section>
  ) : null
  const qrNode = canOperate && (media.qrImage || media.qrImageOmitted)
    ? <QrChallenge challenge={challenge} openedAt={step.at} scanned={infoSteps.length > 0} onRefresh={props.onRefresh} refreshing={props.refreshing} />
    : null
  const answerNode = canOperate ? <AnswerForm key={`answer:${step.id}`} step={step} busy={busy} onSubmit={onSubmit} waitUntil={props.waitUntil} inputRef={props.inputRef} /> : null
  return (
    <div className="console-login-challenge" data-challenge-kind={challenge.kind}>
      <div className="console-login-challenge-head">
        <h3 className="console-login-challenge-title">{i18n.t(challenge.title)}</h3>
        {challenge.help?.short ? <p className="console-login-challenge-short">{i18n.t(challenge.help.short)}</p> : null}
      </div>
      {infoSteps.map(info => (
        <p key={info.id} className="console-login-callout console-login-callout--success" role="status">
          <Smartphone aria-hidden="true" /><span>{i18n.t(info.title)}{info.detail ? <span className="console-login-callout-detail">{i18n.t(info.detail)}</span> : null}</span>
        </p>
      ))}
      {challenge.help?.warning ? (
        <p className="console-login-callout console-login-callout--warning" role="note"><AlertTriangle aria-hidden="true" /><span>{i18n.t(challenge.help.warning)}</span></p>
      ) : null}
      {props.retryNotice && canOperate ? (
        <div className="console-login-callout console-login-callout--danger" role="alert">
          <AlertTriangle aria-hidden="true" />
          <span>
            <span className="font-medium">{i18n.t('上次提交没有通过：{0}', [i18n.t(props.retryNotice.title)])}</span>
            {props.retryNotice.message ? <span className="console-login-callout-detail">{i18n.t(props.retryNotice.message)}</span> : props.retryNotice.description ? <span className="console-login-callout-detail">{i18n.t(props.retryNotice.description)}</span> : null}
          </span>
        </div>
      ) : null}
      {!canOperate ? (
        <p className="console-login-callout console-login-callout--muted" role="note"><Info aria-hidden="true" /><span>{i18n.t('你可以查看登录进度。完成验证需要 endpoint.operate 权限。')}</span></p>
      ) : null}
      {canOperate && media.captcha ? (
        <CaptchaHelper key={`captcha:${step.id}`} captcha={media.captcha} busy={busy} onReply={reply => onSubmit(captchaSubmitValue(reply), i18n.t('滑块验证结果（来自验证页）'))} />
      ) : null}
      {canOperate && media.captcha && (checklistNode || challenge.input) ? <p className="console-login-divider"><span>{i18n.t('也可以手动完成')}</span></p> : null}
      {qrNode ? (
        <div className="console-login-challenge-split">
          {qrNode}
          <div className="console-login-challenge-side">
            {checklistNode}
            {answerNode}
          </div>
        </div>
      ) : checklistNode}
      {canOperate && blocks.length ? (
        <div className="console-login-blocks">
          {blocks.map((block, index) => {
            // The guided step a block belongs to: numbered, and highlighted while it is the current step.
            const item = block.id ? checklist.items.find(entry => entry.blockId === block.id) : undefined
            return <ChallengeBlock key={block.id ?? `${block.kind}-${index}`} block={block} onProgress={onProgress} stepNumber={item?.number} current={Boolean(item?.current)} />
          })}
        </div>
      ) : null}
      {canOperate && media.link && !blocks.some(block => block.kind === 'link' && block.url === media.link!.url) ? (
        <ChallengeBlock block={{ kind: 'link', id: '__media-link', label: media.link.label, url: media.link.url }} onProgress={onProgress} />
      ) : null}
      {canOperate && media.linkOmitted && !media.link && !media.captcha && !blocks.some(block => block.kind === 'link') ? (
        <p className="console-login-callout console-login-callout--muted" role="status"><Loader2 className="animate-spin" aria-hidden="true" /><span>{i18n.t('正在读取验证链接…')}</span></p>
      ) : null}
      {qrNode ? null : answerNode}
    </div>
  )
}

/** Input (with live checks) and the challenge's actions; actions with `cooldownMs` count down. */
function AnswerForm({ step, busy, onSubmit, waitUntil, inputRef }: {
  step: LoginStep & { readonly challenge: LoginChallenge }
  busy: boolean
  onSubmit: (value: LoginSubmitValue, summary: string) => boolean
  waitUntil?: number
  inputRef?: RefObject<HTMLInputElement | null>
}) {
  const i18n = useI18n()
  const challenge = step.challenge
  const input = challenge.input
  const [raw, setRaw] = useState('')
  const [lastUsed, setLastUsed] = useState<Record<string, number>>({})
  const check = checkLoginInput(input, raw)
  const hasCooldown = challenge.actions.some(action => action.cooldownMs)
  const now = useNow(hasCooldown || Boolean(waitUntil && waitUntil > Date.now()))
  const waiting = waitUntil && waitUntil > now ? waitUntil - now : 0
  const fieldId = `login-input-${challenge.id}`
  const hintId = `${fieldId}-hint`
  const primaryInputAction = challenge.actions.find(action => action.requiresInput) ?? challenge.actions.find(action => action.variant === 'primary')
  const run = (action: LoginChallengeAction) => {
    if (busy || waiting) return
    if (action.requiresInput && check.state !== 'ok') return
    if (cooldownRemaining(action, { openedAt: step.at, lastUsedAt: lastUsed[action.id], now: Date.now() }) > 0) return
    setLastUsed(previous => ({ ...previous, [action.id]: Date.now() }))
    const value = submitValueFor(challenge, action, action.requiresInput || check.state === 'ok' ? check.value : undefined)
    const summary = value.values.input
      ? input?.extract ? i18n.t('{0}（已识别 ticket）', [i18n.t(action.label)]) : i18n.t('{0}（{1} 个字符）', [i18n.t(action.label), String(value.values.input.length)])
      : i18n.t(action.label)
    onSubmit(value, summary)
  }
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter' && !event.nativeEvent.isComposing && primaryInputAction) { event.preventDefault(); run(primaryInputAction) }
  }
  const digitsOnly = Boolean(input?.pattern && /^\^?\\d\{\d+\}\$?$/u.test(input.pattern))
  return (
    <div className="console-login-answer">
      {input ? (
        <div className="console-login-field">
          <label htmlFor={fieldId} className="console-login-field-label">{i18n.t(input.label)}</label>
          <Input id={fieldId} ref={inputRef} value={raw} disabled={busy}
            type={input.secret ? 'password' : 'text'}
            inputMode={digitsOnly ? 'numeric' : undefined}
            autoComplete={input.kind === 'code' ? 'one-time-code' : 'off'}
            spellCheck={false}
            maxLength={input.extract ? undefined : input.length && digitsOnly ? input.length : undefined}
            className={cn('console-login-input', input.kind === 'code' && 'console-login-input--code', check.state === 'invalid' && 'is-invalid')}
            aria-invalid={check.state === 'invalid'}
            aria-describedby={hintId}
            placeholder={input.extract ? i18n.t('粘贴 ticket、验证返回的 JSON 或带 ticket 的链接') : input.patternHint ? i18n.t(input.patternHint) : ''}
            onChange={event => setRaw(event.target.value)} onKeyDown={onKeyDown} />
          <p id={hintId} className={cn('console-login-field-hint', check.state === 'invalid' && 'is-error', check.state === 'ok' && check.ticket && 'is-ok')} aria-live="polite">
            {check.state === 'invalid' ? i18n.t(check.message ?? '格式不正确', check.messageValues ? [...check.messageValues] : undefined)
              : check.state === 'partial' ? i18n.t('还差 {0} 位', [String(check.remaining)])
                : check.state === 'ok' && check.ticket ? (
                  <><KeyRound aria-hidden="true" />{i18n.t('已识别 ticket：{0}', [ticketPreview(check.ticket.ticket)])}
                    {check.ticket.randstr ? <span className="console-login-field-tag">{i18n.t('含 randstr')}</span> : null}
                    {check.source === 'json' ? <span className="console-login-field-tag">{i18n.t('来自 JSON')}</span> : check.source === 'url' ? <span className="console-login-field-tag">{i18n.t('来自链接')}</span> : null}</>
                ) : input.extract ? i18n.t('整段粘贴即可，会自动找出 ticket。') : input.patternHint ? i18n.t(input.patternHint) : ' '}
          </p>
        </div>
      ) : null}
      {waiting ? <p className="console-login-callout console-login-callout--warning" role="status"><AlertTriangle aria-hidden="true" /><span>{i18n.t('操作太频繁，{0} 后可以再试。', [formatCountdown(waiting / 1000)])}</span></p> : null}
      <div className="console-login-actions">
        {challenge.actions.map(action => {
          const cooldown = cooldownRemaining(action, { openedAt: step.at, lastUsedAt: lastUsed[action.id], now })
          const blocked = busy || Boolean(waiting) || cooldown > 0 || (action.requiresInput && check.state !== 'ok')
          return (
            <Button key={action.id} size="sm" disabled={blocked}
              variant={action.variant === 'primary' ? 'default' : action.variant === 'danger' ? 'destructive' : 'outline'}
              className="console-login-action" onClick={() => run(action)} data-action-id={action.id}>
              {cooldown > 0 ? i18n.t('{0}（{1} 秒后可用）', [i18n.t(action.label), String(Math.ceil(cooldown / 1000))]) : i18n.t(action.label)}
            </Button>
          )
        })}
      </div>
    </div>
  )
}

/** Large QR code with a ring counting down to `expiresAt`; expired → refresh (once automatically). */
function QrChallenge({ challenge, openedAt, scanned, onRefresh, refreshing }: {
  challenge: LoginChallenge; openedAt: number; scanned: boolean; onRefresh?: () => void; refreshing?: boolean
}) {
  const i18n = useI18n()
  const media = challenge.media ?? {}
  const expiresAt = media.expiresAt ?? challenge.expiresAt
  const now = useNow(Boolean(expiresAt))
  const deadline = deadlineProgress(expiresAt, { startedAt: openedAt, now })
  const expired = Boolean(deadline?.expired)
  const canRefresh = Boolean(media.refreshable && onRefresh)
  // An expired code is refreshed once by itself; after that the button is there.
  const autoRefreshed = useRef<string | null>(null)
  useEffect(() => {
    if (!expired || !canRefresh || refreshing || autoRefreshed.current === challenge.id) return
    if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return
    autoRefreshed.current = challenge.id
    onRefresh?.()
  }, [expired, canRefresh, refreshing, challenge.id, onRefresh])
  const radius = 15.5
  const circumference = 2 * Math.PI * radius
  return (
    <div className="console-login-qrcode">
      <div className={cn('console-login-qr-frame', (expired || scanned) && 'is-dimmed')}>
        {media.qrImage ? <img src={media.qrImage} alt={i18n.t('登录二维码：{0}', [i18n.t(challenge.title)])} className="console-login-qr-image" />
          : <div className="console-login-qr-placeholder" role="status"><Loader2 className="animate-spin" aria-hidden="true" /><span>{i18n.t('正在读取二维码…')}</span></div>}
        {scanned && !expired ? (
          <div className="console-login-qr-overlay is-scanned" role="status"><CheckCircle2 aria-hidden="true" /><span>{i18n.t('已扫码，请在手机上确认')}</span></div>
        ) : null}
        {expired ? (
          <div className="console-login-qr-overlay" role="status">
            <QrCode aria-hidden="true" /><span>{refreshing ? i18n.t('正在获取新的二维码…') : i18n.t('二维码已过期')}</span>
            {canRefresh ? <Button size="sm" onClick={onRefresh} disabled={refreshing}><RefreshCw className={refreshing ? 'animate-spin' : ''} />{i18n.t('刷新二维码')}</Button> : null}
          </div>
        ) : null}
      </div>
      {deadline && !expired ? (
        <div className="console-login-qr-meta">
          <svg className="console-login-ring" viewBox="0 0 36 36" aria-hidden="true">
            <circle className="console-login-ring-track" cx="18" cy="18" r={radius} />
            <circle className={cn('console-login-ring-value', deadline.fraction < 0.2 && 'is-low')} cx="18" cy="18" r={radius}
              strokeDasharray={circumference} strokeDashoffset={circumference * (1 - deadline.fraction)} />
          </svg>
          <span className="console-login-qr-countdown" aria-live="off">{i18n.t('{0} 后过期', [formatCountdown(deadline.secondsLeft)])}</span>
          {canRefresh ? <Button size="sm" variant="ghost" onClick={onRefresh} disabled={refreshing}><RefreshCw className={refreshing ? 'animate-spin' : ''} />{i18n.t('换一张')}</Button> : null}
        </div>
      ) : null}
    </div>
  )
}

type CaptchaState = 'idle' | 'waiting' | 'blocked' | 'received' | 'queued' | 'settled' | 'closed' | 'error'

/**
 * 「开始验证」: opens the hosted helper page (its own origin) in a popup with a fresh nonce and this
 * Console's origin in the fragment, accepts one reply from the helper origin with that nonce and
 * submits `ticket,randstr`. While the window is open the button switches to it instead of opening
 * another one (each attempt has its own window name, so nothing replaces a window in use). A reply
 * that arrives while another write is open waits and is sent once the card is free. A blocked popup
 * gets a link; pasting by hand always stays possible.
 */
export function CaptchaHelper({ captcha, busy, onReply }: {
  captcha: { readonly query: string; readonly helperUrl?: string }
  busy: boolean
  /** `false`: not sent now (another write is open); the helper keeps the reply and retries. */
  onReply: (reply: CaptchaReply) => boolean
}) {
  const i18n = useI18n()
  const [state, setState] = useState<CaptchaState>('idle')
  const [fallbackUrl, setFallbackUrl] = useState<string | null>(null)
  const cleanup = useRef<(() => void) | null>(null)
  const popupRef = useRef<Window | null>(null)
  const queued = useRef<CaptchaReply | null>(null)
  const latestReply = useRef(onReply)
  latestReply.current = onReply
  useEffect(() => () => cleanup.current?.(), [])
  // A queued reply goes out as soon as the card is free again.
  useEffect(() => {
    if (busy || state !== 'queued' || !queued.current) return
    if (latestReply.current(queued.current)) { queued.current = null; setState('received') }
  }, [busy, state])
  // The write that carried the reply finished and this step is still on screen (an accepted answer
  // moves to a new step and unmounts the helper): it was refused or not taken — allow another try.
  const sawBusy = useRef(false)
  useEffect(() => {
    if (state !== 'received') { sawBusy.current = false; return }
    if (busy) { sawBusy.current = true; return }
    if (sawBusy.current) { sawBusy.current = false; setState('settled') }
  }, [busy, state])
  const helperUrl = captcha.helperUrl ?? DEFAULT_CAPTCHA_HELPER_URL
  const helperHost = useMemo(() => { try { return new URL(helperUrl).host } catch { return helperUrl } }, [helperUrl])
  const deliver = (reply: CaptchaReply) => {
    if (latestReply.current(reply)) { setState('received'); return }
    queued.current = reply
    setState('queued')
  }
  const windowOpen = state === 'waiting' && Boolean(popupRef.current && !popupRef.current.closed)
  const start = () => {
    if (windowOpen) {
      try { popupRef.current?.focus() } catch { /* the browser may refuse; the window stays */ }
      return
    }
    cleanup.current?.()
    let url: string
    let gate: ReturnType<typeof createCaptchaReplyGate>
    let nonce: string
    try {
      nonce = createCaptchaNonce()
      if (!isValidCaptchaNonce(nonce)) throw new RangeError('invalid nonce')
      url = buildCaptchaHelperUrl({ helperUrl, query: captcha.query, nonce, origin: window.location.origin })
      gate = createCaptchaReplyGate({ helperUrl, nonce })
    } catch {
      setState('error')
      return
    }
    // The helper answers through `window.opener` (no `noopener`), and must not learn the Console's
    // address (no referrer): openCaptchaPopup does both. A per-attempt name never reuses a window;
    // it is its own random value (window.name is readable by any page later loaded there).
    const popup = openCaptchaPopup(window, url, { name: `zhin-login-captcha-${createCaptchaNonce().slice(0, 12)}` })
    popupRef.current = popup
    const onMessage = (event: MessageEvent) => {
      const reply = gate.accept({ origin: event.origin, data: event.data })
      if (!reply) return
      stop()
      try { popup?.close() } catch { /* cross-origin close may be refused */ }
      popupRef.current = null
      deliver(reply)
    }
    const watch = popup ? window.setInterval(() => { if (popup.closed && !gate.used) { setState('closed'); popupRef.current = null; stop() } }, 800) : undefined
    const stop = () => {
      window.removeEventListener('message', onMessage)
      if (watch !== undefined) window.clearInterval(watch)
      cleanup.current = null
    }
    window.addEventListener('message', onMessage)
    cleanup.current = stop
    setFallbackUrl(url)
    setState(popup ? 'waiting' : 'blocked')
  }
  return (
    <div className="console-login-captcha">
      <div className="console-login-captcha-main">
        <ShieldCheck aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium">{i18n.t('在验证页完成滑块')}</p>
          <p className="console-login-muted">{i18n.t('打开 {0} 上的验证页，拖动滑块后结果会自动交回这里并提交，不需要开发者工具。', [helperHost])}</p>
        </div>
      </div>
      <div className="console-login-actions">
        <Button size="sm" onClick={start} disabled={busy || state === 'received' || state === 'queued'} data-captcha-start>
          {windowOpen ? <Loader2 className="animate-spin" /> : <ExternalLink />}
          {windowOpen ? i18n.t('验证窗口已打开 · 切换到窗口') : state === 'idle' ? i18n.t('开始验证') : i18n.t('重新打开验证页')}
        </Button>
      </div>
      <p className="console-login-captcha-status" role="status" aria-live="polite">
        {state === 'waiting' ? i18n.t('已打开验证窗口。完成滑块后这里会自动提交。')
          : state === 'received' ? i18n.t('已收到验证结果，正在提交。')
            : state === 'queued' ? i18n.t('已收到验证结果，等当前操作结束后自动提交。')
              : state === 'settled' ? i18n.t('这次验证结果没有被采用，请看上方的提交结果，需要时重新验证。')
              : state === 'closed' ? i18n.t('验证窗口已关闭，没有收到结果。可以重新打开，或在下方手动粘贴。')
                : state === 'error' ? i18n.t('无法打开验证页：Console 的地址或验证页地址不正确。请在下方手动粘贴 ticket。')
                  : null}
        {state === 'blocked' && fallbackUrl ? (
          <>{i18n.t('浏览器拦截了弹出窗口。')}{' '}
            {/* rel="opener": the helper answers through window.opener; referrerPolicy keeps the Console's address out. */}
            <a href={fallbackUrl} target="_blank" rel="opener" referrerPolicy="no-referrer" className="console-login-anchor">{i18n.t('点这里打开验证页')}</a></>
        ) : null}
      </p>
    </div>
  )
}

/** One material block: copy (monospace, hidden while sensitive, bookmarklet), link (open, QR) or note. */
function ChallengeBlock({ block, onProgress, stepNumber, current }: { block: LoginRenderBlock; onProgress: (event: ProgressEvent) => void; stepNumber?: number; current?: boolean }) {
  const i18n = useI18n()
  if (block.kind === 'note') {
    return <p className={cn('console-login-callout', block.tone === 'warning' ? 'console-login-callout--warning' : 'console-login-callout--info')}><Info aria-hidden="true" /><NoteText text={block.text} /></p>
  }
  const tag = stepNumber ? <span className="console-login-step-tag">{i18n.t('第 {0} 步', [String(stepNumber)])}</span> : null
  return (
    <div className={cn('console-login-block-frame', current && 'is-current')} data-step={stepNumber}>
      {block.kind === 'link' ? <LinkBlock block={block} onProgress={onProgress} tag={tag} /> : <CopyBlock block={block} onProgress={onProgress} tag={tag} />}
    </div>
  )
}

function NoteText({ text }: { text: string }) {
  const i18n = useI18n()
  return <span>{i18n.t(text)}</span>
}

function useCopied(): [boolean, () => void] {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return [copied, () => {
    setCopied(true)
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setCopied(false), 2000)
  }]
}

function CopyBlock({ block, onProgress, tag }: { block: LoginCopyBlock & { readonly openLink?: LoginLinkBlock }; onProgress: (event: ProgressEvent) => void; tag?: ReactNode }) {
  const i18n = useI18n()
  const [revealed, setRevealed] = useState(false)
  const [expanded, setExpanded] = useState(!block.collapsed)
  const [copied, markCopied] = useCopied()
  const [failed, setFailed] = useState(false)
  const bookmarklet = bookmarkletHref(block)
  const hidden = Boolean(block.sensitive) && !revealed
  const copy = async () => {
    const ok = await copyText(block.content, navigator.clipboard, document)
    setFailed(!ok)
    if (!ok) return false
    markCopied()
    onProgress({ type: 'copied', blockId: block.id })
    return true
  }
  const copyAndOpen = () => {
    const link = block.openLink
    if (!link) return
    // Open inside the click (popup blockers), copy alongside.
    window.open(link.url, '_blank', 'noopener,noreferrer')
    if (link.id) onProgress({ type: 'opened', blockId: link.id })
    void copy()
  }
  if (block.redacted || !block.content) {
    return (
      <div className="console-login-block console-login-copy">
        <p className="console-login-block-label">{tag}{i18n.t(block.label)}</p>
        <p className="console-login-muted">{i18n.t('内容已清除：这一步已结束，或需要重新读取。')}</p>
      </div>
    )
  }
  const content = (
    <div className="console-login-copy-box">
      <pre className={cn('console-login-code', hidden && 'is-hidden')} aria-label={i18n.t(block.label)} tabIndex={0}>
        {hidden ? i18n.t('已隐藏敏感内容（{0} 个字符）。点「显示」查看。', [String(block.content.length)]) : block.content}
      </pre>
    </div>
  )
  return (
    <div className={cn('console-login-block console-login-copy', block.sensitive && 'is-sensitive')} data-block-id={block.id}>
      <div className="console-login-block-head">
        <p className="console-login-block-label">
          {tag}
          {block.format === 'script' ? <Bookmark aria-hidden="true" /> : <ClipboardCopy aria-hidden="true" />}
          {i18n.t(block.label)}
          {block.sensitive ? <span className="console-login-field-tag is-warning">{i18n.t('敏感')}</span> : null}
        </p>
        <div className="console-login-block-tools">
          {block.sensitive ? (
            <Button size="sm" variant="ghost" onClick={() => setRevealed(value => !value)} aria-pressed={revealed}>
              {revealed ? <EyeOff /> : <Eye />}{revealed ? i18n.t('隐藏') : i18n.t('显示')}
            </Button>
          ) : null}
          {block.collapsed ? (
            <Button size="sm" variant="ghost" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
              {expanded ? i18n.t('收起') : i18n.t(block.collapsedLabel ?? '展开')}
            </Button>
          ) : null}
        </div>
      </div>
      {expanded ? content : null}
      <div className="console-login-actions">
        {block.openLink ? (
          <Button size="sm" onClick={copyAndOpen} data-copy-open>
            <ExternalLink />{i18n.t('复制并打开验证页')}
          </Button>
        ) : null}
        <Button size="sm" variant={block.openLink ? 'outline' : 'default'} onClick={() => void copy()} data-copy>
          {copied ? <Check /> : <Copy />}{copied ? i18n.t('已复制') : block.openLink ? i18n.t('仅复制') : i18n.t('复制')}
        </Button>
        {bookmarklet ? <BookmarkletLink href={bookmarklet} /> : null}
      </div>
      {failed ? <p className="console-login-field-hint is-error" role="alert">{i18n.t('浏览器没有允许复制。请展开内容后手动选中复制。')}</p> : null}
      {bookmarklet ? (
        <details className="console-login-devtools">
          <summary>{i18n.t('不能用书签？改用开发者工具')}</summary>
          <ol>
            <li>{i18n.t('点上面的「复制」复制脚本。')}</li>
            <li>{i18n.t('在验证页按 F12（Mac 上按 ⌥⌘I）打开开发者工具，切到 Console（控制台）。')}</li>
            <li>{i18n.t('粘贴脚本后按回车，按提示粘贴设备 JSON。浏览器提示「禁止粘贴」时，先输入 allow pasting 回车。')}</li>
          </ol>
        </details>
      ) : null}
    </div>
  )
}

/**
 * 「拖到书签栏」: a `javascript:` link built from the Adapter's static script (never user or device
 * data). React refuses `javascript:` hrefs, so the attribute is set on the element; clicking it here
 * does nothing (it is meant for the verification page).
 */
function BookmarkletLink({ href }: { href: string }) {
  const i18n = useI18n()
  return (
    <a className="console-login-bookmarklet" data-bookmarklet={href} draggable
      ref={node => { if (node && node.getAttribute('href') !== href) node.setAttribute('href', href) }}
      onClick={event => event.preventDefault()}
      title={i18n.t('把这个按钮拖到浏览器书签栏；到验证页后点一下书签即可运行。')}>
      <Bookmark aria-hidden="true" />{i18n.t('拖到书签栏')}
    </a>
  )
}

function LinkBlock({ block, onProgress, tag }: { block: LoginLinkBlock; onProgress: (event: ProgressEvent) => void; tag?: ReactNode }) {
  const i18n = useI18n()
  const [copied, markCopied] = useCopied()
  const host = useMemo(() => { try { return new URL(block.url).host } catch { return '' } }, [block.url])
  const opened = () => { if (block.id) onProgress({ type: 'opened', blockId: block.id }) }
  return (
    <div className={cn('console-login-block console-login-link-block', block.showQr && 'has-qr')} data-block-id={block.id}>
      <div className="console-login-link-main">
        <p className="console-login-block-label">{tag}<ExternalLink aria-hidden="true" />{i18n.t(block.label)}</p>
        {host ? <p className="console-login-muted"><code title={block.url}>{host}</code></p> : null}
        <div className="console-login-actions">
          <Button asChild size="sm" variant="outline"><a href={block.url} target="_blank" rel="noopener noreferrer" onClick={opened} onAuxClick={opened}><ExternalLink />{i18n.t('打开')}</a></Button>
          <Button size="sm" variant="ghost" onClick={() => { void copyText(block.url, navigator.clipboard, document).then(ok => { if (ok) markCopied() }) }}>
            {copied ? <Check /> : <Copy />}{copied ? i18n.t('已复制') : i18n.t('复制链接')}
          </Button>
        </div>
      </div>
      {block.showQr ? <LinkQr url={block.url} /> : null}
    </div>
  )
}

/** The link drawn as a QR code in the browser, for the phone that has to verify. */
function LinkQr({ url }: { url: string }) {
  const i18n = useI18n()
  const qr = useMemo(() => { try { return encodeQr(url, { ecl: 'M' }) } catch { return null } }, [url])
  if (!qr) return null
  const view = qr.size + 8
  return (
    <figure className="console-login-link-qr">
      <svg viewBox={`0 0 ${view} ${view}`} role="img" aria-label={i18n.t('验证链接二维码')} shapeRendering="crispEdges">
        <rect width={view} height={view} className="console-login-qr-light" />
        <path d={qrSvgPath(qr, 4)} className="console-login-qr-dark" />
      </svg>
      <figcaption>{i18n.t('用需要验证的手机扫码打开')}</figcaption>
    </figure>
  )
}
