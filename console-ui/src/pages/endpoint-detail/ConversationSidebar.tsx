import { useI18n } from '../../i18n'
import type { ConversationListNotice } from './conversation-list-notice.mjs'
import { Loader2, RefreshCw, Search } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import type { SidebarSelection } from './types'
import type { ConversationSection as ConversationSectionType, ConversationSectionId } from './types'
import { ConversationSection } from './ConversationSection'
import { SystemInboxSection } from './SystemInboxSection'

interface ConversationSidebarProps {
  loadErr: string | null
  listLoading: boolean
  listNotice: ConversationListNotice | null
  listSearch: string
  onListSearchChange: (value: string) => void
  conversationSections: ConversationSectionType[]
  sectionCollapsed: Record<ConversationSectionId, boolean>
  systemSectionCollapsed: boolean
  onToggleSection: (id: ConversationSectionId) => void
  onToggleSystemSection: () => void
  selection: SidebarSelection | null
  onSelectChannel: (entry: ConversationSectionType['entries'][number]) => void
  onSelectRequests: () => void
  onSelectNotices: () => void
  requestCount: number
  noticeCount: number
  onRefresh: () => void
}

/**
 * The account chat's conversation list — the only full one (概览 shows a summary). On a phone it is
 * the first pane and fills the workspace; picking a conversation opens the chat pane (and writes the
 * URL, so back returns here). Account switching and the connection test live in the page header and
 * the 接入 tab, not here.
 */
export function ConversationSidebar({
  loadErr,
  listLoading,
  listNotice,
  listSearch,
  onListSearchChange,
  conversationSections,
  sectionCollapsed,
  systemSectionCollapsed,
  onToggleSection,
  onToggleSystemSection,
  selection,
  onSelectChannel,
  onSelectRequests,
  onSelectNotices,
  requestCount,
  noticeCount,
  onRefresh,
}: ConversationSidebarProps) {
  const i18n = useI18n()
  const selectionKey =
    selection?.type === 'channel' ? `${selection.channelType}-${selection.id}` : null

  const total = conversationSections.reduce((sum, section) => sum + section.entries.length, 0)
  const hasVisibleSections = total > 0
  const isSearchEmpty = listSearch.trim() && !hasVisibleSections && !listLoading && listNotice?.tone !== 'error'

  return (
    <nav className="channel-sidebar im-sidebar" aria-label={i18n.t('会话列表')}>
      <div className="im-sidebar-header">
        <h2 className="im-sidebar-title">
          {i18n.t('会话')}
          {!listLoading ? <span className="im-sidebar-count">{total}</span> : null}
        </h2>
        <Button variant="ghost" size="icon" className="im-header-icon-button h-8 w-8" onClick={onRefresh} disabled={listLoading}
          aria-label={i18n.t('刷新列表')} title={i18n.t('刷新列表')}>
          <RefreshCw className={cn('h-4 w-4', listLoading && 'animate-spin')} />
        </Button>
      </div>

      <div className="im-sidebar-search">
        <Search className="im-sidebar-search-icon h-4 w-4" aria-hidden />
        <Input
          value={listSearch}
          onChange={(e) => onListSearchChange(e.target.value)}
          aria-label={i18n.t("搜索会话")}
          placeholder={i18n.t("搜索会话名称或 ID")}
          className="im-sidebar-search-input h-9 text-sm pl-9 border-0 shadow-none bg-transparent focus-visible:ring-0"
        />
      </div>

      {loadErr && (
        <p className="im-sidebar-notice text-destructive" role="alert">{i18n.t('读取账号状态失败：{0}', [loadErr])}</p>
      )}

      <div className="im-sidebar-list">
        {listLoading && (
          <div className="flex items-center justify-center py-10" role="status" aria-label={i18n.t('正在读取会话')}>
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!listLoading && listNotice && (
          <div className="px-3 py-2 mb-1 text-xs leading-relaxed" role={listNotice.tone === 'error' ? 'alert' : 'status'}>
            <p className={listNotice.tone === 'error' ? 'text-destructive' : listNotice.tone === 'warning' ? 'text-warning' : 'text-muted-foreground'}>{listNotice.text}</p>
            {listNotice.details && <details className="mt-2 text-muted-foreground"><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><p className="mt-2 break-words">{listNotice.details}</p></details>}
          </div>
        )}

        {isSearchEmpty && (
          <p className="text-xs text-muted-foreground px-3 py-8 text-center">
            {i18n.t("无匹配「")}{listSearch.trim()}」
          </p>
        )}

        {!listLoading &&
          conversationSections.map((section) => (
            <ConversationSection
              key={section.id}
              section={section}
              suppressEmpty={!!listNotice}
              collapsed={sectionCollapsed[section.id] ?? false}
              onToggle={() => onToggleSection(section.id)}
              selectionKey={selectionKey}
              onSelectEntry={onSelectChannel}
            />
          ))}

        <SystemInboxSection
          selection={selection}
          requestCount={requestCount}
          noticeCount={noticeCount}
          collapsed={systemSectionCollapsed}
          onToggle={onToggleSystemSection}
          onSelectRequests={onSelectRequests}
          onSelectNotices={onSelectNotices}
        />
      </div>
    </nav>
  )
}
