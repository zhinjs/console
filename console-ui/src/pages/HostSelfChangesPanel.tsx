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
import { isKnownApprovalRejection } from './tool-approvals-model.mjs'
import {
  diffLineTone,
  formatBytes,
  needsHandling,
  readSelfChangeCard,
  readSelfChangeDetail,
  readSelfChanges,
  selfChangeFiles,
  selfChangeSummary,
  skippedCheckNames,
  type SelfChangeCard,
  type SelfChangeDetail,
  type SelfChangeDetailFile,
  type SelfChanges,
} from './self-changes-model.mjs'

type Decision = 'approve' | 'reject' | 'handled'
type Review = { change: SelfChangeCard; decision: Decision }
interface Owner {
  readonly context: ApiRequestContext
  readonly controller: AbortController
  active: boolean
  writing: boolean
  uncertain: boolean
  review?: Review
  read?: Promise<void>
}

const RECENT_SHOWN = 10
const DIFF_TONE_CLASS: Record<ReturnType<typeof diffLineTone>, string> = {
  header: 'text-muted-foreground',
  hunk: 'text-info',
  added: 'bg-success/10 text-success',
  removed: 'bg-destructive/10 text-destructive',
  context: '',
}
const UNAVAILABLE_LABELS: Record<string, string> = {
  slimmed: '正文已按保留规则清理，无法展示 diff',
  staged_unreadable: '暂存正文不可读',
  baseline_unreadable: '原文件过大、是符号链接或不可读',
  budget_exhausted: '超出 64 KB 展示预算，未展示',
}

/** Controlled self-change approvals (zhin ADR 0040, #1142 F3): list, full diff detail, approve / reject, mark handled. */
export function HostSelfChangesPanel() {
  const scope = useInboxCacheScope()
  return <HostSelfChangeSession key={scope ?? 'disconnected'} scope={scope} />
}

