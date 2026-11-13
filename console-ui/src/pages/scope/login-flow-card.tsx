import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle, CheckCircle2, Circle, CircleDot, FileText, Info, KeyRound, Link2, Loader2, LogIn, MessageSquareText, QrCode, RefreshCw,
  RotateCcw, ShieldCheck, Smartphone, X, XCircle, type LucideIcon,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { StatusState } from '../../components/StatusState'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { receiptBlocksActions } from '../../components/action-receipt-model.mjs'
import { useLogPanel } from '../../components/log-panel/LogPanel'
import { requestConsole } from '../../utils/console-rpc'
import { LoginTaskCard, type LoginTask, type ScopeEndpoint } from './login-tasks'
import { ChallengePanel, useNow, type ProgressEvent } from './login-challenge'
import { useLoginFlow } from './use-login-flow'
import {
  CHALLENGE_KIND_COPY, LOGIN_RPC, LOGIN_SUBMIT_TIMEOUT_MS, NEXT_ACTION_COPY, PENDING_RESULT_COPY, SUBMIT_ERROR_COPY,
  activeChallengeStep, activeInfoSteps, activeVerifyingStep, flowControls, flowStateBadge, flowTimeline, formatCountdown, outcomeView,
  readLoginDeclaration, readLoginFlowGet, readSubmitReply, recordProgress, submitReceiptResult, verifySubmission,
  type LoginChallengeKind, type LoginFlow, type LoginProgress, type LoginSubmitValue, type OutcomeView, type TimelineStep, type Tone,
} from './login-flow-model.mjs'
import './login-flow.css'

const KIND_ICONS: Record<LoginChallengeKind, LucideIcon> = {
  qrcode: QrCode, link_verify: Link2, slider: ShieldCheck, sms: MessageSquareText, device: Smartphone, auth: KeyRound, confirm: CheckCircle2, other: ShieldCheck,
}
const BADGE_VARIANT: Record<Tone, 'warning' | 'success' | 'destructive' | 'secondary' | 'info'> = {
  warning: 'warning', success: 'success', destructive: 'destructive', muted: 'secondary', info: 'info',
}

/** What `login.submit` sends; rides on the receipt plan so a remounted tab still knows what it checks. */
interface SubmitPayload {
  readonly taskId: string
  /** The challenge step answered: core drops the step's taskId once answered, so checks go by step. */
  readonly stepId: string
  readonly value: LoginSubmitValue
  readonly adapter: string
  readonly endpointKey: string
  readonly endpointIdentity?: LoginFlow['endpointIdentity']
}
type ControlKind = 'cancel' | 'relogin' | 'refresh'
interface ControlPayload { readonly kind: ControlKind; readonly adapter: string; readonly endpointKey: string; readonly taskId?: string; readonly flowId?: string; readonly attempt?: number; readonly stepId?: string }

/** `data.code` of a refused login RPC (LoginSubmissionError / unsupported), read by rpc-reply-capture. */
function refusalCode(error: unknown): string | undefined {
  const details = (error as { details?: { dataCode?: unknown } } | null)?.details
  if (typeof details?.dataCode === 'string') return details.dataCode
  const message = error instanceof Error ? error.message : ''
  return /^unsupported:/u.test(message) ? 'unsupported' : undefined
}

/**
 * 登录 section of the account's 接入 tab (ADR 0058). Reads the account's login flow; a Host that does
 * not know `login.flow.list` gets 需要新版 Host plus the legacy task cards.
 */
