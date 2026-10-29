import { useI18n } from '../i18n'
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

/** 依赖零的 SVG 图表：颜色由调用方传入的 colorMap 决定，所有图共用同一份。 */

const W = 720
const H = 220
const PAD = { left: 48, right: 12, top: 10, bottom: 26 }
const SEGMENT_COLORS: Record<string, string> = { history: '#2563eb', fixed: '#7c5cff', user: '#0f9d76' }

function xLabelEvery(count: number): number {
  return Math.max(1, Math.ceil(count / 8))
}

export function ModelLegend({ keys, colors, hasOther }: { keys: string[]; colors: Map<string, string>; hasOther?: boolean }) {
  const i18n = useI18n()
  return <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground" aria-label={i18n.t("图例")}>
    {keys.map(key => <li key={key} className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: colorFor(colors, key) }} /><span className="break-all">{key}</span></li>)}
    {hasOther ? <li className="flex items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: OTHER_COLOR }} />{i18n.t("其他")}</li> : null}
  </ul>
}

/** 输入 tokens 随时间的堆叠柱（按 provider/model）。 */
export function StackedBarChart({ series, keys, colors, bucket }: { series: UsagePoint[]; keys: string[]; colors: Map<string, string>; bucket: UsageBucket }) {
  const i18n = useI18n()
  const { max, bars } = stackSeries(series, keys)
  const top = niceMax(max)
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / Math.max(1, bars.length)
  const barW = Math.max(1, slot * 0.7)
  const every = xLabelEvery(bars.length)
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH
  return <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={i18n.t("输入 tokens 随时间变化")}>
    {[0, 0.25, 0.5, 0.75, 1].map(tick => <g key={tick}>
      <line x1={PAD.left} x2={W - PAD.right} y1={y(top * tick)} y2={y(top * tick)} stroke="currentColor" strokeOpacity={0.12} />
      <text x={PAD.left - 6} y={y(top * tick) + 3} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.65}>{formatTokens(top * tick, i18n.locale)}</text>
    </g>)}
    {bars.map((bar, index) => {
      const x = PAD.left + index * slot + (slot - barW) / 2
      let acc = 0
      const label = formatBucketLabel(bar.bucketStart, bucket, i18n.locale)
      return <g key={bar.bucketStart}>
        <title>{`${label} · ${formatTokens(bar.total, i18n.locale)}\n${bar.parts.map(part => `${part.key === '__other__' ? i18n.t("其他") : part.key}: ${formatTokens(part.value, i18n.locale)}`).join('\n')}`}</title>
        {bar.parts.map(part => {
          const h = (part.value / top) * innerH
          acc += part.value
          return <rect key={part.key} x={x} y={y(acc)} width={barW} height={h} fill={part.key === '__other__' ? OTHER_COLOR : colorFor(colors, part.key)} />
        })}
        {index % every === 0 ? <text x={x + barW / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.65}>{label}</text> : null}
      </g>
    })}
  </svg>
}

/** 缓存命中率随时间的折线（0–100%）。没有输入的桶断开。 */
export function CacheLineChart({ series, bucket }: { series: UsagePoint[]; bucket: UsageBucket }) {
  const i18n = useI18n()
  const points = cacheLinePoints(series)
  const innerW = W - PAD.left - PAD.right
  const innerH = 120 - PAD.top - PAD.bottom
  const slot = innerW / Math.max(1, points.length)
  const x = (index: number) => PAD.left + index * slot + slot / 2
  const y = (value: number) => PAD.top + innerH - value * innerH
  const every = xLabelEvery(points.length)
  let path = ''
  let pen = false
  points.forEach((point, index) => {
    if (point.value === null) { pen = false; return }
    path += `${pen ? 'L' : 'M'}${x(index).toFixed(1)} ${y(point.value).toFixed(1)}`
    pen = true
  })
  return <svg viewBox={`0 0 ${W} 120`} className="h-auto w-full" role="img" aria-label={i18n.t("缓存命中率随时间变化")}>
    {[0, 0.5, 1].map(tick => <g key={tick}>
      <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} stroke="currentColor" strokeOpacity={0.12} />
      <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" fontSize={10} fill="currentColor" fillOpacity={0.65}>{formatPercent(tick, i18n.locale)}</text>
    </g>)}
    {path ? <path d={path} fill="none" stroke="#0f9d76" strokeWidth={2} strokeLinejoin="round" /> : null}
    {points.map((point, index) => {
      const label = formatBucketLabel(point.bucketStart, bucket, i18n.locale)
      return <g key={point.bucketStart}>
        {point.value !== null ? <circle cx={x(index)} cy={y(point.value)} r={points.length > 60 ? 1.5 : 3} fill="#0f9d76"><title>{`${label} · ${formatPercent(point.value, i18n.locale)}`}</title></circle> : null}
        {index % every === 0 ? <text x={x(index)} y={120 - 8} textAnchor="middle" fontSize={10} fill="currentColor" fillOpacity={0.65}>{label}</text> : null}
      </g>
    })}
  </svg>
}

