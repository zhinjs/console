import { useId, useState } from 'react'
import { useI18n } from '../i18n'
import { cn } from '@zhin.js/client'
import {
  OTHER_COLOR,
  SEGMENT_LABELS,
  cacheLinePoints,
  cacheRatio,
  colorFor,
  donutSlices,
  formatBucketLabel,
  formatPercent,
  formatTokens,
  modelKey,
  niceMax,
  segmentValues,
  stackSeries,
  type UsageBucket,
  type UsageModelRow,
  type UsagePoint,
  type UsageStats,
} from './token-usage-model.mjs'

/** 依赖零的交互式 SVG 图表：颜色由调用方传入的 colorMap 决定，所有图共用同一份。 */

const W = 720
const H = 232
const LINE_H = 164
const PAD = { left: 50, right: 14, top: 14, bottom: 28 }
const SEGMENT_COLORS: Record<string, string> = {
  history: 'hsl(var(--chart-1))',
  fixed: 'hsl(var(--chart-5))',
  user: 'hsl(var(--chart-3))',
}

function xLabelEvery(count: number): number {
  return Math.max(1, Math.ceil(count / 8))
}

function roundedTopRectPath(x: number, y: number, w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h))
  if (r <= 0.5) return `M${x} ${y} h${w} v${h} h${-w} Z`
  return `M${x} ${y + r} A${r} ${r} 0 0 1 ${x + r} ${y} H${x + w - r} A${r} ${r} 0 0 1 ${x + w} ${y + r} V${y + h} H${x} Z`
}

export function ModelLegend({ keys, colors, hasOther }: { keys: string[]; colors: Map<string, string>; hasOther?: boolean }) {
  const i18n = useI18n()
  return (
    <ul className="flex flex-wrap gap-2 text-xs text-muted-foreground" aria-label={i18n.t("图例")}>
      {keys.map(key => (
        <li
          key={key}
          className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--console-border-subtle)] bg-[color:var(--console-surface-inset)] px-2.5 py-1 text-foreground/90"
        >
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colorFor(colors, key) }} />
          <span className="break-all font-medium">{key}</span>
        </li>
      ))}
      {hasOther ? (
        <li className="inline-flex items-center gap-1.5 rounded-full border border-[color:var(--console-border-subtle)] bg-[color:var(--console-surface-inset)] px-2.5 py-1">
          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: OTHER_COLOR }} />
          <span>{i18n.t("其他")}</span>
        </li>
      ) : null}
    </ul>
  )
}

