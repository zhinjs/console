import { useI18n } from '../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { GitBranch, CheckCircle, Loader2 } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import { isLikelySessionKey, parseSessionKeyFromQuery } from '../utils/agent-session'
import {
  loadAgentSessionHistory,
  pushAgentSessionHistory,
} from '../utils/agent-session-history'
import { PageHeader } from '../components/PageHeader'
import { ErrorAlert } from '../components/error-alert'
import { EmptyState } from '../components/empty-state'
import { Card, CardContent } from '../components/ui/card'
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
  sessionKey: string
  sessionId: string
  activeLeafMessageId: number | null
  points: TreePoint[]
}

export default function AgentSessionsPage() {
  const i18n = useI18n()
  const readOnly = isDemoMode()
  const [searchParams] = useSearchParams()
  const sessionKeyFromUrl = parseSessionKeyFromQuery(searchParams.get('sessionKey'))
  const [sessionKey, setSessionKey] = useState(sessionKeyFromUrl)
  const [history, setHistory] = useState<string[]>(() => loadAgentSessionHistory())
  const [recent, setRecent] = useState<RecentSession[] | null>(null)
  const [tree, setTree] = useState<SessionTree | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'none' | '404' | '503' | 'other'>('none')

  const requestSequence = useRef(0)
  const switchInFlight = useRef(false)
  const [confirmPoint, setConfirmPoint] = useState<(TreePoint & { sessionKey: string }) | null>(null)
  const [switching, setSwitching] = useState(false)
  const [switchMsg, setSwitchMsg] = useState<string | null>(null)

  const fetchTree = useCallback(async (key: string, switchMessage: string | null = null) => {
    const trimmed = key.trim()
    if (!trimmed) return
    if (!isLikelySessionKey(trimmed)) {
      requestSequence.current += 1
      setLoading(false)
      setTree(null)
      setConfirmPoint(null)
      setErrorKind('other')
      setError(i18n.t("会话标识不完整，请检查平台、渠道、类型与会话。"))
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
      if (sequence !== requestSequence.current) return

      if (res.status === 404) {
        setErrorKind('404')
        setError(data.error ?? i18n.t("未找到活跃会话：{0}", [trimmed]))
        return
      }
      if (res.status === 503) {
        setErrorKind('503')
        setError(i18n.t("聊天记录还没准备好：请先安装并配置 AI 机器人；收发消息不受影响。"))
        return
      }
      if (!res.ok || !data.success) {
        setErrorKind('other')
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      setTree(data.data as SessionTree)
      setHistory(pushAgentSessionHistory(trimmed))
    } catch (err) {
      if (sequence !== requestSequence.current) return
      setErrorKind('other')
      setError((err as Error).message)
    } finally {
      if (sequence === requestSequence.current) setLoading(false)
    }
  }, [i18n])

  const handleSwitchLeaf = async (point: TreePoint & { sessionKey: string }) => {
    if (readOnly || switchInFlight.current) return
    const trimmed = point.sessionKey.trim()
    if (!trimmed) return
    const viewSequence = requestSequence.current
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
      if (viewSequence !== requestSequence.current) return

      if (res.status === 404) {
        setErrorKind('404')
        setError(data.error ?? i18n.t("未找到活跃会话：{0}", [trimmed]))
        return
      }
      if (res.status === 503) {
        setErrorKind('503')
        setError(i18n.t("聊天记录还没准备好：请先安装并配置 AI 机器人；收发消息不受影响。"))
        return
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? data.message ?? i18n.t("切换失败 (HTTP {0})", [res.status]))
      }

      setConfirmPoint(null)
      await fetchTree(trimmed, i18n.t("已切换至消息 #{0}", [point.messageId]))
    } catch (err) {
      if (viewSequence !== requestSequence.current) return
      setSwitchMsg(null)
      setError((err as Error).message)
      setErrorKind('other')
    } finally {
      switchInFlight.current = false
      setSwitching(false)
    }
  }

  useEffect(() => () => { requestSequence.current += 1 }, [])

  // Recent sessions come from the Host's trace archive; without it the picker falls back to this browser's history.
  useEffect(() => {
    let active = true
    void apiFetch(RECENT_SESSIONS_PATH)
      .then(async (res) => (res.ok ? readRecentSessions(await res.json()) : []))
      .catch(() => [])
      .then((rows) => { if (active) setRecent(rows) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!sessionKeyFromUrl) return
    setSessionKey(sessionKeyFromUrl)
    if (isLikelySessionKey(sessionKeyFromUrl)) {
      void fetchTree(sessionKeyFromUrl)
    } else {
      setErrorKind('other')
      setError(
        i18n.t("sessionKey 格式不正确：「{0}」。应为 platform:endpointId:scope:sceneId（如 icqq:75318:private:userA）", [sessionKeyFromUrl]),
      )
    }
  }, [sessionKeyFromUrl, fetchTree])

  return (
    <div className="space-y-6">
      <PageHeader
        title={i18n.t("聊天记录")}
        description={readOnly ? i18n.t("按聊天账号和会话查看机器人和大家聊过什么（Demo 只读）。") : undefined}
      />

      <AgentSessionPicker
        value={sessionKey}
        history={history}
        recent={recent}
        loading={loading}
        actionLabel={i18n.t("查看记录")}
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
        onLoad={(key) => { if (!switchInFlight.current) void fetchTree(key) }}
      />

      {switchMsg && (
        <Alert variant="success">
          <CheckCircle className="h-4 w-4" />
          <AlertDescription>{switchMsg}</AlertDescription>
        </Alert>
      )}

      {error && (
        <ErrorAlert
          error={error}
          kind={errorKind}
          onRetry={() => fetchTree(sessionKey)}
        />
      )}

      {loading && (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </div>
      )}

      {tree && !loading && (
        <Card>
          <CardContent className="p-4 space-y-3">
            <details className="border-b pb-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer">{i18n.t("会话详情")}</summary>
              <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 break-all">
              <span>{i18n.t("会话：")}<code className="text-foreground">{tree.sessionKey}</code></span>
              <span>
                sessionId: <code className="text-foreground">{tree.sessionId}</code>
              </span>
              <span>
                {i18n.t("活跃叶节点:")}{' '}
                <Badge variant="secondary">
                  {tree.activeLeafMessageId ?? i18n.t("默认（最后一条）")}
                </Badge>
              </span>
              </div>
            </details>

            {tree.points.length === 0 ? (
              <EmptyState compact title={i18n.t("暂无可继续的消息")} />
            ) : (
              <div className="divide-y">
                {tree.points.map((point) => {
                  const isActive = tree.activeLeafMessageId === point.messageId
                  return (
                    <button
                      key={point.messageId}
                      type="button"
                      onClick={() => !readOnly && !isActive && setConfirmPoint({ ...point, sessionKey: tree.sessionKey })}
                      disabled={readOnly || isActive || switching}
                      className={cn(
                        'w-full text-left px-4 py-4 transition-colors focus-visible:outline-offset-[-2px]',
                        isActive
                          ? 'bg-primary/5 shadow-[inset_2px_0_hsl(var(--primary))]'
                          : 'hover:bg-muted/40 cursor-pointer',
                      )}
                    >
                      <p className="mb-3 text-sm leading-relaxed text-foreground">{point.preview || i18n.t("（无预览）")}</p>
                      <div className="flex items-center gap-2 mb-1 min-w-0">
                        <Badge variant={isActive ? 'default' : 'outline'} className="shrink-0">
                          #{point.index}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono truncate min-w-0" title={String(point.messageId)}>
                          msg {point.messageId}
                        </span>
                        {isActive && (
                          <Badge variant="success" className="ml-auto">
                            {i18n.t("当前活跃")}</Badge>
                        )}
                      </div>
                      {(point.parentMessageId !== undefined || point.activePath !== undefined) && (
                        <p className="text-xs text-muted-foreground mb-1">
                          {point.parentMessageId == null ? i18n.t("根消息") : i18n.t("承接消息 #{0}", [point.parentMessageId])}
                          {point.activePath !== undefined && ` · ${point.activePath ? i18n.t("当前路径") : i18n.t("其他分支")}`}
                        </p>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {!readOnly && <Dialog open={!!confirmPoint} onOpenChange={(open) => !open && !switching && setConfirmPoint(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{i18n.t("从这条消息继续")}</DialogTitle>
            <DialogDescription>
              {i18n.t("后续 AI 对话将从这条消息继续。")}</DialogDescription>
          </DialogHeader>
          {confirmPoint && (
            <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30">
              {confirmPoint.preview}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={switching}>{i18n.t("取消")}</Button>
            </DialogClose>
            <Button
              disabled={switching || !confirmPoint}
              onClick={() => confirmPoint && void handleSwitchLeaf(confirmPoint)}
            >
              {switching ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              {i18n.t("确认切换")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  )
}
