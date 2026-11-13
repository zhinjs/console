import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { AlertTriangle, CheckCircle2, CircleHelp, Clock, GitCompareArrows, Loader2, MessageSquare, RotateCw, Stethoscope, XCircle } from 'lucide-react'
import { cn } from '@zhin.js/client'
import './status-surfaces.css'
import { useI18n } from '../i18n'
import { Button } from './ui/button'
import { useConsoleAccess } from '../hooks/use-console-access'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { hostRestart, useHostRestartProgress } from '../hooks/use-host-restart'
import { CONSOLE_PATHS } from '../console-routes.mjs'
import {
  APPLY_BASIS_COPY, APPLY_OUTCOME_COPY, RESTART_TIMEOUT_MS, applyOutcomeCopy, applyOutcomeTone, restartElapsedSeconds, restartInProgress,
  type ApplyOutcome, type ReadBackMismatch, type RestartState,
} from './apply-outcome-model.mjs'

export type { ApplyOutcome, ReadBackMismatch } from './apply-outcome-model.mjs'

export interface ApplyFeedbackProps {
  /** What the save did to the running instance (apply-outcome-model). */
  readonly outcome?: ApplyOutcome | null
  /** A fresh read differs from what was submitted: shown instead of any success. */
  readonly mismatch?: ReadBackMismatch | null
  /** The save itself failed: the Host's reason (already translated or Host text). */
  readonly failure?: { readonly title?: string; readonly reason: string } | null
  /** The save succeeded but the read-back failed: the outcome stands, the stored value is unchecked. */
  readonly unverified?: boolean
  /**
   * After 立即重启 brought the instance back: re-read the affected data. May resolve with the outcome
   * the re-read shows (e.g. a config file's application status); anything but applied is shown.
   */
  readonly onRestarted?: () => Promise<ApplyOutcome | null | void> | ApplyOutcome | null | void
  readonly className?: string
}

const OUTCOME_ICONS = { applied: CheckCircle2, 'next-message': MessageSquare, restart: RotateCw, failed: XCircle } as const

function useElapsed(state: RestartState): number {
  const running = restartInProgress(state)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [running])
  return restartElapsedSeconds(state, now)
}

/**
 * The outcome of one save, next to the control that saved: 已生效 / 下一条消息生效 / 需要重启
 * (立即重启 · 稍后) / 未生效 with the reason — or, when the read-back differs, both values instead of
 * success. Used on its own and inside ActionReceipt.
 */
export function ApplyFeedback({ outcome, mismatch, failure, unverified, onRestarted, className }: ApplyFeedbackProps) {
  const i18n = useI18n()
  // A restart that finished before this outcome existed says nothing about it.
  const [since] = useState(() => Date.now())
  if (mismatch) {
    return (
      <div role="alert" data-apply-outcome="mismatch" className={cn('console-apply console-apply--destructive', className)}>
        <GitCompareArrows className="console-apply-icon" aria-hidden="true" />
        <div className="console-apply-text">
          <p className="console-apply-title">{i18n.t('保存后读取到的值与提交的不一致')}</p>
          <p className="console-apply-description">{i18n.t('Host 接受了保存，但重新读取到的内容不是刚才提交的值。请勿当作已保存，核对后重新编辑。')}</p>
          <dl className="console-apply-compare">
            {mismatch.path ? <><dt>{i18n.t('位置')}</dt><dd><code>{mismatch.path}</code></dd></> : null}
            <dt>{i18n.t('提交的值')}</dt><dd><code>{mismatch.submitted ?? i18n.t('（不存在）')}</code></dd>
            <dt>{i18n.t('读取到的值')}</dt><dd><code>{mismatch.readBack ?? i18n.t('（不存在）')}</code></dd>
          </dl>
          {mismatch.masked ? <p className="console-apply-basis">{i18n.t('敏感值已隐藏，只显示长度。')}</p> : null}
        </div>
      </div>
    )
  }
  if (failure) {
    return (
      <div role="alert" data-apply-outcome="save-failed" className={cn('console-apply console-apply--destructive', className)}>
        <XCircle className="console-apply-icon" aria-hidden="true" />
        <div className="console-apply-text">
          <p className="console-apply-title">{failure.title ?? i18n.t('保存失败')}</p>
          <p className="console-apply-description">{failure.reason}</p>
        </div>
      </div>
    )
  }
  if (!outcome) return null
  return <OutcomeView outcome={outcome} since={since} unverified={unverified} onRestarted={onRestarted} className={className} />
}

