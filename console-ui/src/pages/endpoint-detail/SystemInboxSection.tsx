import { useI18n } from '../../i18n'
import { Bell, ChevronDown, ChevronRight, UserPlus } from 'lucide-react'
import { cn } from '@zhin.js/client'
import type { SidebarSelection } from './types'

interface SystemInboxSectionProps {
  selection: SidebarSelection | null
  requestCount: number
  noticeCount: number
  collapsed: boolean
  onToggle: () => void
  onSelectRequests: () => void
  onSelectNotices: () => void
}

export function SystemInboxSection({
  selection,
  requestCount,
  noticeCount,
  collapsed,
  onToggle,
  onSelectRequests,
  onSelectNotices,
}: SystemInboxSectionProps) {
  const i18n = useI18n()
  const total = requestCount + noticeCount

  return (
    <section className="im-conversation-section im-system-section" aria-label={i18n.t("系统")}>
      <button
        type="button"
        className="im-section-header"
        onClick={onToggle}
        aria-expanded={!collapsed}
      >
        <span className="im-section-chevron" aria-hidden>
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
        </span>
        <span className="im-section-title">{i18n.t("系统")}</span>
        {total > 0 ? <span className="im-section-count-badge">{total}</span> : null}
      </button>
      {!collapsed && (
        <div className="im-section-panel">
          <button
            type="button"
            className={cn('im-system-row', selection?.type === 'requests' && 'active')}
            onClick={onSelectRequests}
          >
            <span className="im-system-icon im-system-icon--request">
              <UserPlus className="h-4 w-4" />
            </span>
            <span className="im-system-label">
              <span className="im-system-title">{i18n.t("请求")}</span>
              <span className="im-system-desc">{i18n.t("好友/群邀请")}</span>
            </span>
            {requestCount > 0 ? (
              <span className="im-conversation-unread">{requestCount}</span>
            ) : null}
          </button>
          <button
            type="button"
            className={cn('im-system-row', selection?.type === 'notices' && 'active')}
            onClick={onSelectNotices}
          >
            <span className="im-system-icon im-system-icon--notice">
              <Bell className="h-4 w-4" />
            </span>
            <span className="im-system-label">
              <span className="im-system-title">{i18n.t("通知")}</span>
              <span className="im-system-desc">{i18n.t("群管/撤回等")}</span>
            </span>
            {noticeCount > 0 ? (
              <span className="im-conversation-unread">{noticeCount}</span>
            ) : null}
          </button>
        </div>
      )}
    </section>
  )
}
