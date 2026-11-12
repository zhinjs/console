import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { RefreshCw, Search, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { StatusState } from '../../components/StatusState'
import {
  IAM_RPC, actorLabel, auditQuery, outcomeVariant, readAuditPage, type AuditFilter, type IamAuditEntry,
} from './access-model.mjs'
import { iamErrorKind, type IamErrorKind } from './iam-request.mjs'
import { FormField, IamLoadError } from './access-components'
import { iamRequest, useIamUsers } from './use-iam'
import { auditEntriesForTarget } from '../scope/records-model.mjs'

const EMPTY_FILTER = { actor: '', action: '', since: '', until: '' }
const KNOWN_ACTIONS = ['auth.login', 'auth.logout', 'auth.password', ...Object.values(IAM_RPC)]

export default function AccessAuditPage() {
  const i18n = useI18n()
  const id = useId()
  const users = useIamUsers()
  const usersById = useMemo(() => new Map(users.data.map(user => [user.id, user])), [users.data])
  const [draft, setDraft] = useState(EMPTY_FILTER)
  const [filter, setFilter] = useState<AuditFilter>(EMPTY_FILTER)
  const [entries, setEntries] = useState<IamAuditEntry[]>([])
  const [next, setNext] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState<{ message: string; kind: IamErrorKind; failure: unknown } | null>(null)
  const sequence = useRef(0)
  // `?target=adapter:<alias>` / `endpoint:<alias>/<id>` from an object page's 记录 tab. The Host
  // cannot filter by target, so the loaded pages are filtered here (and say so).
  const [searchParams, setSearchParams] = useSearchParams()
  const target = searchParams.get('target')?.trim() ?? ''
  const shown = useMemo(() => auditEntriesForTarget(entries, target), [entries, target])
  const clearTarget = () => setSearchParams(previous => { const next = new URLSearchParams(previous); next.delete('target'); return next }, { replace: true })

  const load = useCallback((before?: number) => {
    const request = ++sequence.current
    setLoading(true)
    iamRequest<unknown>(IAM_RPC.AUDIT_LIST, auditQuery(filter, before), i18n.t).then(reply => {
      if (request !== sequence.current) return
      const page = readAuditPage(reply)
      setEntries(previous => (before === undefined ? page.entries : [...previous, ...page.entries]))
      setNext(page.next)
      setLoaded(true)
      setError(null)
      setLoading(false)
    }, (caught: unknown) => {
      if (request !== sequence.current) return
      setError({ message: caught instanceof Error ? caught.message : String(caught), kind: iamErrorKind(caught), failure: caught })
      setLoading(false)
    })
  }, [filter, i18n])

  useEffect(() => {
    load()
    return () => { sequence.current += 1 }
  }, [load])

  const actions = useMemo(() => [...new Set([...KNOWN_ACTIONS, ...entries.map(entry => entry.action)])].sort(), [entries])
  const hasFilter = Object.values(filter).some(Boolean)

  return (
    <PageShell>
      <PageHeader
        title={i18n.t("审计日志")}
        description={i18n.t("登录、访问控制变更、被拒绝的请求和所有写操作。只记录参数名，不记录参数值；保留 180 天。")}
        actions={<Button variant="outline" size="sm" onClick={() => load()} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
      />
      <Card className="p-4">
        <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_1fr_1fr_auto]" onSubmit={event => { event.preventDefault(); setFilter({ ...draft }) }}>
          <FormField htmlFor={`${id}-actor`} label={i18n.t("主体")}>
            <Input id={`${id}-actor`} value={draft.actor} list={`${id}-actors`} autoComplete="off" spellCheck={false} placeholder="user:…"
              onChange={event => setDraft(previous => ({ ...previous, actor: event.target.value }))} />
            <datalist id={`${id}-actors`}>
              <option value="bootstrap">{i18n.t("初始化令牌")}</option>
              {users.data.map(user => <option key={user.id} value={`user:${user.id}`}>{user.username}</option>)}
            </datalist>
          </FormField>
          <FormField htmlFor={`${id}-action`} label={i18n.t("动作")}>
            <Input id={`${id}-action`} value={draft.action} list={`${id}-actions`} autoComplete="off" spellCheck={false} placeholder="auth.login"
              onChange={event => setDraft(previous => ({ ...previous, action: event.target.value }))} />
            <datalist id={`${id}-actions`}>{actions.map(action => <option key={action} value={action} />)}</datalist>
          </FormField>
          <FormField htmlFor={`${id}-since`} label={i18n.t("开始时间")}>
            <Input id={`${id}-since`} type="datetime-local" value={draft.since} onChange={event => setDraft(previous => ({ ...previous, since: event.target.value }))} />
          </FormField>
          <FormField htmlFor={`${id}-until`} label={i18n.t("结束时间")}>
            <Input id={`${id}-until`} type="datetime-local" value={draft.until} onChange={event => setDraft(previous => ({ ...previous, until: event.target.value }))} />
          </FormField>
          <div className="flex items-end gap-2">
            <Button type="submit" size="sm"><Search />{i18n.t("筛选")}</Button>
            {hasFilter ? <Button type="button" variant="ghost" size="sm" onClick={() => { setDraft(EMPTY_FILTER); setFilter(EMPTY_FILTER) }}><X />{i18n.t("清除")}</Button> : null}
          </div>
        </form>
        <p className="mt-2 text-xs text-muted-foreground">{i18n.t("主体与动作按完整值匹配，例如 user:<ID>、api-token:<ID>、auth.login、iam.users.create。")}</p>
        {target ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3 text-sm" role="status">
            <span>{i18n.t("只显示目标为")} <code className="font-mono text-xs">{target}</code> {i18n.t("的记录（在已读取的 {0} 条中筛选）。", [entries.length])}</span>
            <Button type="button" variant="ghost" size="sm" onClick={clearTarget}><X />{i18n.t("显示全部目标")}</Button>
          </div>
        ) : null}
      </Card>
      {error ? <IamLoadError error={error.message} kind={error.kind} failure={error.failure} onRetry={() => load()} /> : null}
      <Card className="overflow-hidden p-0">
        {loading && !loaded ? (
          <div className="space-y-2 p-4">{[0, 1, 2].map(index => <Skeleton key={index} className="h-9" />)}</div>
        ) : !shown.length ? (
          error && !loaded ? null : <StatusState kind="empty" title={hasFilter || target ? i18n.t("没有符合条件的记录") : i18n.t("还没有审计记录")}
            description={target && entries.length ? i18n.t("已读取的记录里没有这个目标，可以加载更早的记录继续查找。")
              : hasFilter ? i18n.t("主体与动作按完整值匹配。换一个条件，或清除筛选。") : i18n.t("登录、访问控制变更和写操作发生后会记录在这里。")} />
        ) : (
          <Table aria-label={i18n.t("审计日志")}>
            <TableHeader>
              <TableRow>
                <TableHead>{i18n.t("时间")}</TableHead>
                <TableHead>{i18n.t("主体")}</TableHead>
                <TableHead>{i18n.t("动作")}</TableHead>
                <TableHead className="hidden lg:table-cell">{i18n.t("目标")}</TableHead>
                <TableHead>{i18n.t("结果")}</TableHead>
                <TableHead className="hidden lg:table-cell">IP</TableHead>
                <TableHead className="hidden md:table-cell">{i18n.t("详情")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {shown.map(entry => (
                <TableRow key={entry.id}>
                  <TableCell className="text-muted-foreground"><span className="whitespace-nowrap">{i18n.date(entry.at, { dateStyle: 'medium', timeStyle: 'medium' })}</span></TableCell>
                  <TableCell><span title={entry.actor}>{actorLabel(entry.actor, usersById, i18n.t)}</span></TableCell>
                  <TableCell className="font-mono text-xs break-all">{entry.action}</TableCell>
                  <TableCell className="hidden max-w-[16rem] truncate lg:table-cell" title={entry.target ?? undefined}>{entry.target ?? '—'}</TableCell>
                  <TableCell><Badge variant={outcomeVariant(entry.outcome)} size="sm">{outcomeText(entry.outcome, i18n.t)}</Badge></TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{entry.ip ?? '—'}</TableCell>
                  <TableCell className="hidden md:table-cell">
                    {entry.detail === null ? '—' : (
                      <details className="text-xs">
                        <summary className="cursor-pointer">{i18n.t("展开")}</summary>
                        <pre className="mt-1 max-w-[24rem] whitespace-pre-wrap break-words">{JSON.stringify(entry.detail, null, 2)}</pre>
                      </details>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
      {next !== null ? (
        <div className="flex justify-center">
          <Button variant="outline" size="sm" onClick={() => load(next)} disabled={loading}>{loading ? i18n.t("处理中...") : i18n.t("加载更早的记录")}</Button>
        </div>
      ) : null}
    </PageShell>
  )
}

function outcomeText(outcome: string, t: (message: string) => string): string {
  if (outcome === 'ok') return t('成功')
  if (outcome === 'denied') return t('已拒绝')
  if (outcome === 'error') return t('出错')
  return outcome
}
