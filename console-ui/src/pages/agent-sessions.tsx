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
  const readOnly = isDemoMode()
  const [searchParams] = useSearchParams()
  const sessionKeyFromUrl = parseSessionKeyFromQuery(searchParams.get('sessionKey'))
  const [sessionKey, setSessionKey] = useState(sessionKeyFromUrl)
  const [history, setHistory] = useState<string[]>(() => loadAgentSessionHistory())
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
      setError('会话标识不完整，请检查平台、渠道、类型与会话。')
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
        setError(data.error ?? `未找到活跃会话：${trimmed}`)
        return
      }
      if (res.status === 503) {
        setErrorKind('503')
        setError('当前实例的 AI 对话分支能力尚未就绪。请先安装并配置 Agent；IM 消息功能可独立使用。')
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
  }, [])

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
        setError(data.error ?? `未找到活跃会话：${trimmed}`)
        return
      }
      if (res.status === 503) {
        setErrorKind('503')
        setError('当前实例的 AI 对话分支能力尚未就绪。请先安装并配置 Agent；IM 消息功能可独立使用。')
        return
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? data.message ?? `切换失败 (HTTP ${res.status})`)
      }

      setConfirmPoint(null)
      await fetchTree(trimmed, `已切换至消息 #${point.messageId}`)
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

  useEffect(() => {
    if (!sessionKeyFromUrl) return
    setSessionKey(sessionKeyFromUrl)
    if (isLikelySessionKey(sessionKeyFromUrl)) {
      void fetchTree(sessionKeyFromUrl)
    } else {
      setErrorKind('other')
      setError(
        `sessionKey 格式不正确：「${sessionKeyFromUrl}」。应为 platform:endpointId:scope:sceneId（如 icqq:75318:private:userA）`,
      )
    }
  }, [sessionKeyFromUrl, fetchTree])

  return (
    <div className="space-y-6">
      <PageHeader
        title="对话分支"
        description={readOnly ? '沿着真实渠道会话查看 AI 对话分支（Demo 只读）。' : '沿着真实渠道会话查看 AI 对话分支，并决定下一轮对话从哪条路径继续。'}
      />

      <p className="text-sm text-muted-foreground">对话分支需要已安装并配置 Agent；仅使用 IM 的项目无需启用此能力。</p>

      <AgentSessionPicker
        value={sessionKey}
        history={history}
        loading={loading}
        actionLabel="查看分支"
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
            <div className="flex flex-wrap gap-2 text-sm text-muted-foreground">
              <span>会话：<code className="text-foreground">{tree.sessionKey}</code></span>
              <span>
                sessionId: <code className="text-foreground">{tree.sessionId}</code>
              </span>
              <span>
                活跃叶节点:{' '}
                <Badge variant="secondary">
                  {tree.activeLeafMessageId ?? '默认（最后一条）'}
                </Badge>
              </span>
            </div>

            {tree.points.length === 0 ? (
              <EmptyState compact title="暂无分支点" />
            ) : (
              <div className="space-y-2">
                {tree.points.map((point) => {
                  const isActive = tree.activeLeafMessageId === point.messageId
                  return (
                    <button
                      key={point.messageId}
                      type="button"
                      onClick={() => !readOnly && !isActive && setConfirmPoint({ ...point, sessionKey: tree.sessionKey })}
                      disabled={readOnly || isActive || switching}
                      className={cn(
                        'w-full text-left p-3 rounded-lg border transition-colors',
                        isActive
                          ? 'border-primary bg-primary/5 ring-1 ring-primary/20'
                          : 'border-border/60 hover:bg-muted/40 cursor-pointer',
                      )}
                    >
                      <div className="flex items-center gap-2 mb-1 min-w-0">
                        <Badge variant={isActive ? 'default' : 'outline'} className="text-[10px] shrink-0">
                          #{point.index}
                        </Badge>
                        <span className="text-xs text-muted-foreground font-mono truncate min-w-0" title={String(point.messageId)}>
                          msg {point.messageId}
                        </span>
                        {isActive && (
                          <Badge variant="success" className="text-[10px] ml-auto">
                            当前活跃
                          </Badge>
                        )}
                      </div>
                      {(point.parentMessageId !== undefined || point.activePath !== undefined) && (
                        <p className="text-xs text-muted-foreground mb-1">
                          {point.parentMessageId == null ? '根消息' : `承接消息 #${point.parentMessageId}`}
                          {point.activePath !== undefined && ` · ${point.activePath ? '当前路径' : '其他分支'}`}
                        </p>
                      )}
                      <p className="text-sm text-foreground/90">{point.preview || '（无预览）'}</p>
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
            <DialogTitle>切换活跃叶节点</DialogTitle>
            <DialogDescription>
              将活跃路径切换至消息 #{confirmPoint?.messageId}（分支 #{confirmPoint?.index}）？
              后续 AI 对话将从该用户消息点继续。
            </DialogDescription>
          </DialogHeader>
          {confirmPoint && (
            <p className="text-sm text-muted-foreground border rounded-md p-3 bg-muted/30">
              {confirmPoint.preview}
            </p>
          )}
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline" disabled={switching}>取消</Button>
            </DialogClose>
            <Button
              disabled={switching || !confirmPoint}
              onClick={() => confirmPoint && void handleSwitchLeaf(confirmPoint)}
            >
              {switching ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
              确认切换
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
    </div>
  )
}
