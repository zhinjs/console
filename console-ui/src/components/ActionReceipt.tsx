import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, RefreshCw, RotateCcw, ServerOff, X, XCircle } from 'lucide-react'
import { cn } from '@zhin.js/client'
import './status-surfaces.css'
import { useI18n } from '../i18n'
import { Button } from './ui/button'
import { StatusState } from './StatusState'
import {
  RECEIPT_COPY, type ActionReceiptState, type ReceiptEvent, type ReceiptPlan,
} from './action-receipt-model.mjs'
import { createReceiptStore, sharedReceipts, type ReceiptStore } from './action-receipt-store.mjs'
import { transactionDetailText, transactionFailureCopy, transactionNeedsInstanceCheck } from '../pages/features/plugin-switch-model.mjs'

export interface UseActionReceiptOptions {
  /** Performs the write. Resolve with nothing or `{ status, items?, message? }` (see readSubmitResult). */
  readonly submit: (plan: ReceiptPlan) => Promise<unknown>
  /** Read-only check after an unknown outcome: `{ applied: true | false | undefined }`. Never writes. */
  readonly verify?: (plan: ReceiptPlan) => Promise<{ applied?: boolean; message?: string } | undefined>
  /** Called once the action settled as succeeded / partial (e.g. reload the list). */
  readonly onSettled?: (state: ActionReceiptState) => void
  /**
   * Scope + action key (e.g. `feature:adapter:qq:ai`). With it the receipt outlives its component
   * (`action-receipt-store.mjs`): leaving a tab mid-write or with an unknown outcome and coming back
   * shows the same receipt, so the write cannot be sent again. `submit` / `verify` then read what
   * they need from `plan.payload`, not from component state.
   */
  readonly persistKey?: string
}

export interface ActionReceiptController {
  readonly state: ActionReceiptState
  /** Shows the plan (准备). Ignored while a request is in flight or its outcome is unknown. */
  readonly prepare: (plan: ReceiptPlan) => void
  /** 确认: submits, or asks once more for a danger plan. */
  readonly confirm: () => void
  readonly cancel: () => void
  readonly verify: () => void
  /** Whether a read-only check was provided. */
  readonly canVerify: boolean
  /** Closes a settled receipt (放弃并重新开始 after a check showed nothing was applied). */
  readonly reset: () => void
}

const LOCAL_KEY = 'local'

/** State machine of one write: 准备 → 确认 → 提交 → 成功 / 部分失败 / 结果未知 / 未执行. */
export function useActionReceipt({ submit, verify, onSettled, persistKey }: UseActionReceiptOptions): ActionReceiptController {
  const local = useRef<ReceiptStore | null>(null)
  if (!local.current) local.current = createReceiptStore()
  const store = persistKey ? sharedReceipts : local.current
  const key = persistKey ?? LOCAL_KEY
  const subscribe = useCallback((listener: () => void) => store.subscribe(key, listener), [store, key])
  const read = useCallback(() => store.get(key), [store, key])
  const state = useSyncExternalStore(subscribe, read, read)
  const callbacks = useRef({ submit, verify, onSettled })
  callbacks.current = { submit, verify, onSettled }
  // Each request settles into the receipt it started from, even if the component is gone by then.
  const run = useCallback((plan: ReceiptPlan) => {
    const send = (event: ReceiptEvent) => store.dispatch(key, event)
    callbacks.current.submit(plan).then(
      value => {
        const next = send({ type: 'resolve', value })
        if (next.phase === 'succeeded' || next.phase === 'partial') callbacks.current.onSettled?.(next)
      },
      (error: unknown) => { send({ type: 'reject', error }) },
    )
  }, [store, key])
  const confirm = useCallback(() => {
    const current = store.get(key)
    if (current.phase !== 'prepared' && current.phase !== 'confirming') return
    // The reducer decides (danger → second step; 「确认执行」 ignores confirms right after it appeared).
    const next = store.dispatch(key, { type: current.phase === 'prepared' ? 'confirm' : 'submit', now: Date.now() })
    if (next.phase === 'submitting' && next.plan) run(next.plan)
  }, [store, key, run])
  const verifyNow = useCallback(() => {
    const current = store.get(key)
    const check = callbacks.current.verify
    if (current.phase !== 'unknown' || !check || !current.plan) return
    store.dispatch(key, { type: 'verify' })
    check(current.plan).then(
      value => {
        const next = store.dispatch(key, { type: 'verified', value })
        if (next.phase === 'succeeded') callbacks.current.onSettled?.(next)
      },
      (error: unknown) => { store.dispatch(key, { type: 'verify-failed', error }) },
    )
  }, [store, key])
  return {
    state,
    prepare: useCallback((plan: ReceiptPlan) => { store.dispatch(key, { type: 'prepare', plan }) }, [store, key]),
    confirm,
    cancel: useCallback(() => { store.dispatch(key, { type: 'cancel' }) }, [store, key]),
    verify: verifyNow,
    canVerify: Boolean(verify),
    reset: useCallback(() => { store.dispatch(key, { type: 'reset' }) }, [store, key]),
  }
}

