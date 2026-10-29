import { useI18n } from '../i18n'
import { useEffect, useMemo, useState } from 'react'
import { ArrowDown, ArrowUp, RefreshCw, X } from 'lucide-react'
import { pluginRpc } from '../utils/plugin-rpc'
import { PageHeader } from '../components/PageHeader'
import { PageShell } from '../components/PageShell'
import { ErrorAlert } from '../components/error-alert'
import { EmptyState } from '../components/empty-state'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Input } from '../components/ui/input'
import { SelectField } from '../components/ui/select'
import { Skeleton } from '../components/ui/skeleton'
import { CacheLineChart, ModelBars, ModelLegend, SegmentDonut, StackedBarChart } from './token-usage-charts'
import {
  USAGE_BUCKETS,
  USAGE_METHOD,
  USAGE_RANGES,
  buildColorMap,
  buildUsageInput,
  cacheQuantiles,
  cacheRatio,
  collectModelKeys,
  formatPercent,
  formatTokens,
  hasCacheWrite,
  isPermissionDenied,
  parseLocalDateTime,
  sortSessions,
  splitSessionKey,
  toLocalDateTime,
  topModelKeys,
  validateUsageStats,
  type UsageFilter,
  type UsageSessionRow,
  type UsageStats,
} from './token-usage-model.mjs'

type SortKey = 'turns' | 'calls' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cache'

function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return <div className="console-dashboard-metric">
    <span>{label}</span>
    <strong className="text-2xl font-semibold tabular-nums">{value}</strong>
    {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
  </div>
}

