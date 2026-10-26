import { translate } from '../../i18n/locale.mjs'
import { useI18n } from '../../i18n'
import type * as React from 'react'
import { Fragment, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Bell,
  Check,
  Code2,
  Crown,
  FileText,
  Forward,
  Image,
  Loader2,
  MessageSquare,
  Music,
  Paperclip,
  Quote,
  Search,
  Send,
  Shield,
  Smile,
  User,
  UserMinus,
  UserPlus,
  Video,
  X,
  GitBranch,
} from 'lucide-react'
import { agentSessionsPath, buildSessionKey } from '../../utils/agent-session'
import { cn } from '@zhin.js/client'
import { useConfirm } from '../../components/confirm-dialog'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../../components/ui/tabs'
import { ConversationSidebar } from './ConversationSidebar'
import { ChatMessageRow, type MessageDraftReference } from './ChatMessageRow'
import { MessageDiagnosticsAction, MessageDiagnosticsProvider } from './MessageDiagnostics'
import { canShowReadEmpty } from './endpoint-request.mjs'
import { useEndpointConsole } from './useEndpointConsole'
import {
  hasRenderableComposerSegments,
  parseComposerToSegments,
  type MessageContent,
} from '../../utils/parseComposerContent'
import { dayKey, dayLabel } from './date-utils'
import { ENDPOINT_RPC } from '../../contracts/zhin-console'
import { isDemoMode } from '../../utils/demo-mode'
import type { GroupAction } from './useGroupActions'

type ComposerMode = 'plain' | 'markdown'

type ComposerAttachment = {
  id: string
  type: 'image' | 'video' | 'audio' | 'file'
  url: string
  name: string
  source: 'local' | 'url'
}

