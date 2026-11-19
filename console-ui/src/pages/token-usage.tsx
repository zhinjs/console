import { useI18n } from '../i18n'
import { ConversationKindBadge } from './features/conversation-list'
import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react'
import { StatusState } from '../components/StatusState'
import { ScopeFilterBar, useScopeFilter } from './insights/ScopeFilterBar'
import { usageSessionPattern } from './insights/scope-filter.mjs'
import { ArrowDown, ArrowDownToLine, ArrowUp, ArrowUpFromLine, Copy, Cpu, Layers, RefreshCw, X, Zap } from 'lucide-react'
import { copyText } from './clipboard-copy.mjs'
import { pluginRpc } from '../utils/plugin-rpc'
import { Alert, AlertDescription, AlertTitle, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, DateTimeField, ErrorAlert, InfoHint, InlineCode, Input, ListItemButton, PageHeader, PageShell, SelectField, Skeleton, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tooltip, TooltipContent, TooltipTrigger } from '@zhin.js/console-ui'
import { CacheLineChart, ModelBars, ModelLegend, SegmentDonut, StackedBarChart } from './token-usage-charts'
import {
  USAGE_BUCKETS,
  promptCacheNotices,
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
  mergeUsageModels,
  parseLocalDateTime,
  sortSessions,
  splitSessionKey,
  toLocalDateTime,
  topModelKeys,
  usageModelIds,
  usageSessionLabel,
  validateUsageStats,
  type UsageFilter,
  type UsageSessionRow,
  type UsageStats,
} from './token-usage-model.mjs'

type SortKey = 'turns' | 'calls' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cache'

function Metric({
  label,
  value,
  hint,
  icon: Icon,
  progress,
}: {
  label: string
  value: string
  hint?: string
  icon: ComponentType<{ className?: string }>
  progress?: number
}) {
  return (
    <div className="console-dashboard-metric">
      <div className="console-metric-head">
        <span>{label}</span>
        <span className="console-metric-icon" aria-hidden="true"><Icon /></span>
      </div>
      <strong className="text-2xl font-semibold">{value}</strong>
      {progress !== undefined ? (
        <div className="console-metric-progress" aria-hidden="true">
          <span style={{ width: `${Math.max(0, Math.min(100, progress * 100))}%` }} />
        </div>
      ) : null}
      {hint ? <span className="text-xs text-muted-foreground">{hint}</span> : null}
    </div>
  )
}

/**
 * The raw ids behind a model row (`services:<uuid>/model`, merged `accounts:` ids): never in the main
 * view, only in this ⓘ panel, with a copy button.
 */
function UsageIdHint({ ids, merged }: { ids: string[]; merged: number }) {
  const i18n = useI18n()
  const [copied, setCopied] = useState(false)
  if (!ids.length) return null
  return (
    <InfoHint label={i18n.t("ID")} className="shrink-0 text-xs font-normal text-muted-foreground">
      <div className="space-y-2 text-xs">
        <p className="text-muted-foreground">{merged > 1 ? i18n.t("合并自 {0} 个 ID", [merged]) : i18n.t("原始 ID")}</p>
        <ul className="space-y-1">{ids.map(id => <li key={id}><InlineCode className="break-all">{id}</InlineCode></li>)}</ul>
        <Button type="button" size="sm" variant="outline" onClick={() => { void copyText(ids.join('\n'), navigator.clipboard, document).then(ok => setCopied(ok)) }}>
          <Copy />{copied ? i18n.t("已复制") : i18n.t("复制 ID")}
        </Button>
      </div>
    </InfoHint>
  )
}

/** Charts are drawn in the browser's time zone; the instance's is named only when it differs. */
function timeZoneNote(hostZone: string | undefined, t: ReturnType<typeof useI18n>['t']): string {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  return hostZone && hostZone !== local ? t("按本机时区 {0} 显示（实例时区 {1}）", [local, hostZone]) : t("按本机时区 {0} 显示", [local])
}

