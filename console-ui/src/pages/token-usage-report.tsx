import { useI18n } from '../i18n'
import { ConversationKindBadge } from './features/conversation-list'
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Copy, Cpu, Layers, Sigma, Zap } from 'lucide-react'
import { copyText } from './clipboard-copy.mjs'
import {
  Alert, AlertDescription, AlertTitle, Badge, Button, Card, CardContent, CardDescription, CardHeader, CardTitle, Disclosure, InfoHint, InlineCode,
  KeyValueList, ListItemButton, ProgressMeter, SelectField, Sheet, SheetBody, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle,
  StatCard, StatGrid, Table, TableBody, TableCell, TableHead, TableHeader, TableRow, Tabs, TabsList, TabsTrigger, Tooltip, TooltipContent, TooltipTrigger,
  cn, useContainerAtLeast,
} from '@zhin.js/console-ui'
import { CacheLineChart, ModelLegend, SegmentDonut, StackedBarChart } from './token-usage-charts'
import {
  buildColorMap,
  cacheQuantiles,
  cacheRatio,
  formatDelta,
  formatPercent,
  formatTokens,
  hasCacheWrite,
  isNotableDelta,
  promptCacheNotices,
  seriesKeys,
  sortSessions,
  splitSessionKey,
  topSeriesKeys,
  totalTokens,
  usageAccountLabel,
  usageAgentLabel,
  usageCapabilities,
  usageDelta,
  usageModelIdGroups,
  usageProfileName,
  usagePurposeLabel,
  usageServiceGroups,
  usageSessionNames,
  usageTrendSeries,
  type UsageAgentRow,
  type UsageModelRow,
  type UsagePurposeRow,
  type UsageServiceGroup,
  type UsageSessionRow,
  type UsageStats,
  type UsageTotals,
} from './token-usage-model.mjs'

/**
 * 「Token 用量」 report (zhinjs/zhin#1250 第 59 批): summary with the change against the previous
 * window, alerts only when something is off, the trend by service / model, the breakdown
 * by service → model, session (and Agent / purpose when the Host sends them), the cache section
 * folded away unless a cache alert is up, and a detail Sheet per row. Raw ids (`services:<uuid>`,
 * hashed session keys) appear only in an ⓘ panel, a tooltip or the Sheet — never as a name.
 */

type Translate = ReturnType<typeof useI18n>['t']
export type UsageView = 'models' | 'sessions' | 'agents' | 'purposes'
export type TrendDimension = 'service' | 'model'
type SortKey = 'turns' | 'calls' | 'inputTokens' | 'outputTokens' | 'cacheReadTokens' | 'cache'
type Counts = { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens?: number; cacheShare?: number; turns?: number }
export type UsageSelection =
  | { kind: 'service'; key: string }
  | { kind: 'model'; key: string }
  | { kind: 'session'; key: string }
  | { kind: 'agent'; key: string }
  | { kind: 'purpose'; key: string }

/** Main name (one line, full name on hover) and, for same-named rows, a greyed qualifier visible at every width. */
export function UsageName({ name, qualifier, secondary, className }: { name: string; qualifier?: string; secondary?: string; className?: string }) {
  return (
    <span className={cn('flex min-w-0 flex-wrap items-baseline gap-1.5', className)}>
      <Tooltip>
        <TooltipTrigger asChild><span className="min-w-0 max-w-full truncate font-medium text-foreground">{name}</span></TooltipTrigger>
        <TooltipContent className="max-w-xs break-words text-xs">{name}</TooltipContent>
      </Tooltip>
      {qualifier ? <span className="min-w-0 max-w-full truncate font-mono text-xs font-normal text-muted-foreground">{qualifier}</span> : null}
      {secondary ? <span className="min-w-0 shrink truncate text-xs font-normal text-muted-foreground">{secondary}</span> : null}
    </span>
  )
}

/**
 * 「较上一周期 ↑12%」: neutral while the change is ordinary; the warning colour only past the
 * threshold (tokens doubled, cache hit down 20 points; D24 steady states stay uncoloured).
 */
export function DeltaText({ current, previous, points = false }: { current: number; previous: number | undefined; points?: boolean }) {
  const i18n = useI18n()
  const delta = previous === undefined ? null : usageDelta(current, previous, { points })
  if (!delta) return null
  return (
    <span className={cn('block text-xs', isNotableDelta(delta, { points }) ? 'text-warning' : 'text-muted-foreground')}>
      {delta.kind === 'change' ? `${i18n.t("较上一周期")} ${formatDelta(delta, i18n.locale, { points })}` : formatDelta(delta, i18n.locale, { points })}
    </span>
  )
}