export function LoginFlowSection({ endpoint, legacyTasks, canOperate, onSettled }: {
  endpoint: ScopeEndpoint
  legacyTasks: readonly LoginTask[]
  canOperate: boolean
  onSettled: () => void
}) {
  const i18n = useI18n()
  const target = { adapter: endpoint.adapter, endpointKey: endpoint.name }
  const flow = useLoginFlow(target)
  const declaration = readLoginDeclaration(endpoint)
  const { state } = flow
  if (state.status === 'loading') {
    return <StatusState kind="loading" placeholder={<div className="console-login-flow-skeleton"><Skeleton className="h-12" /><Skeleton className="h-56" /></div>} />
  }
  if (state.status === 'legacy') {
    return (
      <div className="space-y-3">
        <StatusState compact kind="unsupported" title={i18n.t('需要新版 Host 才能显示登录进度')}
          description={i18n.t('当前 Host 还不支持登录流程。下面是旧版的登录验证卡片；升级 Host 后这里会显示分步时间线、重新登录和自动核对的结果。')} />
        {legacyTasks.length ? (
          <div className="console-scope-login-grid">
            {legacyTasks.map(task => <LoginTaskCard key={task.id} task={task} readOnly={!canOperate} onSettled={onSettled} />)}
          </div>
        ) : (
          <StatusState kind="empty" compact title={endpoint.connected ? i18n.t('不需要登录') : i18n.t('没有待完成的登录验证')}
            description={endpoint.connected ? i18n.t('账号已连接。需要重新登录时，验证会出现在这里。') : i18n.t('账号未连接，但平台没有发来登录验证。可以先测试连接，或在适配器的连接管理里重新启动账号。')} />
        )}
      </div>
    )
  }
  if (state.status === 'error') return <StatusState error={state.error} onRetry={flow.refresh} />
  return (
    <LoginFlowCard flow={state.flow} endpoint={endpoint} declaration={declaration} canOperate={canOperate}
      readError={state.error} refreshing={state.refreshing} onReload={flow.refresh} onApply={flow.apply} onSettled={onSettled} clockOffset={state.clockOffset} />
  )
}

export interface LoginFlowCardProps {
  readonly flow: LoginFlow | null
  readonly endpoint: ScopeEndpoint
  readonly declaration: ReturnType<typeof readLoginDeclaration>
  readonly canOperate: boolean
  readonly readError?: unknown
  readonly refreshing?: boolean
  readonly onReload: () => void
  readonly onApply: (flow: LoginFlow | null | undefined, fresh?: boolean) => void
  /** Server − local clock (ms): server timestamps (deadlines, waits) are shifted onto this clock. */
  readonly clockOffset?: number
  readonly onSettled?: () => void
}

/**
 * One account's login: header (state, attempt, 重新登录 / 刷新二维码 / 取消), the step timeline and the
 * open challenge. Answers go through an ActionReceipt with `wait: true`: 提交中 → 验证中 → the
 * outcome; a result that is still unknown stays 结果待确认 and is checked (read-only) whenever the
 * flow changes — never inferred from the task disappearing.
 */