function createAttachmentId(type: ComposerAttachment['type']) {
  return `${type}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function memberRoleOf(member: Record<string, unknown>): string {
  return String(member.role ?? member.permission ?? member.level ?? 'member')
}

function memberRoleLabel(role: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  if (role === 'owner' || role === 'leader') return translate(locale, "群主")
  if (role === 'admin' || role === 'administrator') return translate(locale, "管理")
  return translate(locale, "成员")
}

function memberInitials(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) return 'U'
  const chars = Array.from(trimmed)
  return chars.slice(0, 2).join('').toUpperCase()
}

export default function EndpointDetailPage() {
  const i18n = useI18n()
  const ctx = useEndpointConsole()
  const readOnly = isDemoMode()

  if (!ctx.valid) {
    return (
      <div className="p-4">
        <Alert>
          <AlertDescription>{i18n.t("参数无效")}</AlertDescription>
        </Alert>
      </div>
    )
  }

  const {
    adapter,
    endpointId,
    info,
    loadErr,
    actionError,
    testLoading,
    testMessage,
    testEndpoint,
    msgContent,
    setMsgContent,
    sending,
    listLoading,
    listNotice,
    selection,
    setSelection,
    showChannelList,
    setShowChannelList,
    listSearch,
    setListSearch,
    conversationSections,
    sectionCollapsed,
    systemSectionCollapsed,
    toggleSection,
    toggleSystemSection,
    members,
    membersLoading,
    channelMessages,
    inboxMessagesLoading,
    inboxMessagesError,
    inboxMessagesHasMore,
    inboxMessagesEnabled,
    loadInboxMessages,
    inboxMessages,
    requestList,
    requestsLoading,
    requestsError,
    requestsAvailable,
    noticeList,
    noticesLoading,
    noticesError,
    noticesAvailable,
    inboxRequestsError,
    inboxNoticesError,
    requestsTab,
    setRequestsTab,
    noticesTab,
    setNoticesTab,
    inboxRequests,
    inboxRequestsLoading,
    inboxRequestsHasMore,
    inboxRequestsEnabled,
    loadInboxRequests,
    inboxNotices,
    inboxNoticesLoading,
    inboxNoticesHasMore,
    inboxNoticesEnabled,
    loadInboxNotices,
    deleteFriend,
    handleSend,
    approve,
    dismissRequest,
    dismissNotice,
    loadMembers,
    groupAction,
    loadLists,
    loadRequestsFromServer,
    refreshNotices,
    getChannelIcon,
    showRightPanel,
  } = ctx

  const [mediaPanel, setMediaPanel] = useState<null | 'image' | 'video' | 'audio'>(null)
  const [mediaUrl, setMediaUrl] = useState('')
  const [composerMode, setComposerMode] = useState<ComposerMode>('plain')
  const [composerAttachments, setComposerAttachments] = useState<ComposerAttachment[]>([])
  const [quoteDraft, setQuoteDraft] = useState<MessageDraftReference | null>(null)
  const [forwardDraft, setForwardDraft] = useState<MessageDraftReference | null>(null)
  const [memberSearch, setMemberSearch] = useState('')
  const [memberRoleFilter, setMemberRoleFilter] = useState<'all' | 'owner' | 'admin' | 'member'>('all')
  const { confirm, ConfirmDialog: ConfirmDialogHost } = useConfirm()
  const imageFileRef = useRef<HTMLInputElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const handleDeleteFriend = async () => {
    if (selection?.type !== 'channel' || selection.channelType !== 'private') return
    const ok = await confirm({
      title: i18n.t("删除好友"),
      description: i18n.t("确定删除好友「{0}」？此操作不可撤销。", [selection.name]),
      confirmLabel: i18n.t("删除"),
      variant: 'destructive',
    })
    if (ok) await deleteFriend()
  }

  const handleGroupAction = async (
    type: GroupAction,
    userId: number | string,
    memberName: string,
    extra?: { enable?: boolean },
  ) => {
    const prompts: Record<typeof type, { title: string; description: string; destructive?: boolean }> = {
      [ENDPOINT_RPC.GROUP_KICK]: {
        title: i18n.t("踢出群成员"),
        description: i18n.t("确定将「{0}」踢出群聊？", [memberName]),
        destructive: true,
      },
      [ENDPOINT_RPC.GROUP_MUTE]: {
        title: i18n.t("禁言成员"),
        description: i18n.t("确定禁言「{0}」？", [memberName]),
      },
      [ENDPOINT_RPC.GROUP_ADMIN]: {
        title: i18n.t("设为管理员"),
        description: i18n.t("确定将「{0}」设为群管理员？", [memberName]),
      },
    }
    const prompt = prompts[type]
    const ok = await confirm({
      title: prompt.title,
      description: prompt.description,
      confirmLabel: i18n.t("确定"),
      variant: prompt.destructive ? 'destructive' : 'default',
    })
    if (ok) await groupAction(type, userId, extra)
  }

  const appendComposerToken = (token: string) => {
    setMsgContent((c) => {
      if (!c) return token
      const needsSpace = !/\s$/.test(c) && !/^[\s[,]/.test(token)
      return c + (needsSpace ? ' ' : '') + token
    })
  }

  const commitMediaUrl = () => {
    const u = mediaUrl.trim()
    if (!u || !mediaPanel) return
    setComposerAttachments((prev) => [
      ...prev,
      {
        id: createAttachmentId(mediaPanel),
        type: mediaPanel,
        url: u,
        name: mediaPanel === 'image' ? i18n.t("图片链接") : mediaPanel === 'video' ? i18n.t("视频链接") : i18n.t("音频链接"),
        source: 'url',
      },
    ])
    setMediaUrl('')
    setMediaPanel(null)
  }

  const onPickImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f?.type.startsWith('image/')) return
    const r = new FileReader()
    r.onload = () => {
      const dataUrl = String(r.result || '')
      if (dataUrl) {
        setComposerAttachments((prev) => [
          ...prev,
          {
            id: createAttachmentId('image'),
            type: 'image',
            url: dataUrl,
            name: f.name || i18n.t("本地图片"),
            source: 'local',
          },
        ])
      }
    }
    r.readAsDataURL(f)
  }

  const onPickFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    const r = new FileReader()
    r.onload = () => {
      const dataUrl = String(r.result || '')
      if (dataUrl) {
        setComposerAttachments((prev) => [
          ...prev,
          {
            id: createAttachmentId('file'),
            type: 'file',
            url: dataUrl,
            name: f.name || i18n.t("本地文件"),
            source: 'local',
          },
        ])
      }
    }
    r.readAsDataURL(f)
  }

  const removeAttachment = (id: string) => {
    setComposerAttachments((prev) => prev.filter((item) => item.id !== id))
  }

  const clearMessageDrafts = () => {
    setQuoteDraft(null)
    setForwardDraft(null)
  }

  const buildComposerSegments = (): MessageContent => {
    const baseSegments: MessageContent =
      composerMode === 'markdown'
        ? msgContent.trim()
          ? [{ type: 'markdown', data: { text: msgContent } }]
          : []
        : hasRenderableComposerSegments(parseComposerToSegments(msgContent))
          ? parseComposerToSegments(msgContent)
          : []

    const attachmentSegments: MessageContent = composerAttachments.map((item) => ({
      type: item.type,
      data: {
        url: item.url,
        name: item.name,
        source: item.source,
      },
    }))

    return [...baseSegments, ...attachmentSegments]
  }

  const handleSendWithDrafts = () => {
    const overrideSegments = buildComposerSegments()
    const displayPrefixSegments =
      quoteDraft != null
        ? [
            {
              type: 'quote',
              data: {
                id: quoteDraft.id,
                senderName: quoteDraft.senderName,
                summary: quoteDraft.summary,
              },
            },
          ]
        : forwardDraft != null
          ? [
              {
                type: 'forward',
                data: {
                  id: forwardDraft.id,
                  senderName: forwardDraft.senderName,
                  summary: forwardDraft.summary,
                },
              },
            ]
          : undefined

    const textPrefix =
      quoteDraft != null
        ? i18n.t("引用 {0}: {1}", [quoteDraft.senderName, quoteDraft.summary])
        : forwardDraft != null
          ? i18n.t("转发 {0}: {1}", [forwardDraft.senderName, forwardDraft.summary])
          : undefined

    void handleSend({
      overrideSegments,
      displayPrefixSegments,
      textPrefix,
      onSent: () => {
        clearMessageDrafts()
        setComposerAttachments([])
        setMediaPanel(null)
        setMediaUrl('')
      },
    })
  }

  const composerSegments = buildComposerSegments()
  const canSend =
    !readOnly &&
    !sending &&
    (hasRenderableComposerSegments(composerSegments) || quoteDraft != null || forwardDraft != null)

  const normalizedMembers = members.map((m, i) => {
    const record = m as Record<string, unknown>
    const uid = String(m.user_id ?? record.id ?? i)
    const name = String(m.nickname ?? record.name ?? record.card ?? uid)
    const role = memberRoleOf(record)
    return { raw: m, uid, name, role, index: i }
  })
  const roleFilterValue = (role: string): 'owner' | 'admin' | 'member' => {
    if (role === 'owner' || role === 'leader') return 'owner'
    if (role === 'admin' || role === 'administrator') return 'admin'
    return 'member'
  }
  const filteredMembers = normalizedMembers.filter((m) => {
    const q = memberSearch.trim().toLowerCase()
    const matchText = !q || `${m.uid} ${m.name} ${m.role}`.toLowerCase().includes(q)
    const matchRole = memberRoleFilter === 'all' || roleFilterValue(m.role) === memberRoleFilter
    return matchText && matchRole
  })
  const memberCounts = normalizedMembers.reduce(
    (acc, m) => {
      acc.total += 1
      acc[roleFilterValue(m.role)] += 1
      return acc
    },
    { total: 0, owner: 0, admin: 0, member: 0 },
  )

  let lastDay = ''

  return (
    <MessageDiagnosticsProvider>
    <div className="sandbox-container im-layout">
      <button
        type="button"
        className="mobile-channel-toggle md:hidden"
        onClick={() => setShowChannelList(!showChannelList)}
      >
        <MessageSquare size={20} /> {i18n.t(" 会话列表")}</button>

      <ConversationSidebar
        adapter={adapter}
        endpointId={endpointId}
        info={info}
        loadErr={loadErr}
        testLoading={testLoading}
        testMessage={testMessage}
        onTest={() => void testEndpoint()}
        listLoading={listLoading}
        listNotice={listNotice}
        listSearch={listSearch}
        onListSearchChange={setListSearch}
        conversationSections={conversationSections}
        sectionCollapsed={sectionCollapsed}
        systemSectionCollapsed={systemSectionCollapsed}
        onToggleSection={toggleSection}
        onToggleSystemSection={toggleSystemSection}
        selection={selection}
        onSelectChannel={(entry) =>
          setSelection({
            type: 'channel',
            id: entry.id,
            name: entry.name,
            channelType: entry.channelType,
            ...(entry.parent ? { parent: entry.parent } : {}),
          })
        }
        onSelectRequests={() => setSelection({ type: 'requests' })}
        onSelectNotices={() => setSelection({ type: 'notices' })}
        requestCount={requestList.length}
        noticeCount={noticeList.length}
        onRefresh={() => void loadLists()}
        showChannelList={showChannelList}
        onCloseMobileList={() => setShowChannelList(false)}
      />

      {showChannelList && (
        <div
          className="channel-overlay md:hidden"
          onClick={() => setShowChannelList(false)}
          aria-hidden
        />
      )}

      <div className="im-main-split">
        <div className="im-center">
          {selection?.type === 'channel' && (
            <>
              <header className="im-chat-header im-chat-header--channel px-3 py-2.5 flex items-center justify-between gap-2">
                <div className="flex items-center gap-3 min-w-0">
                  <div className="im-chat-avatar shrink-0">
                    {getChannelIcon(selection.channelType)}
                  </div>
                  <div className="min-w-0">
                    <h2 className="text-[15px] font-semibold truncate leading-tight">{selection.name}</h2>
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {selection.channelType === 'private'
                        ? i18n.t("私聊")
                        : selection.channelType === 'group'
                          ? i18n.t("群聊")
                          : i18n.t("频道")}
                      {selection.channelType === 'channel' && selection.parent?.name
                        ? ` · ${selection.parent.name}`
                        : ''}{' '}
                      · {selection.id}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <MessageDiagnosticsAction endpoint={info?.endpoint} selection={selection} />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="im-header-icon-button h-8 w-8"
                    title={i18n.t("查看 Agent 对话轨迹")}
                    aria-label={i18n.t("查看 Agent 对话轨迹")}
                    asChild
                  >
                    <Link
                      to={agentSessionsPath(
                        buildSessionKey(adapter, endpointId, selection.channelType, selection.id),
                      )}
                    >
                      <GitBranch className="h-4 w-4" />
                    </Link>
                  </Button>
                  {!readOnly && selection.channelType === 'private' && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="im-header-icon-button h-8 w-8 text-destructive hover:text-destructive"
                      title={i18n.t("删除好友")}
                      onClick={() => void handleDeleteFriend()}
                    >
                      <UserMinus className="h-4 w-4" />
                    </Button>
                  )}
                </div>
              </header>

              <div className="im-message-list flex-1 overflow-y-auto px-3 py-2 min-h-0 flex flex-col">
                {inboxMessagesEnabled && inboxMessagesHasMore && (
                  <div className="flex-shrink-0 py-2 flex justify-center">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-xs"
                      disabled={inboxMessagesLoading}
                      onClick={() => {
                        const oldest = Math.min(...inboxMessages.map((m) => m.timestamp))
                        void loadInboxMessages(oldest)
                      }}
                    >
                      {inboxMessagesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : i18n.t("加载更早消息")}
                    </Button>
                  </div>
                )}
                {inboxMessagesError ? <Alert variant="destructive"><AlertDescription>{i18n.t("消息历史读取失败：")}{inboxMessagesError}</AlertDescription></Alert> : null}
                {channelMessages.length === 0 && canShowReadEmpty(inboxMessagesLoading, inboxMessagesError) ? (
                  <div className="im-empty-state flex flex-col items-center justify-center flex-1 gap-2 text-muted-foreground text-sm py-12">
                    <MessageSquare className="h-10 w-10 opacity-35" />
                    <span>
                      {inboxMessagesEnabled ? i18n.t("暂无消息") : i18n.t("暂无消息，对方发送的消息会显示在此处")}
                    </span>
                  </div>
                ) : (
                  <div className="im-message-stack flex flex-col gap-1 pb-2">
                    {channelMessages.map((m) => {
                      const dk = dayKey(m.timestamp)
                      const showDate = dk !== lastDay
                      if (showDate) lastDay = dk
                      const out = m.outgoing === true
                      return (
                        <Fragment key={m.id}>
                          {showDate && <div className="im-date-pill">{dayLabel(m.timestamp, i18n.locale)}</div>}
                          <ChatMessageRow
                            message={m}
                            onQuote={(ref) => {
                              setQuoteDraft(ref)
                              setForwardDraft(null)
                            }}
                            onForward={(ref) => {
                              setForwardDraft(ref)
                              setQuoteDraft(null)
                            }}
                          />
                        </Fragment>
                      )
                    })}
                  </div>
                )}
              </div>

              {readOnly ? (
                <div className="im-composer shrink-0 border-t px-4 py-3 text-xs text-muted-foreground">
                  {i18n.t("Demo 仅读消息记录，不提供消息编辑器。")}</div>
              ) : (
              <div className="im-composer p-3 shrink-0 space-y-2">
                <input
                  ref={imageFileRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={onPickImageFile}
                />
                <input
                  ref={fileInputRef}
                  type="file"
                  className="hidden"
                  onChange={onPickFile}
                />
                {(quoteDraft || forwardDraft) && (
                  <div className={cn('im-draft-reference', forwardDraft && 'im-draft-reference--forward')}>
                    <span className="im-draft-reference-icon">
                      {quoteDraft ? <Quote className="h-4 w-4" /> : <Forward className="h-4 w-4" />}
                    </span>
                    <span className="im-draft-reference-main">
                      <span className="im-draft-reference-title">
                        {quoteDraft ? i18n.t("引用 {0}", [quoteDraft.senderName]) : i18n.t("转发 {0}", [forwardDraft?.senderName])}
                      </span>
                      <span className="im-draft-reference-summary">
                        {quoteDraft?.summary ?? forwardDraft?.summary}
                      </span>
                    </span>
                    <button type="button" className="im-draft-reference-close" onClick={clearMessageDrafts} aria-label={i18n.t("取消")}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                )}
                <div className="im-composer-tools flex flex-wrap items-center gap-1">
                  <Button
                    type="button"
                    variant={composerMode === 'markdown' ? 'secondary' : 'outline'}
                    size="sm"
                    className="im-tool-button h-8 px-2 text-xs"
                    title={i18n.t("Markdown 模式")}
                    onClick={() => setComposerMode((mode) => (mode === 'markdown' ? 'plain' : 'markdown'))}
                  >
                    <Code2 className="w-3.5 h-3.5 mr-1" />
                    Markdown
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="im-tool-button h-8 px-2 text-xs"
                    title={i18n.t("插入 QQ 表情段")}
                    onClick={() => appendComposerToken('[face:14]')}
                  >
                    <Smile className="w-3.5 h-3.5 mr-1" />
                    {i18n.t("表情")}</Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="im-tool-button h-8 px-2 text-xs"
                    title={i18n.t("选择本地图片（插入为 data URL）")}
                    onClick={() => imageFileRef.current?.click()}
                  >
                    <Image className="w-3.5 h-3.5 mr-1" />
                    {i18n.t("图片文件")}</Button>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="im-tool-button h-8 px-2 text-xs"
                    title={i18n.t("选择本地文件（插入为 data URL 文件段）")}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    <Paperclip className="w-3.5 h-3.5 mr-1" />
                    {i18n.t("文件")}</Button>
                  <Button
                    type="button"
                    variant={mediaPanel === 'image' ? 'secondary' : 'outline'}
                    size="sm"
                    className="im-tool-button h-8 px-2 text-xs"
                    onClick={() => {
                      setMediaPanel((p) => (p === 'image' ? null : 'image'))
                    }}
                  >
                    {i18n.t("图片链接")}</Button>
                  <Button
                    type="button"
                    variant={mediaPanel === 'video' ? 'secondary' : 'outline'}
                    size="sm"
                    className="im-tool-button h-8 px-2 text-xs"
                    onClick={() => {
                      setMediaPanel((p) => (p === 'video' ? null : 'video'))
                    }}
                  >
                    <Video className="w-3.5 h-3.5 mr-1" />
                    {i18n.t("视频")}</Button>
                  <Button
                    type="button"
                    variant={mediaPanel === 'audio' ? 'secondary' : 'outline'}
                    size="sm"
                    className="im-tool-button h-8 px-2 text-xs"
                    onClick={() => {
                      setMediaPanel((p) => (p === 'audio' ? null : 'audio'))
                    }}
                  >
                    <Music className="w-3.5 h-3.5 mr-1" />
                    {i18n.t("音频")}</Button>
                </div>
                {mediaPanel && (
                  <div className="im-media-panel flex flex-wrap items-end gap-2 p-2">
                    <Input
                      value={mediaUrl}
                      onChange={(e) => setMediaUrl(e.target.value)}
                      placeholder={
                        mediaPanel === 'image'
                          ? i18n.t("图片 URL 或 base64://…")
                          : mediaPanel === 'video'
                            ? i18n.t("视频直链 URL")
                            : i18n.t("音频直链 URL")
                      }
                      className="im-media-input flex-1 min-w-0 sm:min-w-[12rem] h-9 text-sm"
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault()
                          commitMediaUrl()
                        }
                      }}
                    />
                    <Button type="button" size="sm" className="im-insert-button h-9" onClick={commitMediaUrl} disabled={!mediaUrl.trim()}>
                      <Check className="w-3.5 h-3.5 mr-1" />
                      {i18n.t("插入")}</Button>
                  </div>
                )}
                {composerAttachments.length > 0 && (
                  <div className="im-attachment-tray">
                    {composerAttachments.map((item) => (
                      <div key={item.id} className="im-attachment-chip">
                        <span className="im-attachment-icon">
                          {item.type === 'image' ? (
                            <Image className="h-3.5 w-3.5" />
                          ) : item.type === 'video' ? (
                            <Video className="h-3.5 w-3.5" />
                          ) : item.type === 'audio' ? (
                            <Music className="h-3.5 w-3.5" />
                          ) : (
                            <FileText className="h-3.5 w-3.5" />
                          )}
                        </span>
                        <span className="im-attachment-main">
                          <span className="im-attachment-name">{item.name}</span>
                          <span className="im-attachment-meta">
                            {item.source === 'local' ? i18n.t("本地附件") : i18n.t("URL 附件")} · {item.type}
                          </span>
                        </span>
                        <button type="button" onClick={() => removeAttachment(item.id)} aria-label={i18n.t("移除附件")}>
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="im-composer-row flex gap-2 items-end">
                  <Textarea
                    placeholder={
                      composerMode === 'markdown'
                        ? i18n.t("Markdown 消息：支持标题、列表、引用、代码块…")
                        : i18n.t("文字消息；也可手写 [@名称]、[face:id]、[image:URL]、[video:URL]、[audio:URL]")
                    }
                    value={msgContent}
                    onChange={(e) => setMsgContent(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault()
                        handleSendWithDrafts()
                      }
                    }}
                    className="im-composer-textarea flex-1 min-h-[44px] max-h-[160px] text-sm resize-y bg-background font-mono text-[13px]"
                    rows={2}
                  />
                  <Button
                    className="im-send-button shrink-0 h-10 w-10 p-0 rounded-full"
                    onClick={handleSendWithDrafts}
                    disabled={!canSend}
                  >
                    {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="im-composer-hint text-[10px] text-muted-foreground">
                  <>{i18n.t("Enter 发送 · Shift+Enter 换行 · 当前模式：")}{composerMode === 'markdown' ? 'Markdown' : i18n.t("普通文本")} {i18n.t(" · 待发送 ")}{composerSegments.length} {i18n.t(" 个消息段")}</>
                </p>
              </div>
              )}
            </>
          )}

          {selection?.type === 'requests' && (
            <div className="im-system-page flex flex-col flex-1 min-h-0 overflow-hidden bg-card m-0 border-0 rounded-none">
              <header className="im-chat-header im-system-page-header px-4 py-3 flex items-center justify-between">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <UserPlus size={18} />
                  {i18n.t("请求")}</h2>
                <Button
                  size="sm"
                  variant="outline"
                  className="im-secondary-action"
                  disabled={requestsTab === 'history' ? inboxRequestsLoading : requestsLoading}
                  onClick={() => void (requestsTab === 'history' ? loadInboxRequests(false) : loadRequestsFromServer())}
                >
                  {i18n.t("刷新")}</Button>
              </header>
              <Tabs
                value={requestsTab}
                onValueChange={(v) => {
                  setRequestsTab(v as 'pending' | 'history')
                  if (v === 'history' && inboxRequests.length === 0 && !inboxRequestsLoading)
                    void loadInboxRequests(false)
                }}
                className="flex flex-col flex-1 min-h-0"
              >
                <TabsList className="im-tabs-list mx-3 mt-2 w-auto justify-start">
                  <TabsTrigger value="pending">{i18n.t("待处理")}</TabsTrigger>
                  <TabsTrigger value="history">{i18n.t("历史")}</TabsTrigger>
                </TabsList>
                <TabsContent value="pending" className="im-system-content flex-1 overflow-y-auto p-4 space-y-3 mt-0">
                  {actionError ? <Alert variant="destructive"><AlertDescription>{i18n.t("操作失败：")}{actionError}</AlertDescription></Alert> : null}
                  {requestsLoading ? <p role="status">{i18n.t("正在读取待处理请求…")}</p> : null}
                  {requestsError ? <Alert variant="destructive"><AlertDescription>{i18n.t("请求读取失败：")}{requestsError}</AlertDescription></Alert> : null}
                  {requestList.length === 0 && canShowReadEmpty(requestsLoading, requestsError) && (
                    <div className="im-empty-state flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
                      <UserPlus size={40} className="opacity-25" />
                      <span>{requestsAvailable === false ? i18n.t("此渠道未提供请求管理，且未启用请求收件箱") : i18n.t("暂无未处理请求")}</span>
                    </div>
                  )}
                  {requestList.map((r) => (
                    <div key={r.platformRequestId} className="im-inbox-card border border-border/80 rounded-lg p-3 space-y-2 bg-background/50">
                      <div className="flex flex-wrap gap-2 text-sm">
                        <Badge>{r.type}</Badge>
                        <span>{i18n.t("来自 ")}{r.sender.name || r.sender.id}</span>
                        <span className="text-muted-foreground text-xs">
                          {new Date(r.timestamp).toLocaleString(i18n.locale)}
                        </span>
                      </div>
                      {r.comment && <p className="text-sm">{r.comment}</p>}
                      {!readOnly && <div className="flex flex-wrap gap-2">
                        {r.canAct === true && (
                          <>
                            <Button size="sm" onClick={() => void approve(r.platformRequestId, true)}>
                              {i18n.t("同意")}</Button>
                            <Button size="sm" variant="outline" onClick={() => void approve(r.platformRequestId, false)}>
                              {i18n.t("拒绝")}</Button>
                          </>
                        )}
                        <Button size="sm" variant="ghost" disabled={r.id === undefined} onClick={() => { if (r.id !== undefined) void dismissRequest(r.id) }}>
                          {i18n.t("标记已处理")}</Button>
                      </div>}
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="history" className="im-system-content flex-1 overflow-y-auto p-4 space-y-3 mt-0 min-h-0">
                  {inboxRequestsError ? <Alert variant="destructive"><AlertDescription>{inboxRequestsError}</AlertDescription></Alert> : null}
                  {!inboxRequestsEnabled && canShowReadEmpty(inboxRequestsLoading, inboxRequestsError) && (
                    <div className="im-empty-state flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                      <span>{i18n.t("未启用统一收件箱，无历史记录")}</span>
                    </div>
                  )}
                  {inboxRequestsLoading && inboxRequests.length === 0 && (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {inboxRequestsEnabled && inboxRequests.length === 0 && canShowReadEmpty(inboxRequestsLoading, inboxRequestsError) && (
                    <div className="im-empty-state flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                      <span>{i18n.t("暂无请求历史")}</span>
                    </div>
                  )}
                  {inboxRequests.length > 0 && (
                    <>
                      {inboxRequests.map((r) => (
                        <div key={r.id} className="im-inbox-card border border-border/80 rounded-lg p-3 space-y-1 text-sm bg-background/50">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{r.type}</Badge>
                            <span>{r.sender_name || r.sender_id}</span>
                            <span className="text-muted-foreground text-xs">
                              {new Date(r.created_at).toLocaleString(i18n.locale)}
                            </span>
                            {r.resolved ? <Badge variant="secondary">{i18n.t("已处理")}</Badge> : null}
                          </div>
                          {r.comment && <p className="text-muted-foreground text-sm">{r.comment}</p>}
                        </div>
                      ))}
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={inboxRequestsLoading || !inboxRequestsHasMore}
                          onClick={() => void loadInboxRequests(true)}
                        >
                          {inboxRequestsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : inboxRequestsHasMore ? i18n.t("加载更多") : i18n.t("没有更多记录")}
                        </Button>
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {selection?.type === 'notices' && (
            <div className="im-system-page flex flex-col flex-1 min-h-0 overflow-hidden bg-card m-0 border-0 rounded-none">
              <header className="im-chat-header im-system-page-header px-4 py-3 flex items-center justify-between">
                <h2 className="text-base font-semibold flex items-center gap-2">
                  <Bell size={18} />
                  {i18n.t("通知")}</h2>
                <Button
                  size="sm"
                  variant="outline"
                  className="im-secondary-action"
                  onClick={() => void refreshNotices()}
                >
                  {i18n.t("刷新")}</Button>
              </header>
              <Tabs
                value={noticesTab}
                onValueChange={(v) => {
                  setNoticesTab(v as 'unread' | 'history')
                  if (v === 'history' && inboxNotices.length === 0 && !inboxNoticesLoading)
                    void loadInboxNotices(false)
                }}
                className="flex flex-col flex-1 min-h-0"
              >
                <TabsList className="im-tabs-list mx-3 mt-2 w-auto justify-start">
                  <TabsTrigger value="unread">{i18n.t("未读")}</TabsTrigger>
                  <TabsTrigger value="history">{i18n.t("历史")}</TabsTrigger>
                </TabsList>
                <TabsContent value="unread" className="im-system-content flex-1 overflow-y-auto p-4 space-y-3 mt-0">
                  {actionError ? <Alert variant="destructive"><AlertDescription>{i18n.t("操作失败：")}{actionError}</AlertDescription></Alert> : null}
                  {noticesLoading ? <p role="status">{i18n.t("正在读取通知…")}</p> : null}
                  {noticesError ? <Alert variant="destructive"><AlertDescription>{i18n.t("通知读取失败：")}{noticesError}</AlertDescription></Alert> : null}
                  {noticeList.length === 0 && canShowReadEmpty(noticesLoading, noticesError) && (
                    <div className="im-empty-state flex flex-col items-center justify-center py-16 gap-2 text-muted-foreground text-sm">
                      <Bell size={40} className="opacity-25" />
                      <span>{noticesAvailable === false ? i18n.t("此实例未启用通知收件箱") : i18n.t("暂无未读通知")}</span>
                    </div>
                  )}
                  {noticeList.map((n) => (
                    <div
                      key={n.id}
                      className="im-inbox-card border border-border/80 rounded-lg p-3 flex justify-between gap-2 bg-background/50"
                    >
                      <div className="min-w-0">
                        <Badge className="mb-1">{n.noticeType}</Badge>
                        <p className="text-xs text-muted-foreground font-mono truncate max-w-md">
                          {n.payload.slice(0, 200)}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          {new Date(n.timestamp).toLocaleString(i18n.locale)}
                        </p>
                      </div>
                      {!readOnly && (
                        <Button size="sm" variant="outline" onClick={() => void dismissNotice(n.id)}>
                          {i18n.t("已读")}</Button>
                      )}
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="history" className="im-system-content flex-1 overflow-y-auto p-4 space-y-3 mt-0 min-h-0">
                  {inboxNoticesError ? <Alert variant="destructive"><AlertDescription>{inboxNoticesError}</AlertDescription></Alert> : null}
                  {!inboxNoticesEnabled && canShowReadEmpty(inboxNoticesLoading, inboxNoticesError) && (
                    <div className="im-empty-state flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                      <span>{i18n.t("未启用统一收件箱，无历史记录")}</span>
                    </div>
                  )}
                  {inboxNoticesLoading && inboxNotices.length === 0 && (
                    <div className="flex justify-center py-8">
                      <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  {inboxNoticesEnabled && inboxNotices.length === 0 && canShowReadEmpty(inboxNoticesLoading, inboxNoticesError) && (
                    <div className="im-empty-state flex flex-col items-center justify-center py-12 gap-2 text-muted-foreground text-sm">
                      <span>{i18n.t("暂无通知历史")}</span>
                    </div>
                  )}
                  {inboxNotices.length > 0 && (
                    <>
                      {inboxNotices.map((n) => (
                        <div key={n.id} className="im-inbox-card border border-border/80 rounded-lg p-3 space-y-1 text-sm bg-background/50">
                          <div className="flex flex-wrap gap-2">
                            <Badge variant="outline">{n.type}</Badge>
                            <span className="text-muted-foreground text-xs">
                              {new Date(n.created_at).toLocaleString(i18n.locale)}
                            </span>
                          </div>
                          <p className="text-muted-foreground font-mono text-xs truncate max-w-full">
                            {String(n.payload ?? '').slice(0, 200)}
                          </p>
                        </div>
                      ))}
                      <div className="flex justify-center pt-2">
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={inboxNoticesLoading || !inboxNoticesHasMore}
                          onClick={() => void loadInboxNotices(true)}
                        >
                          {inboxNoticesLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : inboxNoticesHasMore ? i18n.t("加载更多") : i18n.t("没有更多记录")}
                        </Button>
                      </div>
                    </>
                  )}
                </TabsContent>
              </Tabs>
            </div>
          )}

          {!selection && (
            <div className="im-empty-state im-empty-state--hero flex flex-col items-center justify-center flex-1 gap-3 text-muted-foreground px-6 text-center">
              <MessageSquare className="h-14 w-14 opacity-20" />
              <p className="text-sm font-medium text-foreground/80">{i18n.t("选择会话或查看请求 / 通知")}</p>
              <p className="text-xs max-w-sm">
                {i18n.t("在左侧选择好友、群或频道查看消息并发送内容；也可以查看请求与通知。")}</p>
            </div>
          )}
        </div>

        {showRightPanel && (
          <aside className={cn('im-right-panel im-right-visible')}>
            <div className="im-right-header p-3 border-b border-border/60">
              <div className="im-member-panel-title">
                <div>
                  <h3 className="text-sm font-semibold">{i18n.t("群成员与管理")}</h3>
                  <p className="text-[11px] text-muted-foreground mt-0.5">{i18n.t("仅 ICQQ 群聊")}</p>
                </div>
                <Badge variant="secondary" className="im-member-total">
                  {memberCounts.total}
                </Badge>
              </div>
            </div>
            <div className="im-right-actions p-2 border-b border-border/60">
              <Button
                size="sm"
                variant="outline"
                className="im-secondary-action w-full"
                onClick={() => void loadMembers()}
                disabled={membersLoading}
              >
                {membersLoading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : null}
                {i18n.t("加载成员")}</Button>
              <div className="im-member-search">
                <Search className="h-3.5 w-3.5" />
                <Input
                  value={memberSearch}
                  onChange={(e) => setMemberSearch(e.target.value)}
                  aria-label={i18n.t("搜索成员")}
                  placeholder={i18n.t("搜索成员昵称、ID 或角色")}
                  className="h-8 border-0 bg-transparent px-0 text-xs shadow-none focus-visible:ring-0"
                />
              </div>
              <div className="im-member-role-tabs">
                {[
                  ['all', i18n.t("全部 {0}", [memberCounts.total])],
                  ['owner', i18n.t("群主 {0}", [memberCounts.owner])],
                  ['admin', i18n.t("管理 {0}", [memberCounts.admin])],
                  ['member', i18n.t("成员 {0}", [memberCounts.member])],
                ].map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    className={cn(memberRoleFilter === value && 'active')}
                    onClick={() => setMemberRoleFilter(value as typeof memberRoleFilter)}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
            <div className="im-member-list flex-1 overflow-y-auto p-2 space-y-2 min-h-0">
              {filteredMembers.length === 0 && (
                <div className="im-member-empty">
                  <User className="h-8 w-8 opacity-30" />
                  <span>{membersLoading ? i18n.t("正在加载成员") : i18n.t("暂无匹配成员")}</span>
                </div>
              )}
              {filteredMembers.map((item) => {
                const uid = item.uid
                const roleKind = roleFilterValue(item.role)
                return (
                  <div
                    key={`${uid}-${item.index}`}
                    className={cn('im-member-card flex flex-col gap-1.5 text-xs p-2 border border-border/70 rounded-md bg-background/60', `im-member-card--${roleKind}`)}
                  >
                    <div className="im-member-card-main">
                      <span className="im-member-avatar">
                        {memberInitials(item.name)}
                      </span>
                      <span className="im-member-identity">
                        <span className="im-member-name">{item.name}</span>
                        <span className="im-member-id">{uid}</span>
                      </span>
                      <span className="im-member-role">
                        {roleKind === 'owner' ? (
                          <Crown className="h-3.5 w-3.5" />
                        ) : roleKind === 'admin' ? (
                          <Shield className="h-3.5 w-3.5" />
                        ) : (
                          <User className="h-3.5 w-3.5" />
                        )}
                        <Badge variant="outline" className="text-[10px]">
                          {memberRoleLabel(item.role, i18n.locale)}
                        </Badge>
                      </span>
                    </div>
                    {!readOnly && <div className="im-member-actions">
                      <Button
                        size="sm"
                        variant="destructive"
                        className="im-member-danger h-7 text-[10px] px-2"
                        onClick={() =>
                          void handleGroupAction(ENDPOINT_RPC.GROUP_KICK, uid, item.name)
                        }
                      >
                        {i18n.t("踢")}</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] px-2"
                        onClick={() =>
                          void handleGroupAction(ENDPOINT_RPC.GROUP_MUTE, uid, item.name)
                        }
                      >
                        {i18n.t("禁言")}</Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-[10px] px-2"
                        onClick={() =>
                          void handleGroupAction(ENDPOINT_RPC.GROUP_ADMIN, uid, item.name, { enable: true })
                        }
                      >
                        {i18n.t("管理")}</Button>
                    </div>}
                  </div>
                )
              })}
            </div>
          </aside>
        )}
      </div>
      {ConfirmDialogHost}
    </div>
    </MessageDiagnosticsProvider>
  )
}
