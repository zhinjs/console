import { useCallback, useRef, useState } from 'react'
import { AlertCircle, CheckCircle, Loader2, SearchCheck } from 'lucide-react'
import { Alert, AlertDescription, AlertTitle, Button } from '@zhin.js/console-ui'
import { useI18n } from '../../i18n'
import { STATUS_COPY, statusFromError } from '../../components/status-state-model.mjs'
import { runWriteCheck, writeCheckCopy, type WriteCheckPlan, type WriteCheckVerdict } from './write-check-model.mjs'

type Row = Record<string, unknown>

export interface UnknownWrite {
  readonly plan: WriteCheckPlan
  readonly details: string
  /** `manual`: the check could not tell; the editor may only be closed. */
  readonly phase: 'unknown' | 'checking' | 'manual'
  readonly checkError?: string
}

export interface WriteCheckResult { readonly kind: WriteCheckPlan['kind']; readonly verdict: WriteCheckVerdict; readonly count: number }

/**
 * Holds a database write whose outcome is unknown (#64 database-insert-unknown-outcome). While it is
 * held the page must not send that write again: `locked` gates 保存 / 删除 and closing the editor;
 * only `check` (a db:select) settles it.
 */
export function useWriteCheck(select: (where: Row) => Promise<{ rows?: unknown[]; total?: number }>, definitions?: Record<string, { type?: string }>) {
  const i18n = useI18n()
  const [pending, setPending] = useState<UnknownWrite | null>(null)
  const [result, setResult] = useState<WriteCheckResult | null>(null)
  const checking = useRef(false)

  const markUnknown = useCallback((plan: WriteCheckPlan, details: string) => { setResult(null); setPending({ plan, details, phase: 'unknown' }) }, [])
  const dismiss = useCallback(() => { setPending(null); setResult(null) }, [])

  const check = useCallback(async (): Promise<WriteCheckResult | null> => {
    if (!pending || pending.phase !== 'unknown' || checking.current) return null
    checking.current = true
    setPending({ ...pending, phase: 'checking', checkError: undefined })
    try {
      const { verdict, count = 0 } = await runWriteCheck(pending.plan, select, definitions)
      if (verdict === 'undetermined') { setPending({ ...pending, phase: 'manual', checkError: undefined }); return null }
      const settled = { kind: pending.plan.kind, verdict, count }
      setPending(null)
      setResult(settled)
      return settled
    } catch (error) {
      const status = statusFromError(error)
      setPending({ ...pending, phase: 'unknown', checkError: i18n.t('核对没有完成（{0}），结果仍未知。请稍后再核对。', [i18n.t(STATUS_COPY[status.kind as keyof typeof STATUS_COPY]?.title ?? '读取失败')]) })
      return null
    } finally {
      checking.current = false
    }
  }, [pending, select, definitions, i18n])

  return { pending, result, locked: pending !== null && pending.phase !== 'manual', held: pending !== null, markUnknown, dismiss, check, clearResult: () => setResult(null) }
}

/** 「结果未知」 notice with 「核对」 as its only action, then the check's verdict. */
export function WriteCheckNotice({ controller, className, onCheck }: { controller: ReturnType<typeof useWriteCheck>; className?: string; /** Runs the check and what follows it (reload, close); defaults to `controller.check`. */ onCheck?: () => void }) {
  const i18n = useI18n()
  const { pending, result } = controller
  if (pending) {
    const checking = pending.phase === 'checking'
    return (
      <Alert variant="warning" className={className} data-write-unknown={pending.plan.kind}>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>{i18n.t('结果未知')}</AlertTitle>
        <AlertDescription className="space-y-2">
          <p>{pending.phase === 'manual'
            ? i18n.t(writeCheckCopy(pending.plan.kind, 'undetermined'))
            : i18n.t('请求已发出，但没有收到可信的答复，可能已经写入。请先核对，不要直接重试。')}</p>
          {pending.checkError ? <p role="alert">{pending.checkError}</p> : null}
          {pending.details ? <details className="text-xs"><summary className="cursor-pointer">{i18n.t('技术详情')}</summary><p className="mt-2 whitespace-pre-wrap break-words">{pending.details}</p></details> : null}
          {pending.phase !== 'manual' ? <Button type="button" size="sm" variant="outline" disabled={checking} data-action="write-check" onClick={() => { if (onCheck) onCheck(); else void controller.check() }}>
            {checking ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <SearchCheck className="mr-1 h-3.5 w-3.5" />}
            {checking ? i18n.t('正在核对…') : i18n.t('核对')}
          </Button> : null}
        </AlertDescription>
      </Alert>
    )
  }
  if (result) {
    return (
      <Alert variant={result.verdict === 'applied' ? 'success' : 'default'} className={className} role="status" data-write-check-result={result.verdict}>
        <CheckCircle className="h-4 w-4" />
        <AlertDescription>{i18n.t(writeCheckCopy(result.kind, result.verdict), [result.count])}</AlertDescription>
      </Alert>
    )
  }
  return null
}