export function LoginFlowCard({ flow, endpoint, declaration, canOperate, readError, refreshing, onReload, onApply, onSettled, clockOffset = 0 }: LoginFlowCardProps) {
  const i18n = useI18n()
  const logPanel = useLogPanel()
  const adapter = endpoint.adapter
  const endpointKey = endpoint.name
  const inputRef = useRef<HTMLInputElement | null>(null)
  const [progress, setProgress] = useState<Record<string, LoginProgress>>({})
  const translate = useCallback((message: string, detail?: string) => detail ? i18n.t('{0}：{1}', [i18n.t(message), i18n.t(detail)]) : i18n.t(message), [i18n])

  const receipt = useActionReceipt({
    persistKey: `login-flow:${adapter}:${endpointKey}`,
    submit: async plan => {
      const payload = plan.payload as SubmitPayload
      try {
        const reply = await requestConsole<unknown>({
          type: LOGIN_RPC.SUBMIT, taskId: payload.taskId, value: payload.value, wait: true, adapter: payload.adapter, endpointKey: payload.endpointKey,
          ...(payload.endpointIdentity ? { endpointIdentity: payload.endpointIdentity } : {}),
        }, { timeoutMs: LOGIN_SUBMIT_TIMEOUT_MS })
        const read = readSubmitReply(reply)
        if (read.flow) onApply(read.flow, true)
        const result = submitReceiptResult(read)
        return { status: result.status, message: translate(result.message, result.detail) }
      } catch (error) {
        // The Host refused the answer (format, missing input, stale action): the challenge stays open.
        const code = refusalCode(error)
        if (code && code in SUBMIT_ERROR_COPY) {
          const reason = error instanceof Error ? error.message : ''
          return { status: 'failed', message: translate(SUBMIT_ERROR_COPY[code as keyof typeof SUBMIT_ERROR_COPY], reason || undefined) }
        }
        throw error
      }
    },
    verify: async plan => {
      const payload = plan.payload as SubmitPayload
      const current = readLoginFlowGet(await requestConsole<unknown>({ type: LOGIN_RPC.FLOW_GET, adapter: payload.adapter, endpointKey: payload.endpointKey }))
      onApply(current)
      const verdict = verifySubmission(current, payload.stepId)
      return verdict ? { applied: verdict.applied, message: i18n.t(verdict.message) } : { message: i18n.t(PENDING_RESULT_COPY) }
    },
    onSettled: () => onSettled?.(),
  })
  const control = useActionReceipt({
    persistKey: `login-control:${adapter}:${endpointKey}`,
    submit: async plan => {
      const payload = plan.payload as ControlPayload
      try {
        if (payload.kind === 'cancel') {
          await requestConsole({ type: LOGIN_RPC.CANCEL, taskId: payload.taskId, reason: 'console_cancelled', adapter: payload.adapter, endpointKey: payload.endpointKey })
          return { status: 'saved', message: i18n.t('已取消这次登录。') }
        }
        await requestConsole({ type: payload.kind === 'relogin' ? LOGIN_RPC.RELOGIN : LOGIN_RPC.REFRESH, adapter: payload.adapter, endpointKey: payload.endpointKey })
        return { status: 'saved', message: payload.kind === 'relogin' ? i18n.t('已开始重新登录，新的步骤会出现在时间线上。') : i18n.t('已请求新的验证，稍候会显示。') }
      } catch (error) {
        if (refusalCode(error) === 'unsupported') return { status: 'failed', message: i18n.t(SUBMIT_ERROR_COPY.unsupported) }
        throw error
      } finally {
        onReload()
      }
    },
    verify: async plan => {
      const payload = plan.payload as ControlPayload
      const current = readLoginFlowGet(await requestConsole<unknown>({ type: LOGIN_RPC.FLOW_GET, adapter: payload.adapter, endpointKey: payload.endpointKey }))
      onApply(current)
      if (payload.kind === 'cancel') return current && current.activeTaskId === payload.taskId && current.state === 'active' ? { applied: false } : { applied: true }
      if (payload.kind === 'relogin') return current && (current.id !== payload.flowId || current.attempt > (payload.attempt ?? 0)) ? { applied: true } : undefined
      // Challenge ids are stable per kind (icqq-qrcode…): a refresh shows as a new step.
      const open = activeChallengeStep(current)
      return open && open.id === payload.stepId ? undefined : { applied: true }
    },
  })

  // A result that was still unknown is checked again (read-only) whenever the flow moves on.
  const revision = flow?.revision
  const unknown = receipt.state.phase === 'unknown'
  const verifyLatest = useRef(receipt.verify)
  verifyLatest.current = receipt.verify
  // One check per flow revision: a check that is still undecided waits for the next change.
  const checkedRevision = useRef<number | null>(null)
  useEffect(() => {
    if (!unknown || revision === undefined || checkedRevision.current === revision) return
    checkedRevision.current = revision
    verifyLatest.current()
  }, [unknown, revision])

  // The answer before the open challenge was rejected: say so next to the input, where the person
  // looks, and let the timeline keep the record. A rejected submission's receipt has then said its piece.
  const openStep = activeChallengeStep(flow)
  const retryNotice = (() => {
    if (!flow || !openStep) return null
    const before = flow.steps.slice(0, flow.steps.indexOf(openStep)).reverse().find(item => item.kind !== 'info')
    return before?.status === 'failed' && before.outcome ? outcomeView(before.outcome) : null
  })()
  const settledPlanStep = (receipt.state.plan?.payload as SubmitPayload | undefined)?.stepId
  const resetLatest = useRef(receipt.reset)
  resetLatest.current = receipt.reset
  useEffect(() => {
    if (receipt.state.phase === 'failed' && !receipt.state.verified && retryNotice && settledPlanStep && settledPlanStep !== openStep?.id) resetLatest.current()
  }, [receipt.state.phase, receipt.state.verified, retryNotice, settledPlanStep, openStep?.id])

  const busy = receiptBlocksActions(receipt.state)
  const controlBusy = receiptBlocksActions(control.state)
  const controls = flowControls(flow, declaration, canOperate)
  const step = activeChallengeStep(flow)
  const challenge = step?.challenge
  const verifying = activeVerifyingStep(flow)
  const badge = flowStateBadge(flow)
  const timeline = flowTimeline(flow)
  // The challenge the header names: the open one, else the last one answered.
  const named = challenge ?? (flow ? [...flow.steps].reverse().find(item => item.challenge)?.challenge : undefined)
  const KindIcon = named ? KIND_ICONS[named.kind] : LogIn

  /** Sends an answer; `false` when it could not be sent now (another write is open) — the caller keeps it. */
  const submit = (value: LoginSubmitValue, summary: string): boolean => {
    if (!flow || !step || receiptBlocksActions(receipt.state) || receiptBlocksActions(control.state)) return false
    const taskId = flow.activeTaskId ?? step.taskId
    if (!taskId) return false
    const payload: SubmitPayload = { taskId, stepId: step.id, value, adapter, endpointKey, ...(flow.endpointIdentity ? { endpointIdentity: flow.endpointIdentity } : {}) }
    receipt.prepare({ title: i18n.t('提交 {0}：{1}', [`${adapter} / ${endpointKey}`, i18n.t(step.challenge.title)]), changes: [summary], payload })
    // Answering a challenge is the click itself: no extra confirmation step.
    receipt.confirm()
    return true
  }
  const runControl = (kind: ControlKind) => {
    if (!flow && kind !== 'relogin') return
    const payload: ControlPayload = {
      kind, adapter, endpointKey,
      ...(flow?.activeTaskId ? { taskId: flow.activeTaskId } : {}),
      ...(flow ? { flowId: flow.id, attempt: flow.attempt } : {}),
      ...(step ? { stepId: step.id } : {}),
    }
    if (kind === 'refresh') {
      control.prepare({ title: i18n.t('刷新 {0} 的验证', [`${adapter} / ${endpointKey}`]), payload })
      control.confirm()
      return
    }
    control.prepare(kind === 'cancel'
      ? { title: i18n.t('取消 {0} 的这次登录', [`${adapter} / ${endpointKey}`]), summary: i18n.t('正在进行的验证会失效，账号保持离线，直到重新登录。'), confirmLabel: i18n.t('取消登录'), payload }
      : { title: i18n.t('重新登录 {0}', [`${adapter} / ${endpointKey}`]), summary: i18n.t('会结束当前的登录并从头开始；正在进行的验证会失效。'), confirmLabel: i18n.t('重新登录'), payload })
  }
  const onProgress = (event: ProgressEvent) => {
    // Keyed by step: a re-opened challenge with the same id (icqq-sms…) starts unticked.
    if (!step) return
    setProgress(previous => ({ ...previous, [step.id]: recordProgress(previous[step.id], event) }))
  }
  const onNext = (next: NonNullable<OutcomeView['next']>) => {
    if (next === 'retry_input') { inputRef.current?.focus(); inputRef.current?.select(); return }
    if (next === 'refresh_challenge') { runControl(controls.refresh ? 'refresh' : 'relogin'); return }
    if (next === 'relogin') runControl('relogin')
  }
  // `rate_limited` (next: wait): answers stay closed until the wait is over.
  const lastFailed = flow ? [...flow.steps].reverse().find(item => item.outcome && item.outcome.result !== 'accepted' && item.outcome.result !== 'online') : undefined
  // Server time → this browser's clock.
  const waitUntil = lastFailed?.outcome?.retryAfterMs ? (lastFailed.endedAt ?? lastFailed.at) + lastFailed.outcome.retryAfterMs - clockOffset : undefined

  const header = (
    <header className="console-login-flow-head">
      <span className={cn('console-login-flow-icon', flow?.state === 'online' && 'is-online', flow?.state === 'failed' && 'is-failed')} aria-hidden="true"><KindIcon /></span>
      <div className="console-login-flow-heading">
        <p className="console-login-flow-title">
          <span>{named ? i18n.t(CHALLENGE_KIND_COPY[named.kind]) : i18n.t('登录')}</span>
          {badge ? <Badge size="sm" variant={BADGE_VARIANT[badge.tone]}>{i18n.t(badge.label)}</Badge> : null}
          {flow && flow.attempt > 1 ? <Badge size="sm" variant="outline">{i18n.t('第 {0} 次尝试', [String(flow.attempt)])}</Badge> : null}
        </p>
        <p className="console-login-flow-sub">
          <code title={`${adapter} / ${endpointKey}`}>{adapter} / {endpointKey}</code>
          {flow ? <span><SinceText at={flow.startedAt} /></span> : null}
          {refreshing ? <Loader2 className="console-login-flow-sync animate-spin" aria-label={i18n.t('正在同步')} /> : null}
        </p>
      </div>
      <div className="console-login-flow-tools">
        {controls.refresh ? <Button size="sm" variant="outline" disabled={controlBusy} onClick={() => runControl('refresh')}><RefreshCw />{challenge?.kind === 'qrcode' ? i18n.t('刷新二维码') : i18n.t('刷新验证')}</Button> : null}
        {controls.relogin ? <Button size="sm" variant="outline" disabled={controlBusy} onClick={() => runControl('relogin')}><RotateCcw />{i18n.t('重新登录')}</Button> : null}
        {controls.cancel ? <Button size="sm" variant="ghost" disabled={controlBusy || busy} onClick={() => runControl('cancel')}><X />{i18n.t('取消')}</Button> : null}
        {logPanel.available ? (
          <Button size="sm" variant="ghost" aria-label={i18n.t('查看 {0} 的日志', [endpointKey])} onClick={() => logPanel.open({ adapter, endpoint: endpointKey })}>
            <FileText />{i18n.t('日志')}
          </Button>
        ) : null}
      </div>
    </header>
  )

  if (!flow) {
    return (
      <Card className="console-login-flow">
        {header}
        <ActionReceipt controller={control} className="console-login-receipt" />
        <StatusState kind="empty" compact title={endpoint.connected ? i18n.t('不需要登录') : i18n.t('没有进行中的登录')}
          description={endpoint.connected
            ? i18n.t('账号已连接。需要扫码、短信或其它验证时，步骤会实时出现在这里。')
            : i18n.t('账号未连接，平台也没有发来登录验证。可以先测试连接，或重新登录。')} />
      </Card>
    )
  }

  return (
    <Card className={cn('console-login-flow', `is-${flow.state}`)} data-flow-state={flow.state}>
      {header}
      <ActionReceipt controller={control} className="console-login-receipt" />
      {readError ? <StatusState compact error={readError} onRetry={onReload} description={i18n.t('最近一次同步失败，下面是上次读到的状态。')} /> : null}
      <div className="console-login-flow-body">
        <Timeline steps={timeline.steps} onNext={canOperate ? onNext : undefined} nextAllowed={next => next === 'retry_input' ? Boolean(challenge?.input) : next === 'wait' ? false : next === 'refresh_challenge' ? controls.refresh || controls.relogin : controls.relogin} disabled={busy || controlBusy} clockOffset={clockOffset} />
        <div className="console-login-flow-main">
          {challenge && step ? (
            <>
              <ChallengePanel key={step.id} step={step} progress={progress[step.id] ?? {}} clockOffset={clockOffset} onProgress={onProgress} onSubmit={submit}
                busy={busy || controlBusy} canOperate={canOperate} infoSteps={activeInfoSteps(flow)}
                onRefresh={controls.refresh ? () => runControl('refresh') : undefined} refreshing={control.state.phase === 'submitting'}
                waitUntil={waitUntil} inputRef={inputRef} retryNotice={retryNotice} />
              <SubmitProgress phase={receipt.state.phase} verifyingTitle={verifying?.title} />
            </>
          ) : receipt.state.phase === 'submitting' ? (
            <SubmitProgress phase={receipt.state.phase} verifyingTitle={verifying?.title} />
          ) : (
            <FlowResult flow={flow} verifyingTitle={verifying?.title} receiptExplains={receipt.state.phase === 'unknown' || receipt.state.phase === 'verifying'} />
          )}
          {receipt.state.phase !== 'submitting' ? <ActionReceipt controller={receipt} className="console-login-receipt" /> : null}
        </div>
      </div>
    </Card>
  )
}

