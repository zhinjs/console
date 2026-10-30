import { useCallback, useEffect, useRef, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card'
import { Alert, AlertDescription } from '../components/ui/alert'
import { ConfirmDialog } from '../components/confirm-dialog'
import { captureApiRequestContext, type ApiRequestContext } from '../utils/auth'
import { pluginRpc } from '../utils/plugin-rpc'
import { isDemoMode } from '../utils/demo-mode'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { isKnownApprovalRejection, readToolApprovalCard, readToolApprovals, type ToolApprovalCard, type ToolApprovals } from './tool-approvals-model.mjs'

type Review = { card: ToolApprovalCard; decision: 'approve' | 'deny' }
interface Owner {
  readonly context: ApiRequestContext
  readonly controller: AbortController
  active: boolean
  writing: boolean
  uncertain: boolean
  review?: Review
  read?: Promise<void>
}

/** Host operator authority remains with the existing RPC, separate from any Sandbox IM user. */
export function HostToolApprovalsPanel() {
  const scope = useInboxCacheScope()
  return <HostToolApprovalSession key={scope ?? 'disconnected'} scope={scope} />
}

export function HostToolApprovalSession({ scope }: { scope?: string }) {
  const i18n = useI18n()
  const owner = useRef<Owner | null>(null)
  const [catalog, setCatalog] = useState<ToolApprovals | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const demo = isDemoMode(), current = isInboxCacheScopeActive(scope)
  const owns = (candidate: Owner) => owner.current === candidate && candidate.active && isInboxCacheScopeActive(scope)

  const refresh = useCallback(async () => {
    const active = owner.current
    if (!active || !owns(active) || active.writing || demo) return
    if (active.read) return active.read
    active.review = undefined
    setReview(null)
    setLoading(true)
    active.read = (async () => {
      try {
        const next = readToolApprovals(await pluginRpc('root', 'tool-approvals', undefined, {
          signal: active.controller.signal, context: active.context,
        }))
        if (!owns(active)) return
        setCatalog(next)
        setError(null)
        active.uncertain = false
        setUncertain(false)
      } catch (caught) {
        if (owns(active)) { setCatalog(null); setError(caught instanceof Error ? caught.message : String(caught)) }
      } finally {
        active.read = undefined
        if (owns(active)) setLoading(false)
      }
    })()
    return active.read
  }, [scope, demo])

  useEffect(() => {
    if (demo || !isInboxCacheScopeActive(scope)) return
    const active: Owner = { context: captureApiRequestContext(), controller: new AbortController(), active: true, writing: false, uncertain: false }
    owner.current = active
    void refresh()
    return () => {
      active.active = false
      active.controller.abort()
      if (owner.current === active) owner.current = null
    }
  }, [scope, demo, refresh])

  const prepare = (card: ToolApprovalCard, decision: Review['decision']) => {
    const active = owner.current
    if (!active || !owns(active) || active.writing || active.read || active.uncertain || demo) return
    active.review = { card, decision }
    setReview(active.review)
  }

  const decide = async () => {
    const active = owner.current, confirmed = review
    if (!active || !confirmed || active.review !== confirmed || !owns(active) || active.writing || active.read || active.uncertain || demo) return
    active.writing = true
    active.review = undefined
    setBusy(true)
    setError(null)
    setReview(null)
    let readCurrent = false
    let rejection: string | null = null
    try {
      // Do not abort or replay a submitted decision: losing its response does not undo the settlement.
      const settled = readToolApprovalCard(await pluginRpc('root', 'resolve-tool-approval', {
        id: confirmed.card.id, decision: confirmed.decision,
      }, { context: active.context }))
      if (!owns(active)) return
      if (settled.id !== confirmed.card.id || settled.status !== (confirmed.decision === 'approve' ? 'approved' : 'denied')) {
        throw new Error(i18n.t('审批回执与本次请求不一致'))
      }
      readCurrent = true
    } catch (caught) {
      if (!owns(active)) return
      if (isKnownApprovalRejection(caught)) {
        rejection = caught instanceof Error ? caught.message : String(caught)
        readCurrent = true
      } else {
        active.uncertain = true
        setUncertain(true)
        setError(i18n.t('审批结果尚未确认，请重新读取后核对。'))
      }
    } finally {
      active.writing = false
      if (owns(active)) {
        setBusy(false)
        if (readCurrent) await refresh()
        if (rejection && owns(active)) setError(rejection)
      }
    }
  }

  const disabled = demo || !current || loading || busy || uncertain
  return <Card id="tool-approvals">
    <CardHeader className="flex-row items-center justify-between gap-3">
      <CardTitle>{i18n.t('Host 工具审批')}</CardTitle>
      <Button variant="outline" size="sm" disabled={demo || !current || loading || busy} onClick={() => void refresh()} aria-label={i18n.t('刷新工具审批')}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>
    </CardHeader>
    <CardContent className="space-y-3">
      {error && current && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {demo ? <p className="text-sm text-muted-foreground">{i18n.t('Demo 只读')}</p>
        : !current ? <p className="text-sm text-muted-foreground">{i18n.t('连接 Host 后读取工具审批')}</p>
        : loading && !catalog ? <p role="status">{i18n.t('正在读取工具审批…')}</p>
        : catalog?.available === false ? <p className="text-sm text-muted-foreground">{i18n.t('当前 Agent 未提供工具审批队列')}</p>
        : catalog?.pending.length === 0 ? <p className="text-sm text-muted-foreground">{i18n.t('当前没有待审批的工具请求')}</p> : null}
      {current && catalog?.pending.map(card => <article key={card.id} className="space-y-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-medium break-all">{card.toolName}</h3><time className="text-xs text-muted-foreground">{i18n.t('有效期至 {0}', [new Date(card.expiresAt).toLocaleString(i18n.locale)])}</time></div>
        <p className="text-xs text-muted-foreground break-all">{i18n.t('发起会话：')}{card.sessionKey}{card.requesterId && <> · {i18n.t('发起人：')}{card.requesterId}</>}</p>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-3 text-xs">{JSON.stringify(card.args, null, 2)}</pre>
        <div className="flex gap-2"><Button size="sm" disabled={disabled} onClick={() => prepare(card, 'approve')}>{i18n.t('批准一次')}</Button><Button size="sm" variant="outline" disabled={disabled} onClick={() => prepare(card, 'deny')}>{i18n.t('拒绝')}</Button></div>
      </article>)}
      <ConfirmDialog open={Boolean(review && current)} onOpenChange={open => {
        const active = owner.current
        if (!open && active && owns(active)) { active.review = undefined; setReview(null) }
      }}
        title={i18n.t(review?.decision === 'approve' ? '确认批准本次工具请求' : '确认拒绝本次工具请求')}
        description={review?.card.toolName} confirmLabel={i18n.t(review?.decision === 'approve' ? '批准一次' : '拒绝')}
        variant={review?.decision === 'deny' ? 'destructive' : 'default'} onConfirm={decide}>
        {review && current && <div className="max-h-[50vh] overflow-auto space-y-2 text-xs">
          <p className="break-all">{review.card.id}</p><p className="break-all">{review.card.sessionKey}</p>
          <pre className="whitespace-pre-wrap break-all">{JSON.stringify(review.card.args, null, 2)}</pre>
        </div>}
      </ConfirmDialog>
    </CardContent>
  </Card>
}
