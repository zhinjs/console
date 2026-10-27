import { useI18n } from '../i18n'
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowLeft, Download, RefreshCw } from 'lucide-react'
import { pluginRpc } from '../utils/plugin-rpc'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ErrorAlert } from '../components/error-alert'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import {
  EXPORT_WINDOWS,
  REPLAY_EXPORT_METHOD,
  REPLAY_KINDS,
  REPLAY_LIST_METHOD,
  REPLAY_OUTCOMES,
  REPLAY_PAGE_SIZE,
  REPLAY_TURN_METHOD,
  buildReplayFilter,
  collectReplayExport,
  describeReplayRow,
  exportFileName,
  exportWindow,
  isPermissionDenied,
  kindLabel,
  outcomeLabel,
  validateReplayList,
  validateReplayTurn,
  type ReplayFilterInput,
  type ReplayRow,
  type ReplayTurn,
} from './bot-replay-model.mjs'

const selectClass = 'h-9 rounded-md border bg-background px-3 text-sm'

function formatTime(timestamp: number, locale: 'zh-CN' | 'en'): string {
  return new Date(timestamp).toLocaleString(locale)
}

function outcomeVariant(code: string): 'success' | 'info' | 'secondary' | 'destructive' {
  if (code === 'allow') return 'success'
  if (code === 'deny' || code === 'error') return 'destructive'
  if (code === 'defer') return 'info'
  return 'secondary'
}

type ListState = { rows: ReplayRow[]; nextBefore: number | null; persistent: boolean }

