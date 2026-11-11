import { useI18n } from '../i18n'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Activity, AlertTriangle, Coins, MessagesSquare, RefreshCw, Settings2, Workflow } from 'lucide-react'
import {
  cn,
  useEngagementDetail,
  useEngagements,
  useVenues,
  type ConsoleEngagementDetail,
  type ConsoleEngagementSummary,
} from '@zhin.js/client'
import { startVisiblePolling } from '../hooks/visible-polling.mjs'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ErrorAlert } from '../components/error-alert'
import { EmptyState } from '../components/empty-state'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Card, CardContent } from '../components/ui/card'
import { Skeleton } from '../components/ui/skeleton'
import { ListItemButton } from '../components/ui/list-item-button'
import { isDemoMode } from '../utils/demo-mode'
import {
  actorLabel,
  collaborationEventSummary,
  engagementTotals,
  hasRunningEngagement,
  venueChannelLabel,
} from './engagements-model.mjs'

const ENGAGEMENT_LIMIT = 50
type DetailView = 'timeline' | 'board' | 'raw'

function statusVariant(status: ConsoleEngagementSummary['status']): 'success' | 'secondary' | 'destructive' {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'destructive'
  return 'secondary'
}

function WorkroomBoardPage() {
  const i18n = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedId = searchParams.get('engagementId')?.trim() || null
  // The SDK hooks read the Host's Engagement projection (agent.engagements.* RPC, REST fallback).
  const { engagements, loading, error, reload } = useEngagements(ENGAGEMENT_LIMIT)
  const { detail, loading: detailLoading, error: detailError, reload: reloadDetail } = useEngagementDetail(selectedId)
  const { venues } = useVenues()
  // `loading` also turns on for background refreshes; only the first load shows the skeleton.
  const [loaded, setLoaded] = useState(false)
  const started = useRef(false)
  useEffect(() => {
    if (loading) started.current = true
    else if (started.current) setLoaded(true)
  }, [loading])

  const live = hasRunningEngagement(engagements)
  useEffect(() => {
    if (!live) return
    return startVisiblePolling(() => {
      void reload()
      if (selectedId) void reloadDetail(selectedId)
    }, 5_000)
  }, [live, reload, reloadDetail, selectedId])

  const refresh = useCallback(() => {
    void reload()
    if (selectedId) void reloadDetail(selectedId)
  }, [reload, reloadDetail, selectedId])
  const totals = useMemo(() => engagementTotals(engagements), [engagements])
  const statusLabel = (status: ConsoleEngagementSummary['status']) =>
    status === 'running' ? i18n.t("进行中") : status === 'completed' ? i18n.t("已完成") : i18n.t("失败")

  return (
    <PageShell className="max-w-[1680px]">
      <PageHeader
        title={i18n.t("Workroom 协作记录")}
        description={i18n.t("查看多 Agent 协作（Engagement）的参与方、预算消耗、共享黑板与事件。此页只读。")}
        actions={
          <div className="flex items-center gap-2">
            <Button asChild variant="outline" size="sm"><Link to="/agent/workrooms/catalog"><Settings2 />{i18n.t("配置 Workrooms")}</Link></Button>
            <Button variant="outline" size="sm" disabled={loading} onClick={refresh}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>
          </div>
        }
      />

      {error ? <ErrorAlert error={error} onRetry={refresh} /> : null}

      {venues.length ? (
        <section className="console-dashboard-panel p-4 sm:p-5" aria-labelledby="workroom-venues-title">
          <div className="console-panel-heading mb-3">
            <div>
              <h2 id="workroom-venues-title">{i18n.t("协作场所 · {0}", [venues.length])}</h2>
              <p>{i18n.t("配置中声明的 Venue，以及各自绑定的会话。")}</p>
            </div>
          </div>
          <ul className="flex flex-wrap gap-2">
            {venues.map((venue) => (
              <li key={venue.key} className="rounded-lg border bg-muted/20 px-3 py-1.5 text-xs">
                <code className="font-medium">{venue.key}</code>
                <span className="ml-2 text-muted-foreground">{venueChannelLabel(venue)}</span>
                <Badge variant="outline" className="ml-2">{venue.floor === 'moderated' ? i18n.t("主持发言") : i18n.t("自由发言")}</Badge>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {loaded && !error ? (
        <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" aria-label={i18n.t("Workroom 摘要")}>
          <Metric icon={Workflow} label={i18n.t("协作")} value={i18n.number(engagements.length)} detail={i18n.t("{0} 个仍在进行", [totals.running])} />
          <Metric icon={AlertTriangle} label={i18n.t("失败")} value={i18n.number(totals.failed)} detail={i18n.t("打开记录查看终止原因")} tone={totals.failed ? 'warning' : 'success'} />
          <Metric icon={MessagesSquare} label={i18n.t("轮次")} value={i18n.number(totals.turns)} detail={i18n.t("所有协作的 Agent 轮次")} />
          <Metric icon={Coins} label="Tokens" value={i18n.number(totals.tokens)} detail={i18n.t("所有协作的 Token 消耗")} />
        </section>
      ) : null}

      {!loaded ? (
        <div className="grid gap-4 xl:grid-cols-[minmax(18rem,0.7fr)_minmax(0,1.3fr)]">
          <Skeleton className="h-[34rem] rounded-xl" />
          <Skeleton className="h-[34rem] rounded-xl" />
        </div>
      ) : error ? (
        <div className="console-dashboard-panel flex min-h-[20rem] items-center justify-center p-6">
          <EmptyState
            title={i18n.t("无法读取协作记录")}
            description={i18n.t("请检查连接，并确认当前令牌具有完整权限。")}
          />
        </div>
      ) : (
        <div className="grid items-start gap-4 xl:grid-cols-[minmax(19rem,0.72fr)_minmax(0,1.28fr)]">
          <section className="console-dashboard-panel overflow-hidden" aria-labelledby="workroom-engagements-title">
            <div className="console-panel-heading px-4 pt-4 sm:px-5 sm:pt-5">
              <div>
                <h2 id="workroom-engagements-title">{i18n.t("最近的协作")}</h2>
                <p>{i18n.t("选择一条记录，查看协作链路、共享黑板与事件。")}</p>
              </div>
              {live ? <Badge variant="secondary"><Activity className="mr-1 h-3 w-3" />Live</Badge> : null}
            </div>
            <div className="space-y-2 p-3 sm:p-4">
              {engagements.map((item) => (
                <ListItemButton
                  key={item.engagementId}
                  type="button"
                  aria-current={item.engagementId === selectedId ? 'true' : undefined}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors hover:bg-muted/45',
                    item.engagementId === selectedId && 'border-primary/35 bg-primary/[0.055]',
                  )}
                  onClick={() => setSearchParams({ engagementId: item.engagementId })}
                >
                  <div className="flex items-start justify-between gap-3">
                    <p className="min-w-0 truncate text-sm font-semibold">{item.engagementId}</p>
                    <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                  </div>
                  <p className="mt-2 text-xs text-muted-foreground">
                    {i18n.date(item.startedAt, { dateStyle: 'short', timeStyle: 'short' })}
                    {item.venue ? ` · ${item.venue}` : ''}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {i18n.t("{0} 次跳转 · {1} 轮 · {2} Tokens", [item.hops, item.turns, i18n.number(item.tokensUsed)])}
                  </p>
                  {item.participants.length ? (
                    <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{item.participants.join(', ')}</p>
                  ) : null}
                </ListItemButton>
              ))}
              {engagements.length === 0 ? (
                <EmptyState compact title={i18n.t("还没有协作记录")} description={i18n.t("Agent 之间发生协作后，记录会出现在这里。")} />
              ) : null}
            </div>
          </section>

          <section className="console-dashboard-panel min-h-[34rem]" aria-labelledby="workroom-detail-title">
            {detailError ? (
              <div className="p-5"><ErrorAlert error={detailError} onRetry={() => void reloadDetail(selectedId)} /></div>
            ) : detail && detail.summary.engagementId === selectedId ? (
              <EngagementDetail detail={detail} statusLabel={statusLabel} />
            ) : detailLoading ? (
              <div className="space-y-3 p-5">
                <Skeleton className="h-20 rounded-lg" />
                <Skeleton className="h-28 rounded-lg" />
                <Skeleton className="h-28 rounded-lg" />
              </div>
            ) : (
              <div className="flex min-h-[34rem] items-center justify-center p-6">
                <EmptyState title={i18n.t("选择一条协作记录")} description={i18n.t("右侧将展示协作链路、预算消耗与共享黑板。")} />
              </div>
            )}
          </section>
        </div>
      )}
    </PageShell>
  )
}

function DemoWorkroomBoardPage() {
  const i18n = useI18n()
  return (
    <PageShell className="max-w-[1200px]">
      <PageHeader
        title={i18n.t("Workroom 协作记录")}
        description={i18n.t("查看多 Agent 协作的参与方、预算消耗与事件。")}
        actions={<Button asChild variant="outline" size="sm"><Link to="/agent/workrooms/catalog"><Settings2 />{i18n.t("查看公开目录")}</Link></Button>}
      />
      <div className="console-dashboard-panel flex min-h-[28rem] items-center justify-center p-6">
        <EmptyState title={i18n.t("协作记录需要完整权限")} description={i18n.t("演示模式不提供协作记录。可查看项目目录。")} />
      </div>
    </PageShell>
  )
}

export default function WorkroomsPage() {
  return isDemoMode() ? <DemoWorkroomBoardPage /> : <WorkroomBoardPage />
}

function EngagementDetail({ detail, statusLabel }: {
  detail: ConsoleEngagementDetail
  statusLabel: (status: ConsoleEngagementSummary['status']) => string
}) {
  const i18n = useI18n()
  const [view, setView] = useState<DetailView>('timeline')
  const { summary } = detail
  const views: { key: DetailView; label: string }[] = [
    { key: 'timeline', label: i18n.t("协作链路") },
    { key: 'board', label: i18n.t("共享黑板 · {0}", [detail.board.length]) },
    { key: 'raw', label: i18n.t("原始事件 · {0}", [detail.events.length]) },
  ]
  return (
    <div className="space-y-4 p-4 sm:p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="workroom-detail-title" className="text-lg font-semibold">{i18n.t("协作详情")}</h2>
          <p className="mt-1 break-all text-xs text-muted-foreground"><code>{summary.engagementId}</code></p>
          <p className="mt-1 text-sm text-muted-foreground">
            {summary.venue ? i18n.t("场所：{0}", [summary.venue]) : i18n.t("临时协作（未绑定场所）")}
            {' · '}{i18n.t("参与方：{0}", [summary.participants.join(', ') || '—'])}
            {summary.stopReason ? <>{' · '}{i18n.t("终止原因：{0}", [summary.stopReason])}</> : null}
          </p>
        </div>
        <Badge variant={statusVariant(summary.status)}>{statusLabel(summary.status)}</Badge>
      </header>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border text-sm sm:grid-cols-4">
        {([
          [i18n.t("跳转"), i18n.number(summary.hops)],
          [i18n.t("轮次"), i18n.number(summary.turns)],
          ['Tokens', i18n.number(summary.tokensUsed)],
          [i18n.t("耗时"), i18n.t("{0} 毫秒", [i18n.number(summary.wallClockMs)])],
        ] as const).map(([label, value]) => (
          <div key={label} className="bg-background p-2.5">
            <dt className="text-xs text-muted-foreground">{label}</dt>
            <dd className="mt-0.5 font-medium tabular-nums">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex gap-1 rounded-lg bg-muted/35 p-1" role="tablist" aria-label={i18n.t("协作详情视图")}>
        {views.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={view === item.key}
            className={cn(
              'flex-1 rounded-md px-2 py-1.5 text-xs font-medium',
              view === item.key ? 'bg-background shadow-console-xs' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => setView(item.key)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {view === 'timeline' ? (
        detail.events.length ? (
          <ol className="space-y-2 font-mono text-xs">
            {detail.events.map((event, index) => (
              <li key={index} className="break-all rounded-lg border p-2.5">
                <span className="font-semibold text-foreground">{String(event.kind ?? 'event')}</span>
                <span className="ml-2 text-muted-foreground">{collaborationEventSummary(event)}</span>
              </li>
            ))}
          </ol>
        ) : <EmptyState compact title={i18n.t("尚无事件")} />
      ) : null}

      {view === 'board' ? (
        detail.board.length ? (
          <ul className="space-y-2 text-sm">
            {detail.board.map((entry) => (
              <li key={entry.key} className="space-y-1 rounded-lg border p-3">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-xs font-semibold">{entry.key}</code>
                  <span className="text-xs text-muted-foreground">v{entry.version} · {actorLabel(entry.updatedBy)}</span>
                </div>
                <pre className="overflow-auto rounded bg-muted/35 p-2 font-mono text-xs">
                  {typeof entry.value === 'string' ? entry.value : JSON.stringify(entry.value, null, 2)}
                </pre>
              </li>
            ))}
          </ul>
        ) : <EmptyState compact title={i18n.t("黑板上还没有内容")} />
      ) : null}

      {view === 'raw' ? (
        <pre className="max-h-96 overflow-auto rounded-lg border bg-muted/25 p-3 font-mono text-xs">{JSON.stringify(detail.events, null, 2)}</pre>
      ) : null}
    </div>
  )
}

function Metric(props: {
  icon: typeof Workflow
  label: string
  value: string
  detail: string
  tone?: 'warning' | 'success'
}) {
  const Icon = props.icon
  return (
    <Card>
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-xs text-muted-foreground"><Icon className="h-4 w-4" />{props.label}</div>
        <strong className={cn('mt-2 block text-2xl', props.tone === 'warning' && 'text-warning', props.tone === 'success' && 'text-success')}>{props.value}</strong>
        <p className="mt-1 text-xs text-muted-foreground">{props.detail}</p>
      </CardContent>
    </Card>
  )
}
