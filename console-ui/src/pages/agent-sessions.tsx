import { useCallback, useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { GitBranch, CheckCircle, Loader2, History } from 'lucide-react'
import { apiFetch } from '../utils/auth'
import {
  agentOrchestrationPath,
  isLikelySessionKey,
  parseSessionKeyFromQuery,
} from '../utils/agent-session'
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
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
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

interface TreePoint {
  index: number
  messageId: number
  preview: string
}

interface SessionTree {
  sessionKey: string
  sessionId: string
  activeLeafMessageId: number | null
  points: TreePoint[]
}

export default function AgentSessionsPage() {
  const [searchParams] = useSearchParams()
  const sessionKeyFromUrl = parseSessionKeyFromQuery(searchParams.get('sessionKey'))
  const [sessionKey, setSessionKey] = useState(sessionKeyFromUrl)
  const [history, setHistory] = useState<string[]>(() => loadAgentSessionHistory())
  const [tree, setTree] = useState<SessionTree | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [errorKind, setErrorKind] = useState<'none' | '404' | '503' | 'other'>('none')

  const [confirmPoint, setConfirmPoint] = useState<TreePoint | null>(null)
  const [switching, setSwitching] = useState(false)
  const [switchMsg, setSwitchMsg] = useState<string | null>(null)

  const fetchTree = useCallback(async (key: string) => {
    const trimmed = key.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setErrorKind('none')
    setTree(null)
    setSwitchMsg(null)
    try {
      const encoded = encodeURIComponent(trimmed)
      const res = await apiFetch(`/api/agent/sessions/${encoded}/tree`)
      const data = await res.json()

      if (res.status === 404) {
        setErrorKind('404')
        setError(data.error ?? `未找到活跃会话：${trimmed}`)
        return
      }
      if (res.status === 503) {
        setErrorKind('503')
        setError(data.error ?? 'Agent 未就绪')
        return
      }
      if (!res.ok || !data.success) {
        setErrorKind('other')
        throw new Error(data.error ?? `HTTP ${res.status}`)
      }

      setTree(data.data as SessionTree)
      setHistory(pushAgentSessionHistory(trimmed))
    } catch (err) {
      setErrorKind('other')
      setError((err as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleLoad = () => {
    void fetchTree(sessionKey)
  }

  const handleSwitchLeaf = async (point: TreePoint) => {
    const trimmed = sessionKey.trim()
    if (!trimmed) return
    setSwitching(true)
    setSwitchMsg(null)
    try {
      const encoded = encodeURIComponent(trimmed)
      const res = await apiFetch(`/api/agent/sessions/${encoded}/leaf`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messageId: point.messageId }),
      })
      const data = await res.json()

      if (res.status === 404) {
        setErrorKind('404')
        setError(data.error ?? `未找到活跃会话：${trimmed}`)
        return
      }
      if (res.status === 503) {
        setErrorKind('503')
        setError(data.error ?? 'Agent 未就绪')
        return
      }
      if (!res.ok || !data.success) {
        throw new Error(data.error ?? data.message ?? `切换失败 (HTTP ${res.status})`)
      }

      setSwitchMsg(data.message ?? `已切换至消息 #${point.messageId}`)
      setConfirmPoint(null)
      await fetchTree(trimmed)
    } catch (err) {
      setSwitchMsg(null)
      setError((err as Error).message)
      setErrorKind('other')
    } finally {
      setSwitching(false)
    }
  }

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
        description="查看并切换 AI 对话分支。sessionKey 格式为 platform:endpointId:scope:sceneId（可从机器人会话页跳转）。"
      />

      <Card>
        <CardContent className="p-4 space-y-3">
          <div className="flex flex-wrap gap-2">
            <div className="flex-1 min-w-0 w-full sm:min-w-[240px] relative">
              <Input
                placeholder="sessionKey（如 private:user123）"
                value={sessionKey}
                onChange={(e) => setSessionKey(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleLoad()}
                list="agent-session-history"
              />
              <datalist id="agent-session-history">
                {history.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <Button onClick={handleLoad} disabled={loading || !sessionKey.trim()}>
              {loading ? (
                <Loader2 className="w-4 h-4 mr-1 animate-spin" />
              ) : (
                <GitBranch className="w-4 h-4 mr-1" />
              )}
              加载
            </Button>
          </div>

          {history.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">最近:</span>
              {history.slice(0, 5).map((k) => (
                <Button
                  key={k}
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2 max-w-[12rem] truncate"
                  title={k}
                  onClick={() => {
                    setSessionKey(k)
                    void fetchTree(k)
                  }}
                >
                  {k}
                </Button>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

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
                      onClick={() => !isActive && setConfirmPoint(point)}
                      disabled={isActive || switching}
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
                      <p className="text-sm text-foreground/90">{point.preview || '（无预览）'}</p>
                    </button>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {sessionKey.trim() && (
        <p className="text-xs text-muted-foreground">
          查看编排运行：
          <Link
            to={agentOrchestrationPath(sessionKey.trim())}
            className="text-primary underline-offset-4 hover:underline ml-1"
          >
            前往编排运行页
          </Link>
        </p>
      )}

      <Dialog open={!!confirmPoint} onOpenChange={(open) => !open && setConfirmPoint(null)}>
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
              <Button variant="outline">取消</Button>
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
      </Dialog>
    </div>
  )
}