/** 「机器人状态 → 决策回放」：机器人每次回 / 不回的原因（ADR 0036 切片 C）。只读，需要 decisions:read。 */
export default function BotReplayPage() {
  const i18n = useI18n()
  const [draft, setDraft] = useState<ReplayFilterInput>({})
  const [filter, setFilter] = useState<Record<string, string>>({})
  const [list, setList] = useState<ListState | null>(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [turn, setTurn] = useState<ReplayTurn | null>(null)
  const [turnError, setTurnError] = useState<string | null>(null)
  const [windowChoice, setWindowChoice] = useState(EXPORT_WINDOWS[1]!.value)
  const [exporting, setExporting] = useState(false)
  const [exportNote, setExportNote] = useState<string | null>(null)

  const load = useCallback(async (nextFilter: Record<string, string>, before?: number) => {
    const data = validateReplayList(await pluginRpc<unknown>('root', REPLAY_LIST_METHOD, {
      ...nextFilter,
      limit: REPLAY_PAGE_SIZE,
      ...(before === undefined ? {} : { before }),
    }), i18n.locale)
    return data
  }, [i18n.locale])

  const refresh = useCallback(async (nextFilter: Record<string, string>) => {
    setLoading(true)
    try {
      const data = await load(nextFilter)
      setList({ rows: data.items, nextBefore: data.nextBefore, persistent: data.persistent })
      setError(null)
      setDenied(false)
    } catch (caught) {
      if (isPermissionDenied(caught)) setDenied(true)
      else setError((caught as Error).message)
    } finally {
      setLoading(false)
    }
  }, [load])

  useEffect(() => { void refresh(filter) }, [refresh, filter])

  const loadMore = async () => {
    if (!list?.nextBefore) return
    setLoadingMore(true)
    try {
      const data = await load(filter, list.nextBefore)
      setList({ rows: [...list.rows, ...data.items], nextBefore: data.nextBefore, persistent: data.persistent })
    } catch (caught) {
      setError((caught as Error).message)
    } finally {
      setLoadingMore(false)
    }
  }

  const openTurn = async (turnId: string) => {
    setTurnError(null)
    try {
      setTurn(validateReplayTurn(await pluginRpc<unknown>('root', REPLAY_TURN_METHOD, { turnId }), i18n.locale))
    } catch (caught) {
      setTurn(null)
      setTurnError((caught as Error).message)
    }
  }

  const runExport = async () => {
    setExporting(true)
    setExportNote(null)
    try {
      const window = exportWindow(windowChoice)
      const result = await collectReplayExport((input) => pluginRpc<unknown>('root', REPLAY_EXPORT_METHOD, input), window, filter, i18n.locale)
      const blob = new Blob([JSON.stringify(result, null, 2)], { type: 'application/json' })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url
      anchor.download = exportFileName(window)
      anchor.click()
      URL.revokeObjectURL(url)
      setExportNote(i18n.t("已导出 {0} 条记录。", [result.count]))
    } catch (caught) {
      setExportNote((caught as Error).message)
    } finally {
      setExporting(false)
    }
  }

  return <PageShell>
    <PageHeader
      title={i18n.t("决策回放")}
      description={i18n.t("机器人每一次回或不回、调没调模型、发没发消息，都记在这里。新的在前，点回合可以看完整过程。")}
      actions={<div className="flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" asChild><Link to="/agent/workbench"><ArrowLeft />{i18n.t("机器人状态")}</Link></Button>
        <Button variant="outline" size="sm" onClick={() => void refresh(filter)} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
      </div>}
    />

    {denied ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{i18n.t("当前账号没有查看决策回放的权限，请联系管理员开通。")}</CardContent></Card> : <>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <Input className="w-36" aria-label={i18n.t("平台")} placeholder={i18n.t("平台，如 icqq")} value={draft.platform ?? ''} onChange={event => setDraft({ ...draft, platform: event.target.value })} />
          <Input className="w-48" aria-label={i18n.t("会话")} placeholder={i18n.t("会话，如 group:123")} value={draft.sceneId ?? ''} onChange={event => setDraft({ ...draft, sceneId: event.target.value })} />
          <select aria-label={i18n.t("类型")} className={selectClass} value={draft.kind ?? ''} onChange={event => setDraft({ ...draft, kind: event.target.value })}>
            <option value="">{i18n.t("全部类型")}</option>
            {REPLAY_KINDS.map(kind => <option key={kind} value={kind}>{kindLabel(kind, i18n.locale)}</option>)}
          </select>
          <select aria-label={i18n.t("结果")} className={selectClass} value={draft.outcome ?? ''} onChange={event => setDraft({ ...draft, outcome: event.target.value })}>
            <option value="">{i18n.t("全部结果")}</option>
            {REPLAY_OUTCOMES.map(outcome => <option key={outcome} value={outcome}>{outcomeLabel(outcome, i18n.locale)}</option>)}
          </select>
          <Button size="sm" onClick={() => setFilter(buildReplayFilter(draft))}>{i18n.t("筛选")}</Button>
          <span className="flex-1" />
          <select aria-label={i18n.t("导出范围")} className={selectClass} value={windowChoice} onChange={event => setWindowChoice(event.target.value)}>
            {EXPORT_WINDOWS.map(choice => <option key={choice.value} value={choice.value}>{i18n.t(choice.label)}</option>)}
          </select>
          <Button size="sm" variant="outline" onClick={() => void runExport()} disabled={exporting}><Download />{exporting ? i18n.t("导出中…") : i18n.t("导出 JSON")}</Button>
        </CardContent>
        {exportNote ? <p className="px-6 pb-4 text-xs text-muted-foreground">{exportNote}</p> : null}
      </Card>

      {turn || turnError ? <Card>
        <CardHeader>
          <CardTitle className="text-base">{i18n.t("回合时间线")}{turn ? <span className="ml-2 break-all font-mono text-xs font-normal text-muted-foreground">{turn.turnId}</span> : null}</CardTitle>
          {turn ? <CardDescription>{i18n.t("{0} 条记录，从 {1} 到 {2}", [turn.events.length, formatTime(turn.startedAt, i18n.locale), formatTime(turn.endedAt, i18n.locale)])}{turn.truncated ? i18n.t("（太长，只显示前一部分）") : ''}</CardDescription> : null}
        </CardHeader>
        <CardContent>
          {turnError ? <ErrorAlert error={turnError} /> : null}
          {turn ? <ol className="space-y-2 border-l pl-4 text-sm">
            {turn.events.map(row => {
              const view = describeReplayRow(row, i18n.locale)
              return <li key={view.id}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs text-muted-foreground">{formatTime(view.at, i18n.locale)}</span>
                  <span className="font-medium">{view.kind}</span>
                  <Badge variant={outcomeVariant(view.outcomeCode)}>{view.outcome}</Badge>
                  <span>{view.reason}</span>
                </div>
                <div className="font-mono text-xs text-muted-foreground">{view.code}{view.detail ? ` · ${view.detail}` : ''}</div>
              </li>
            })}
          </ol> : null}
          <Button className="mt-3" variant="ghost" size="sm" onClick={() => { setTurn(null); setTurnError(null) }}>{i18n.t("收起")}</Button>
        </CardContent>
      </Card> : null}

      {loading && !list ? <Skeleton className="h-64 w-full" />
        : error && !list ? <ErrorAlert error={error} onRetry={() => void refresh(filter)} />
          : list ? <Card>
            <CardHeader>
              <CardTitle className="text-base">{i18n.t("最近的决策")}</CardTitle>
              <CardDescription>{list.persistent ? i18n.t("默认保留 14 天（ai.audit.retentionDays 可改）。") : i18n.t("没有接数据库，只能看到进程内最近 200 条，重启后清空。")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {error ? <p className="text-xs text-destructive">{error}</p> : null}
              {list.rows.length ? <ul className="divide-y rounded-md border text-sm">
                {list.rows.map(row => {
                  const view = describeReplayRow(row, i18n.locale)
                  return <li key={view.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="text-xs text-muted-foreground">{formatTime(view.at, i18n.locale)}</span>
                    <span className="break-all text-xs">{view.where}</span>
                    <span className="font-medium">{view.kind}</span>
                    <Badge variant={outcomeVariant(view.outcomeCode)}>{view.outcome}</Badge>
                    <span className="text-muted-foreground" title={view.code}>{view.reason}</span>
                    <span className="flex-1" />
                    <Button variant="ghost" size="sm" onClick={() => void openTurn(view.turnId)}>{i18n.t("看这个回合")}</Button>
                  </li>
                })}
              </ul> : <p className="text-sm text-muted-foreground">{i18n.t("还没有决策记录。")}</p>}
              {list.nextBefore !== null ? <Button variant="outline" size="sm" onClick={() => void loadMore()} disabled={loadingMore}>{loadingMore ? i18n.t("加载中…") : i18n.t("加载更多")}</Button> : null}
            </CardContent>
          </Card> : null}
    </>}
  </PageShell>
}
