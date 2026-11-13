import { useI18n } from '../../i18n'
import { useCallback, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { Play, History, Trash2, Loader2, Eye, EyeOff, ShieldAlert } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Textarea } from '../../components/ui/textarea'
import { Badge } from '../../components/ui/badge'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { StatusState } from '../../components/StatusState'
import { ConfirmDialog } from '../../components/confirm-dialog'
import {
  affectedRows, cellText, clearSqlHistory, databaseRefusalCode, isSensitiveColumn, isUnsupportedRpcError, MASK,
  pushSqlHistory, readSqlHistory, sqlLooksReadOnly, type SqlHistoryEntry,
} from './database-console-model.mjs'
import type { DatabaseAdmin } from './use-database-console'
import type { DbExecuteResult, DbQueryResult } from './database-types'

function browserStorage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

type Outcome =
  | { readonly kind: 'rows'; readonly result: DbQueryResult; readonly sql: string }
  | { readonly kind: 'write'; readonly result: DbExecuteResult; readonly sql: string }
  | { readonly kind: 'error'; readonly error: unknown; readonly sql: string; readonly durationMs: number }

/**
 * Raw SQL console. Reads (`db:query`) run in a read-only transaction on the Host; anything else is a
 * write (`db:execute`, `ops.database.schema`) that is dry-run first to show the affected rows.
 */
