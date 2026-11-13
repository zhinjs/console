import { Bell } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { ATTENTION_PATH } from './attention-model.mjs'
import { useAttention } from './use-attention'
import './attention.css'

/**
 * Top bar entry to 「需要你处理」: a bell with the number of danger + warning items still shown to
 * this viewer. Hidden for callers without status.view.
 */
export function AttentionBadge() {
  const i18n = useI18n()
  const { allowed, badgeCount, active } = useAttention()
  if (!allowed) return null
  const danger = active.some(item => item.severity === 'danger')
  const label = badgeCount > 0 ? i18n.t('需要你处理：{0} 项', [badgeCount]) : i18n.t('需要你处理：没有待办')
  return (
    <Link to={ATTENTION_PATH} className="console-attention-badge" title={label} aria-label={label}>
      <Bell className="h-4 w-4" aria-hidden="true" />
      {badgeCount > 0 ? (
        <span className={cn('console-attention-badge-count', danger && 'is-danger')} aria-hidden="true">
          {badgeCount > 99 ? '99+' : badgeCount}
        </span>
      ) : null}
    </Link>
  )
}