/** 提交 → 验证中 → 结果, while the `wait: true` request is open. */
function SubmitProgress({ phase, verifyingTitle }: { phase: string; verifyingTitle?: string }) {
  const i18n = useI18n()
  if (phase !== 'submitting') return null
  const verifying = Boolean(verifyingTitle)
  return (
    <div className="console-login-progress" role="status" aria-live="polite">
      <ol>
        <li className="is-done"><CheckCircle2 aria-hidden="true" />{i18n.t('已提交')}</li>
        <li className={verifying ? 'is-current' : 'is-waiting'}>{verifying ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Loader2 className="animate-spin" aria-hidden="true" />}{verifying ? i18n.t(verifyingTitle!) : i18n.t('提交中…')}</li>
        <li className="is-todo"><Circle aria-hidden="true" />{i18n.t('等待结果')}</li>
      </ol>
      <p className="console-login-muted">{i18n.t('平台最多需要十几秒确认。请不要关闭页面或重复提交。')}</p>
    </div>
  )
}

/** No open challenge: verifying, online, failed, cancelled or expired. */
function FlowResult({ flow, verifyingTitle, receiptExplains }: { flow: LoginFlow; verifyingTitle?: string; receiptExplains?: boolean }) {
  const i18n = useI18n()
  const outcome = outcomeView(flow.lastOutcome)
  if (flow.state === 'online') {
    return <div className="console-login-result is-success" role="status"><CheckCircle2 aria-hidden="true" /><div><p className="font-medium">{i18n.t('登录完成，账号已上线')}</p><p className="console-login-muted"><SinceText at={flow.updatedAt} prefix="done" /></p></div></div>
  }
  // The receipt below already says 结果待确认 for this submission.
  if (flow.state === 'active' && flow.pendingConfirmation && receiptExplains) return null
  if (flow.state === 'active' && flow.pendingConfirmation) {
    return <div className="console-login-result is-info" role="status"><Info aria-hidden="true" /><div><p className="font-medium">{i18n.t('结果待确认')}</p><p className="console-login-muted">{i18n.t('平台还没有给出结果。页面会继续等待并自动更新，不需要重复提交。')}</p></div></div>
  }
  if (flow.state === 'active') {
    return <div className="console-login-result is-info" role="status"><Loader2 className="animate-spin" aria-hidden="true" /><div><p className="font-medium">{verifyingTitle ? i18n.t(verifyingTitle) : i18n.t('正在连接平台…')}</p><p className="console-login-muted">{i18n.t('需要你操作时，验证会出现在这里。')}</p></div></div>
  }
  return (
    <div className={cn('console-login-result', flow.state === 'failed' ? 'is-error' : 'is-muted')} role="status">
      {flow.state === 'failed' ? <XCircle aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
      <div>
        <p className="font-medium">{outcome ? i18n.t(outcome.title) : flow.state === 'cancelled' ? i18n.t('这次登录已取消') : flow.state === 'expired' ? i18n.t('验证已过期') : i18n.t('登录失败')}</p>
        {outcome?.message || outcome?.description ? <p className="console-login-muted">{i18n.t(outcome.message ?? outcome.description!)}</p> : null}
        {flow.state === 'expired' ? <p className="console-login-muted">{i18n.t('平台通常会自动发来新的验证；也可以刷新或重新登录。')}</p> : null}
      </div>
    </div>
  )
}

function SinceText({ at, prefix }: { at: number; prefix?: 'done' }) {
  const i18n = useI18n()
  const now = useNow(true, 30_000)
  if (!at) return null
  const minutes = Math.max(0, Math.round((now - at) / 60_000))
  const time = new Date(at).toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit' })
  if (prefix === 'done') return <>{i18n.t('{0} 完成', [time])}</>
  return <>{minutes < 1 ? i18n.t('{0} 开始', [time]) : i18n.t('{0} 开始 · 已 {1} 分钟', [time, String(minutes)])}</>
}

/** Vertical step timeline: done steps one line ✓, the current step highlighted, failures with the next step. */
function Timeline({ steps, onNext, nextAllowed, disabled, clockOffset = 0 }: {
  steps: readonly TimelineStep[]
  onNext?: (next: NonNullable<OutcomeView['next']>) => void
  nextAllowed: (next: NonNullable<OutcomeView['next']>) => boolean
  disabled: boolean
  clockOffset?: number
}) {
  const i18n = useI18n()
  // Only the latest failure keeps its full reason and next step; older ones shrink to one line.
  const latestFailed = [...steps].reverse().find(step => step.status === 'failed' && step.outcome)?.id
  return (
    <ol className="console-login-timeline" aria-label={i18n.t('登录步骤')}>
      {steps.map((step, index) => (
        <li key={step.id} className={cn('console-login-timeline-step', `is-${step.status}`, step.current && 'is-current', step.collapsed && 'is-collapsed')}
          aria-current={step.current ? 'step' : undefined}>
          <span className="console-login-timeline-marker" aria-hidden="true">
            {step.status === 'done' ? <CheckCircle2 /> : step.status === 'failed' ? <XCircle /> : step.status === 'skipped' ? <Circle /> : step.kind === 'verifying' ? <Loader2 className="animate-spin" /> : <CircleDot />}
          </span>
          <div className="console-login-timeline-content">
            <p className="console-login-timeline-title">
              <span className="sr-only">{i18n.t('第 {0} 步', [String(index + 1)])}{' '}</span>
              <span>{i18n.t(step.title)}</span>
              {step.status === 'skipped' ? <span className="console-login-timeline-tag">{i18n.t('已被新的验证替换')}</span> : null}
              <time dateTime={new Date(step.endedAt ?? step.at).toISOString()}>{new Date(step.endedAt ?? step.at).toLocaleTimeString(i18n.locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</time>
            </p>
            {!step.collapsed && step.detail ? <p className="console-login-muted">{i18n.t(step.detail)}</p> : null}
            {step.outcome && step.status === 'failed' && step.id !== latestFailed ? <p className="console-login-muted">{i18n.t(step.outcome.title)}</p> : null}
            {step.outcome && step.status === 'failed' && step.id === latestFailed ? <StepOutcome outcome={step.outcome} at={(step.endedAt ?? step.at) - clockOffset} onNext={onNext} nextAllowed={nextAllowed} disabled={disabled} /> : null}
            {step.outcome && step.status !== 'failed' && step.outcome.tone === 'success' && !step.collapsed ? <p className="console-login-muted">{i18n.t(step.outcome.title)}</p> : null}
          </div>
        </li>
      ))}
    </ol>
  )
}

function StepOutcome({ outcome, at, onNext, nextAllowed, disabled }: {
  outcome: OutcomeView; at: number
  onNext?: (next: NonNullable<OutcomeView['next']>) => void
  nextAllowed: (next: NonNullable<OutcomeView['next']>) => boolean
  disabled: boolean
}) {
  const i18n = useI18n()
  const waitUntil = outcome.retryAfterMs ? at + outcome.retryAfterMs : 0
  const now = useNow(waitUntil > Date.now())
  const waiting = waitUntil > now ? waitUntil - now : 0
  const next = outcome.next
  return (
    <div className="console-login-outcome" role="alert">
      <p className="console-login-outcome-title">{i18n.t(outcome.title)}</p>
      {outcome.message ? <p>{i18n.t(outcome.message)}</p> : outcome.description ? <p>{i18n.t(outcome.description)}</p> : null}
      {outcome.message && outcome.description ? <p className="console-login-muted">{i18n.t(outcome.description)}</p> : null}
      {waiting ? <p className="console-login-muted">{i18n.t('{0} 后可以再试', [formatCountdown(waiting / 1000)])}</p> : null}
      {next && next !== 'wait' && onNext && nextAllowed(next) ? (
        <Button size="sm" variant="outline" disabled={disabled || Boolean(waiting)} onClick={() => onNext(next)} title={i18n.t(NEXT_ACTION_COPY[next].hint)}>
          {next === 'retry_input' ? <RotateCcw /> : <RefreshCw />}{i18n.t(NEXT_ACTION_COPY[next].label)}
        </Button>
      ) : null}
    </div>
  )
}
