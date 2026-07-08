import { Link } from 'react-router-dom'
import { ArrowLeft, Bot, Loader2, RefreshCw, Search, Wifi, WifiOff } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import type { EndpointInfo, SidebarSelection } from './types'
import type { ConversationSection as ConversationSectionType, ConversationSectionId } from './types'
import { ConversationSection } from './ConversationSection'
import { SystemInboxSection } from './SystemInboxSection'

interface ConversationSidebarProps {
  adapter: string
  endpointId: string
  info: EndpointInfo | null
  connected: boolean
  loadErr: string | null
  listLoading: boolean
  listErr: string | null
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
  showChannelList: boolean
  onCloseMobileList?: () => void
}

export function ConversationSidebar({
  adapter,
  endpointId,
  info,
  connected,
  loadErr,
  listLoading,
  listErr,
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
  showChannelList,
  onCloseMobileList,
}: ConversationSidebarProps) {
  const selectionKey =
    selection?.type === 'channel' ? `${selection.channelType}-${selection.id}` : null

  const hasVisibleSections = conversationSections.some((s) => s.entries.length > 0)
  const isSearchEmpty = listSearch.trim() && !hasVisibleSections && !listLoading

  const pickChannel = (entry: ConversationSectionType['entries'][number]) => {
    onSelectChannel(entry)
    onCloseMobileList?.()
  }

  return (
    <div className={cn('channel-sidebar im-sidebar', showChannelList && 'show')}>
      <div className="im-sidebar-header">
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" asChild>
          <Link to="/endpoints" aria-label="返回 Endpoints">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div className="im-sidebar-endpoint">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="im-sidebar-endpoint-icon">
              <Bot className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="font-semibold truncate text-[15px] leading-tight tracking-tight">
                {info?.name || endpointId}
              </p>
              <div className="flex items-center gap-1.5 mt-1">
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0 font-medium h-5">
                  {adapter}
                </Badge>
                <span
                  className={cn(
                    'im-connection-pill',
                    connected ? 'im-connection-pill--on' : 'im-connection-pill--off',
                  )}
                >
                  {connected ? <Wifi size={10} /> : <WifiOff size={10} />}
                  {connected ? '已连接' : '未连接'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {loadErr && (
        <div className="px-3 py-2 border-b border-border/40">
          <p className="text-xs text-destructive leading-relaxed">{loadErr}</p>
        </div>
      )}

      <div className="im-sidebar-search">
        <Search className="im-sidebar-search-icon h-4 w-4" aria-hidden />
        <Input
          value={listSearch}
          onChange={(e) => onListSearchChange(e.target.value)}
          placeholder="搜索会话…"
          className="im-sidebar-search-input h-9 text-sm pl-9 border-0 shadow-none bg-transparent focus-visible:ring-0"
        />
      </div>

      <div className="im-sidebar-list">
        {listLoading && (
          <div className="flex items-center justify-center py-10">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!listLoading && listErr && (
          <p
            className={cn(
              'text-xs px-3 py-2 mb-1 leading-relaxed',
              !hasVisibleSections ? 'text-destructive' : 'text-muted-foreground',
            )}
          >
            {listErr}
          </p>
        )}

        {isSearchEmpty && (
          <p className="text-xs text-muted-foreground px-3 py-8 text-center">
            无匹配「{listSearch.trim()}」
          </p>
        )}

        {!listLoading &&
          conversationSections.map((section) => (
            <ConversationSection
              key={section.id}
              section={section}
              collapsed={sectionCollapsed[section.id] ?? false}
              onToggle={() => onToggleSection(section.id)}
              selectionKey={selectionKey}
              onSelectEntry={pickChannel}
            />
          ))}

        <SystemInboxSection
          selection={selection}
          requestCount={requestCount}
          noticeCount={noticeCount}
          collapsed={systemSectionCollapsed}
          onToggle={onToggleSystemSection}
          onSelectRequests={() => {
            onSelectRequests()
            onCloseMobileList?.()
          }}
          onSelectNotices={() => {
            onSelectNotices()
            onCloseMobileList?.()
          }}
        />
      </div>

      <div className="im-sidebar-footer">
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs h-9 text-muted-foreground hover:text-foreground"
          onClick={onRefresh}
          disabled={listLoading || !connected}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', listLoading && 'animate-spin')} />
          刷新列表
        </Button>
      </div>
    </div>
  )
}