/** 「机器人 → Token 用量」：读 plugin.root.usage-stats（只读），按时间 / 模型 / 会话看 token 花在哪。 */
export default function TokenUsagePage() {
  const i18n = useI18n()
  const [range, setRange] = useState('7d')
  const [bucket, setBucket] = useState('auto')
  const [customSince, setCustomSince] = useState(() => toLocalDateTime(Date.now() - 24 * 3600_000))
  const [customUntil, setCustomUntil] = useState(() => toLocalDateTime(Date.now()))
  // 范围参数（adapter / endpoint / conversation）换成会话键条件，上级层用 `*` 通配。
  const scopeFilter = useScopeFilter()
  const [sessionDraft, setSessionDraft] = useState(() => usageSessionPattern(scopeFilter.scope))
  const [session, setSession] = useState(() => usageSessionPattern(scopeFilter.scope))
  const appliedScope = useRef(scopeFilter.identity)
  useEffect(() => {
    if (appliedScope.current === scopeFilter.identity) return
    appliedScope.current = scopeFilter.identity
    const pattern = usageSessionPattern(scopeFilter.scope)
    setSessionDraft(pattern)
    setSession(pattern)
  }, [scopeFilter.identity]) // eslint-disable-line react-hooks/exhaustive-deps
  const [refreshTick, setRefreshTick] = useState(0)
  const [stats, setStats] = useState<UsageStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [denied, setDenied] = useState(false)
  // 503 means the Host has no AI runtime yet: an expected empty state, not a failure to retry.
  const [unavailable, setUnavailable] = useState<string | null>(null)
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
        // One row per 「服务名 · 模型」 (displayName / modelLabels); opaque ids never become a name.
        setStats(mergeUsageModels(validateUsageStats(data, i18n.locale), i18n.locale))
        setError(null)
        setDenied(false)
        setUnavailable(null)
      })
      .catch(caught => {
        if (cancelled) return
        if (isPermissionDenied(caught)) setDenied(true)
        else if ((caught as { status?: number }).status === 503) setUnavailable((caught as Error).message)
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
    return { colors, shown, hasOther: modelKeys.length > shown.length, showWrite: hasCacheWrite(stats), showEndpoint: stats.bySession.some(row => splitSessionKey(row).endpoint !== ''), quantiles: cacheQuantiles(stats.totals), cache: promptCacheNotices(stats, i18n.locale) }
  }, [stats, i18n.locale])

  const sessions = useMemo(() => stats ? sortSessions(stats.bySession, sortKey, sortDir) : [], [stats, sortKey, sortDir])

  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const pickSession = (row: UsageSessionRow) => { setSessionDraft(row.sessionKey); setSession(row.sessionKey) }
  const applySession = (value: string) => { setSessionDraft(value); setSession(value.trim()) }

  const empty = stats && stats.totals.calls === 0
  const header = (key: SortKey, label: string, priority?: 'secondary') => <TableHead numeric priority={priority}>
    <Button type="button" variant="ghost" size="sm" className="-mr-3" onClick={() => toggleSort(key)} aria-label={i18n.t("按{0}排序", [label])}>
      {label}{sortKey === key ? (sortDir === 'desc' ? <ArrowDown /> : <ArrowUp />) : null}
    </Button>
  </TableHead>

  return <PageShell>
    <PageHeader
      title={i18n.t("Token 用量")}
      description={i18n.t("机器人调用模型花了多少 token：按时间、模型和会话拆开看，也能看缓存命中情况。")}
      actions={<Button variant="outline" size="sm" onClick={() => setRefreshTick(tick => tick + 1)} disabled={loading}><RefreshCw className={loading ? 'animate-spin' : ''} />{i18n.t("刷新")}</Button>}
    />

    <ScopeFilterBar
      filter={scopeFilter}
      note={i18n.t("按会话键 {0} 统计；可在下方改动会话条件。", [usageSessionPattern(scopeFilter.scope)])}
    />

    {denied ? <StatusState kind="forbidden" permissions={['control:read']} /> : <>
      <Card>
        <CardContent className="flex flex-wrap items-end gap-3 pt-6">
          <SelectField aria-label={i18n.t("时间范围")} className="w-auto" value={range} onValueChange={setRange} options={USAGE_RANGES.map(item => ({ value: item.value, label: i18n.t(item.label) }))} />
          {range === 'custom' ? <>
            <DateTimeField className="w-52" aria-label={i18n.t("开始时间")} value={customSince} onValueChange={setCustomSince} max={customUntil || undefined} />
            <DateTimeField className="w-52" aria-label={i18n.t("结束时间")} value={customUntil} onValueChange={setCustomUntil} min={customSince || undefined} />
          </> : null}
          <SelectField aria-label={i18n.t("统计粒度")} className="w-auto" value={bucket} onValueChange={setBucket} options={USAGE_BUCKETS.map(item => ({ value: item.value, label: i18n.t(item.label) }))} />
          <form className="flex items-center gap-2" onSubmit={event => { event.preventDefault(); applySession(sessionDraft) }}>
            <Input className="w-56" aria-label={i18n.t("会话")} placeholder={i18n.t("按会话筛选，如 icqq:8596238:group:123")} value={sessionDraft} onChange={event => setSessionDraft(event.target.value)} />
            <Button type="submit">{i18n.t("筛选")}</Button>
            {session ? <Button size="sm" type="button" variant="ghost" onClick={() => applySession('')}><X />{i18n.t("清除会话")}</Button> : null}
          </form>
        </CardContent>
        {built.error ? <p className="px-6 pb-4 text-xs text-destructive">{i18n.t("自定义范围的开始时间必须早于结束时间。")}</p> : null}
      </Card>

      {unavailable && !stats ? <StatusState kind="empty" title={i18n.t("还没有用量数据")} description={unavailable} />
        : loading && !stats ? <StatusState kind="loading" onRetry={() => setRefreshTick(tick => tick + 1)} placeholder={<Skeleton className="h-64 w-full" />} />
        : error && !stats ? <StatusState error={error} onRetry={() => setRefreshTick(tick => tick + 1)} />
          : stats && view ? <>
            {error ? <ErrorAlert error={error} onRetry={() => setRefreshTick(tick => tick + 1)} /> : null}
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5" aria-busy={loading}>
              <Metric label={i18n.t("总输入 tokens")} value={formatTokens(stats.totals.inputTokens, i18n.locale)} icon={ArrowDownToLine} hint={i18n.t("每次模型调用的实际输入之和，工具循环里的多次调用都计入")} />
              <Metric label={i18n.t("输出 tokens")} value={formatTokens(stats.totals.outputTokens, i18n.locale)} icon={ArrowUpFromLine} />
              <Metric
                label={i18n.t("缓存命中率")}
                value={formatPercent(cacheRatio(stats.totals), i18n.locale)}
                icon={Zap}
                progress={cacheRatio(stats.totals)}
                hint={[
                  view.quantiles ? `${i18n.t("单次调用")} P50 ${formatPercent(view.quantiles.p50, i18n.locale)} · P90 ${formatPercent(view.quantiles.p90, i18n.locale)}` : '',
                  view.showWrite && stats.totals.cacheWriteTokens ? `${i18n.t("缓存写入")} ${formatTokens(stats.totals.cacheWriteTokens, i18n.locale)}` : '',
                ].filter(Boolean).join(' · ') || undefined}
              />
              <Metric label={i18n.t("模型调用次数")} value={formatTokens(stats.totals.calls, i18n.locale)} icon={Cpu} />
              <Metric label={i18n.t("回合数")} value={formatTokens(stats.totals.turns, i18n.locale)} icon={Layers} />
            </div>

            {view.cache?.hints.length ? (
              <Alert variant="warning" role="status">
                <Zap aria-hidden="true" />
                <AlertTitle>{i18n.t("可能不支持提示缓存")}</AlertTitle>
                <AlertDescription>
                  <ul className="space-y-1">{view.cache.hints.map(hint => <li key={hint.key} className="break-words">{hint.text}</li>)}</ul>
                </AlertDescription>
              </Alert>
            ) : view.cache?.missed ? (
              <p className="console-basis-note" role="status"><strong>{i18n.t("缓存未命中")}</strong><span>{i18n.t("这段时间的请求都没有命中提示缓存。系统提示或工具定义每次都在变化时，缓存无法复用。")}</span></p>
            ) : null}
            <p className="console-basis-note"><strong>{i18n.t("持久统计")}</strong><span>{i18n.t("来自回合追踪文件，覆盖 {0} 至 {1}", [new Date(stats.range.since).toLocaleString(i18n.locale), new Date(stats.range.until).toLocaleString(i18n.locale)])}</span></p>
            {empty ? <StatusState kind="empty" title={i18n.t("这段时间没有模型调用记录。")} description={i18n.t("换一个时间范围或清除会话筛选试试。")}
              actions={<>
                {range !== '30d' ? <Button size="sm" variant="outline" onClick={() => setRange('30d')}>{i18n.t("查看最近 30 天")}</Button> : null}
                {session ? <Button size="sm" variant="outline" onClick={() => { setSessionDraft(''); setSession('') }}>{i18n.t("清除会话筛选")}</Button> : null}
              </>} /> : <>
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">{i18n.t("输入 tokens 随时间变化")}</CardTitle>
                  <CardDescription>{i18n.t("按模型堆叠；鼠标停在柱子上看具体数值。")} · {timeZoneNote(stats.range.timeZone, i18n.t)}</CardDescription>
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
                <CardContent className="text-foreground"><CacheLineChart series={stats.series} bucket={stats.range.bucket} quantiles={view.quantiles} /></CardContent>
              </Card>

              <div className="grid gap-3 lg:grid-cols-2">
                <Card>
                  <CardHeader><CardTitle className="text-base">{i18n.t("按模型")}</CardTitle><CardDescription>{i18n.t("输入 / 输出 / 缓存读取，按输入从多到少。")}</CardDescription></CardHeader>
                  <CardContent className="text-foreground"><ModelBars rows={stats.byModel} colors={view.colors} showWrite={view.showWrite} idHint={row => <UsageIdHint ids={usageModelIds(row)} merged={row.providerIds?.length ?? 0} />} /></CardContent>
                </Card>
                <Card>
                  <CardHeader><CardTitle className="text-base">{i18n.t("输入构成")}</CardTitle><CardDescription>{i18n.t("历史对话、固定提示词、用户输入各占多少。按每个回合的上下文预算估算（每回合一次），所以合计小于上方「总输入」。")}</CardDescription></CardHeader>
                  <CardContent className="text-foreground"><SegmentDonut segments={stats.segments} /></CardContent>
                </Card>
              </div>

              <Card>
                <CardHeader><CardTitle className="text-base">{i18n.t("用量最高的会话")}</CardTitle><CardDescription>{i18n.t("最多 50 个；点一行只看这个会话。")}</CardDescription></CardHeader>
                {/* No minimum width: below 40rem the console-ui Table turns rows into cards and keeps only the
                    primary columns (name, input, cache hit), so nothing sits off screen at 375px (ADR 0063 D18-6). */}
                <CardContent>
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent">
                        <TableHead>{i18n.t("会话")}</TableHead>
                        <TableHead priority="secondary">{i18n.t("平台")}</TableHead>
                        {view.showEndpoint ? <TableHead priority="secondary">{i18n.t("账号")}</TableHead> : null}
                        <TableHead priority="secondary">{i18n.t("类型")}</TableHead>
                        {header('turns', i18n.t("回合"), 'secondary')}
                        {header('calls', i18n.t("调用"), 'secondary')}
                        {header('inputTokens', i18n.t("输入"))}
                        {header('outputTokens', i18n.t("输出"), 'secondary')}
                        {header('cacheReadTokens', i18n.t("缓存读取"), 'secondary')}
                        {header('cache', i18n.t("缓存命中率"))}
                        {view.showWrite ? <TableHead numeric priority="secondary">{i18n.t("缓存写入")}</TableHead> : null}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {sessions.map(row => {
                        const parts = splitSessionKey(row)
                        const name = usageSessionLabel(row, i18n.locale)
                        return <TableRow key={row.sessionKey} className="cursor-pointer hover:bg-muted/50" onClick={() => pickSession(row)}>
                          <TableCell className="min-w-0 text-sm">
                            {/* The session key (hashed keys included) only shows on hover. */}
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <ListItemButton className="min-w-0 max-w-full truncate text-left font-medium underline-offset-2 hover:underline" onClick={event => { event.stopPropagation(); pickSession(row) }}>{name}</ListItemButton>
                              </TooltipTrigger>
                              <TooltipContent className="max-w-xs break-all font-mono text-xs">{row.sessionKey}</TooltipContent>
                            </Tooltip>
                          </TableCell>
                          <TableCell priority="secondary">{parts.platform || '—'}</TableCell>
                          {view.showEndpoint ? <TableCell priority="secondary">{parts.endpoint || '—'}</TableCell> : null}
                          <TableCell priority="secondary">{parts.scope === 'group' || parts.scope === 'private' || parts.scope === 'channel' ? <ConversationKindBadge kind={parts.scope} /> : parts.scope || '—'}</TableCell>
                          <TableCell numeric priority="secondary">{formatTokens(row.turns, i18n.locale)}</TableCell>
                          <TableCell numeric priority="secondary">{formatTokens(row.calls, i18n.locale)}</TableCell>
                          <TableCell numeric>{formatTokens(row.inputTokens, i18n.locale)}</TableCell>
                          <TableCell numeric priority="secondary">{formatTokens(row.outputTokens, i18n.locale)}</TableCell>
                          <TableCell numeric priority="secondary">{formatTokens(row.cacheReadTokens, i18n.locale)}</TableCell>
                          <TableCell numeric>{formatPercent(cacheRatio(row), i18n.locale)}</TableCell>
                          {view.showWrite ? <TableCell numeric priority="secondary">{row.cacheWriteTokens ? formatTokens(row.cacheWriteTokens, i18n.locale) : '—'}</TableCell> : null}
                        </TableRow>
                      })}
                    </TableBody>
                  </Table>
                </CardContent>
              </Card>
            </>}
            {stats.malformedLines ? <p className="text-xs text-muted-foreground">{i18n.t("有 {0} 行用量记录无法解析，已忽略。", [stats.malformedLines])}</p> : null}
          </> : null}
    </>}
  </PageShell>
}
