import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { RefreshCw, Stethoscope } from 'lucide-react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../components/ui/dialog'
import { Button } from '../../components/ui/button'
import { apiFetch } from '../../utils/auth'
import { isDemoMode } from '../../utils/demo-mode'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { getInboxCacheScope, isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { CONSOLE_REST } from '../../contracts/zhin-console'
import { RenderingDiagnostics } from './RenderingDiagnostics'
import { diagnosticHelpLinks } from './diagnostic-help.mjs'
import type { ChatRow, DiagnosticConversation, SidebarSelection } from './types'
import { createDiagnosticRequestGate, diagnosticTarget, conversationDiagnosticTarget, diagnosticConversationKey, diagnosticQuery,
  readMessageDiagnostics, diagnosticLabel, diagnosticAdvice, DIAGNOSTIC_RETENTION, type MessageDiagnostic } from './message-diagnostics.mjs'

const DiagnosticScope = createContext<string | undefined>(undefined)
/** One connection subscription per conversation view, rather than per message row. */
export function MessageDiagnosticsProvider({ children }: { children: ReactNode }) {
  const scope = useInboxCacheScope()
  return <DiagnosticScope.Provider value={scope}>{children}</DiagnosticScope.Provider>
}

function ConversationLabel({ conversation }: { conversation: DiagnosticConversation }) {
  return <span className="break-all">{conversation.kind === 'private' ? '私聊' : conversation.kind === 'group' ? '群聊' : '频道'} · {conversation.id}
    {conversation.parent && ` · 父容器 ${conversation.parent.id}`}{conversation.threadId && ` · 话题 ${conversation.threadId}`}</span>
}

/** A user-initiated, read-only query. No message body or replay enters this request. */
export function MessageDiagnosticsAction({ message, endpoint, selection }: { message?: ChatRow; endpoint?: { id: string; adapter: string }; selection?: SidebarSelection | null }) {
  const scope = useContext(DiagnosticScope)
  const target = message ? diagnosticTarget(message) : conversationDiagnosticTarget(endpoint, selection)
  const reason = 'reason' in target ? target.reason : undefined
  const identity = JSON.stringify([scope, 'conversation' in target ? diagnosticConversationKey(target.conversation) : null, 'messageId' in target ? target.messageId : null, message?.id])
  const identityRef = useRef(identity); identityRef.current = identity
  const gate = useRef(createDiagnosticRequestGate(getInboxCacheScope))
  const [open, setOpen] = useState(false)
  const [records, setRecords] = useState<MessageDiagnostic[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [owner, setOwner] = useState(identity)
  const demo = isDemoMode()
  const title = message ? '消息处理诊断' : '本会话最近诊断'
  useEffect(() => {
    gate.current.cancel(); setOpen(false); setRecords([]); setError(null); setLoading(false)
    return () => gate.current.cancel()
  }, [identity])

  const close = () => { gate.current.cancel(); setOpen(false); setLoading(false); setRecords([]); setError(null) }
  const load = async () => {
    if ('reason' in target || demo || !isInboxCacheScopeActive(scope)) return
    const requestedIdentity = identity
    const request = gate.current.begin()
    const current = () => request.current() && identityRef.current === requestedIdentity && isInboxCacheScopeActive(scope)
    setOwner(identity); setLoading(true); setError(null); setRecords([])
    try {
      const response = await apiFetch(`${CONSOLE_REST.MESSAGE_DIAGNOSTICS}?${diagnosticQuery(target)}`, { signal: request.signal, cache: 'no-store' })
      if (!current()) return
      if (!response.ok) {
        const messages: Record<number, string> = { 404: '当前 Host 尚不支持消息诊断，请更新 Host 后重试；这不表示消息没有问题。',
          403: '当前身份无权读取消息诊断，需要 full scope。', 401: '登录已失效，请重新连接 Host。',
          503: 'Host 的 IM 消息诊断尚未就绪，请确认运行时已启动后刷新。' }
        throw new Error(messages[response.status] ?? `诊断读取失败（HTTP ${response.status}），请检查 Host 状态后刷新。`)
      }
      const result = readMessageDiagnostics(await response.json(), target)
      if (current()) setRecords(result)
    } catch (caught) {
      if (current()) setError(caught instanceof Error ? caught.message : '诊断读取失败，请检查连接后刷新。')
    } finally { if (current()) setLoading(false) }
  }
  const visible = owner === identity && isInboxCacheScopeActive(scope)
  return <>
    <button type="button" className={message ? undefined : 'im-header-icon-button h-8 px-2 text-xs inline-flex items-center gap-1 rounded-md hover:bg-accent'}
      disabled={demo || !isInboxCacheScopeActive(scope)} title={demo ? 'Demo 不开放消息诊断' : !isInboxCacheScopeActive(scope) ? '请先连接 Host' : reason ?? title}
      aria-label={message ? '诊断这条入站消息' : title} onClick={() => { setOpen(true); if (!reason) void load() }}>
      <Stethoscope className="h-3.5 w-3.5" />{!message && '最近诊断'}
    </button>
    <Dialog open={open} onOpenChange={value => { if (!value) close() }}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>只读查看实际处理阶段，不发送或重放消息。{DIAGNOSTIC_RETENTION}</DialogDescription></DialogHeader>
        {reason ? <p role="status" className="text-sm text-muted-foreground">{reason} 可从会话顶部查看“最近诊断”。</p> : <>
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">{message ? '按原始完整会话与平台消息 ID 查询' : '按当前完整会话查询最近 50 条记录'}</span>
            <Button variant="outline" size="sm" disabled={loading || demo} onClick={() => void load()}><RefreshCw className={`h-3.5 w-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新</Button></div>
          {visible && error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {visible && loading && <p role="status" className="text-sm text-muted-foreground">正在读取处理记录…</p>}
          {visible && !loading && !error && !records.length && <p role="status" className="text-sm text-muted-foreground">没有找到该范围的近期记录。{DIAGNOSTIC_RETENTION}</p>}
          {visible && records.map(record => <article key={record.id} className="rounded-lg border p-3 space-y-3 text-sm">
            <div className="flex flex-wrap items-center gap-2 font-medium"><span>{record.status === 'completed' ? '入站处理已结束' : diagnosticLabel(record.status)}</span>
              {record.route && <span className="text-muted-foreground">· {diagnosticLabel(record.route)}</span>}{record.dispatchStatus && <span className="text-muted-foreground">· {diagnosticLabel(record.dispatchStatus)}</span>}</div>
            {record.command && <div className="break-all">命中指令：{record.command}</div>}
            <p className="text-xs text-muted-foreground">{new Date(record.startedAt).toLocaleString('zh-CN')} · 入站处理结束不等于业务、Agent 或平台投递已完成。</p>
            {record.truncated && <p className="text-xs text-amber-700 dark:text-amber-300">步骤或投递超过保留上限，记录不完整，请结合日志排查。</p>}
            <ol className="space-y-1" aria-label="实际处理步骤">{record.steps.map((step, index) => <li key={index} className="flex flex-wrap gap-x-2"><span className="text-muted-foreground tabular-nums">{index + 1}.</span><span>{diagnosticLabel(step.stage)}</span><span>{diagnosticLabel(step.status)}</span><span className="text-xs text-muted-foreground">+{Math.max(0, step.at - record.startedAt)} ms</span></li>)}</ol>
            <div className="space-y-2" aria-label="实际投递记录">{record.deliveries.map((delivery, index) => <div key={index} className="rounded-md bg-muted/50 p-2 text-xs space-y-1">
              <div className="font-medium">投递 {index + 1}：{delivery.deliveryUnknown ? '结果不确定' : diagnosticLabel(delivery.status)}</div>
              <div>实际目标：<ConversationLabel conversation={delivery.conversation} /></div>
              {delivery.status === 'sent' && <p>仅表示平台已受理，不保证客户端显示或接收者已读。</p>}
              <RenderingDiagnostics rendering={delivery.rendering} projection />
              {delivery.failureCode && <details><summary className="cursor-pointer text-muted-foreground">错误代码</summary><code className="break-all">{delivery.failureCode}</code></details>}
              <details><summary className="cursor-pointer text-muted-foreground">实际目标身份</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify(delivery.conversation, null, 2)}</pre></details>
            </div>)}</div>
            {diagnosticAdvice(record).map(advice => <p key={advice} className="text-xs leading-relaxed text-muted-foreground">{advice}</p>)}
            <nav aria-label="对应问题的处理方法" className="space-y-1 border-t pt-2 text-xs">
              <p className="font-medium">查看处理方法</p>
              {diagnosticHelpLinks(record).map(link => <a key={link.id} href={link.href} target="_blank" rel="noopener noreferrer" className="block underline underline-offset-2">{link.label}</a>)}
            </nav>
            <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">记录身份与版本</summary><pre className="whitespace-pre-wrap break-all">{JSON.stringify({ id: record.id, generation: record.generation, messageId: record.messageId, conversation: record.conversation }, null, 2)}</pre></details>
          </article>)}
        </>}
      </DialogContent>
    </Dialog>
  </>
}