/** 输入 tokens 随时间的堆叠柱（按 provider/model），带顶部圆角与悬停联动读数条。 */
export function StackedBarChart({ series, keys, colors, bucket }: { series: UsagePoint[]; keys: string[]; colors: Map<string, string>; bucket: UsageBucket }) {
  const i18n = useI18n()
  const [hovered, setHovered] = useState<number | null>(null)
  const { max, bars } = stackSeries(series, keys)
  const top = niceMax(max)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / Math.max(1, bars.length)
  const barW = Math.min(36, Math.max(2, slot * 0.68))
  const every = xLabelEvery(bars.length)
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH

  const peakIndex = bars.reduce((best, bar, idx) => (bar.total > (bars[best]?.total ?? -1) ? idx : best), 0)
  const activeBar = hovered !== null ? bars[hovered] : bars[peakIndex]
  const activeIsHover = hovered !== null

  return (
    <div className="space-y-2.5">
      {activeBar ? (
        <div className="console-chart-readout" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              {activeIsHover ? i18n.t("当前时段") : i18n.t("峰值时段")}
            </span>
            <strong className="font-semibold text-foreground">
              {formatBucketLabel(activeBar.bucketStart, bucket, i18n.locale)}
            </strong>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 font-semibold text-primary">
              {formatTokens(activeBar.total, i18n.locale)} tok
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
            {activeBar.parts.slice(0, 4).map(part => (
              <span key={part.key} className="inline-flex items-center gap-1">
                <span
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: part.key === '__other__' ? OTHER_COLOR : colorFor(colors, part.key) }}
                />
                <span>{part.key === '__other__' ? i18n.t("其他") : part.key}</span>
                <strong className="font-medium text-foreground">{formatTokens(part.value, i18n.locale)}</strong>
              </span>
            ))}
          </div>
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label={i18n.t("输入 tokens 随时间变化")}
        onMouseLeave={() => setHovered(null)}
      >
        {[0, 0.25, 0.5, 0.75, 1].map(tick => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(top * tick)}
              y2={y(top * tick)}
              stroke="currentColor"
              strokeOpacity={tick === 0 ? 0.2 : 0.1}
              strokeDasharray={tick === 0 ? undefined : '3 4'}
            />
            <text x={PAD.left - 8} y={y(top * tick) + 4} textAnchor="end" fontSize={11.5} fill="currentColor" fillOpacity={0.62}>
              {formatTokens(top * tick, i18n.locale)}
            </text>
          </g>
        ))}
        {bars.map((bar, index) => {
          const slotX = PAD.left + index * slot
          const x = slotX + (slot - barW) / 2
          let acc = 0
          const label = formatBucketLabel(bar.bucketStart, bucket, i18n.locale)
          const isHovered = hovered === index
          const dimmed = hovered !== null && !isHovered
          const nonZeroParts = bar.parts.filter(p => p.value > 0)
          return (
            <g
              key={bar.bucketStart}
              style={{ opacity: dimmed ? 0.45 : 1, transition: 'opacity 140ms ease' }}
              onMouseEnter={() => setHovered(index)}
            >
              <title>{`${label} · ${formatTokens(bar.total, i18n.locale)}\n${bar.parts.map(part => `${part.key === '__other__' ? i18n.t("其他") : part.key}: ${formatTokens(part.value, i18n.locale)}`).join('\n')}`}</title>
              <rect
                x={slotX}
                y={PAD.top}
                width={slot}
                height={innerH}
                rx={4}
                fill="currentColor"
                fillOpacity={isHovered ? 0.05 : 0}
              />
              {nonZeroParts.map((part, partIdx) => {
                const h = Math.max(0, (part.value / top) * innerH)
                acc += part.value
                const rectY = y(acc)
                const fill = part.key === '__other__' ? OTHER_COLOR : colorFor(colors, part.key)
                const isTopSegment = partIdx === nonZeroParts.length - 1
                return isTopSegment ? (
                  <path key={part.key} d={roundedTopRectPath(x, rectY, barW, h, 4)} fill={fill} />
                ) : (
                  <rect key={part.key} x={x} y={rectY} width={barW} height={h} fill={fill} />
                )
              })}
              {index % every === 0 ? (
                <text
                  x={x + barW / 2}
                  y={H - 8}
                  textAnchor="middle"
                  fontSize={11.5}
                  fontWeight={isHovered ? 600 : 400}
                  fill="currentColor"
                  fillOpacity={isHovered ? 0.95 : 0.62}
                >
                  {label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** 缓存命中率随时间的面积折线（0–100%）。没有输入的桶断开，支持分位参考线与悬停准星。 */
export function CacheLineChart({
  series,
  bucket,
  quantiles,
}: {
  series: UsagePoint[]
  bucket: UsageBucket
  quantiles?: { p50: number; p90: number } | null
}) {
  const i18n = useI18n()
  const gradientId = useId().replace(/:/g, '')
  const [hovered, setHovered] = useState<number | null>(null)
  const points = cacheLinePoints(series)
  const innerW = W - PAD.left - PAD.right
  const innerH = LINE_H - PAD.top - PAD.bottom
  const slot = innerW / Math.max(1, points.length)
  const x = (index: number) => PAD.left + index * slot + slot / 2
  const y = (value: number) => PAD.top + innerH - value * innerH
  const baselineY = y(0)
  const every = xLabelEvery(points.length)

  // Group contiguous non-null points into segments so gaps stay truthful while contiguous runs get area fills.
  const runs: Array<Array<{ index: number; value: number }>> = []
  points.forEach((point, index) => {
    if (point.value === null) {
      runs.push([])
      return
    }
    if (runs.length === 0) runs.push([])
    runs.at(-1)!.push({ index, value: point.value })
  })
  const validRuns = runs.filter(run => run.length > 0)

  const activePoint = hovered !== null && points[hovered]?.value !== null
    ? { index: hovered, point: points[hovered]! }
    : (() => {
        for (let idx = points.length - 1; idx >= 0; idx--) {
          if (points[idx]?.value !== null) return { index: idx, point: points[idx]! }
        }
        return null
      })()

  return (
    <div className="space-y-2.5">
      {activePoint && activePoint.point.value !== null ? (
        <div className="console-chart-readout" aria-live="polite">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground">
              {hovered !== null ? i18n.t("当前时段") : i18n.t("最近有效时段")}
            </span>
            <strong className="font-semibold text-foreground">
              {formatBucketLabel(activePoint.point.bucketStart, bucket, i18n.locale)}
            </strong>
            <span className="rounded-full bg-[hsl(var(--chart-3)/0.14)] px-2 py-0.5 font-semibold text-[hsl(var(--chart-3))]">
              {formatPercent(activePoint.point.value, i18n.locale)}
            </span>
          </div>
          {quantiles ? (
            <div className="flex items-center gap-3 text-muted-foreground">
              <span>P50 <strong className="text-foreground">{formatPercent(quantiles.p50, i18n.locale)}</strong></span>
              <span>P90 <strong className="text-foreground">{formatPercent(quantiles.p90, i18n.locale)}</strong></span>
            </div>
          ) : null}
        </div>
      ) : null}

      <svg
        viewBox={`0 0 ${W} ${LINE_H}`}
        className="h-auto w-full select-none"
        role="img"
        aria-label={i18n.t("缓存命中率随时间变化")}
        onMouseLeave={() => setHovered(null)}
      >
        <defs>
          <linearGradient id={`cache-area-${gradientId}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="hsl(var(--chart-3))" stopOpacity="0.26" />
            <stop offset="100%" stopColor="hsl(var(--chart-3))" stopOpacity="0.01" />
          </linearGradient>
        </defs>

        {[0, 0.25, 0.5, 0.75, 1].map(tick => (
          <g key={tick}>
            <line
              x1={PAD.left}
              x2={W - PAD.right}
              y1={y(tick)}
              y2={y(tick)}
              stroke="currentColor"
              strokeOpacity={tick === 0 ? 0.2 : 0.09}
              strokeDasharray={tick === 0 ? undefined : '3 4'}
            />
            {tick === 0 || tick === 0.5 || tick === 1 ? (
              <text x={PAD.left - 8} y={y(tick) + 4} textAnchor="end" fontSize={11.5} fill="currentColor" fillOpacity={0.62}>
                {formatPercent(tick, i18n.locale)}
              </text>
            ) : null}
          </g>
        ))}

        {quantiles ? (
          <line
            x1={PAD.left}
            x2={W - PAD.right}
            y1={y(quantiles.p50)}
            y2={y(quantiles.p50)}
            stroke="hsl(var(--chart-3))"
            strokeOpacity={0.35}
            strokeDasharray="5 4"
          />
        ) : null}

        {validRuns.map((run, runIdx) => {
          const linePath = run
            .map((pt, idx) => `${idx === 0 ? 'M' : 'L'}${x(pt.index).toFixed(1)} ${y(pt.value).toFixed(1)}`)
            .join(' ')
          const areaPath = run.length > 1
            ? `${linePath} L${x(run.at(-1)!.index).toFixed(1)} ${baselineY.toFixed(1)} L${x(run[0]!.index).toFixed(1)} ${baselineY.toFixed(1)} Z`
            : null
          return (
            <g key={runIdx}>
              {areaPath ? <path d={areaPath} fill={`url(#cache-area-${gradientId})`} /> : null}
              <path d={linePath} fill="none" stroke="hsl(var(--chart-3))" strokeWidth={2.25} strokeLinecap="round" strokeLinejoin="round" />
            </g>
          )
        })}

        {hovered !== null && points[hovered]?.value !== null ? (
          <line
            x1={x(hovered)}
            x2={x(hovered)}
            y1={PAD.top}
            y2={baselineY}
            stroke="hsl(var(--chart-3))"
            strokeOpacity={0.35}
            strokeDasharray="2 3"
          />
        ) : null}

        {points.map((point, index) => {
          const label = formatBucketLabel(point.bucketStart, bucket, i18n.locale)
          const isHovered = hovered === index
          return (
            <g key={point.bucketStart} onMouseEnter={() => setHovered(index)}>
              <rect x={PAD.left + index * slot} y={PAD.top} width={slot} height={innerH} fill="transparent" />
              {point.value !== null ? (
                <circle
                  cx={x(index)}
                  cy={y(point.value)}
                  r={isHovered ? 5 : points.length > 60 ? 1.8 : 3.2}
                  fill="hsl(var(--chart-3))"
                  stroke="hsl(var(--card))"
                  strokeWidth={isHovered ? 2 : 1.25}
                >
                  <title>{`${label} · ${formatPercent(point.value, i18n.locale)}`}</title>
                </circle>
              ) : null}
              {index % every === 0 ? (
                <text
                  x={x(index)}
                  y={LINE_H - 8}
                  textAnchor="middle"
                  fontSize={11.5}
                  fontWeight={isHovered ? 600 : 400}
                  fill="currentColor"
                  fillOpacity={isHovered ? 0.95 : 0.62}
                >
                  {label}
                </text>
              ) : null}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** 按 provider/model 的对比卡片与多轨进度条：输入 / 输出 / 缓存读取，右侧显示命中率与调用次数。 */
export function ModelBars({ rows, colors, showWrite }: { rows: UsageModelRow[]; colors: Map<string, string>; showWrite: boolean }) {
  const i18n = useI18n()
  const max = Math.max(1, ...rows.flatMap(row => [row.inputTokens, row.outputTokens, row.cacheReadTokens]))
  const kinds = [
    ['inputTokens', "输入", 1],
    ['outputTokens', "输出", 0.68],
    ['cacheReadTokens', "缓存读取", 0.42],
  ] as const

  return (
    <ul className="space-y-3">
      {rows.map(row => {
        const key = modelKey(row.provider, row.model)
        const color = colorFor(colors, key)
        const hitRate = cacheRatio(row)
        return (
          <li key={key} className="console-model-bar-card">
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="inline-block h-3 w-3 shrink-0 rounded-full shadow-xs" style={{ background: color }} />
                <span className="break-all font-semibold text-foreground">{key}</span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                <span className="rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary">
                  {i18n.t("缓存命中率")} {formatPercent(hitRate, i18n.locale)}
                </span>
                {showWrite && row.cacheWriteTokens ? (
                  <span className="rounded-full border border-[color:var(--console-border-subtle)] bg-card px-2 py-0.5">
                    {i18n.t("缓存写入")} {formatTokens(row.cacheWriteTokens, i18n.locale)}
                  </span>
                ) : null}
                <span className="rounded-full border border-[color:var(--console-border-subtle)] bg-card px-2 py-0.5 tabular-nums">
                  {i18n.t("{0} 次调用", [row.calls])}
                </span>
              </span>
            </div>

            <div className="space-y-1.5">
              {kinds.map(([field, label, opacity]) => (
                <div key={field} className="flex items-center gap-2.5 text-xs">
                  <span className="w-16 shrink-0 text-muted-foreground">{i18n.t(label)}</span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-muted/80" aria-hidden="true">
                    <span
                      className="block h-full rounded-full transition-[width] duration-300"
                      style={{ width: `${Math.max(row[field] > 0 ? 1.5 : 0, (row[field] / max) * 100)}%`, background: color, opacity }}
                    />
                  </span>
                  <span className="w-14 shrink-0 text-right font-medium tabular-nums text-foreground">
                    {formatTokens(row[field], i18n.locale)}
                  </span>
                </div>
              ))}
            </div>
          </li>
        )
      })}
    </ul>
  )
}

/** 输入 tokens 的来源构成：历史 / 固定 / 用户输入，支持切片与图例双向悬停高亮。 */
export function SegmentDonut({ segments }: { segments: UsageStats['segments'] }) {
  const i18n = useI18n()
  const [activeKey, setActiveKey] = useState<string | null>(null)
  const items = segmentValues(segments)
  const slices = donutSlices(items)
  const cx = 84
  const cy = 84
  const r = 68
  const inner = 45
  const point = (radius: number, angle: number) => `${(cx + radius * Math.sin(angle)).toFixed(2)} ${(cy - radius * Math.cos(angle)).toFixed(2)}`
  const arc = (start: number, end: number, outerR = r) => {
    const large = end - start > Math.PI ? 1 : 0
    return `M${point(outerR, start)} A${outerR} ${outerR} 0 ${large} 1 ${point(outerR, end)} L${point(inner, end)} A${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`
  }
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  const activeSlice = activeKey ? slices.find(slice => slice.key === activeKey) ?? null : null

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center" onMouseLeave={() => setActiveKey(null)}>
      <svg viewBox="0 0 168 168" className="mx-auto h-40 w-40 shrink-0 sm:mx-0" role="img" aria-label={i18n.t("输入构成")}>
        <circle cx={cx} cy={cy} r={(r + inner) / 2} fill="none" stroke="currentColor" strokeOpacity={0.07} strokeWidth={r - inner} />
        {slices.map(slice => {
          const full = slice.share >= 0.9999
          const isActive = activeKey === slice.key
          const dimmed = activeKey !== null && !isActive
          return full ? (
            <circle
              key={slice.key}
              cx={cx}
              cy={cy}
              r={(r + inner) / 2}
              fill="none"
              stroke={SEGMENT_COLORS[slice.key]}
              strokeWidth={isActive ? r - inner + 3 : r - inner}
              onMouseEnter={() => setActiveKey(slice.key)}
            >
              <title>{`${i18n.t(SEGMENT_LABELS[slice.key]!)} 100%`}</title>
            </circle>
          ) : (
            <path
              key={slice.key}
              d={arc(slice.start, slice.end, isActive ? r + 3 : r)}
              fill={SEGMENT_COLORS[slice.key]}
              stroke="hsl(var(--card))"
              strokeWidth={2}
              style={{ opacity: dimmed ? 0.48 : 1, transition: 'opacity 150ms ease' }}
              onMouseEnter={() => setActiveKey(slice.key)}
            >
              <title>{`${i18n.t(SEGMENT_LABELS[slice.key]!)} · ${formatTokens(slice.value, i18n.locale)} · ${formatPercent(slice.share, i18n.locale)}`}</title>
            </path>
          )
        })}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize={11} fill="currentColor" fillOpacity={0.62}>
          {activeSlice ? i18n.t(SEGMENT_LABELS[activeSlice.key]!) : i18n.t("总输入")}
        </text>
        <text x={cx} y={cy + 13} textAnchor="middle" fontSize={15} fontWeight={700} fill="currentColor">
          {activeSlice ? formatPercent(activeSlice.share, i18n.locale) : formatTokens(total, i18n.locale)}
        </text>
      </svg>

      <ul className="grid min-w-0 flex-1 gap-2 text-sm">
        {items.map(item => {
          const share = total > 0 ? item.value / total : 0
          const isActive = activeKey === item.key
          return (
            <li
              key={item.key}
              className={cn('console-donut-legend-card', isActive && 'is-active')}
              onMouseEnter={() => setActiveKey(item.key)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-medium text-foreground">
                  <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: SEGMENT_COLORS[item.key] }} />
                  <span>{i18n.t(SEGMENT_LABELS[item.key]!)}</span>
                </span>
                <span className="tabular-nums text-xs text-muted-foreground">
                  <strong className="font-semibold text-foreground">{formatTokens(item.value, i18n.locale)}</strong>
                  {total > 0 ? ` · ${formatPercent(share, i18n.locale)}` : ''}
                </span>
              </div>
              <span className="block h-1.5 w-full overflow-hidden rounded-full bg-muted/80" aria-hidden="true">
                <span
                  className="block h-full rounded-full transition-[width] duration-300"
                  style={{ width: `${Math.min(100, share * 100)}%`, background: SEGMENT_COLORS[item.key] }}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
