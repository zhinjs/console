import { useI18n } from '../i18n'
import { isPersonalSessionKey } from './personal-session-model.mjs'
import { PersonalSessionPanel } from './PersonalSessionPanel'
import { ConversationHistory } from './ConversationHistory'
import { ConversationTrace } from './ConversationTrace'
import { useConversationTraces } from './useConversationTraces'
import './conversation-trace.css'
import type { DiagnosticConversation } from './endpoint-detail/types'
import './agent-sessions.css'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { SessionMessageDetails } from './SessionMessageDetails'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle, Loader2, MessageSquare, MessagesSquare, Repeat2, Users, AlertTriangle, X } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { isLikelySessionKey, parseSessionKeyFromQuery, parseImSessionKey } from '../utils/agent-session'
import { loadAgentSessionHistory, pushAgentSessionHistory } from '../utils/agent-session-history'
import { PageHeader } from '../components/PageHeader'
import { ErrorAlert } from '../components/error-alert'
import { EmptyState } from '../components/empty-state'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Skeleton } from '../components/ui/skeleton'
import { AgentSessionPicker } from '../components/AgentSessionPicker'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  DialogClose,
} from '../components/ui/dialog'
import { cn } from '@zhin.js/client'
import { CONSOLE_REST } from '../contracts/zhin-console'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { readRecentSessions, summarizeRecentSessions, type RecentSession, type RecentSessionSummary } from './agent-session-recent.mjs'
import { StatCard, StatGrid } from '../components/StatCard'
import { sessionConversationScope, sessionKeyInScope } from './scope/records-model.mjs'
import { readScopeFilterParams } from './insights/scope-filter.mjs'
import { scopeHref, scopeIdentity } from '../scope/scope-tree.mjs'

const RECENT_SESSIONS_PATH = '/api/agent/trace-archive/sessions'

interface TreePoint {
  index: number
  messageId: number
  preview: string
  parentMessageId?: number | null
  activePath?: boolean
}

interface SessionTree {
  connectionScope?: string
  sessionKey: string
  sessionId: string
  activeLeafMessageId: number | null
  points: TreePoint[]
}

