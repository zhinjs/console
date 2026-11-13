import { AlertCircle, AlertTriangle, ArrowUpRight, BellOff, Info, RotateCcw, Clock } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Button } from '../../components/ui/button'
import { formatAttentionSince, type AttentionItem, type AttentionSeverity } from './attention-model.mjs'

const SEVERITY_ICONS: Record<AttentionSeverity, LucideIcon> = { danger: AlertCircle, warning: AlertTriangle, info: Info }

export function AttentionSeverityIcon({ severity }: { severity: AttentionSeverity }) {
  const Icon = SEVERITY_ICONS[severity]
  return <Icon className={`console-attention-icon is-${severity}`} aria-hidden="true" />
}

/**
 * One item of the /attention page: reason, since, 「去处理」 (deep link), 「稍后提醒」 and 「忽略」 — or
 * 「恢复」 when it was snoozed or ignored.
 */
export function AttentionItemRow({ item, now, hidden, onSnooze, onIgnore, onRestore }: {
  item: AttentionItem
  now: number
  /** Why it is hidden right now (shown with 「恢复」). */
  hidden?: 'snoozed' | 'ignored'
  onSnooze?: (item: AttentionItem) => void
  onIgnore?: (item: AttentionItem) => void
  onRestore?: (id: string) => void
}) {
  const i18n = useI18n()
  const since = formatAttentionSince(item.since, now, i18n.locale)
  return (
    <li className={cn('console-attention-row', `is-${item.severity}`, hidden && 'is-hidden')}>
      <AttentionSeverityIcon severity={item.severity} />
      <div className="console-attention-row-body">
        <p className="console-attention-row-title">{item.title}</p>
        {item.detail ? <p className="console-attention-row-detail">{item.detail}</p> : null}
        <p className="console-attention-row-meta">
          {since && item.since ? <time dateTime={item.since} title={new Date(item.since).toLocaleString(i18n.locale)}>{i18n.t('{0}出现', [since])}</time> : null}
          {hidden === 'snoozed' ? <span>{i18n.t('已推迟 24 小时')}</span> : null}
          {hidden === 'ignored' ? <span>{i18n.t('已忽略，情况变化后会重新出现')}</span> : null}
        </p>
      </div>
      <div className="console-attention-row-actions">
        <Button asChild size="sm">
          <Link to={item.action.path} title={item.action.label || undefined}>
            {i18n.t('去处理')}<ArrowUpRight />
          </Link>
        </Button>
        {hidden ? (
          <Button variant="outline" size="sm" onClick={() => onRestore?.(item.id)}>
            <RotateCcw />{i18n.t('恢复')}
          </Button>
        ) : (
          <>
            <Button variant="outline" size="sm" onClick={() => onSnooze?.(item)} title={i18n.t('24 小时内不再显示')}>
              <Clock />{i18n.t('稍后提醒')}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onIgnore?.(item)} title={i18n.t('情况变化前不再显示')}>
              <BellOff />{i18n.t('忽略')}
            </Button>
          </>
        )}
      </div>
    </li>
  )
}
