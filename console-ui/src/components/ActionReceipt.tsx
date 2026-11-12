import { useCallback, useReducer, useRef } from 'react'
import { AlertTriangle, CheckCircle2, CircleHelp, Loader2, RefreshCw, X, XCircle } from 'lucide-react'
import { cn } from '@zhin.js/client'
import './status-surfaces.css'
import { useI18n } from '../i18n'
import { Button } from './ui/button'
import { StatusState } from './StatusState'
import {
  IDLE_RECEIPT, RECEIPT_COPY, receiptReducer, type ActionReceiptState, type ReceiptPlan,
} from './action-receipt-model.mjs'

export interface UseActionReceiptOptions {
  /** Performs the write. Resolve with nothing or `{ status, items?, message? }` (see readSubmitResult). */
  readonly submit: (plan: ReceiptPlan) => Promise<unknown>
  /** Read-only check after an unknown outcome: `{ applied: true | false | undefined }`. Never writes. */
  readonly verify?: (plan: ReceiptPlan) => Promise<{ applied?: boolean; message?: string } | undefined>
  /** Called once the action settled as succeeded / partial (e.g. reload the list). */
  readonly onSettled?: (state: ActionReceiptState) => void
}

export interface ActionReceiptController {
  readonly state: ActionReceiptState
  /** Shows the plan (准备). */
  readonly prepare: (plan: ReceiptPlan) => void
  /** 确认: submits, or asks once more for a danger plan. */
  readonly confirm: () => void
  readonly cancel: () => void
  readonly verify: () => void
  /** Whether a read-only check was provided. */
  readonly canVerify: boolean
  readonly reset: () => void
}

/** State machine of one write: 准备 → 确认 → 提交 → 成功 / 部分失败 / 结果未知 / 未执行. */
export function useActionReceipt({ submit, verify, onSettled }: UseActionReceiptOptions): ActionReceiptController {
  const [state, dispatch] = useReducer(receiptReducer, IDLE_RECEIPT)
  const stateRef = useRef(state)
  stateRef.current = state
  const callbacks = useRef({ submit, verify, onSettled })
  callbacks.current = { submit, verify, onSettled }
  const run = useCallback((plan: ReceiptPlan) => {
    callbacks.current.submit(plan).then(
      value => {
        dispatch({ type: 'resolve', value })
        const next = receiptReducer({ phase: 'submitting', plan }, { type: 'resolve', value })
        if (next.phase === 'succeeded' || next.phase === 'partial') callbacks.current.onSettled?.(next)
      },
      (error: unknown) => dispatch({ type: 'reject', error }),
    )
  }, [])
  const confirm = useCallback(() => {
    const current = stateRef.current
    if (current.phase === 'prepared' && current.plan && !current.plan.danger) {
      dispatch({ type: 'confirm' })
      run(current.plan)
    } else if (current.phase === 'prepared') {
      dispatch({ type: 'confirm' })
    } else if (current.phase === 'confirming' && current.plan) {
      dispatch({ type: 'submit' })
      run(current.plan)
    }
  }, [run])
  const verifyNow = useCallback(() => {
    const current = stateRef.current
    const check = callbacks.current.verify
    if (current.phase !== 'unknown' || !check || !current.plan) return
    dispatch({ type: 'verify' })
    check(current.plan).then(
      value => {
        dispatch({ type: 'verified', value })
        if (value?.applied === true) callbacks.current.onSettled?.({ ...current, phase: 'succeeded', verified: true })
      },
      (error: unknown) => dispatch({ type: 'verify-failed', error }),
    )
  }, [])
  return {
    state,
    prepare: useCallback((plan: ReceiptPlan) => dispatch({ type: 'prepare', plan }), []),
    confirm,
    cancel: useCallback(() => dispatch({ type: 'cancel' }), []),
    verify: verifyNow,
    canVerify: Boolean(verify),
    reset: useCallback(() => dispatch({ type: 'reset' }), []),
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
  if (state.phase === 'idle') return null
  const plan = state.plan
  const busy = state.phase === 'submitting' || state.phase === 'verifying'
  const Icon = state.phase === 'succeeded' ? CheckCircle2
    : state.phase === 'partial' ? AlertTriangle
      : state.phase === 'failed' ? XCircle
        : state.phase === 'unknown' ? CircleHelp
          : busy ? Loader2 : null
  return (
    <section
      className={cn('console-receipt', `console-receipt--${state.phase}`, className)}
      aria-live="polite"
      aria-busy={busy}
      aria-label={i18n.t('操作回执')}
    >
      <header className="console-receipt-head">
        {Icon ? <Icon className={cn('console-receipt-icon', busy && 'animate-spin')} aria-hidden="true" /> : null}
        <div className="min-w-0 flex-1">
          <p className="console-receipt-phase">{i18n.t(RECEIPT_COPY[state.phase])}</p>
          {plan ? <p className="console-receipt-title">{plan.title}</p> : null}
        </div>
        {!busy && state.phase !== 'prepared' && state.phase !== 'confirming' ? (
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
      {state.phase === 'failed' && state.status ? (
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
          <Button size="sm" variant={plan?.danger ? 'destructive' : 'default'} onClick={confirm}>{plan?.confirmLabel ?? i18n.t('确认')}</Button>
          <Button size="sm" variant="outline" onClick={cancel}>{i18n.t('取消')}</Button>
        </> : null}
        {state.phase === 'confirming' ? <>
          <Button size="sm" variant="destructive" onClick={confirm}>{i18n.t('确认执行')}</Button>
          <Button size="sm" variant="outline" onClick={cancel}>{i18n.t('取消')}</Button>
        </> : null}
        {state.phase === 'unknown' ? (
          <Button size="sm" variant="outline" onClick={verify} disabled={!canVerify}><RefreshCw />{i18n.t('核对当前状态')}</Button>
        ) : null}
      </footer>
    </section>
  )
}