export default function AgentSessionsPage() {
  const i18n = useI18n()
  const readOnly = !hasConsolePermission('endpoint.operate')
  const scope = useInboxCacheScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const sessionKeyFromUrl = parseSessionKeyFromQuery(searchParams.get('sessionKey'))
  // `?adapter=&endpoint=&conversation=` (the shared scope parameters, e.g. from an object page's
  // 记录 tab): only that scope's sessions.
  const scopeFilter = readScopeFilterParams(searchParams)
  const clearScopeFilter = () => setSearchParams(previous => { const next = new URLSearchParams(previous); for (const key of ['adapter', 'endpoint', 'conversation']) next.delete(key); return next }, { replace: true })
  const [sessionKey, setSessionKey] = useState(sessionKeyFromUrl)
  const [directoryOpen, setDirectoryOpen] = useState(!sessionKeyFromUrl)
  const selectedKey = isLikelySessionKey(sessionKeyFromUrl) ? sessionKeyFromUrl : ''
  const [resolvedConversation, setResolvedConversation] = useState<{ identity: string; conversation?: DiagnosticConversation; error?: string; retry?: () => void } | null>(null)
  const resolved = resolvedConversation?.identity === JSON.stringify([scope, selectedKey]) ? resolvedConversation : null
  const personal = isPersonalSessionKey(selectedKey)
  // 个人会话不保存聊天记录，默认打开「轨迹」；切换页签的选择只在同类会话之间沿用。
  const [viewChoice, setViewChoice] = useState<{ personal: boolean; view: string } | null>(null)
  const view = viewChoice?.personal === personal ? viewChoice.view : personal ? 'trace' : 'conversation'
  const setView = (next: string) => setViewChoice({ personal, view: next })
  const traces = useConversationTraces(readOnly ? '' : selectedKey, scope, resolved?.conversation)
  const [traceSelection, setTraceSelection] = useState<{ identity: string; turnId: string } | null>(null)
  const selected = parseImSessionKey(selectedKey)
  const continueScope = personal ? null : sessionConversationScope(selectedKey)
  const [history, setHistory] = useState<string[]>(() => loadAgentSessionHistory())
  const [recentFailed, setRecentFailed] = useState(false)
  const [recentResult, setRecent] = useState<{ connectionScope?: string; rows: RecentSession[]; summary: RecentSessionSummary | null } | null>(null)
  const recentCurrent = recentResult && isInboxCacheScopeActive(scope) && recentResult.connectionScope === scope ? recentResult : null
  const recent = recentCurrent ? (scopeFilter ? recentCurrent.rows.filter(row => sessionKeyInScope(row.sessionKey, scopeFilter)) : recentCurrent.rows).slice(0, 12) : null
  const sessionSummary = recentCurrent?.summary ?? null
  const [loadedTree, setTree] = useState<SessionTree | null>(null)
  const tree =
    isInboxCacheScopeActive(scope) &&
    loadedTree?.connectionScope === scope &&
    loadedTree?.sessionKey === selectedKey
      ? loadedTree
      : null
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'none' | '404' | '503' | 'other'>('none')

  const requestSequence = useRef(0)
  const switchInFlight = useRef(false)
  const [confirmPoint, setConfirmPoint] = useState<(TreePoint & { sessionKey: string }) | null>(null)
  const [switching, setSwitching] = useState(false)
  const [switchMsg, setSwitchMsg] = useState<string | null>(null)
  const identity = JSON.stringify([scope, selectedKey])
  const identityRef = useRef(identity)
  identityRef.current = identity
  const [feedbackIdentity, setFeedbackIdentity] = useState<string | null>(null)
  const currentFeedback = feedbackIdentity === identity && isInboxCacheScopeActive(scope)

  const fetchTree = useCallback(
    async (key: string, switchMessage: string | null = null) => {
      const connectionScope = scope
      if (!isInboxCacheScopeActive(connectionScope)) return
      const trimmed = key.trim()
      if (!trimmed || identityRef.current !== JSON.stringify([connectionScope, trimmed])) return
      setFeedbackIdentity(JSON.stringify([connectionScope, trimmed]))
      if (!isLikelySessionKey(trimmed)) {
        requestSequence.current += 1
        setLoading(false)
        setTree(null)
        setConfirmPoint(null)
        setErrorKind('other')
        setError(i18n.t('会话标识不完整，请检查平台、账号、类型与会话。'))
        return
      }
      const sequence = ++requestSequence.current
      setConfirmPoint(null)
      setLoading(true)
      setError(null)
      setErrorKind('none')
      setTree(null)
      setSwitchMsg(switchMessage)
      try {
        const encoded = encodeURIComponent(trimmed)
        const res = await apiFetch(`${CONSOLE_REST.AGENT_SESSIONS}/${encoded}/tree`)
        const data = await res.json()
        if (sequence !== requestSequence.current || !isInboxCacheScopeActive(connectionScope)) return

        if (res.status === 404) {
          setErrorKind('404')
          setError(data.error ?? i18n.t('未找到活跃会话：{0}', [trimmed]))
          return
        }
        if (res.status === 503) {
          setErrorKind('503')
          setError(i18n.t('会话分支还没准备好，请检查 Agent 配置。'))
          return
        }
        if (!res.ok || !data.success) {
          setErrorKind('other')
          throw new Error(data.error ?? `HTTP ${res.status}`)
        }

        setTree({ ...(data.data as SessionTree), connectionScope })
        setHistory(pushAgentSessionHistory(trimmed))
      } catch (err) {
        if (sequence !== requestSequence.current || !isInboxCacheScopeActive(connectionScope)) return
        setErrorKind('other')
        setError((err as Error).message)
      } finally {
        if (sequence === requestSequence.current) setLoading(false)
      }
    },
    [i18n, scope],
  )

  const handleSwitchLeaf = async (point: TreePoint & { sessionKey: string }) => {
    if (
      readOnly ||
      switchInFlight.current ||
      !isInboxCacheScopeActive(scope) ||
      identityRef.current !== JSON.stringify([scope, point.sessionKey])
    )
      return
    const trimmed = point.sessionKey.trim()
    if (!trimmed) return
    const viewSequence = requestSequence.current
    setFeedbackIdentity(JSON.stringify([scope, trimmed]))
    switchInFlight.current = true
    setSwitching(true)
    setSwitchMsg(null)
    try {
      const encoded = encodeURIComponent(trimmed)
      const res = await apiFetch(`${CONSOLE_REST.AGENT_SESSIONS}/${encoded}/leaf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: point.messageId }),
      })
      const data = await res.json()
      if (
        viewSequence !== requestSequence.current ||
        !isInboxCacheScopeActive(scope) ||
        identityRef.current !== JSON.stringify([scope, trimmed])
      )
        return

      if (res.status === 404) {
        setErrorKind('404')
        setError(data.error ?? i18n.t('未找到活跃会话：{0}', [trimmed]))
        return
      }
      if (res.status === 503) {
        setErrorKind('503')
        setError(i18n.t('会话分支还没准备好，请检查 Agent 配置。'))
        return
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? data.message ?? i18n.t('切换失败 (HTTP {0})', [res.status]))
      }

      setConfirmPoint(null)
      await fetchTree(trimmed, i18n.t('已切换至消息 #{0}', [point.messageId]))
    } catch (err) {
      if (
        viewSequence !== requestSequence.current ||
        !isInboxCacheScopeActive(scope) ||
        identityRef.current !== JSON.stringify([scope, trimmed])
      )
        return
      setSwitchMsg(null)
      setError((err as Error).message)
      setErrorKind('other')
    } finally {
      switchInFlight.current = false
      setSwitching(false)
    }
  }

  useEffect(() => {
    requestSequence.current += 1
    setTree(null)
    setFeedbackIdentity(null)
    setConfirmPoint(null)
    setError(null)
    setSwitchMsg(null)
    setLoading(false)
  }, [scope])

  useEffect(
    () => () => {
      requestSequence.current += 1
    },
    [],
  )

  // Recent sessions come from the Host's trace archive; without it the picker falls back to this browser's history.
  useEffect(() => {
    let active = true
    if (!isInboxCacheScopeActive(scope)) { setRecent(null); setRecentFailed(false); return }
    if (personal) return
    setRecent(null)
    setRecentFailed(false)
    void apiFetch(RECENT_SESSIONS_PATH, { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) return { rows: [] as RecentSession[], summary: null, failed: true }
        const body: unknown = await res.json()
        return { rows: readRecentSessions(body, Number.POSITIVE_INFINITY), summary: summarizeRecentSessions(body), failed: false }
      })
      .catch(() => ({ rows: [] as RecentSession[], summary: null, failed: true }))
      .then(({ rows, summary, failed }) => {
        if (active && isInboxCacheScopeActive(scope)) { setRecent({ connectionScope: scope, rows, summary }); setRecentFailed(failed) }
      })
    return () => {
      active = false
    }
  }, [scope, personal])

  useEffect(() => {
    if (!sessionKeyFromUrl) return
    setSessionKey(sessionKeyFromUrl)
    if (isLikelySessionKey(sessionKeyFromUrl)) {
      if (view === 'branches') void fetchTree(sessionKeyFromUrl)
    } else {
      setErrorKind('other')
      setError(
        i18n.t(
          'sessionKey 格式不正确：「{0}」。应为 platform:endpointId:scope:sceneId（如 icqq:75318:private:userA）',
          [sessionKeyFromUrl],
        ),
      )
    }
  }, [sessionKeyFromUrl, fetchTree, view])

  return (
    <div className="console-page console-conversations-page">
      <PageHeader
        title={i18n.t('聊天记录')}
        description={readOnly ? i18n.t('按聊天账号和会话查看机器人和大家聊过什么（只读）。') : i18n.t('按聊天账号和会话查看机器人和大家聊过什么，也可以接着聊。')}
      />

      {!personal && recentResult ? (
        <StatGrid label={i18n.t('会话概况')}>
          <StatCard
            icon={MessagesSquare}
            label={i18n.t('Agent 会话')}
            value={sessionSummary?.sessions ?? '—'}
            sub={sessionSummary ? i18n.t('近 24 小时活跃 {0} 个', [sessionSummary.active]) : i18n.t('未启用或暂时无法读取')}
          />
          <StatCard
            icon={Repeat2}
            label={i18n.t('对话轮次')}
            value={sessionSummary?.turns ?? '—'}
            sub={sessionSummary && sessionSummary.sessions > 0
              ? i18n.t('平均每个会话 {0} 轮', [Math.round((sessionSummary.turns / sessionSummary.sessions) * 10) / 10])
              : i18n.t('Agent 处理过的消息轮次')}
          />
          <StatCard
            icon={Users}
            label={i18n.t('群聊与频道')}
            value={sessionSummary?.groups ?? '—'}
            sub={sessionSummary ? i18n.t('私聊 {0} 个', [sessionSummary.privates]) : i18n.t('按会话类型统计')}
          />
          <StatCard
            icon={AlertTriangle}
            label={i18n.t('最后一轮出错')}
            value={sessionSummary?.failed ?? '—'}
            sub={sessionSummary ? sessionSummary.failed > 0 ? i18n.t('打开会话查看对话追踪') : i18n.t('没有出错的会话') : i18n.t('按会话最后一轮的结果统计')}
            tone={sessionSummary && sessionSummary.failed > 0 ? 'danger' : undefined}
          />
        </StatGrid>
      ) : null}

      <div className="console-session-workspace">
        <aside className={cn('console-session-directory', directoryOpen && 'is-open')}>
          <Button
            variant="outline"
            className="console-session-directory-toggle"
            aria-expanded={directoryOpen}
            aria-controls="session-directory"
            onClick={() => setDirectoryOpen((value) => !value)}
          >
            {i18n.t('切换对话')}
          </Button>
          <div id="session-directory">
            {recentFailed ? <p role="status" className="mb-2 text-xs text-warning">{i18n.t('最近会话未能读取，仅显示本机历史。')}</p> : null}
            {scopeFilter ? (
              <p role="status" className="console-session-scope-filter">
                <span>{i18n.t('只显示 {0} 的会话', [scopeIdentity(scopeFilter)])}</span>
                <Button variant="ghost" size="sm" onClick={clearScopeFilter}><X />{i18n.t('显示全部')}</Button>
              </p>
            ) : null}
            <AgentSessionPicker
              value={sessionKey}
              history={scopeFilter ? history.filter(key => sessionKeyInScope(key, scopeFilter)) : history}
              recent={recent}
              loading={loading}
              actionLabel={i18n.t('查看记录')}
              onChange={(key) => {
                if (switchInFlight.current) return
                requestSequence.current += 1
                setSessionKey(key)
                setTree(null)
                setConfirmPoint(null)
                setLoading(false)
                setError(null)
                setSwitchMsg(null)
              }}
              onLoad={(key) => {
                if (switchInFlight.current || !isLikelySessionKey(key)) return
                const next = new URLSearchParams(searchParams)
                next.set('sessionKey', key)
                setSearchParams(next)
                setDirectoryOpen(false)
                setHistory(pushAgentSessionHistory(key))
                if (key === selectedKey && view === 'branches') void fetchTree(key)
              }}
            />
          </div>
        </aside>
        <section className="console-session-reading" aria-label={i18n.t('当前对话')}>
          {selectedKey ? (
            <>
              <header className="console-session-heading">
                <div className="min-w-0">
                  <h2>{personal ? i18n.t('个人会话') : selected?.sceneId}</h2>
                  {selected ? <p>{selected.platform} · {selected.endpointId}</p> : null}
                </div>
                {/* A conversation session can be continued in its chat; anything else is history only. */}
                {continueScope ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={scopeHref(continueScope, 'chat')}><MessageSquare />{i18n.t('在会话中继续聊天')}</Link>
                  </Button>
                ) : <span className="console-session-readonly">{i18n.t('仅可查看')}</span>}
              </header>
              {personal ? <PersonalSessionPanel key={`${scope}:${selectedKey}`} sessionKey={selectedKey} connectionScope={scope} preferredOwnerId={searchParams.get('personalOwner')} /> : null}
              <Tabs
                value={view}
                onValueChange={(value) => {
                  if (!switchInFlight.current) {
                    setConfirmPoint(null)
                    setView(value)
                  }
                }}
              >
                <TabsList aria-label={i18n.t('记录视图')}>
                  <TabsTrigger value="conversation">{i18n.t('对话')}</TabsTrigger>
                  <TabsTrigger value="trace">{i18n.t('轨迹')}</TabsTrigger>
                  <TabsTrigger value="branches">{i18n.t('会话分支')}</TabsTrigger>
                </TabsList>
                <TabsContent value="conversation" forceMount className="data-[state=inactive]:hidden">
                  {personal ? (
                    <div className="flex flex-col items-center pb-6">
                      <EmptyState
                        compact
                        icon={MessagesSquare}
                        title={i18n.t('个人会话没有聊天记录')}
                        description={i18n.t('个人会话不保存聊天记录，每一轮的处理过程请在「轨迹」页签查看。')}
                        className="pb-3"
                      />
                      <Button variant="outline" size="sm" onClick={() => setView('trace')}>{i18n.t('查看轨迹')}</Button>
                    </div>
                  ) : <ConversationHistory
                    key={`${scope}:${selectedKey}`}
                    sessionKey={selectedKey}
                    connectionScope={scope}
                    turns={traces.turns}
                    onRefresh={traces.refresh}
                    onOpenTrace={(turnId) => { setTraceSelection({ identity, turnId }); setView('trace') }}
                    onConversation={(conversation, error, retry) => setResolvedConversation({ identity, conversation, error, retry })}
                  />}
                </TabsContent>
                <TabsContent value="trace">
                  <ConversationTrace turns={traces.turns} revision={traces.revision} loading={personal ? traces.loading : !resolved?.conversation && !resolved?.error || traces.loading} error={personal ? traces.error : resolved?.error ?? traces.error}
                    refresh={() => { if (personal) void traces.refresh(); else if (resolved?.conversation) void traces.refresh(); else if (resolved?.retry) { setResolvedConversation({ identity }); resolved.retry() } }}
                    selectedTurn={traceSelection?.identity === identity ? traceSelection.turnId : ''}
                    onSelectTurn={(turnId) => setTraceSelection({ identity, turnId })} connectionScope={scope} conversation={resolved?.conversation} />
                </TabsContent>
                <TabsContent value="branches">
                  {currentFeedback && switchMsg && (
                    <Alert variant="success">
                      <CheckCircle className="h-4 w-4" />
                      <AlertDescription>{switchMsg}</AlertDescription>
                    </Alert>
                  )}

                  {currentFeedback && error && (
                    <ErrorAlert error={error} kind={errorKind} onRetry={() => fetchTree(sessionKey)} />
                  )}

                  {currentFeedback && loading && (
                    <div className="space-y-2">
                      {[...Array(4)].map((_, i) => (
                        <Skeleton key={i} className="h-14 w-full" />
                      ))}
                    </div>
                  )}

                  {tree && !loading && (
                    <section className="console-session-branches">
                      <div className="space-y-3">
                        <details className="border-b pb-3 text-xs text-muted-foreground">
                          <summary className="cursor-pointer">{i18n.t('会话详情')}</summary>
                          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 break-all">
                            <span>
                              {i18n.t('会话：')}
                              <code className="text-foreground">{tree.sessionKey}</code>
                            </span>
                            <span>
                              sessionId: <code className="text-foreground">{tree.sessionId}</code>
                            </span>
                            <span>
                              {i18n.t('活跃叶节点:')}{' '}
                              <Badge variant="secondary">
                                {tree.activeLeafMessageId ?? i18n.t('默认（最后一条）')}
                              </Badge>
                            </span>
                          </div>
                        </details>

                        {tree.points.length === 0 ? (
                          <EmptyState compact title={i18n.t('暂无可继续的消息')} />
                        ) : (
                          <div className="divide-y">
                            {tree.points.map((point) => {
                              const isActive = tree.activeLeafMessageId === point.messageId
                              return (
                                <div key={point.messageId}>
                                  <div className={cn('px-4 py-4', isActive && 'bg-primary/5')}>
                                    <p className="mb-3 text-sm leading-relaxed text-foreground [overflow-wrap:anywhere]">
                                      {point.preview || i18n.t('（无预览）')}
                                    </p>
                                    <div className="flex items-center gap-2 mb-1 min-w-0">
                                      <Badge variant={isActive ? 'default' : 'outline'} className="shrink-0">
                                        #{point.index}
                                      </Badge>
                                      <span
                                        className="text-xs text-muted-foreground font-mono truncate min-w-0"
                                        title={String(point.messageId)}
                                      >
                                        msg {point.messageId}
                                      </span>
                                      {isActive && (
                                        <Badge variant="success" className="ml-auto">
                                          {i18n.t('当前活跃')}
                                        </Badge>
                                      )}
                                    </div>
                                    {(point.parentMessageId !== undefined ||
                                      point.activePath !== undefined) && (
                                      <p className="text-xs text-muted-foreground mb-1">
                                        {point.parentMessageId == null
                                          ? i18n.t('根消息')
                                          : i18n.t('承接消息 #{0}', [point.parentMessageId])}
                                        {point.activePath !== undefined &&
                                          ` · ${point.activePath ? i18n.t('当前路径') : i18n.t('其他分支')}`}
                                      </p>
                                    )}
                                    {!readOnly && (
                                      <Button
                                        variant="outline"
                                        size="sm"
                                        disabled={isActive || switching}
                                        onClick={() =>
                                          setConfirmPoint({ ...point, sessionKey: tree.sessionKey })
                                        }
                                      >
                                        {i18n.t('从这里继续')}
                                      </Button>
                                    )}
                                  </div>
                                  <SessionMessageDetails
                                    key={`${tree.connectionScope}:${tree.sessionKey}:${tree.sessionId}:${point.messageId}`}
                                    sessionKey={tree.sessionKey}
                                    sessionId={tree.sessionId}
                                    messageId={point.messageId}
                                    connectionScope={tree.connectionScope}
                                  />
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    </section>
                  )}
                </TabsContent>
              </Tabs>
            </>
          ) : sessionKeyFromUrl ? (
            <ErrorAlert error={i18n.t('会话标识不完整，请检查平台、账号、类型与会话。')} />
          ) : (
            <EmptyState compact title={i18n.t('选择一个对话')} />
          )}
        </section>
      </div>

      {!readOnly && (
        <Dialog
          open={!!confirmPoint && tree?.sessionKey === confirmPoint.sessionKey}
          onOpenChange={(open) => !open && !switching && setConfirmPoint(null)}
        >
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{i18n.t('从这条消息继续')}</DialogTitle>
              <DialogDescription>{i18n.t('后续 AI 对话将从这条消息继续。')}</DialogDescription>
            </DialogHeader>
            {confirmPoint && (
              <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30">
                {confirmPoint.preview}
              </p>
            )}
            <DialogFooter>
              <DialogClose asChild>
                <Button variant="outline" disabled={switching}>
                  {i18n.t('取消')}
                </Button>
              </DialogClose>
              <Button
                disabled={switching || !confirmPoint}
                onClick={() => confirmPoint && void handleSwitchLeaf(confirmPoint)}
              >
                {switching ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
                {i18n.t('确认切换')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
