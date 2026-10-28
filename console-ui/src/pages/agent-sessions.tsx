import { useI18n } from '../i18n'
import { ConversationHistory } from './ConversationHistory'
import './agent-sessions.css'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { SessionMessageDetails } from './SessionMessageDetails'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GitBranch, CheckCircle, Loader2 } from 'lucide-react'
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
import { isDemoMode } from '../utils/demo-mode'
import { readRecentSessions, type RecentSession } from './agent-session-recent.mjs'

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
  const readOnly = isDemoMode()
  const scope = useInboxCacheScope()
  const [searchParams, setSearchParams] = useSearchParams()
  const sessionKeyFromUrl = parseSessionKeyFromQuery(searchParams.get('sessionKey'))
  const [sessionKey, setSessionKey] = useState(sessionKeyFromUrl)
  const [view, setView] = useState('conversation')
  const [directoryOpen, setDirectoryOpen] = useState(!sessionKeyFromUrl)
  const selectedKey = isLikelySessionKey(sessionKeyFromUrl) ? sessionKeyFromUrl : ''
  const selected = parseImSessionKey(selectedKey)
  const [history, setHistory] = useState<string[]>(() => loadAgentSessionHistory())
  const [recentResult, setRecent] = useState<{ connectionScope?: string; rows: RecentSession[] } | null>(null)
  const recent =
    recentResult && isInboxCacheScopeActive(scope) && recentResult.connectionScope === scope
      ? recentResult.rows
      : null
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
        setError(i18n.t('会话标识不完整，请检查平台、渠道、类型与会话。'))
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
    setRecent(null)
    if (!isInboxCacheScopeActive(scope)) return
    void apiFetch(RECENT_SESSIONS_PATH, { cache: 'no-store' })
      .then(async (res) => (res.ok ? readRecentSessions(await res.json()) : []))
      .catch(() => [])
      .then((rows) => {
        if (active && isInboxCacheScopeActive(scope)) setRecent({ connectionScope: scope, rows })
      })
    return () => {
      active = false
    }
  }, [scope])

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
        description={readOnly ? i18n.t('按聊天账号和会话查看机器人和大家聊过什么（Demo 只读）。') : undefined}
      />

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
            <AgentSessionPicker
              value={sessionKey}
              history={history}
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
                <h2>{selected?.sceneId}</h2>
                <p>
                  {selected?.platform} · {selected?.endpointId}
                </p>
              </header>
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
                  <TabsTrigger value="branches">{i18n.t('会话分支')}</TabsTrigger>
                </TabsList>
                <TabsContent value="conversation">
                  <ConversationHistory
                    key={`${scope}:${selectedKey}`}
                    sessionKey={selectedKey}
                    connectionScope={scope}
                  />
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
            <ErrorAlert error={i18n.t('会话标识不完整，请检查平台、渠道、类型与会话。')} />
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