/** 按 provider/model 的横向条：输入 / 输出 / 缓存读取，右侧显示命中率（和缓存写入，如有）。 */
export function ModelBars({ rows, colors, showWrite }: { rows: UsageModelRow[]; colors: Map<string, string>; showWrite: boolean }) {
  const i18n = useI18n()
  const max = Math.max(1, ...rows.flatMap(row => [row.inputTokens, row.outputTokens, row.cacheReadTokens]))
  const kinds = [
    ['inputTokens', "输入", 1],
    ['outputTokens', "输出", 0.6],
    ['cacheReadTokens', "缓存读取", 0.35],
  ] as const
  return <ul className="space-y-4">
    {rows.map(row => {
      const key = modelKey(row.provider, row.model)
      const color = colorFor(colors, key)
      return <li key={key} className="space-y-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
          <span className="flex min-w-0 items-center gap-1.5"><span className="inline-block h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color }} /><span className="break-all font-medium">{key}</span></span>
          <span className="text-xs text-muted-foreground">
            {i18n.t("缓存命中率")} {formatPercent(cacheRatio(row), i18n.locale)}
            {showWrite && row.cacheWriteTokens ? ` · ${i18n.t("缓存写入")} ${formatTokens(row.cacheWriteTokens, i18n.locale)}` : ''}
            {` · ${i18n.t("{0} 次调用", [row.calls])}`}
          </span>
        </div>
        {kinds.map(([field, label, opacity]) => <div key={field} className="flex items-center gap-2 text-xs">
          <span className="w-16 shrink-0 text-muted-foreground">{i18n.t(label)}</span>
          <span className="h-2 flex-1 rounded-sm bg-muted" aria-hidden="true"><span className="block h-2 rounded-sm" style={{ width: `${(row[field] / max) * 100}%`, background: color, opacity }} /></span>
          <span className="w-14 shrink-0 text-right tabular-nums">{formatTokens(row[field], i18n.locale)}</span>
        </div>)}
      </li>
    })}
  </ul>
}

/** 输入 tokens 的来源构成：历史 / 固定 / 用户输入。 */
export function SegmentDonut({ segments }: { segments: UsageStats['segments'] }) {
  const i18n = useI18n()
  const slices = donutSlices(segmentValues(segments))
  const r = 60
  const inner = 38
  const point = (radius: number, angle: number) => `${(70 + radius * Math.sin(angle)).toFixed(2)} ${(70 - radius * Math.cos(angle)).toFixed(2)}`
  const arc = (start: number, end: number) => {
    // 整圆拆成两段，避免起点 = 终点时弧线消失。
    const large = end - start > Math.PI ? 1 : 0
    return `M${point(r, start)} A${r} ${r} 0 ${large} 1 ${point(r, end)} L${point(inner, end)} A${inner} ${inner} 0 ${large} 0 ${point(inner, start)} Z`
  }
  const total = slices.reduce((sum, slice) => sum + slice.value, 0)
  return <div className="flex flex-wrap items-center gap-4">
    <svg viewBox="0 0 140 140" className="h-36 w-36 shrink-0" role="img" aria-label={i18n.t("输入构成")}>
      {slices.map(slice => {
        const full = slice.share >= 0.9999
        return full
          ? <circle key={slice.key} cx={70} cy={70} r={(r + inner) / 2} fill="none" stroke={SEGMENT_COLORS[slice.key]} strokeWidth={r - inner}><title>{`${i18n.t(SEGMENT_LABELS[slice.key]!)} 100%`}</title></circle>
          : <path key={slice.key} d={arc(slice.start, slice.end)} fill={SEGMENT_COLORS[slice.key]}><title>{`${i18n.t(SEGMENT_LABELS[slice.key]!)} · ${formatTokens(slice.value, i18n.locale)} · ${formatPercent(slice.share, i18n.locale)}`}</title></path>
      })}
      <text x={70} y={74} textAnchor="middle" fontSize={12} fill="currentColor">{formatTokens(total, i18n.locale)}</text>
    </svg>
    <ul className="space-y-1 text-sm">
      {segmentValues(segments).map(item => <li key={item.key} className="flex items-center gap-2">
        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SEGMENT_COLORS[item.key] }} />
        <span>{i18n.t(SEGMENT_LABELS[item.key]!)}</span>
        <span className="tabular-nums text-muted-foreground">{formatTokens(item.value, i18n.locale)}{total > 0 ? ` · ${formatPercent(item.value / total, i18n.locale)}` : ''}</span>
      </li>)}
    </ul>
  </div>
}