/**
 * The receipt panel for a {@link useActionReceipt} controller. Renders nothing while idle. Placed
 * next to the control that started the action (inline), not as a toast: the outcome stays visible
 * until dismissed.
 */
export function ActionReceipt({ controller, className, lockHref }: {
  controller: ActionReceiptController
  className?: string
  /** Where a `locked` refusal can be lifted (the locking level's page). */
  lockHref?: string
}) {
  const i18n = useI18n()
  const { state, confirm, cancel, verify, canVerify, reset } = controller
  // Phases swap the buttons (确认 → 提交中 → 结果), so the focused button unmounts. Keep keyboard
  // users inside the receipt: move focus to its first action, or the panel itself.
  const panel = useRef<HTMLElement | null>(null)
  const hadFocus = useRef(false)
  useEffect(() => {
    const node = panel.current
    if (!node || !hadFocus.current) return
    const active = document.activeElement
    // Entering 「确认执行」 always moves the focus to 取消, wherever it was inside the receipt.
    if (active && active !== document.body && node.contains(active) && state.phase !== 'confirming') return
    const target = node.querySelector<HTMLElement>('.console-receipt-actions [data-receipt-cancel]')
      ?? node.querySelector<HTMLElement>('.console-receipt-actions button:not([disabled]), .console-receipt-close')
    ;(target ?? node).focus()
  }, [state.phase])
  if (state.phase === 'idle') { hadFocus.current = false; return null }
  const plan = state.plan
  const busy = state.phase === 'submitting' || state.phase === 'verifying'
  const Icon = state.phase === 'succeeded' ? CheckCircle2
    : state.phase === 'partial' ? AlertTriangle
      : state.phase === 'failed' ? XCircle
        : state.phase === 'unknown' ? CircleHelp
          : busy ? Loader2 : null
  return (
    <section
      ref={panel}
      tabIndex={-1}
      onFocusCapture={() => { hadFocus.current = true }}
      onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null) && event.relatedTarget) hadFocus.current = false }}
      className={cn('console-receipt', `console-receipt--${state.phase}`, className)}
      aria-live="polite"
      aria-busy={busy}
      aria-label={i18n.t('操作回执')}
    >
      <header className="console-receipt-head">
        {Icon ? <Icon className={cn('console-receipt-icon', busy && 'animate-spin')} aria-hidden="true" /> : null}
        <div className="min-w-0 flex-1">
          {/* A rollback that did not finish is not 未执行: the instance may have been left stopped. */}
          <p className="console-receipt-phase">{state.phase === 'failed' && state.status?.transaction?.outcome === 'rollback-failed' ? i18n.t('失败') : i18n.t(RECEIPT_COPY[state.phase])}</p>
          {plan ? <p className="console-receipt-title">{plan.title}</p> : null}
        </div>
        {/* An unknown outcome cannot be dismissed: only a check settles it. */}
        {!busy && state.phase !== 'prepared' && state.phase !== 'confirming' && state.phase !== 'unknown' ? (
          <Button variant="ghost" size="icon" className="console-receipt-close" onClick={reset} aria-label={i18n.t('关闭回执')}><X /></Button>
        ) : null}
      </header>
      {plan?.summary && (state.phase === 'prepared' || state.phase === 'confirming') ? <p className="console-receipt-summary">{plan.summary}</p> : null}
      {plan?.changes?.length && (state.phase === 'prepared' || state.phase === 'confirming') ? (
        <ul className="console-receipt-changes">{plan.changes.map(change => <li key={change}>{change}</li>)}</ul>
      ) : null}
      {state.items?.length ? (
        <ul className="console-receipt-items">
          {state.items.map(item => (
            <li key={item.label} className={item.ok ? 'is-ok' : 'is-failed'}>
              {item.ok ? <CheckCircle2 aria-hidden="true" /> : <XCircle aria-hidden="true" />}
              <span>{item.label}</span>{item.message ? <span className="text-muted-foreground"> · {item.message}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
      {state.phase === 'succeeded' && state.unchanged ? <p className="console-receipt-summary">{i18n.t('内容没有变化。')}</p> : null}
      {state.phase === 'succeeded' && state.verified ? <p className="console-receipt-summary">{i18n.t('已核对：修改已生效。')}</p> : null}
      {state.message ? <p className="console-receipt-summary">{state.message}</p> : null}
      {state.phase === 'unknown' ? (
        <StatusState compact kind="unknown" error={state.status?.message ? state.status.message : undefined}
          description={i18n.t('请求已发出但没有收到可信答复，修改可能已经生效。请先只读核对，不要重复提交。')} />
      ) : null}
      {state.phase === 'failed' && state.status?.transaction ? (
        // A refused gateway transaction (global plugin switch, ADR 0054 §4): rolled back, rollback
        // failed or no gateway. The failed phase and the instance log tail go under 技术详情.
        <StatusState compact kind="error" title={transactionFailureCopy(state.status.transaction.outcome, i18n.t).title}
          description={transactionFailureCopy(state.status.transaction.outcome, i18n.t).description}
          error={transactionDetailText(state.status, i18n.t) || undefined}
          actions={transactionNeedsInstanceCheck(state.status.transaction)
            ? <Button asChild size="sm" variant="outline"><Link to="/ops/instance"><ServerOff />{i18n.t('查看实例')}</Link></Button>
            : undefined} />
      ) : state.phase === 'failed' && state.status ? (
        // A write that was not applied never reads as 读取失败: a plain failure is 操作没有完成; the
        // Host's own reason is the answer itself, a coded failure keeps its text under 技术详情.
        state.status.kind === 'error'
          ? state.status.message && !state.status.serverCode
            ? <StatusState compact kind="error" title={i18n.t('操作没有完成')} description={state.status.message} />
            : <StatusState compact kind="error" title={i18n.t('操作没有完成')} error={state.status.message || undefined}
              description={i18n.t('Host 没有执行这次修改，内容保持原样。查看技术详情后可以重新准备。')} />
          : <StatusState compact kind={state.status.kind} error={state.status.message || undefined} lockedBy={state.status.lockedBy} lockHref={lockHref} />
      ) : null}
      <footer className="console-receipt-actions">
        {state.phase === 'prepared' ? <>
          <Button key="confirm" size="sm" variant={plan?.danger ? 'destructive' : 'default'} onClick={confirm}>{plan?.confirmLabel ?? i18n.t('确认')}</Button>
          <Button key="cancel" size="sm" variant="outline" onClick={cancel}>{i18n.t('取消')}</Button>
        </> : null}
        {/* The second step puts 取消 first (it takes the focus) and 确认执行 where 取消 was, so a double
            click or a repeated Enter on 「确认」 lands on 取消; the reducer also ignores confirms for
            CONFIRM_GUARD_MS after this step appeared. */}
        {state.phase === 'confirming' ? <>
          <Button key="cancel" size="sm" variant="outline" onClick={cancel} data-receipt-cancel>{i18n.t('取消')}</Button>
          <Button key="execute" size="sm" variant="destructive" onClick={confirm} data-receipt-execute>{i18n.t('确认执行')}</Button>
        </> : null}
        {state.phase === 'unknown' ? (
          <Button size="sm" variant="outline" onClick={verify} disabled={!canVerify}><RefreshCw />{i18n.t('核对当前状态')}</Button>
        ) : null}
        {state.phase === 'failed' && state.verified ? (
          <Button size="sm" variant="outline" onClick={reset}><RotateCcw />{i18n.t('放弃并重新开始')}</Button>
        ) : null}
      </footer>
    </section>
  )
}
