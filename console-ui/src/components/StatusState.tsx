import { useEffect, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertCircle, CircleHelp, DatabaseZap, Hourglass, Inbox, Loader2, Lock, PackageX, PlugZap, RefreshCw, ServerOff, Settings2, ShieldOff, Sparkles, GitCompareArrows, Stethoscope,
  type LucideIcon,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import './status-surfaces.css'
import { useI18n } from '../i18n'
import { Button } from './ui/button'
import {
  LOCK_LEVEL_LABELS, SLOW_LOADING_COPY, SLOW_LOADING_MS, STATUS_COPY, loadingSeconds, statusFromError, statusTone, type StatusKind, type StatusReading,
} from './status-state-model.mjs'
import { CONSOLE_PATHS } from '../console-routes.mjs'

const ICONS: Record<StatusKind, LucideIcon> = {
  loading: Loader2,
  unknown: CircleHelp,
  forbidden: ShieldOff,
  'not-installed': PackageX,
  unsupported: Sparkles,
  empty: Inbox,
  locked: Lock,
  conflict: GitCompareArrows,
  'database-busy': DatabaseZap,
  'instance-unavailable': ServerOff,
  'needs-configuration': Settings2,
  disconnected: PlugZap,
  error: AlertCircle,
}

export interface StatusStateProps {
  /** The situation; or pass `error` and let it be classified. */
  readonly kind?: StatusKind
  /** A failed request (ConsoleTransportError, Error, Host body or text); classified with `statusFromError`. */
  readonly error?: unknown
  /** Overrides the standard title / description (authored copy, already translated). */
  readonly title?: string
  readonly description?: string
  /** Missing permission names for `forbidden` (shown as code). */
  readonly permissions?: readonly string[]
  /** Level that disabled the feature, for `locked` (else read from `error`). */
  readonly lockedBy?: 'global' | 'adapter' | 'endpoint'
  /** Where the lock can be lifted. */
  readonly lockHref?: string
  /** Retry handler: shown for retryable kinds. Never offered for `unknown` (verify instead). */
  readonly onRetry?: () => void
  /** Read-only re-check for `unknown`: reads the current state, never replays the write. */
  readonly onVerify?: () => void
  /** Extra actions (links) after the standard ones. */
  readonly actions?: ReactNode
  /** Inline (inside a card or table) instead of a full panel. */
  readonly compact?: boolean
  readonly className?: string
  /**
   * `loading`: what to show while the read is young (a skeleton of the content); after
   * SLOW_LOADING_MS it gives way to 「仍在加载…」 with the likely causes, 重试 and the self-check.
   */
  readonly placeholder?: ReactNode
  /** `loading`: when the read started (default: when this state appeared). */
  readonly since?: number
}

const RETRYABLE: ReadonlySet<StatusKind> = new Set(['error', 'database-busy', 'disconnected', 'instance-unavailable', 'conflict', 'unsupported'])

/**
 * The one way to say why there is nothing to show (Console 重构规范 §空态与错误态):
 * 未知 / 无权限 / 未安装 / 无数据 / 已锁定 / 修订冲突 / 数据库忙 / 实例不可用 / 需要配置 / 断连 / 失败.
 */
export function StatusState(props: StatusStateProps) {
  if (props.kind === 'loading') return <LoadingState {...props} />
  return <SettledState {...props} />
}

/**
 * 读取中: the placeholder (or a short line) first; after SLOW_LOADING_MS 「仍在加载…」 with the likely
 * causes — gateway down, WebSocket / event stream blocked, reverse-proxy path — 重试 and 连接自检.
 */
function LoadingState({ title, description, onRetry, actions, compact, className, placeholder, since }: StatusStateProps) {
  const i18n = useI18n()
  const [started] = useState(() => since ?? Date.now())
  const [now, setNow] = useState(() => Date.now())
  const slow = now - started >= SLOW_LOADING_MS
  useEffect(() => {
    const wait = Math.max(0, started + SLOW_LOADING_MS - Date.now())
    // Until slow: one timer at the threshold; then a once-a-second count of the seconds waited.
    const timer = slow ? window.setInterval(() => setNow(Date.now()), 1000) : window.setTimeout(() => setNow(Date.now()), wait)
    return () => { window.clearInterval(timer); window.clearTimeout(timer) }
  }, [started, slow])
  if (!slow) {
    if (placeholder !== undefined) return <div role="status" aria-busy="true" aria-label={title ?? i18n.t(STATUS_COPY.loading.title)} data-status-kind="loading" className={className}>{placeholder}</div>
    return (
      <div role="status" aria-busy="true" data-status-kind="loading"
        className={cn('console-status-state console-status-state--muted console-status-state--loading', compact && 'console-status-state--compact', className)}>
        <Loader2 className="console-status-state-icon animate-spin" aria-hidden="true" />
        <div className="console-status-state-text">
          <p className="console-status-state-title">{title ?? i18n.t(STATUS_COPY.loading.title)}</p>
          {description ? <p className="console-status-state-description">{description}</p> : null}
        </div>
      </div>
    )
  }
  return (
    <div role="status" aria-live="polite" data-status-kind="loading" data-loading-slow="true"
      className={cn('console-status-state console-status-state--warning', compact && 'console-status-state--compact', className)}>
      <Hourglass className="console-status-state-icon" aria-hidden="true" />
      <div className="console-status-state-text">
        <p className="console-status-state-title">{i18n.t(SLOW_LOADING_COPY.title)}{title ? <span className="console-status-state-subject"> · {title}</span> : null}</p>
        <p className="console-status-state-description">{i18n.t(SLOW_LOADING_COPY.description, [loadingSeconds(started, now)])}</p>
        <ul className="console-status-state-causes">
          {SLOW_LOADING_COPY.causes.map(cause => <li key={cause}>{i18n.t(cause)}</li>)}
        </ul>
        <div className="console-status-state-actions">
          {onRetry ? <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw />{i18n.t('重试')}</Button> : null}
          <Button asChild size="sm" variant="outline"><Link to={CONSOLE_PATHS.opsSelfCheck}><Stethoscope />{i18n.t('运行连接自检')}</Link></Button>
          {actions}
        </div>
      </div>
    </div>
  )
}

function SettledState({
  kind, error, title, description, permissions, lockedBy, lockHref, onRetry, onVerify, actions, compact, className,
}: StatusStateProps) {
  const i18n = useI18n()
  const reading: StatusReading | null = error !== undefined && error !== null ? statusFromError(error) : null
  const resolved: StatusKind = kind ?? reading?.kind ?? 'empty'
  const copy = STATUS_COPY[resolved]
  const Icon = ICONS[resolved]
  const tone = statusTone(resolved)
  const lock = lockedBy ?? reading?.lockedBy
  const detail = reading?.message && reading.message !== title ? reading.message : undefined
  let body = description ?? i18n.t(copy.description)
  if (!description && resolved === 'locked' && lock) body = i18n.t('已在{0}层禁用，这一层不能修改。', [i18n.t(LOCK_LEVEL_LABELS[lock])])
  if (!description && (resolved === 'database-busy' || resolved === 'instance-unavailable') && reading?.retryAfterSeconds) {
    body = `${body} ${i18n.t('建议 {0} 秒后重试。', [reading.retryAfterSeconds])}`
  }
  const retry = onRetry && RETRYABLE.has(resolved) ? onRetry : undefined
  return (
    <div
      role={tone === 'destructive' ? 'alert' : 'status'}
      data-status-kind={resolved}
      className={cn('console-status-state', `console-status-state--${tone}`, compact && 'console-status-state--compact', className)}
    >
      <Icon className="console-status-state-icon" aria-hidden="true" />
      <div className="console-status-state-text">
        <p className="console-status-state-title">{title ?? i18n.t(copy.title)}</p>
        <p className="console-status-state-description">{body}</p>
        {resolved === 'forbidden' && permissions?.length ? (
          <p className="console-status-state-description">
            {i18n.t('需要以下任一权限：')}{' '}
            {permissions.map((name, index) => <span key={name}>{index ? '、' : ''}<code>{name}</code></span>)}
          </p>
        ) : null}
        {resolved === 'needs-configuration' && reading?.missingEnv?.length ? (
          <p className="console-status-state-description">{i18n.t('缺少环境变量：')} <code>{reading.missingEnv.join(', ')}</code></p>
        ) : null}
        {detail && resolved !== 'empty' ? (
          <details className="console-status-state-detail">
            <summary>{i18n.t('技术详情')}</summary>
            <pre>{reading?.serverCode ? `${reading.serverCode}: ` : ''}{detail}</pre>
          </details>
        ) : null}
        {retry || onVerify || actions || (resolved === 'locked' && lockHref) || resolved === 'instance-unavailable' ? (
          <div className="console-status-state-actions">
            {resolved === 'unknown' && onVerify ? <Button size="sm" variant="outline" onClick={onVerify}><RefreshCw />{i18n.t('核对当前状态')}</Button> : null}
            {retry ? <Button size="sm" variant="outline" onClick={retry}><RefreshCw />{i18n.t('重试')}</Button> : null}
            {resolved === 'locked' && lockHref ? <Button asChild size="sm" variant="outline"><Link to={lockHref}><Lock />{i18n.t('查看上级设置')}</Link></Button> : null}
            {resolved === 'instance-unavailable' ? <Button asChild size="sm" variant="outline"><Link to="/ops/instance"><ServerOff />{i18n.t('查看实例')}</Link></Button> : null}
            {actions}
          </div>
        ) : null}
      </div>
    </div>
  )
}