/** Raw ids of a row, grouped so every count matches what is listed; copy puts all of them on the clipboard. */
function UsageIdList({ groups }: { groups: Array<{ kind: string; ids: string[] }> }) {
  const i18n = useI18n()
  const [copied, setCopied] = useState(false)
  const all = groups.flatMap(group => group.ids)
  if (!all.length) return null
  const heading: Record<string, string> = { keys: "统计键（{0}）", services: "服务 / 账号 ID（{0}）", session: "会话键", agent: "Agent 键", purpose: "用途键" }
  return (
    <div className="space-y-2 text-xs">
      {all.length > 1 ? <p className="text-muted-foreground">{i18n.t("合并自 {0} 个 ID", [all.length])}</p> : null}
      {groups.map(group => (
        <div key={group.kind} className="space-y-1">
          {groups.length > 1 || group.kind === 'session' ? <p className="font-medium text-foreground">{i18n.t(heading[group.kind] ?? "原始 ID", [group.ids.length])}</p> : null}
          <ul className="space-y-1">{group.ids.map(id => <li key={id}><InlineCode className="break-all">{id}</InlineCode></li>)}</ul>
        </div>
      ))}
      <Button type="button" size="sm" variant="outline" onClick={() => { void copyText(all.join('\n'), navigator.clipboard, document).then(ok => setCopied(ok)) }}>
        <Copy />{copied ? i18n.t("已复制") : i18n.t("复制 ID")}
      </Button>
    </div>
  )
}

/** 「ID ⓘ」 next to a model name: its raw ids, only on demand. The accessible name says whose ids they are. */
export function UsageIdHint({ row, name }: { row: UsageModelRow; name: string }) {
  const i18n = useI18n()
  const groups = usageModelIdGroups(row)
  if (!groups.length) return null
  return (
    <span className="shrink-0" onClick={event => event.stopPropagation()}>
      <InfoHint label={<><span className="sr-only">{i18n.t("{0} 的 ID", [name])}</span><span aria-hidden="true">{i18n.t("ID")}</span></>} className="text-xs font-normal text-muted-foreground">
        <UsageIdList groups={groups} />
      </InfoHint>
    </span>
  )
}

/** Tabs where there is room, a select in a narrow container (ADR 0063 D18). */
function DimensionSwitch<T extends string>({ value, onChange, options, label, narrow }: { value: T; onChange: (value: T) => void; options: Array<{ value: T; label: string }>; label: string; narrow: boolean }) {
  if (options.length < 2) return null
  if (narrow) return <SelectField aria-label={label} className="w-auto min-w-40" value={value} onValueChange={next => onChange(next as T)} options={options} />
  return (
    <Tabs value={value} onValueChange={next => onChange(next as T)}>
      <TabsList aria-label={label}>{options.map(option => <TabsTrigger key={option.value} value={option.value}>{option.label}</TabsTrigger>)}</TabsList>
    </Tabs>
  )
}

function timeZoneNote(hostZone: string | undefined, t: Translate): string {
  const local = Intl.DateTimeFormat().resolvedOptions().timeZone
  return hostZone && hostZone !== local ? t("按本机时区 {0} 显示（实例时区 {1}）", [local, hostZone]) : t("按本机时区 {0} 显示", [local])
}

/** How the numbers were counted, said once in an ⓘ (D15 第 2 条). */
export function UsageBasisHint({ stats }: { stats: UsageStats }) {
  const i18n = useI18n()
  return (
    <InfoHint label={i18n.t("统计口径")} className="text-xs text-muted-foreground">
      <ul className="max-w-sm space-y-1.5 text-xs">
        <li>{i18n.t("来自回合追踪文件，覆盖 {0} 至 {1}", [new Date(stats.range.since).toLocaleString(i18n.locale), new Date(stats.range.until).toLocaleString(i18n.locale)])}</li>
        <li>{timeZoneNote(stats.range.timeZone, i18n.t)}</li>
        <li>{i18n.t("总 tokens = 输入 + 输出。输入是每次模型调用的实际输入之和，工具循环里的多次调用都计入。")}</li>
        <li>{i18n.t("「较上一周期」与紧挨在前、同样长度的一段时间比较。")}</li>
        <li>{i18n.t("输入构成按每个回合的上下文预算估算（每回合一次），所以合计小于「总输入」。")}</li>
        {stats.malformedLines ? <li>{i18n.t("有 {0} 行用量记录无法解析，已忽略。", [stats.malformedLines])}</li> : null}
      </ul>
    </InfoHint>
  )
}

