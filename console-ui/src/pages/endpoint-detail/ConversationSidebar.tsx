import { useI18n } from '../../i18n'
import { AccountSwitcher } from './AccountSwitcher'
import { useEffect, useRef, type KeyboardEvent } from 'react'
import { useIsMobile } from '../../hooks/useIsMobile'
import type { ConversationListNotice } from './conversation-list-notice.mjs'
import { Link } from 'react-router-dom'
import { ArrowLeft, CheckCircle2, Loader2, RefreshCw, Search, Wifi, X, XCircle } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import type { EndpointInfo, SidebarSelection } from './types'
import type { ConversationSection as ConversationSectionType, ConversationSectionId } from './types'
import { ConversationSection } from './ConversationSection'
import { SystemInboxSection } from './SystemInboxSection'
import { endpointTestPresentation, type EndpointTestResult } from '../endpoint-test-result-model.mjs'

interface ConversationSidebarProps {
  adapter: string
  endpointId: string
  info: EndpointInfo | null
  loadErr: string | null
  testLoading: boolean
  testMessage: EndpointTestResult | null
  onTest: () => void
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
  showChannelList: boolean
  onCloseMobileList?: () => void
  hasDraft?: boolean
  sending?: boolean
}

export function ConversationSidebar({
  adapter,
  endpointId,
  info,
  loadErr,
  testLoading,
  testMessage,
  onTest,
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
  showChannelList,
  onCloseMobileList,
  hasDraft,
  sending,
}: ConversationSidebarProps) {
  const i18n = useI18n()
  const isMobile = useIsMobile()
  const sidebarRef = useRef<HTMLDivElement>(null)
  const mobileDialog = isMobile && !!onCloseMobileList
  const testPresentation = testMessage ? endpointTestPresentation(testMessage, i18n.locale) : null
  useEffect(() => {
    if (!mobileDialog || !showChannelList) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    sidebarRef.current?.querySelector<HTMLElement>('button, a, input')?.focus()
    return () => { if (previous?.isConnected && !previous.closest('[inert]')) previous.focus() }
  }, [mobileDialog, showChannelList])

  const onDrawerKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!mobileDialog || !showChannelList || event.defaultPrevented || event.nativeEvent.isComposing) return
    if (event.key === 'Escape') { event.preventDefault(); onCloseMobileList?.(); return }
    if (event.key !== 'Tab') return
    const targets = [...event.currentTarget.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], input:not([disabled])')]
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0)
    const first = targets[0], last = targets.at(-1)
    if (event.shiftKey && document.activeElement === first && last) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last && first) { event.preventDefault(); first.focus() }
  }
  const selectionKey =
    selection?.type === 'channel' ? `${selection.channelType}-${selection.id}` : null

  const hasVisibleSections = conversationSections.some((s) => s.entries.length > 0)
  const isSearchEmpty = listSearch.trim() && !hasVisibleSections && !listLoading && listNotice?.tone !== 'error'

  const pickChannel = (entry: ConversationSectionType['entries'][number]) => {
    onSelectChannel(entry)
    onCloseMobileList?.()
  }

  return (
    <div className={cn('channel-sidebar im-sidebar', showChannelList && 'show')} ref={sidebarRef}
      role={mobileDialog ? 'dialog' : undefined} aria-modal={mobileDialog && showChannelList ? true : undefined}
      aria-label={mobileDialog ? i18n.t('会话列表') : undefined} aria-hidden={isMobile && !showChannelList}
      inert={isMobile && !showChannelList} onKeyDown={onDrawerKeyDown}>
      <div className="im-sidebar-header">
        <Button variant="ghost" size="icon" className="shrink-0" asChild>
          <Link to="/endpoints" aria-label={i18n.t("返回聊天账号")}>
            <ArrowLeft />
          </Link>
        </Button>
        <AccountSwitcher adapter={adapter} endpointId={endpointId} info={info} loadErr={loadErr} hasDraft={hasDraft} sending={sending} onBeforeLeave={isMobile ? onCloseMobileList : undefined} />
        {isMobile && onCloseMobileList && <Button type="button" variant="ghost" size="icon" className="shrink-0" onClick={onCloseMobileList} aria-label={i18n.t('关闭会话列表')}><X className="h-4 w-4" /></Button>}
      </div>

      {loadErr && (
        <div className="px-3 py-2 border-b border-border/40">
          <p className="text-xs text-destructive leading-relaxed">{loadErr}</p>
        </div>
      )}
      {testPresentation && (
        <div
          role={testPresentation.role}
          className={cn(
            'flex items-start gap-1.5 px-3 py-2 border-b border-border/40 text-xs leading-relaxed',
            testPresentation.tone === 'success' ? 'text-success bg-success/5' : 'text-destructive bg-destructive/5',
          )}
        >
          {testPresentation.tone === 'success'
            ? <CheckCircle2 className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />
            : <XCircle className="h-3.5 w-3.5 mt-0.5 shrink-0" aria-hidden="true" />}
          <p className="min-w-0 break-words">
            <span className="font-medium">{testPresentation.label}</span>
            {testPresentation.detail ? <span>{' · '}{testPresentation.detail}</span> : null}
          </p>
        </div>
      )}

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

      <div className="im-sidebar-list">
        {listLoading && (
          <div className="flex items-center justify-center py-10">
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
          onClick={onTest}
          disabled={testLoading}
        >
          {testLoading ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <Wifi className="h-3.5 w-3.5 mr-1.5" />}
          {testLoading ? i18n.t("测试中…") : i18n.t("测试连接")}</Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-xs h-9 text-muted-foreground hover:text-foreground"
          onClick={onRefresh}
          disabled={listLoading}
        >
          <RefreshCw className={cn('h-3.5 w-3.5 mr-1.5', listLoading && 'animate-spin')} />
          {i18n.t("刷新列表")}</Button>
      </div>
    </div>
  )
}