/** 「机器人 → Token 用量」：读 plugin.root.usage-stats（只读），按时间 / 模型 / 会话看 token 花在哪。 */
export default function TokenUsagePage() {
  const i18n = useI18n()
  const [range, setRange] = useState('7d')
  const [bucket, setBucket] = useState('auto')
  const [customSince, setCustomSince] = useState(() => toLocalDateTime(Date.now() - 24 * 3600_000))
  const [customUntil, setCustomUntil] = useState(() => toLocalDateTime(Date.now()))
  const [sessionDraft, setSessionDraft] = useState('')
  const [session, setSession] = useState('')
  const [refreshTick, setRefreshTick] = useState(0)
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  const [sortKey, setSortKey] = useState<SortKey>('inputTokens')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  const filter: UsageFilter = useMemo(() => ({
    range,
    bucket,
    session,
    customSince: parseLocalDateTime(customSince) ?? undefined,
    customUntil: parseLocalDateTime(customUntil) ?? undefined,
  }), [range, bucket, session, customSince, customUntil])
  const built = useMemo(() => buildUsageInput(filter), [filter, refreshTick]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!built.input) { setLoading(false); return }
    let cancelled = false
    setLoading(true)
    pluginRpc<unknown>('root', USAGE_METHOD, built.input as unknown as Record<string, unknown>)
      .then(data => {
        if (cancelled) return
        setStats(validateUsageStats(data, i18n.locale))
        setError(null)
        setDenied(false)
      })
      .catch(caught => {
        if (cancelled) return
        if (isPermissionDenied(caught)) setDenied(true)
        else setError((caught as Error).message)
      })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [built, i18n.locale])

  const view = useMemo(() => {
    if (!stats) return null
    const modelKeys = collectModelKeys(stats)
    const colors = buildColorMap(modelKeys)
    const shown = topModelKeys(stats.byModel)
    return { colors, shown, hasOther: modelKeys.length > shown.length, showWrite: hasCacheWrite(stats), showEndpoint: stats.bySession.some(row => splitSessionKey(row).endpoint !== ''), quantiles: cacheQuantiles(stats.totals) }
  }, [stats])

  const sessions = useMemo(() => stats ? sortSessions(stats.bySession, sortKey, sortDir) : [], [stats, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const pickSession = (row: UsageSessionRow) => { setSessionDraft(row.sessionKey); setSession(row.sessionKey) }
  const applySession = (value: string) => { setSessionDraft(value); setSession(value.trim()) }

  const empty = stats && stats.totals.calls === 0
  const header = (key: SortKey, label: string) => <th scope="col" className="px-3 py-2 text-right font-medium">
    <button type="button" className="inline-flex items-center gap-1 hover:text-foreground" onClick={() => toggleSort(key)} aria-label={i18n.t("按{0}排序", [label])}>
      {label}{sortKey === key ? (sortDir === 'desc' ? <ArrowDown className="h-3 w-3" /> : <ArrowUp className="h-3 w-3" />) : null}
    </button>
  </th>

  return <PageShell>
    <PageHeader
      title={i18n.t("Token 用量")}
      description={i18n.t("机器人调用模型花了多少 token：按时间、模型和会话拆开看，也能看缓存命中情况。")}
      actions={<Button variant="outline" size="sm" onClick={() => setRefreshTick(tick => tick + 1)} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
    />

    {denied ? <Card><CardContent className="py-8 text-center text-sm text-muted-foreground">{i18n.t("当前账号没有查看 Token 用量的权限，请联系管理员开通。")}</CardContent></Card> : <>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <SelectField aria-label={i18n.t("时间范围")} className="w-auto" value={range} onValueChange={setRange} options={USAGE_RANGES.map(item => ({ value: item.value, label: i18n.t(item.label) }))} />
          {range === 'custom' ? <>
            <Input type="datetime-local" className="w-52" aria-label={i18n.t("开始时间")} value={customSince} onChange={event => setCustomSince(event.target.value)} />
            <Input type="datetime-local" className="w-52" aria-label={i18n.t("结束时间")} value={customUntil} onChange={event => setCustomUntil(event.target.value)} />
          </> : null}
          <SelectField aria-label={i18n.t("统计粒度")} className="w-auto" value={bucket} onValueChange={setBucket} options={USAGE_BUCKETS.map(item => ({ value: item.value, label: i18n.t(item.label) }))} />
          <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); applySession(sessionDraft) }}>
            <Input className="w-56" aria-label={i18n.t("会话")} placeholder={i18n.t("按会话筛选，如 icqq:8596238:group:123")} value={sessionDraft} onChange={event => setSessionDraft(event.target.value)} />
            <Button size="sm" type="submit">{i18n.t("筛选")}</Button>
            {session ? <Button size="sm" type="button" variant="ghost" onClick={() => applySession('')}><X />{i18n.t("清除会话")}</Button> : null}
          </form>
        </CardContent>
        {built.error ? <p className="px-6 pb-4 text-xs text-destructive">{i18n.t("自定义范围的开始时间必须早于结束时间。")}</p> : null}
      </Card>

      {loading && !stats ? <Skeleton className="h-64 w-full" />
        : error && !stats ? <ErrorAlert error={error} onRetry={() => setRefreshTick(tick => tick + 1)} />
          : stats && view ? <>
            {error ? <ErrorAlert error={error} onRetry={() => setRefreshTick(tick => tick + 1)} /> : null}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy={loading}>
              <Metric label={i18n.t("总输入 tokens")} value={formatTokens(stats.totals.inputTokens, i18n.locale)} />
              <Metric label={i18n.t("输出 tokens")} value={formatTokens(stats.totals.outputTokens, i18n.locale)} />
              <Metric
                label={i18n.t("缓存命中率")}
                value={formatPercent(cacheRatio(stats.totals), i18n.locale)}
                hint={[
                  view.quantiles ? `${i18n.t("单次调用")} P50 ${formatPercent(view.quantiles.p50, i18n.locale)} · P90 ${formatPercent(view.quantiles.p90, i18n.locale)}` : '',
                  view.showWrite && stats.totals.cacheWriteTokens ? `${i18n.t("缓存写入")} ${formatTokens(stats.totals.cacheWriteTokens, i18n.locale)}` : '',
                ].filter(Boolean).join(' · ') || undefined}
              />
              <Metric label={i18n.t("模型调用次数")} value={formatTokens(stats.totals.calls, i18n.locale)} />
              <Metric label={i18n.t("回合数")} value={formatTokens(stats.totals.turns, i18n.locale)} />
            </div>

            {empty ? <Card><CardContent><EmptyState title={i18n.t("这段时间没有模型调用记录。")} description={i18n.t("换一个时间范围或清除会话筛选试试。")} /></CardContent></Card> : <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{i18n.t("输入 tokens 随时间变化")}</CardTitle>
                  <CardDescription>{i18n.t("按 provider/model 堆叠；鼠标停在柱子上看具体数值。")}{stats.range.timeZone ? ` · ${stats.range.timeZone}` : ''}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-foreground">
                  <ModelLegend keys={view.shown} colors={view.colors} hasOther={view.hasOther} />
                  <StackedBarChart series={stats.series} keys={view.shown} colors={view.colors} bucket={stats.range.bucket} />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{i18n.t("缓存命中率随时间变化")}</CardTitle>
                  <CardDescription>{i18n.t("命中率 = 缓存读取 / 输入；没有调用的时段不画点。")}</CardDescription>
                </CardHeader>
                <CardContent className="text-foreground"><CacheLineChart series={stats.series} bucket={stats.range.bucket} /></CardContent>
              </Card>

              <div className="grid gap-3 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">{i18n.t("按模型")}</CardTitle><CardDescription>{i18n.t("输入 / 输出 / 缓存读取，按输入从多到少。")}</CardDescription></CardHeader>
                  <CardContent className="text-foreground"><ModelBars rows={stats.byModel} colors={view.colors} showWrite={view.showWrite} /></CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">{i18n.t("输入构成")}</CardTitle><CardDescription>{i18n.t("历史对话、固定提示词、用户输入各占多少。")}</CardDescription></CardHeader>
                  <CardContent className="text-foreground"><SegmentDonut segments={stats.segments} /></CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">{i18n.t("用量最高的会话")}</CardTitle><CardDescription>{i18n.t("最多 50 个；点一行只看这个会话。")}</CardDescription></CardHeader>
                <CardContent>
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-[720px] text-sm">
                      <thead className="text-xs text-muted-foreground">
                        <tr>
                          <th scope="col" className="px-3 py-2 text-left font-medium">{i18n.t("平台")}</th>
                          {view.showEndpoint ? <th scope="col" className="px-3 py-2 text-left font-medium">{i18n.t("账号")}</th> : null}
                          <th scope="col" className="px-3 py-2 text-left font-medium">{i18n.t("类型")}</th>
                          <th scope="col" className="px-3 py-2 text-left font-medium">{i18n.t("会话 ID")}</th>
                          {header('turns', i18n.t("回合"))}
                          {header('calls', i18n.t("调用"))}
                          {header('inputTokens', i18n.t("输入"))}
                          {header('outputTokens', i18n.t("输出"))}
                          {header('cacheReadTokens', i18n.t("缓存读取"))}
                          {header('cache', i18n.t("缓存命中率"))}
                          {view.showWrite ? <th scope="col" className="px-3 py-2 text-right font-medium">{i18n.t("缓存写入")}</th> : null}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {sessions.map(row => {
                          const parts = splitSessionKey(row)
                          return <tr key={row.sessionKey} className="cursor-pointer hover:bg-muted/50" title={row.sessionKey} onClick={() => pickSession(row)}>
                            <td className="px-3 py-2">{parts.platform || '—'}</td>
                            {view.showEndpoint ? <td className="px-3 py-2">{parts.endpoint || '—'}</td> : null}
                            <td className="px-3 py-2">{parts.scope || '—'}</td>
                            <td className="px-3 py-2 break-all font-mono text-xs"><button type="button" className="text-left underline-offset-2 hover:underline" onClick={event => { event.stopPropagation(); pickSession(row) }}>{parts.sceneId || row.sessionKey}</button></td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatTokens(row.turns, i18n.locale)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatTokens(row.calls, i18n.locale)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatTokens(row.inputTokens, i18n.locale)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatTokens(row.outputTokens, i18n.locale)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatTokens(row.cacheReadTokens, i18n.locale)}</td>
                            <td className="px-3 py-2 text-right tabular-nums">{formatPercent(cacheRatio(row), i18n.locale)}</td>
                            {view.showWrite ? <td className="px-3 py-2 text-right tabular-nums">{row.cacheWriteTokens ? formatTokens(row.cacheWriteTokens, i18n.locale) : '—'}</td> : null}
                          </tr>
                        })}
                      </tbody>
                    </table>
                  </div>
                </CardContent>
              </Card>
            </>}
            {stats.malformedLines ? <p className="text-xs text-muted-foreground">{i18n.t("有 {0} 行用量记录无法解析，已忽略。", [stats.malformedLines])}</p> : null}
          </> : null}
    </>}
  </PageShell>
}