function UsageSummary({ stats, previous }: { stats: UsageStats; previous: UsageTotals | null }) {
  const i18n = useI18n()
  const totals = stats.totals
  const quantiles = cacheQuantiles(totals)
  const prev = previous ?? undefined
  return (
    <StatGrid label={i18n.t("用量汇总")}>
      <StatCard icon={Sigma} label={i18n.t("总 tokens")} value={formatTokens(totalTokens(totals), i18n.locale)}
        sub={<><span className="block">{i18n.t("输入 {0} · 输出 {1}", [formatTokens(totals.inputTokens, i18n.locale), formatTokens(totals.outputTokens, i18n.locale)])}</span><DeltaText current={totalTokens(totals)} previous={prev && totalTokens(prev)} /></>} />
      <StatCard icon={Cpu} label={i18n.t("模型调用")} value={formatTokens(totals.calls, i18n.locale)} sub={<DeltaText current={totals.calls} previous={prev?.calls} />} />
      <StatCard icon={Zap} label={i18n.t("缓存命中率")} value={formatPercent(cacheRatio(totals), i18n.locale)}
        footer={<ProgressMeter value={Math.round(cacheRatio(totals) * 100)} label={i18n.t("缓存命中率")} />}
        sub={<>{quantiles ? <span className="block">{`P50 ${formatPercent(quantiles.p50, i18n.locale)} · P90 ${formatPercent(quantiles.p90, i18n.locale)}`}</span> : null}<DeltaText current={cacheRatio(totals)} previous={prev && cacheRatio(prev)} points /></>} />
      <StatCard icon={Layers} label={i18n.t("回合")} value={formatTokens(totals.turns, i18n.locale)} sub={<DeltaText current={totals.turns} previous={prev?.turns} />} />
    </StatGrid>
  )
}

function UsageTrend({ stats, narrow }: { stats: UsageStats; narrow: boolean }) {
  const i18n = useI18n()
  const [dimension, setDimension] = useState<TrendDimension>('service')
  const series = useMemo(() => usageTrendSeries(stats, dimension, i18n.locale), [stats, dimension, i18n.locale])
  const keys = useMemo(() => seriesKeys(series), [series])
  const colors = useMemo(() => buildColorMap(keys), [keys])
  const shown = useMemo(() => topSeriesKeys(series), [series])
  const options: Array<{ value: TrendDimension; label: string }> = [
    { value: 'service', label: i18n.t("按服务") },
    { value: 'model', label: i18n.t("按模型") },
  ]
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">{i18n.t("用量趋势")}</CardTitle>
          <CardDescription>{i18n.t("输入 tokens，悬停柱子看各项数值。")}</CardDescription>
        </div>
        <DimensionSwitch value={dimension} onChange={setDimension} options={options} label={i18n.t("趋势维度")} narrow={narrow} />
      </CardHeader>
      <CardContent className="space-y-3 text-foreground">
        <ModelLegend keys={shown} colors={colors} hasOther={keys.length > shown.length} />
        <StackedBarChart series={series} keys={shown} colors={colors} bucket={stats.range.bucket} />
      </CardContent>
    </Card>
  )
}

function UsageAlerts({ stats }: { stats: UsageStats }) {
  const i18n = useI18n()
  const cache = promptCacheNotices(stats, i18n.locale)
  if (cache?.hints.length) return (
    <Alert variant="warning" role="status">
      <Zap aria-hidden="true" />
      <AlertTitle>{i18n.t("可能不支持提示缓存")}</AlertTitle>
      <AlertDescription><ul className="space-y-1">{cache.hints.map(hint => <li key={hint.key} className="break-words">{hint.text}</li>)}</ul></AlertDescription>
    </Alert>
  )
  if (cache?.missed) return (
    <Alert role="status">
      <Zap aria-hidden="true" />
      <AlertTitle>{i18n.t("缓存未命中")}</AlertTitle>
      <AlertDescription>{i18n.t("这段时间的请求都没有命中提示缓存。系统提示或工具定义每次都在变化时，缓存无法复用。")}</AlertDescription>
    </Alert>
  )
  return null
}

const numbers = (row: Counts, t: Translate, locale: ReturnType<typeof useI18n>["locale"]) => `${t("输入 {0}", [formatTokens(row.inputTokens, locale)])} · ${t("缓存命中 {0}", [formatPercent(cacheRatio(row), locale)])}`

/** One row of a narrow list: name line, key numbers line, share bar; the rest is in the Sheet. */
function CompactRow({ name, qualifier, row, share, onOpen }: { name: string; qualifier?: string; row: Counts; share: number; onOpen: () => void }) {
  const i18n = useI18n()
  return (
    <li>
      <ListItemButton className="block w-full min-w-0 space-y-1.5 rounded-lg border border-[color:var(--console-border-subtle)] px-3 py-2.5 text-left hover:bg-muted/50" onClick={onOpen}>
        <UsageName name={name} qualifier={qualifier} />
        <span className="block text-xs text-muted-foreground">{numbers(row, i18n.t, i18n.locale)}</span>
        <ProgressMeter value={Math.round(share * 100)} label={i18n.t("占比")} />
      </ListItemButton>
    </li>
  )
}

