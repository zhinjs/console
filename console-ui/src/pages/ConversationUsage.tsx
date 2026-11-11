import { useState } from 'react'
import { useI18n } from '../i18n'
import { Button } from '../components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover'
import { contextLabels, formatTraceMetric, traceUsage, type ContextBudget, type TraceTurn } from './conversation-trace-model.mjs'

export function UsageSummary({ turns }: { turns: Array<Pick<TraceTurn, 'usage_calls' | 'total_tokens'>> }) {
  const i18n = useI18n()
  const usage = traceUsage(turns)
  const groups = [
    { key: 'input', label: '总输入', parts: [['uncachedInput', '非缓存输入'], ['cacheRead', '缓存读取'], ['cacheWrite', '缓存写入']] },
    { key: 'output', label: '输出', parts: [['reasoning', '推理']] },
  ] as const
  const inputVal = typeof usage.input === 'number' ? usage.input : 0
  const outputVal = typeof usage.output === 'number' ? usage.output : 0
  const totalKnown = inputVal + outputVal
  const cacheShare = inputVal > 0 && typeof usage.cacheRead === 'number'
    ? Math.min(100, (usage.cacheRead / inputVal) * 100)
    : null
  return <div className="conversation-usage-metrics">
    {totalKnown > 0 ? (
      <div className="mb-2 flex h-1.5 w-full overflow-hidden rounded-full bg-muted/80" aria-hidden="true">
        {cacheShare !== null ? (
          <span style={{ width: `${(inputVal / totalKnown) * (cacheShare / 100) * 100}%`, background: 'hsl(var(--chart-3))' }} />
        ) : null}
        <span
          style={{
            width: `${(inputVal / totalKnown) * (cacheShare !== null ? (100 - cacheShare) / 100 : 1) * 100}%`,
            background: 'hsl(var(--chart-1))',
          }}
        />
        <span style={{ width: `${(outputVal / totalKnown) * 100}%`, background: 'hsl(var(--chart-5))' }} />
      </div>
    ) : null}
    {groups.map(group => <dl key={group.key}>
      <div><dt>{i18n.t(group.label)}</dt><dd>{formatTraceMetric(usage[group.key], i18n.locale)}</dd></div>
      {group.parts.map(([key, label]) => <div className="conversation-usage-subset" key={key}><dt>{i18n.t(label)}</dt><dd>{formatTraceMetric(usage[key], i18n.locale)}</dd></div>)}
    </dl>)}
  </div>
}

export function ContextUsage({ budget }: { budget: ContextBudget }) {
  const i18n = useI18n()
  const entries = Object.entries(budget.segments).filter(([key, value]) => contextLabels[key] && value > 0).sort((a, b) => b[1] - a[1])
  return <section className="conversation-context-usage">
    <h4>{i18n.t('首个请求的上下文（估算）')} <span>{new Intl.NumberFormat(i18n.locale).format(budget.total_tokens)} tok</span></h4>
    <dl>{entries.map(([key, value]) => <div key={key}>
      <dt>{i18n.t(contextLabels[key])}</dt>
      <dd><span className="conversation-context-bar" aria-hidden="true"><i style={{ width: `${budget.total_tokens ? Math.min(100, value / budget.total_tokens * 100) : 0}%` }} /></span>{new Intl.NumberFormat(i18n.locale).format(value)}</dd>
    </div>)}</dl>
  </section>
}

export function ConversationUsage({ turns, onOpenTrace }: { turns: TraceTurn[]; onOpenTrace?: (turnId: string) => void }) {
  const i18n = useI18n()
  const [open, setOpen] = useState(false)
  if (!turns.length) return null
  const total = traceUsage(turns).totalTokens
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button className="conversation-usage-trigger h-auto" variant="ghost" size="sm">{i18n.t('此轮用量')} · {formatTraceMetric(total, i18n.locale)} tok</Button></PopoverTrigger>
    <PopoverContent className="conversation-usage-popover" aria-label={i18n.t('此轮用量')}>
      <h3>{i18n.t('模型用量')} <span>tokens</span></h3>
      <UsageSummary turns={turns} />
      {turns.map(turn => <section key={turn.turn_id}>
        {turn.context_budget ? <ContextUsage budget={turn.context_budget} /> : null}
        {onOpenTrace ? <Button className="conversation-usage-trace-link" variant="ghost" size="sm" onClick={() => { setOpen(false); onOpenTrace(turn.turn_id) }}>{i18n.t('查看轨迹')}</Button> : null}
      </section>)}
    </PopoverContent>
  </Popover>
}