function OutcomeView({ outcome, since, unverified, onRestarted, className }: { outcome: ApplyOutcome; since: number; unverified?: boolean; onRestarted?: ApplyFeedbackProps['onRestarted']; className?: string }) {
  const i18n = useI18n()
  const restart = useHostRestartProgress()
  const [after, setAfter] = useState<{ startedAt: number; phase: 'refreshing' | 'done'; outcome?: ApplyOutcome | null } | null>(null)
  const handled = useRef<number | null>(null)
  const relevant = restart.phase !== 'idle' && (restartInProgress(restart) || (restart.startedAt ?? 0) >= since)
  const latest = useRef(onRestarted)
  latest.current = onRestarted
  useEffect(() => {
    if (outcome.kind !== 'restart' || !relevant || restart.phase !== 'back' || typeof restart.startedAt !== 'number') return
    if (handled.current === restart.startedAt) return
    const startedAt = restart.startedAt
    handled.current = startedAt
    setAfter({ startedAt, phase: 'refreshing' })
    void Promise.resolve().then(() => latest.current?.()).then(
      value => setAfter({ startedAt, phase: 'done', outcome: value ?? null }),
      () => setAfter({ startedAt, phase: 'done', outcome: null }),
    )
  }, [outcome.kind, relevant, restart.phase, restart.startedAt])

  // After the restart the re-read decides: still not applied is said as such.
  const settled = after && after.phase === 'done' && after.startedAt === restart.startedAt && restart.phase === 'back'
  // Only Host evidence (application groups) can say a restart did not help; a restart flag cannot.
  const shown = settled && after.outcome && after.outcome.basis === 'application' && after.outcome.kind !== 'applied' && after.outcome.kind !== 'next-message' ? after.outcome : outcome
  const restarted = outcome.kind === 'restart' && settled && shown === outcome
  const copy = restarted ? APPLY_OUTCOME_COPY.restarted : applyOutcomeCopy(shown)
  const tone = restarted ? 'success' : applyOutcomeTone(shown)
  const Icon = restarted ? CheckCircle2 : shown.kind === 'failed' && shown.unconfirmed ? CircleHelp : OUTCOME_ICONS[shown.kind]
  return (
    <div role={tone === 'destructive' ? 'alert' : 'status'} aria-live="polite" data-apply-outcome={restarted ? 'restarted' : shown.kind}
      className={cn('console-apply', `console-apply--${tone}`, className)}>
      <Icon className="console-apply-icon" aria-hidden="true" />
      <div className="console-apply-text">
        <p className="console-apply-title">{settled && shown !== outcome ? i18n.t('重启后仍未生效') : copy ? i18n.t(copy.title) : null}</p>
        <p className="console-apply-description">
          {shown.kind === 'restart' && shown.partial && !restarted ? i18n.t('部分修改已生效，其余在重启后生效。') : copy ? i18n.t(copy.description) : null}
        </p>
        {shown.reason ? <p className="console-apply-description">{i18n.t(shown.reason)}</p> : null}
        {shown.groups?.length && !restarted ? (
          <ul className="console-apply-groups">
            {shown.groups.map(group => <li key={group.id}><code>{group.id}</code>{group.reasonCode ? <span> · {group.reasonCode}</span> : null}</li>)}
          </ul>
        ) : null}
        {unverified ? <p className="console-apply-description">{i18n.t('保存后没能重新读取核对，请刷新确认保存的值。')}</p> : null}
        <p className="console-apply-basis">{i18n.t('依据：{0}', [i18n.t(restarted ? APPLY_BASIS_COPY.restart : APPLY_BASIS_COPY[shown.basis])])}</p>
        {outcome.kind === 'restart' && !(settled && shown !== outcome) ? <RestartControls state={restart} relevant={relevant} refreshing={after?.phase === 'refreshing' && after.startedAt === restart.startedAt} /> : null}
      </div>
    </div>
  )
}

/** 立即重启 (with an inline confirmation) · 稍后, then the shared restart's progress. */
function RestartControls({ state, relevant, refreshing }: { state: RestartState; relevant: boolean; refreshing: boolean }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const canRestart = hasConsolePermission('ops.restart', access)
  const [confirming, setConfirming] = useState(false)
  const [later, setLater] = useState(false)
  if (relevant) return <RestartProgressBody state={state} refreshing={refreshing} />
  if (!canRestart) {
    return <p className="console-apply-description">{i18n.t('当前身份没有重启权限（ops.restart）。请让管理员重启，或在 Host 上运行 zhin restart。')}</p>
  }
  if (later) {
    return <div className="console-apply-actions">
      <span className="console-apply-basis">{i18n.t('已选择稍后重启；重启前仍使用旧值。')}</span>
      <Button size="sm" variant="ghost" onClick={() => setLater(false)}>{i18n.t('现在重启')}</Button>
    </div>
  }
  if (confirming) {
    return <div className="console-apply-actions" role="group" aria-label={i18n.t('确认重启')}>
      <span className="console-apply-basis">{i18n.t('重启会断开所有连接，进行中的对话可能被中止。')}</span>
      <Button size="sm" variant="outline" onClick={() => setConfirming(false)} autoFocus>{i18n.t('取消')}</Button>
      <Button size="sm" variant="destructive" onClick={() => { setConfirming(false); void hostRestart.start() }}><RotateCw />{i18n.t('确认重启')}</Button>
    </div>
  }
  return <div className="console-apply-actions">
    <Button size="sm" onClick={() => setConfirming(true)}><RotateCw />{i18n.t('立即重启')}</Button>
    <Button size="sm" variant="outline" onClick={() => setLater(true)}>{i18n.t('稍后')}</Button>
  </div>
}

