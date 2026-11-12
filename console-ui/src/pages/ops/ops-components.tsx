import { useEffect, useRef } from 'react'
import { Power, RefreshCw } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { StatusState } from '../../components/StatusState'
import { instanceStateLabel, operationLabel, phaseLabel, transactionSummary, type GatewayErrorKind, type PackageProgressState } from './gateway-model.mjs'

/**
 * Load failure of a gateway read as one `StatusState`: an old gateway reads 需要新版 Host, a missing
 * permission 无权限 (with the permission), a busy database 数据库忙; anything else 读取失败 + retry.
 */
export function GatewayLoadError({ error, kind, failure, onRetry, permissions }: {
  error: string
  kind: GatewayErrorKind | null
  failure?: unknown
  onRetry: () => void
  permissions?: readonly string[]
}) {
  const i18n = useI18n()
  if (kind === 'unsupported') {
    return <StatusState kind="unsupported" title={i18n.t("需要新版网关")}
      description={i18n.t("当前 Host 不支持实例与依赖管理（ADR 0054）。用 zhin start 运行网关后，这里会显示实例状态、日志和依赖。")} />
  }
  return <StatusState error={failure ?? error} permissions={permissions} onRetry={onRetry} />
}

/** Phases, package manager output and the result of one gateway transaction. */
export function TransactionProgress({ progress, running, error }: { progress: PackageProgressState; running: boolean; error: string | null }) {
  const i18n = useI18n()
  const output = useRef<HTMLPreElement>(null)
  useEffect(() => {
    if (output.current) output.current.scrollTop = output.current.scrollHeight
  }, [progress.output])
  const result = progress.result
  const summary = result ? transactionSummary(result, i18n.t) : null
  const failedPhase = result?.failedPhase
  return (
    <section className="space-y-3 rounded-md border p-3" aria-label={i18n.t("依赖事务进度")} aria-busy={running}>
      <div className="flex items-center gap-2 text-sm font-medium">
        {running ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Power className="h-4 w-4" />}
        {running ? i18n.t("正在执行依赖事务…") : i18n.t("依赖事务")}
        {progress.operation ? <Badge size="sm" variant="secondary">{operationLabel(progress.operation, i18n.t)}</Badge> : null}
      </div>
      {progress.phases.length ? (
        <ol className="space-y-1 text-sm" role="status">
          {progress.phases.map((phase, index) => {
            const current = running && index === progress.phases.length - 1
            const failed = !running && phase === failedPhase
            return (
              <li key={`${phase}-${index}`} className={failed ? 'text-destructive' : current ? 'font-medium' : 'text-muted-foreground'}>
                {failed ? '✕' : current ? '…' : '✓'} {phaseLabel(phase, i18n.t)}
              </li>
            )
          })}
        </ol>
      ) : running ? <p className="text-sm text-muted-foreground">{i18n.t("等待网关报告进度…")}</p> : null}
      {progress.output ? (
        <pre ref={output} aria-label={i18n.t("包管理器输出")} className="max-h-56 overflow-auto rounded-md bg-muted p-2 font-mono text-xs leading-relaxed">{progress.output}</pre>
      ) : null}
      {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
      {result && summary ? (
        <Alert variant={summary.tone === 'success' ? 'success' : summary.tone === 'warning' ? 'warning' : 'destructive'}>
          <AlertTitle>{summary.title}</AlertTitle>
          <AlertDescription className="space-y-1 text-sm">
            {result.failedPhase ? <p>{i18n.t("失败阶段：{0}", [phaseLabel(result.failedPhase, i18n.t)])}</p> : null}
            {result.error ? <p>{i18n.t("错误：{0}", [result.error])}</p> : null}
            {result.rollbackError ? <p>{i18n.t("回滚未完成：{0}", [result.rollbackError])}</p> : null}
            <p className="text-xs text-muted-foreground">
              {i18n.t("实例状态：{0} → {1}", [instanceStateOrUnmanaged(result.instance.before, i18n.t), instanceStateOrUnmanaged(result.instance.after, i18n.t)])}
            </p>
            {result.logTail.length ? (
              <pre aria-label={i18n.t("实例日志尾部")} className="max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{result.logTail.join('\n')}</pre>
            ) : null}
          </AlertDescription>
        </Alert>
      ) : null}
    </section>
  )
}

function instanceStateOrUnmanaged(state: string, t: (message: string, values?: readonly unknown[]) => string): string {
  return state === 'unmanaged' ? t('未托管') : instanceStateLabel(state, t)
}