function ShareCell({ share }: { share: number }) {
  const i18n = useI18n()
  return <TableCell priority="secondary" className="w-32"><ProgressMeter value={Math.round(share * 100)} showValue label={i18n.t("占比")} /></TableCell>
}

function NameButton({ onOpen, children }: { onOpen: () => void; children: ReactNode }) {
  return <ListItemButton className="min-w-0 max-w-full text-left underline-offset-2 hover:underline" onClick={event => { event.stopPropagation(); onOpen() }}>{children}</ListItemButton>
}

function ModelTable({ groups, total, narrow, open }: { groups: UsageServiceGroup[]; total: number; narrow: boolean; open: (selection: UsageSelection) => void }) {
  const i18n = useI18n()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(groups.slice(0, 1).map(group => group.key)))
  const share = (row: Counts) => total > 0 ? row.inputTokens / total : 0
  if (narrow) return (
    <ul className="space-y-2">
      {groups.flatMap(group => group.models).sort((a, b) => b.inputTokens - a.inputTokens).map(row => (
        <CompactRow key={row.model} name={row.model} row={row} share={share(row)} onOpen={() => open({ kind: 'model', key: row.model })} />
      ))}
    </ul>
  )
  const toggle = (key: string) => setExpanded(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  return (
    <Table density="compact">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{i18n.t("服务 / 模型")}</TableHead>
          <TableHead numeric>{i18n.t("调用")}</TableHead>
          <TableHead numeric>{i18n.t("输入")}</TableHead>
          <TableHead numeric>{i18n.t("输出")}</TableHead>
          <TableHead numeric>{i18n.t("缓存命中率")}</TableHead>
          <TableHead priority="secondary">{i18n.t("占比")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {groups.flatMap(group => {
          const isOpen = expanded.has(group.key)
          return [
            <TableRow key={`s:${group.key}`} className="cursor-pointer hover:bg-muted/50" onClick={() => open({ kind: 'service', key: group.key })}>
              <TableCell className="min-w-0">
                <span className="flex min-w-0 items-center gap-1">
                  <Button type="button" variant="ghost" size="icon" className="shrink-0" aria-expanded={isOpen} aria-label={i18n.t(isOpen ? "收起 {0}" : "展开 {0}", [group.name])} onClick={event => { event.stopPropagation(); toggle(group.key) }}>
                    {isOpen ? <ChevronDown /> : <ChevronRight />}
                  </Button>
                  <NameButton onOpen={() => open({ kind: 'service', key: group.key })}><UsageName name={group.name} secondary={group.models.length > 1 ? i18n.t("{0} 个模型", [group.models.length]) : undefined} /></NameButton>
                </span>
              </TableCell>
              <TableCell numeric>{formatTokens(group.calls, i18n.locale)}</TableCell>
              <TableCell numeric>{formatTokens(group.inputTokens, i18n.locale)}</TableCell>
              <TableCell numeric>{formatTokens(group.outputTokens, i18n.locale)}</TableCell>
              <TableCell numeric>{formatPercent(cacheRatio(group), i18n.locale)}</TableCell>
              <ShareCell share={group.share} />
            </TableRow>,
            ...(isOpen ? group.models.map(row => (
              <TableRow key={`m:${row.model}`} className="cursor-pointer text-muted-foreground hover:bg-muted/50" onClick={() => open({ kind: 'model', key: row.model })}>
                <TableCell className="min-w-0 pl-12">
                  <span className="flex min-w-0 items-center gap-2">
                    <NameButton onOpen={() => open({ kind: 'model', key: row.model })}><UsageName name={row.modelName ?? row.model} secondary={usageProfileName(row) || undefined} /></NameButton>
                    <UsageIdHint row={row} name={row.model} />
                  </span>
                </TableCell>
                <TableCell numeric>{formatTokens(row.calls, i18n.locale)}</TableCell>
                <TableCell numeric>{formatTokens(row.inputTokens, i18n.locale)}</TableCell>
                <TableCell numeric>{formatTokens(row.outputTokens, i18n.locale)}</TableCell>
                <TableCell numeric>{formatPercent(cacheRatio(row), i18n.locale)}</TableCell>
                <ShareCell share={share(row)} />
              </TableRow>
            )) : []),
          ]
        })}
      </TableBody>
    </Table>
  )
}

function SessionTable({ stats, narrow, open }: { stats: UsageStats; narrow: boolean; open: (selection: UsageSelection) => void }) {
  const i18n = useI18n()
  const [sortKey, setSortKey] = useState<SortKey>('inputTokens')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const names = useMemo(() => usageSessionNames(stats.bySession, i18n.locale), [stats.bySession, i18n.locale])
  const sessions = useMemo(() => sortSessions(stats.bySession, sortKey, sortDir), [stats.bySession, sortKey, sortDir])
  const total = stats.totals.inputTokens
  const toggleSort = (key: SortKey) => {
    if (key === sortKey) setSortDir(sortDir === 'desc' ? 'asc' : 'desc')
    else { setSortKey(key); setSortDir('desc') }
  }
  const header = (key: SortKey, label: string, priority?: 'secondary') => <TableHead numeric priority={priority}>
    <Button type="button" variant="ghost" size="sm" className="-mr-3" onClick={() => toggleSort(key)} aria-label={i18n.t("按{0}排序", [label])}>
      {label}{sortKey === key ? (sortDir === 'desc' ? <ArrowDown /> : <ArrowUp />) : null}
    </Button>
  </TableHead>
  return <>
    {narrow ? (
      <ul className="space-y-2">
        {sessions.map(row => {
          const name = names.get(row.sessionKey)!
          return <CompactRow key={row.sessionKey} name={name.name} qualifier={name.qualifier} row={row} share={total > 0 ? row.inputTokens / total : 0} onOpen={() => open({ kind: 'session', key: row.sessionKey })} />
        })}
      </ul>
    ) : (
      <Table density="compact">
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead>{i18n.t("会话")}</TableHead>
            {header('turns', i18n.t("回合"), 'secondary')}
            {header('calls', i18n.t("调用"), 'secondary')}
            {header('inputTokens', i18n.t("输入"))}
            {header('outputTokens', i18n.t("输出"), 'secondary')}
            {header('cache', i18n.t("缓存命中率"))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {sessions.map(row => {
            const name = names.get(row.sessionKey)!
            const parts = splitSessionKey(row)
            const kind = row.scopeKind ?? parts.scope
            return <TableRow key={row.sessionKey} className="cursor-pointer hover:bg-muted/50" onClick={() => open({ kind: 'session', key: row.sessionKey })}>
              <TableCell className="min-w-0 text-sm">
                <span className="flex min-w-0 items-center gap-2">
                  {/* The full session key (hashed keys included) only shows on hover and in the Sheet. */}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <ListItemButton className="min-w-0 max-w-full text-left underline-offset-2 hover:underline" onClick={event => { event.stopPropagation(); open({ kind: 'session', key: row.sessionKey }) }}>
                        <UsageName name={name.name} qualifier={name.qualifier} />
                      </ListItemButton>
                    </TooltipTrigger>
                    <TooltipContent className="max-w-xs break-all font-mono text-xs">{row.sessionKey}</TooltipContent>
                  </Tooltip>
                  {kind === 'group' || kind === 'private' || kind === 'channel' ? <ConversationKindBadge kind={kind} /> : null}
                </span>
              </TableCell>
              <TableCell numeric priority="secondary">{formatTokens(row.turns, i18n.locale)}</TableCell>
              <TableCell numeric priority="secondary">{formatTokens(row.calls, i18n.locale)}</TableCell>
              <TableCell numeric>{formatTokens(row.inputTokens, i18n.locale)}</TableCell>
              <TableCell numeric priority="secondary">{formatTokens(row.outputTokens, i18n.locale)}</TableCell>
              <TableCell numeric>{formatPercent(cacheRatio(row), i18n.locale)}</TableCell>
            </TableRow>
          })}
        </TableBody>
      </Table>
    )}
    <SessionFooter stats={stats} />
  </>
}

/** 「其余 N 个会话合计」 (zhin 第 58 批 `othersTotals`), or the 50-row cap of an older Host. */
function SessionFooter({ stats }: { stats: UsageStats }) {
  const i18n = useI18n()
  const others = usageCapabilities(stats).others
  if (others && others.sessions > 0) return <p className="pt-3 text-xs text-muted-foreground">{i18n.t("其余 {0} 个会话合计：输入 {1} · 输出 {2} · 调用 {3}", [others.sessions, formatTokens(others.totals.inputTokens, i18n.locale), formatTokens(others.totals.outputTokens, i18n.locale), formatTokens(others.totals.calls, i18n.locale)])}</p>
  if (!others && stats.bySession.length >= 50) return <p className="pt-3 text-xs text-muted-foreground">{i18n.t("只列出用量最高的 {0} 个会话。", [stats.bySession.length])}</p>
  return null
}

function DimensionTable({ rows, total, narrow, nameOf, open }: { rows: Array<Counts & { key: string }>; total: number; narrow: boolean; nameOf: (key: string) => string; open: (key: string) => void }) {
  const i18n = useI18n()
  const share = (row: Counts) => total > 0 ? row.inputTokens / total : 0
  if (narrow) return <ul className="space-y-2">{rows.map(row => <CompactRow key={row.key} name={nameOf(row.key)} row={row} share={share(row)} onOpen={() => open(row.key)} />)}</ul>
  return (
    <Table density="compact">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead>{i18n.t("名称")}</TableHead>
          <TableHead numeric priority="secondary">{i18n.t("回合")}</TableHead>
          <TableHead numeric>{i18n.t("调用")}</TableHead>
          <TableHead numeric>{i18n.t("输入")}</TableHead>
          <TableHead numeric priority="secondary">{i18n.t("输出")}</TableHead>
          <TableHead numeric>{i18n.t("缓存命中率")}</TableHead>
          <TableHead priority="secondary">{i18n.t("占比")}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map(row => (
          <TableRow key={row.key} className="cursor-pointer hover:bg-muted/50" onClick={() => open(row.key)}>
            <TableCell className="min-w-0"><NameButton onOpen={() => open(row.key)}><UsageName name={nameOf(row.key)} /></NameButton></TableCell>
            <TableCell numeric priority="secondary">{typeof row.turns === 'number' ? formatTokens(row.turns, i18n.locale) : '—'}</TableCell>
            <TableCell numeric>{formatTokens(row.calls, i18n.locale)}</TableCell>
            <TableCell numeric>{formatTokens(row.inputTokens, i18n.locale)}</TableCell>
            <TableCell numeric priority="secondary">{formatTokens(row.outputTokens, i18n.locale)}</TableCell>
            <TableCell numeric>{formatPercent(cacheRatio(row), i18n.locale)}</TableCell>
            <ShareCell share={share(row)} />
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

/** Every number of the selected row, its raw ids with a copy button, and (sessions) 「只看这个会话」. */
function UsageDetailSheet({ stats, groups, selection, narrow, onClose, onPickSession }: {
  stats: UsageStats; groups: UsageServiceGroup[]; selection: UsageSelection | null; narrow: boolean; onClose: () => void; onPickSession?: (sessionKey: string) => void
}) {
  const i18n = useI18n()
  const t = i18n.t
  const locale = i18n.locale
  const caps = usageCapabilities(stats)
  const total = stats.totals.inputTokens
  let title = '', kindLabel = '', row: Counts | null = null
  let extra: Array<{ key: string; label: string; value: ReactNode }> = []
  let idGroups: Array<{ kind: string; ids: string[] }> = []
  let action: ReactNode = null
  if (selection?.kind === 'service') {
    const group = groups.find(item => item.key === selection.key)
    if (group) {
      title = group.name; kindLabel = t("服务"); row = group
      extra = [
        { key: 'models', label: t("模型"), value: group.models.map(model => model.modelName ?? model.model).join('、') },
        ...(group.driverLabel ? [{ key: 'driver', label: t("驱动"), value: group.driverLabel }] : []),
      ]
      idGroups = [{ kind: 'services', ids: group.providerIds }].filter(item => item.ids.length)
    }
  } else if (selection?.kind === 'model') {
    const model = stats.byModel.find(item => item.model === selection.key)
    if (model) {
      title = model.model; kindLabel = t("模型"); row = model
      extra = [
        { key: 'service', label: t("服务"), value: model.serviceName ?? '—' },
        { key: 'model', label: t("模型"), value: model.modelName ?? model.model },
        ...(model.driverLabel ? [{ key: 'driver', label: t("驱动"), value: model.driverLabel }] : []),
        ...(usageProfileName(model) ? [{ key: 'profile', label: t("模型配置"), value: usageProfileName(model) }] : []),
        ...(model.claimsWithoutToolCall ? [{ key: 'claims', label: t("声称查过但没调用工具"), value: formatTokens(model.claimsWithoutToolCall, locale) }] : []),
      ]
      idGroups = usageModelIdGroups(model)
    }
  } else if (selection?.kind === 'session') {
    const session = stats.bySession.find(item => item.sessionKey === selection.key)
    if (session) {
      const name = usageSessionNames(stats.bySession, locale).get(session.sessionKey)!
      const parts = splitSessionKey(session)
      const kind = session.scopeKind ?? parts.scope
      const account = usageAccountLabel(session)
      title = name.qualifier ? `${name.name} ${name.qualifier}` : name.name; kindLabel = t("会话"); row = session
      extra = [
        ...(parts.platform ? [{ key: 'platform', label: t("平台"), value: parts.platform }] : []),
        ...(account ? [{ key: 'account', label: t("账号"), value: account }] : []),
        ...(kind === 'group' || kind === 'private' || kind === 'channel' ? [{ key: 'kind', label: t("类型"), value: <ConversationKindBadge kind={kind} /> }] : []),
      ]
      idGroups = [{ kind: 'session', ids: [session.sessionKey] }]
      if (onPickSession) action = <Button type="button" variant="outline" onClick={() => { onPickSession(session.sessionKey); onClose() }}>{t("只看这个会话")}</Button>
    }
  } else if (selection?.kind === 'agent') {
    const agent = caps.agents.find(item => item.agent === selection.key)
    if (agent) { title = usageAgentLabel(agent, locale); kindLabel = t("Agent"); row = agent; idGroups = [{ kind: 'agent', ids: [agent.agent] }] }
  } else if (selection?.kind === 'purpose') {
    const purpose = caps.purposes.find(item => item.purpose === selection.key)
    if (purpose) { title = usagePurposeLabel(purpose, locale); kindLabel = t("用途"); row = purpose; idGroups = [{ kind: 'purpose', ids: [purpose.purpose] }] }
  }
  const items = row ? [
    ...extra,
    ...(typeof row.turns === 'number' ? [{ key: 'turns', label: t("回合"), value: formatTokens(row.turns, locale) }] : []),
    { key: 'calls', label: t("调用"), value: formatTokens(row.calls, locale) },
    { key: 'input', label: t("输入"), value: formatTokens(row.inputTokens, locale) },
    { key: 'output', label: t("输出"), value: formatTokens(row.outputTokens, locale) },
    { key: 'read', label: t("缓存读取"), value: formatTokens(row.cacheReadTokens, locale) },
    ...(row.cacheWriteTokens ? [{ key: 'write', label: t("缓存写入"), value: formatTokens(row.cacheWriteTokens, locale) }] : []),
    { key: 'cache', label: t("缓存命中率"), value: formatPercent(cacheRatio(row), locale) },
    { key: 'share', label: t("占总输入"), value: formatPercent(total > 0 ? row.inputTokens / total : 0, locale) },
  ] : []
  return (
    <Sheet open={Boolean(row)} onOpenChange={next => { if (!next) onClose() }}>
      <SheetContent side={narrow ? 'bottom' : 'right'}>
        <SheetHeader>
          <SheetTitle className="break-words">{title}</SheetTitle>
          <SheetDescription>{kindLabel}</SheetDescription>
        </SheetHeader>
        <SheetBody className="space-y-5">
          <KeyValueList items={items} columns={2} />
          {idGroups.length ? <div className="space-y-2 border-t border-[color:var(--console-border-subtle)] pt-4"><p className="text-sm font-medium">{t("原始 ID")}</p><UsageIdList groups={idGroups} /></div> : null}
        </SheetBody>
        {action ? <SheetFooter>{action}</SheetFooter> : null}
      </SheetContent>
    </Sheet>
  )
}

function UsageDetails({ stats, groups, narrow, view, onViewChange, open }: {
  stats: UsageStats; groups: UsageServiceGroup[]; narrow: boolean; view: UsageView; onViewChange: (view: UsageView) => void; open: (selection: UsageSelection) => void
}) {
  const i18n = useI18n()
  const caps = usageCapabilities(stats)
  const options: Array<{ value: UsageView; label: string }> = [
    { value: 'models', label: i18n.t("服务与模型") },
    { value: 'sessions', label: i18n.t("会话") },
    ...(caps.agents.length ? [{ value: 'agents' as const, label: i18n.t("Agent") }] : []),
    ...(caps.purposes.length ? [{ value: 'purposes' as const, label: i18n.t("用途") }] : []),
  ]
  // A view the Host cannot answer (an older Host and a shared 「?view=agents」 link) falls back to the default.
  const active: UsageView = options.some(option => option.value === view) ? view : 'models'
  const total = stats.totals.inputTokens
  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-base">{i18n.t("明细")}</CardTitle>
          <CardDescription>{i18n.t("按输入从多到少；点一行看全部数值。")}</CardDescription>
        </div>
        <DimensionSwitch value={active} onChange={onViewChange} options={options} label={i18n.t("明细维度")} narrow={narrow} />
      </CardHeader>
      <CardContent>
        {active === 'models' ? <ModelTable groups={groups} total={total} narrow={narrow} open={open} />
          : active === 'sessions' ? <SessionTable stats={stats} narrow={narrow} open={open} />
            : active === 'agents' ? <DimensionTable rows={caps.agents.map((row: UsageAgentRow) => ({ ...row, key: row.agent }))} total={total} narrow={narrow} nameOf={key => usageAgentLabel({ agent: key }, i18n.locale)} open={key => open({ kind: 'agent', key })} />
              : <DimensionTable rows={caps.purposes.map((row: UsagePurposeRow) => ({ ...row, key: row.purpose }))} total={total} narrow={narrow} nameOf={key => usagePurposeLabel({ purpose: key }, i18n.locale)} open={key => open({ kind: 'purpose', key })} />}
      </CardContent>
    </Card>
  )
}

/** Cache hit over time, the input breakdown and the cache hit per service: folded unless a cache alert is up. */
function UsageCacheSection({ stats, groups, alert }: { stats: UsageStats; groups: UsageServiceGroup[]; alert: boolean }) {
  const i18n = useI18n()
  const showWrite = hasCacheWrite(stats)
  return (
    <Disclosure key={alert ? 'alert' : 'calm'} defaultOpen={alert} summary={i18n.t("缓存与上下文")} description={i18n.t("命中率趋势、输入构成、各服务的缓存命中")}
      badge={alert ? <Badge variant="warning" size="sm">{i18n.t("需要留意")}</Badge> : undefined}>
      <div className="space-y-6 pt-2">
        <section className="space-y-2">
          <h3 className="text-sm font-medium">{i18n.t("缓存命中率随时间变化")}</h3>
          <div className="text-foreground"><CacheLineChart series={stats.series} bucket={stats.range.bucket} quantiles={cacheQuantiles(stats.totals)} /></div>
        </section>
        <div className="grid gap-6 lg:grid-cols-2">
          <section className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium">{i18n.t("各服务的缓存命中")}</h3>
            <Table density="compact">
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>{i18n.t("服务")}</TableHead>
                  <TableHead numeric>{i18n.t("输入")}</TableHead>
                  <TableHead numeric priority="secondary">{i18n.t("缓存读取")}</TableHead>
                  {showWrite ? <TableHead numeric priority="secondary">{i18n.t("缓存写入")}</TableHead> : null}
                  <TableHead numeric>{i18n.t("缓存命中率")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map(group => (
                  <TableRow key={group.key}>
                    <TableCell className="min-w-0"><UsageName name={group.name} /></TableCell>
                    <TableCell numeric>{formatTokens(group.inputTokens, i18n.locale)}</TableCell>
                    <TableCell numeric priority="secondary">{formatTokens(group.cacheReadTokens, i18n.locale)}</TableCell>
                    {showWrite ? <TableCell numeric priority="secondary">{group.cacheWriteTokens ? formatTokens(group.cacheWriteTokens, i18n.locale) : '—'}</TableCell> : null}
                    <TableCell numeric>{formatPercent(cacheRatio(group), i18n.locale)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </section>
          <section className="min-w-0 space-y-2">
            <h3 className="text-sm font-medium">{i18n.t("输入构成")}</h3>
            <div className="text-foreground"><SegmentDonut segments={stats.segments} /></div>
          </section>
        </div>
      </div>
    </Disclosure>
  )
}

export interface UsageReportProps {
  stats: UsageStats
  /** Totals of the previous window (the Host's `previous`, or a second request); null hides the change. */
  previous: UsageTotals | null
  view: UsageView
  onViewChange: (view: UsageView) => void
  onPickSession?: (sessionKey: string) => void
  /** Replaces the report body when the range has no model calls. */
  empty?: ReactNode
  /** Test seam: the row whose Sheet is open at first. */
  initialSelection?: UsageSelection | null
}

export function UsageReport({ stats, previous, view, onViewChange, onPickSession, empty, initialSelection = null }: UsageReportProps) {
  const i18n = useI18n()
  const root = useRef<HTMLDivElement>(null)
  // Below 40rem of the report's own width (ADR 0063 D18): selects instead of tabs, one compact card per row.
  const narrow = useContainerAtLeast(root, 40) === false
  const [selection, setSelection] = useState<UsageSelection | null>(initialSelection)
  const groups = useMemo(() => usageServiceGroups(stats.byModel, i18n.locale), [stats.byModel, i18n.locale])
  const cacheAlert = Boolean(promptCacheNotices(stats, i18n.locale)?.hints.length)
  return (
    <div ref={root} className="console-content-stack is-gap-section">
      <UsageSummary stats={stats} previous={previous} />
      {empty ?? <>
        <UsageAlerts stats={stats} />
        <UsageTrend stats={stats} narrow={narrow} />
        <UsageDetails stats={stats} groups={groups} narrow={narrow} view={view} onViewChange={onViewChange} open={setSelection} />
        <UsageCacheSection stats={stats} groups={groups} alert={cacheAlert} />
        <UsageDetailSheet stats={stats} groups={groups} selection={selection} narrow={narrow} onClose={() => setSelection(null)} onPickSession={onPickSession} />
      </>}
    </div>
  )
}