function RestartProgressBody({ state, refreshing }: { state: RestartState; refreshing?: boolean }) {
  const i18n = useI18n()
  const elapsed = useElapsed(state)
  if (state.phase === 'requesting' || state.phase === 'waiting') {
    return <div className="console-apply-progress" role="status" aria-live="polite" data-restart-phase={state.phase}>
      <Loader2 className="animate-spin" aria-hidden="true" />
      <span>{state.phase === 'requesting' ? i18n.t('正在发送重启请求…') : i18n.t('正在重启，等待实例恢复…')}</span>
      <span className="console-apply-elapsed"><Clock aria-hidden="true" />{i18n.t('已等待 {0} 秒', [elapsed])}</span>
    </div>
  }
  if (state.phase === 'back') {
    return <div className="console-apply-progress" role="status" data-restart-phase="back">
      {refreshing ? <Loader2 className="animate-spin" aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
      <span>{refreshing ? i18n.t('实例已恢复，正在重新读取…') : i18n.t('实例已恢复（用时 {0} 秒）。', [elapsed])}</span>
    </div>
  }
  if (state.phase === 'failed') {
    return <div className="console-apply-progress" role="alert" data-restart-phase="failed">
      <XCircle aria-hidden="true" />
      <span>{i18n.t('重启请求没有被执行：{0}', [state.reason || i18n.t('Host 拒绝了请求')])}</span>
      <Button size="sm" variant="ghost" onClick={() => hostRestart.dismiss()}>{i18n.t('关闭')}</Button>
    </div>
  }
  if (state.phase === 'timeout') {
    return <div className="console-apply-timeout" role="alert" data-restart-phase="timeout">
      <p className="console-apply-title"><AlertTriangle aria-hidden="true" />{i18n.t('{0} 秒内没有确认实例恢复', [Math.round(RESTART_TIMEOUT_MS / 1000)])}</p>
      <ul>
        <li>{i18n.t('在「实例」页查看状态与最近的日志。')}</li>
        <li>{i18n.t('在 Host 上运行 zhin status 与 zhin logs 查看进程是否在运行。')}</li>
        <li>{i18n.t('以 --once 或自定义启动器运行时，进程不会自动重新启动，需要手动启动。')}</li>
      </ul>
      <div className="console-apply-actions">
        <Button asChild size="sm" variant="outline"><Link to={CONSOLE_PATHS.opsInstance}>{i18n.t('查看实例与日志')}</Link></Button>
        <Button asChild size="sm" variant="ghost"><Link to={CONSOLE_PATHS.opsSelfCheck}><Stethoscope />{i18n.t('连接自检')}</Link></Button>
        <Button size="sm" variant="ghost" onClick={() => hostRestart.keepWaiting()}>{i18n.t('继续等待')}</Button>
      </div>
    </div>
  }
  return null
}

/**
 * The shared restart's progress on its own (首页 and 环境变量's 重启 button): renders nothing while
 * idle, then 正在重启 + elapsed time, 已重启 or what to check after a timeout.
 */
export function RestartProgress({ className, onRestarted }: { className?: string; onRestarted?: () => void }) {
  const state = useHostRestartProgress()
  const handled = useRef<number | null>(null)
  const latest = useRef(onRestarted)
  latest.current = onRestarted
  // Once the instance is back, the page re-reads what the restart changed.
  useEffect(() => {
    if (state.phase !== 'back' || typeof state.startedAt !== 'number' || handled.current === state.startedAt) return
    handled.current = state.startedAt
    latest.current?.()
  }, [state.phase, state.startedAt])
  if (state.phase === 'idle') return null
  return <div className={cn('console-apply console-apply--muted', className)} data-apply-outcome="restart-progress">
    <RotateCw className="console-apply-icon" aria-hidden="true" />
    <div className="console-apply-text">
      <RestartProgressBody state={state} />
      {state.phase === 'back' ? <div className="console-apply-actions"><RestartDismiss /></div> : null}
    </div>
  </div>
}

function RestartDismiss() {
  const i18n = useI18n()
  return <Button size="sm" variant="ghost" onClick={() => hostRestart.dismiss()}>{i18n.t('关闭')}</Button>
}