export function SqlConsole({ admin, canWrite, supported, reason, dialect }: {
  admin: DatabaseAdmin
  /** The principal holds `ops.database.schema`. */
  canWrite: boolean
  /** The Host reports `capabilities.sql`. */
  supported: boolean
  reason?: string
  dialect: string
}) {
  const i18n = useI18n()
  const storage = useMemo(browserStorage, [])
  const [sql, setSql] = useState('')
  const [running, setRunning] = useState(false)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [history, setHistory] = useState<SqlHistoryEntry[]>(() => readSqlHistory(storage))
  const [showHistory, setShowHistory] = useState(false)
  const [pendingWrite, setPendingWrite] = useState<{ sql: string; estimate: DbExecuteResult } | null>(null)
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  const [unsupported, setUnsupported] = useState(false)
  const editor = useRef<HTMLTextAreaElement | null>(null)

  const remember = useCallback((text: string, ok: boolean) => setHistory(previous => pushSqlHistory(storage, { sql: text, ok }, previous)), [storage])

  const run = useCallback(async () => {
    const text = sql.trim()
    if (!text || running) return
    setRunning(true)
    setRevealed(new Set())
    const started = performance.now()
    try {
      if (sqlLooksReadOnly(text) || !canWrite) {
        const result = await admin.query(text)
        setOutcome({ kind: 'rows', result, sql: text })
        remember(text, true)
      } else {
        // Dry run inside a transaction that is rolled back: the Host reports how many rows would change.
        const estimate = await admin.execute(text, true)
        setPendingWrite({ sql: text, estimate })
      }
    } catch (error) {
      if (isUnsupportedRpcError(error)) setUnsupported(true)
      setOutcome({ kind: 'error', error, sql: text, durationMs: Math.round(performance.now() - started) })
      remember(text, false)
    } finally {
      setRunning(false)
    }
  }, [sql, running, canWrite, admin, remember])

  const applyWrite = async () => {
    if (!pendingWrite) return
    const text = pendingWrite.sql
    try {
      const result = await admin.execute(text)
      setOutcome({ kind: 'write', result, sql: text })
      remember(text, true)
      setPendingWrite(null)
    } catch (error) {
      remember(text, false)
      throw error
    }
  }

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault()
      void run()
    }
  }

  if (!supported || unsupported) {
    return <StatusState kind="unsupported" title={i18n.t('SQL 查询不可用')}
      description={reason || i18n.t('当前 Host 或数据库不支持 SQL 查询（需要 SQLite、MySQL 或 PostgreSQL，并升级 Host）。')} />
  }

  const estimate = pendingWrite ? affectedRows(pendingWrite.estimate) : null
  const refusal = outcome?.kind === 'error' ? databaseRefusalCode(outcome.error) : ''

  return (
    <div className="flex h-full min-h-0 flex-col gap-3" data-sql-console>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Badge variant="secondary" size="sm">{dialect}</Badge>
        <span className="text-xs text-muted-foreground">
          {canWrite ? i18n.t('只读语句直接执行；写语句会先预估影响行数并要求确认。') : i18n.t('只能执行单条只读语句（SELECT / WITH / EXPLAIN 等），最多返回 1000 行。')}
        </span>
        <Button type="button" size="sm" variant="ghost" className="ml-auto" aria-expanded={showHistory} onClick={() => setShowHistory(open => !open)}>
          <History className="w-3.5 h-3.5 mr-1" />{i18n.t('历史')}{history.length ? ` (${history.length})` : ''}</Button>
      </div>

      {showHistory ? (
        <div className="shrink-0 max-h-48 overflow-auto rounded-md border bg-muted/20" role="region" aria-label={i18n.t('查询历史')}>
          {history.length ? <ul className="divide-y">
            {history.map(entry => (
              <li key={`${entry.at}-${entry.sql}`}>
                <button type="button" className="w-full px-3 py-1.5 text-left font-mono text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  onClick={() => { setSql(entry.sql); setShowHistory(false); editor.current?.focus() }}>
                  <span className={entry.ok ? 'text-foreground' : 'text-destructive'}>{entry.sql.length > 160 ? `${entry.sql.slice(0, 160)}…` : entry.sql}</span>
                  <span className="ml-2 text-muted-foreground">{new Date(entry.at).toLocaleString(i18n.locale)}</span>
                </button>
              </li>
            ))}
          </ul> : <p className="p-3 text-xs text-muted-foreground">{i18n.t('还没有执行过语句。历史只保存在这个浏览器里。')}</p>}
          {history.length ? <div className="border-t p-1.5 text-right">
            <Button type="button" size="sm" variant="ghost" onClick={() => setHistory(clearSqlHistory(storage))}><Trash2 className="w-3.5 h-3.5 mr-1" />{i18n.t('清空历史')}</Button>
          </div> : null}
        </div>
      ) : null}

      <div className="shrink-0 space-y-2">
        <Textarea ref={editor} value={sql} spellCheck={false} aria-label={i18n.t('SQL 语句')}
          className="min-h-[7.5rem] font-mono text-xs leading-5" placeholder="SELECT * FROM … LIMIT 50"
          onChange={event => setSql(event.target.value)} onKeyDown={onKeyDown} />
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" disabled={!sql.trim() || running} onClick={() => { void run() }} data-action="run-sql">
            {running ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1" />}{i18n.t('执行')}</Button>
          <kbd className="text-xs text-muted-foreground">Ctrl / ⌘ + Enter</kbd>
          {outcome && outcome.kind !== 'error' ? (
            <span className="ml-auto text-xs text-muted-foreground" data-sql-summary>
              {outcome.kind === 'rows'
                ? i18n.t('{0} 行 · {1} ms{2}', [outcome.result.rowCount, outcome.result.durationMs, outcome.result.truncated ? i18n.t(' · 只显示前 {0} 行', [outcome.result.rows.length]) : ''])
                : i18n.t('已执行 {0} 条语句 · {1} ms', [outcome.result.statements.length, outcome.result.durationMs])}
            </span>
          ) : outcome?.kind === 'error' ? <span className="ml-auto text-xs text-muted-foreground">{i18n.t('{0} ms', [outcome.durationMs])}</span> : null}
        </div>
      </div>

      <div className="flex-1 min-h-[12rem] min-w-0 overflow-auto rounded-md border bg-card" role="region" aria-label={i18n.t('查询结果')}>
        {running && !outcome ? <div className="p-6 text-center"><Loader2 className="w-4 h-4 animate-spin inline-block" /></div>
          : !outcome ? <p className="p-6 text-center text-sm text-muted-foreground">{i18n.t('结果会显示在这里。')}</p>
            : outcome.kind === 'error' ? (
              <div className="p-3">
                <StatusState compact kind={refusal ? 'error' : undefined} error={outcome.error}
                  title={refusal === 'read_only' ? i18n.t('这条语句会修改数据') : refusal === 'protected_table' ? i18n.t('受保护的表') : refusal === 'multi_statement' ? i18n.t('一次只能执行一条语句') : i18n.t('执行失败')}
                  description={refusal === 'read_only'
                    ? (canWrite ? i18n.t('Host 判断这是写语句，请检查语句类型。') : i18n.t('写 SQL 需要 ops.database.schema 权限；当前身份只能执行只读语句。'))
                    : refusal === 'protected_table' ? i18n.t('网关账号与审计表不能从实例访问；迁移记录与系统表不能修改。') : undefined} />
              </div>
            ) : outcome.kind === 'write' ? (
              <ul className="divide-y text-xs" data-sql-write-result>
                {outcome.result.statements.map((statement, index) => (
                  <li key={index} className="flex flex-wrap items-baseline gap-2 px-3 py-2">
                    <code className="font-mono break-all flex-1 min-w-0">{statement.sql}</code>
                    <span className="text-muted-foreground">{typeof statement.affected === 'number' ? i18n.t('影响 {0} 行', [statement.affected]) : typeof statement.rows === 'number' ? i18n.t('{0} 行', [statement.rows]) : i18n.t('已执行')}</span>
                  </li>
                ))}
              </ul>
            ) : outcome.result.rows.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">{i18n.t('没有返回行。')}</p>
            ) : (
              <Table containerClassName="overflow-visible" className="min-w-full w-max">
                <TableHeader sticky>
                  <TableRow className="hover:bg-transparent">
                    {outcome.result.columns.map(column => <TableHead key={column}>{column}{isSensitiveColumn(column) ? <ShieldAlert className="inline w-3 h-3 ml-1 text-muted-foreground" aria-label={i18n.t('敏感列，默认遮盖')} /> : null}</TableHead>)}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {outcome.result.rows.map((row, rowIndex) => (
                    <TableRow key={rowIndex}>
                      {outcome.result.columns.map(column => {
                        const key = `${rowIndex}:${column}`
                        const masked = isSensitiveColumn(column) && row[column] != null && !revealed.has(key)
                        return (
                          <TableCell key={column} className="whitespace-nowrap py-1.5 font-mono text-xs">
                            {isSensitiveColumn(column) && row[column] != null ? (
                              <button type="button" className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                aria-label={masked ? i18n.t('显示 {0} 的值', [column]) : i18n.t('隐藏 {0} 的值', [column])}
                                onClick={() => setRevealed(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })}>
                                {masked ? <><Eye className="w-3 h-3" />{MASK}</> : <><EyeOff className="w-3 h-3" />{cellText(row[column])}</>}
                              </button>
                            ) : row[column] === null ? <span className="text-muted-foreground">NULL</span> : cellText(row[column])}
                          </TableCell>
                        )
                      })}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
      </div>

      <ConfirmDialog
        open={!!pendingWrite}
        onOpenChange={open => { if (!open) setPendingWrite(null) }}
        title={i18n.t('执行写 SQL')}
        description={pendingWrite?.estimate.estimateUnavailable
          ? i18n.t('这批语句含有 MySQL 会自动提交的结构语句，无法预估影响行数。执行后无法撤销。')
          : estimate === null ? i18n.t('Host 没有报告影响行数。执行后无法撤销。') : i18n.t('将影响 {0} 行。执行后无法撤销。', [estimate])}
        variant="destructive"
        confirmLabel={i18n.t('执行')}
        onConfirm={applyWrite}
      >
        <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap break-all" data-sql-pending>{pendingWrite?.sql}</pre>
        <p className="text-xs text-muted-foreground">{i18n.t('语句文本会写入审计日志。')}</p>
      </ConfirmDialog>
    </div>
  )
}