export function HostSelfChangeSession({ scope }: { scope?: string }) {
  const i18n = useI18n()
  const owner = useRef<Owner | null>(null)
  const [catalog, setCatalog] = useState<SelfChanges | null>(null)
  const [detail, setDetail] = useState<SelfChangeDetail | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)
  const [detailLoading, setDetailLoading] = useState(false)
  const [detailError, setDetailError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [review, setReview] = useState<Review | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [uncertain, setUncertain] = useState(false)
  const demo = isDemoMode()
  const current = isInboxCacheScopeActive(scope)
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
        const response = await pluginRpc('root', 'self-changes', undefined, {
          signal: active.controller.signal,
          context: active.context,
        })
        const next = readSelfChanges(response)
        if (!owns(active)) return
        setCatalog(next)
        setError(null)
        active.uncertain = false
        setUncertain(false)
      } catch (caught) {
        if (owns(active)) {
          setCatalog(null)
          setError(caught instanceof Error ? caught.message : String(caught))
        }
      } finally {
        active.read = undefined
        if (owns(active)) setLoading(false)
      }
    })()
    return active.read
  }, [scope, demo])

  useEffect(() => {
    if (demo || !isInboxCacheScopeActive(scope)) return
    const active: Owner = {
      context: captureApiRequestContext(),
      controller: new AbortController(),
      active: true,
      writing: false,
      uncertain: false,
    }
    owner.current = active
    void refresh()
    return () => {
      active.active = false
      active.controller.abort()
      if (owner.current === active) owner.current = null
    }
  }, [scope, demo, refresh])

  const loadDetail = async (change: SelfChangeCard) => {
    const active = owner.current
    if (!active || !owns(active) || demo) return
    setDetailId(change.id)
    setDetail(null)
    setDetailError(null)
    setDetailLoading(true)
    try {
      const response = await pluginRpc('root', 'self-change-detail', { id: change.id }, {
        signal: active.controller.signal,
        context: active.context,
      })
      const next = readSelfChangeDetail(response)
      if (!owns(active)) return
      if (next.change.id !== change.id) throw new Error(i18n.t('变更详情与所选变更不一致'))
      setDetail(next)
    } catch (caught) {
      if (!owns(active)) return
      const message = caught instanceof Error ? caught.message : String(caught)
      const code = (caught as { code?: unknown } | null)?.code
      setDetailError(code === 'forbidden' ? i18n.t('查看完整 diff 需要 ops:approve 权限（{0}）', [message]) : message)
    } finally {
      if (owns(active)) setDetailLoading(false)
    }
  }

  const closeDetail = () => {
    setDetailId(null)
    setDetail(null)
    setDetailError(null)
  }

  const prepare = (change: SelfChangeCard, decision: Decision) => {
    const active = owner.current
    if (!active || !owns(active) || active.writing || active.read || active.uncertain || demo) return
    active.review = { change, decision }
    setReview(active.review)
  }

  const decide = async () => {
    const active = owner.current
    const confirmed = review
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
      const response = confirmed.decision === 'handled'
        ? await pluginRpc('root', 'mark-self-change-handled', { id: confirmed.change.id }, { context: active.context })
        : await pluginRpc('root', 'resolve-self-change', { id: confirmed.change.id, decision: confirmed.decision }, { context: active.context })
      const settled = readSelfChangeCard(response)
      if (!owns(active)) return
      if (settled.id !== confirmed.change.id || !matchesDecision(settled, confirmed.decision)) {
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
        if (readCurrent) {
          closeDetail()
          await refresh()
        }
        if (rejection && owns(active)) setError(rejection)
      }
    }
  }

  const disabled = demo || !current || loading || busy || uncertain
  const failed = catalog?.recent.filter(needsHandling) ?? []
  const recent = catalog?.recent.filter(change => !needsHandling(change)).slice(0, RECENT_SHOWN) ?? []
  const reviewedDetail = review && detail?.change.id === review.change.id ? detail : null

  const renderChange = (change: SelfChangeCard, actions: 'pending' | 'failed') => {
    const files = selfChangeFiles(change)
    const skipped = skippedCheckNames(change.trial)
    return <article key={change.id} className="space-y-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-medium break-all">{selfChangeSummary(change)}</h3>
        <span className="text-xs text-muted-foreground">{i18n.t('状态：')}{change.status}</span>
      </div>
      <p className="text-xs text-muted-foreground break-all">{i18n.t('变更：')}{change.id} · {formatBytes(change.bytes)}</p>
      {files.length > 0 && <ul className="space-y-1 text-xs">
        {files.map(file => <li key={file.path} className="break-all font-mono">{file.kind} {file.path}（+{file.added} -{file.removed}）</li>)}
      </ul>}
      {change.configPaths.length > 0 && <p className="text-xs break-all">{i18n.t('配置：')}{change.configPaths.join('，')}</p>}
      {skipped.length > 0 && <p className="text-xs text-warning break-all">{i18n.t('试跑跳过：')}{skipped.join('，')}</p>}
      {change.error && <p className="text-xs text-destructive break-all">{change.error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" disabled={demo || !current || detailLoading} onClick={() => void loadDetail(change)}>{i18n.t('查看完整 diff')}</Button>
        {actions === 'pending' && <>
          <Button size="sm" disabled={disabled} onClick={() => prepare(change, 'approve')}>{i18n.t('批准变更')}</Button>
          <Button size="sm" variant="outline" disabled={disabled} onClick={() => prepare(change, 'reject')}>{i18n.t('驳回变更')}</Button>
        </>}
        {actions === 'failed' && <Button size="sm" variant="outline" disabled={disabled} onClick={() => prepare(change, 'handled')}>{i18n.t('标记已处理')}</Button>}
      </div>
      {detailId === change.id && <SelfChangeDetailView detail={detail} loading={detailLoading} error={detailError} onClose={closeDetail} />}
    </article>
  }

  return <Card id="self-changes">
    <CardHeader className="flex-row items-center justify-between gap-3">
      <CardTitle>{i18n.t('自我变更审批')}</CardTitle>
      <Button variant="outline" size="sm" disabled={demo || !current || loading || busy} onClick={() => void refresh()} aria-label={i18n.t('刷新自我变更')}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>
    </CardHeader>
    <CardContent className="space-y-3">
      {error && current && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
      {demo ? <p className="text-sm text-muted-foreground">{i18n.t('Demo 只读')}</p>
        : !current ? <p className="text-sm text-muted-foreground">{i18n.t('连接 Host 后读取自我变更')}</p>
        : loading && !catalog ? <p role="status">{i18n.t('正在读取自我变更…')}</p>
        : catalog?.available === false ? <p className="text-sm text-muted-foreground">{i18n.t('当前 Agent 未启用自我变更')}</p>
        : catalog?.pending.length === 0 ? <p className="text-sm text-muted-foreground">{i18n.t('当前没有待审批的自我变更')}</p> : null}
      {current && catalog?.available && <p className="text-xs text-muted-foreground">{i18n.t('暂存区占用：{0}', [formatBytes(catalog.usageBytes)])}</p>}
      {current && catalog?.pending.map(change => renderChange(change, 'pending'))}
      {current && failed.length > 0 && <section className="space-y-3">
        <h3 className="text-sm font-medium">{i18n.t('急停待处理')}</h3>
        {failed.map(change => renderChange(change, 'failed'))}
      </section>}
      {current && recent.length > 0 && <section className="space-y-2">
        <h3 className="text-sm font-medium">{i18n.t('最近的变更')}</h3>
        <ul className="space-y-1 text-xs">
          {recent.map(change => <li key={change.id} className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="break-all">{selfChangeSummary(change)}</span>
              <span className="text-muted-foreground">{change.status}</span>
              <Button size="sm" variant="ghost" disabled={demo || !current || detailLoading} onClick={() => void loadDetail(change)}>{i18n.t('详情')}</Button>
            </div>
            {detailId === change.id && <SelfChangeDetailView detail={detail} loading={detailLoading} error={detailError} onClose={closeDetail} />}
          </li>)}
        </ul>
      </section>}
      <ConfirmDialog open={Boolean(review && current)} onOpenChange={open => {
        const active = owner.current
        if (!open && active && owns(active)) {
          active.review = undefined
          setReview(null)
        }
      }}
        title={i18n.t(reviewTitle(review?.decision))}
        description={review ? selfChangeSummary(review.change) : undefined}
        confirmLabel={i18n.t(reviewConfirmLabel(review?.decision))}
        variant={review?.decision === 'approve' ? 'default' : 'destructive'}
        onConfirm={decide}>
        {review && current && <div className="max-h-[50vh] overflow-auto space-y-2 text-xs">
          <p className="break-all">{review.change.id}</p>
          <p className="break-all">{i18n.t('内容摘要：')}{review.change.contentHash}</p>
          {review.decision === 'approve' && !reviewedDetail && <p className="text-warning">{i18n.t('你还没有查看这个变更的完整 diff，请先查看再批准，不要盲批。')}</p>}
          {review.decision === 'approve' && <p>{i18n.t('批准只对这一版内容有效；批准后会写入生产目录并按影响面热重载或受控重启。')}</p>}
        </div>}
      </ConfirmDialog>
    </CardContent>
  </Card>
}

function SelfChangeDetailView({ detail, loading, error, onClose }: {
  detail: SelfChangeDetail | null
  loading: boolean
  error: string | null
  onClose: () => void
}) {
  const i18n = useI18n()
  return <section className="space-y-3 rounded-md border bg-muted/20 p-3" aria-label={i18n.t('变更详情')}>
    <div className="flex items-center justify-between gap-2">
      <h4 className="text-sm font-medium">{i18n.t('变更详情')}</h4>
      <Button size="sm" variant="ghost" onClick={onClose}>{i18n.t('收起')}</Button>
    </div>
    {loading && <p role="status" className="text-xs">{i18n.t('正在读取变更详情…')}</p>}
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {detail && <>
      {!detail.bodiesAvailable && <Alert><AlertDescription>{i18n.t('正文已按保留规则清理，无法展示 diff')}</AlertDescription></Alert>}
      {detail.bodiesAvailable && <p className="text-xs text-muted-foreground">
        {i18n.t(detail.baseline === 'snapshot' ? '改动前：回滚快照' : '改动前：生产目录现有文件')} · {i18n.t('diff {0} / {1}', [formatBytes(detail.diffBytes), formatBytes(detail.maxDiffBytes)])}
        {detail.diffTruncated && <> · <span className="text-warning">{i18n.t('部分内容已截断')}</span></>}
      </p>}
      {detail.files.map(file => <SelfChangeFileDiffView key={file.path} file={file} />)}
      {detail.configPatch && <div className="space-y-1">
        <h5 className="text-xs font-medium">{i18n.t('配置补丁（值已脱敏）')}</h5>
        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/40 p-3 text-xs">{JSON.stringify(detail.configPatch.operations, null, 2)}</pre>
      </div>}
      {detail.trial && <div className="space-y-1">
        <h5 className="text-xs font-medium">{i18n.t(detail.trial.passed ? '试跑：通过' : '试跑：未通过或未知')}</h5>
        {detail.trial.skippedChecks.length > 0 && <p className="text-xs text-warning break-all">{i18n.t('试跑跳过：')}{detail.trial.skippedChecks.join('，')}</p>}
        {detail.trial.pendingStages.length > 0 && <p className="text-xs text-muted-foreground break-all">{i18n.t('未执行的阶段：')}{detail.trial.pendingStages.join('，')}</p>}
        <ul className="space-y-1 text-xs font-mono">
          {detail.trial.checks.map((check, index) => <li key={index} className={check.status === 'skipped' ? 'text-warning' : check.status === 'failed' ? 'text-destructive' : ''}>
            {check.status} {check.check} {check.path}{check.message ? ` — ${check.message}` : ''}
          </li>)}
        </ul>
      </div>}
      <p className="text-xs text-muted-foreground">{i18n.t('暂存区占用：{0}', [formatBytes(detail.usageBytes)])}</p>
    </>}
  </section>
}

function SelfChangeFileDiffView({ file }: { file: SelfChangeDetailFile }) {
  const i18n = useI18n()
  const reason = file.unavailableReason ? UNAVAILABLE_LABELS[file.unavailableReason] ?? '不可用' : null
  return <div className="space-y-1">
    <h5 className="text-xs font-medium font-mono break-all">{file.kind} {file.path}</h5>
    {file.diff === null && <p className="text-xs text-muted-foreground">{i18n.t(reason ?? '不可用')}</p>}
    {file.diff === '' && <p className="text-xs text-muted-foreground">{i18n.t('与改动前相同')}</p>}
    {file.diff && <pre className="max-h-96 overflow-auto rounded-md bg-muted/40 p-3 text-xs font-mono leading-5">
      {file.diff.split('\n').map((line, index) => <div key={index} className={`whitespace-pre ${DIFF_TONE_CLASS[diffLineTone(line)]}`}>{line || ' '}</div>)}
    </pre>}
    {file.diff !== null && file.truncated && <p className="text-xs text-warning">{i18n.t('该文件 diff 已按展示预算截断')}</p>}
  </div>
}

function matchesDecision(settled: SelfChangeCard, decision: Decision): boolean {
  if (decision === 'handled') return settled.resolvedAt !== null
  if (decision === 'reject') return settled.status === 'rejected'
  return ['approved', 'applying', 'verifying', 'applied'].includes(settled.status)
}

function reviewTitle(decision: Decision | undefined): string {
  if (decision === 'approve') return '确认批准这个自我变更'
  if (decision === 'reject') return '确认驳回这个自我变更'
  return '确认已处理这个急停变更'
}

function reviewConfirmLabel(decision: Decision | undefined): string {
  if (decision === 'approve') return '批准变更'
  if (decision === 'reject') return '驳回变更'
  return '标记已处理'
}
