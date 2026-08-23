import { useEffect, useMemo, useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Circle,
  Copy,
  FileText,
  Filter,
  Info,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react'
import { cn } from '@zhin.js/client'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { EmptyState } from '../../components/empty-state'
import { ErrorAlert } from '../../components/error-alert'

export interface LogEntry {
  level: string
  message: string
  timestamp: string
  source: string
}

export interface LogStats {
  total: number
  byLevel: Record<string, number>
  oldestTimestamp: string | null
}

export interface LogWorkbenchState {
  logs: LogEntry[]
  stats: LogStats | null
  level: 'all' | 'debug' | 'info' | 'warn' | 'error'
  query: string
  autoScroll: boolean
  error: string | null
  readOnly: boolean
}

export interface LogWorkbenchActions {
  selectLevel(level: string): void
  changeQuery(query: string): void
  changeAutoScroll(enabled: boolean): void
  refresh(): void
  retry(): void
  clearAll(): void
  cleanup(days?: number, maxRecords?: number): void
}

interface LogWorkbenchProps {
  state: LogWorkbenchState
  actions: LogWorkbenchActions
  endRef: RefObject<HTMLDivElement | null>
}

const LEVEL_META = {
  debug: { label: 'Debug', icon: Circle, className: 'is-debug' },
  info: { label: 'Info', icon: Info, className: 'is-info' },
  warn: { label: 'Warn', icon: AlertTriangle, className: 'is-warn' },
  error: { label: 'Error', icon: XCircle, className: 'is-error' },
} as const

type KnownLogLevel = keyof typeof LEVEL_META
const OVERVIEW_LEVELS = ['info', 'warn', 'error'] as const

function getLevelMeta(level: string) {
  return LEVEL_META[level as KnownLogLevel] ?? {
    label: level ? level.toUpperCase() : 'UNKNOWN',
    icon: Circle,
    className: 'is-debug',
  }
}

function logIdentity(log: LogEntry): string {
  return `${log.timestamp}\u0000${log.level}\u0000${log.source}\u0000${log.message}`
}

export function LogWorkbench({ state, actions, endRef }: LogWorkbenchProps) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const logEntries = useMemo(() => {
    const occurrences = new Map<string, number>()
    return state.logs.map((log) => {
      const identity = logIdentity(log)
      const occurrence = occurrences.get(identity) ?? 0
      occurrences.set(identity, occurrence + 1)
      return { log, id: `${identity}\u0000${occurrence}` }
    })
  }, [state.logs])
  const selectedEntry = logEntries.find(({ id }) => id === selectedId) ?? logEntries.at(-1) ?? null
  const selected = selectedEntry?.log ?? null
  const sourceCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const log of state.logs) {
      const source = log.source || 'runtime'
      counts.set(source, (counts.get(source) ?? 0) + 1)
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1])
  }, [state.logs])

  useEffect(() => {
    if (!logEntries.length) setSelectedId(null)
    else if (!logEntries.some(({ id }) => id === selectedId)) {
      setSelectedId(logEntries.at(-1)!.id)
    }
  }, [logEntries, selectedId])

  const levelCount = (level: KnownLogLevel) => state.stats?.byLevel[level] ?? 0
  const visibleTotal = state.logs.length
  const issueCount = levelCount('warn') + levelCount('error')
  const healthLabel = issueCount === 0 ? '当前窗口稳定' : `${issueCount} 条需关注`

  return (
    <section className="console-log-workbench" aria-label="日志诊断工作台">
      <header className="console-log-overview">
        <button type="button" className={cn('console-log-signal', state.level === 'all' && 'is-selected')} onClick={() => actions.selectLevel('all')} aria-pressed={state.level === 'all'}>
          <span className="console-eyebrow">Event journal</span>
          <strong>{state.stats?.total ?? visibleTotal}</strong>
          <small>总日志</small>
        </button>
        {OVERVIEW_LEVELS.map((level) => {
          const meta = LEVEL_META[level]
          const Icon = meta.icon
          return (
            <button key={level} type="button" className={cn('console-log-signal', meta.className, state.level === level && 'is-selected')} onClick={() => actions.selectLevel(level)} aria-pressed={state.level === level}>
              <Icon aria-hidden="true" />
              <strong>{levelCount(level)}</strong>
              <small>{meta.label}</small>
            </button>
          )
        })}
        <div className={cn('console-log-health', issueCount === 0 && 'is-healthy')}>
          <CheckCircle2 aria-hidden="true" />
          <span><small>Window signal</small><strong>{healthLabel}</strong></span>
        </div>
      </header>

      <div className="console-log-toolbar">
        <div className="relative min-w-0 flex-1 sm:max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input type="search" aria-label="搜索日志消息或来源" placeholder="搜索消息、来源…" value={state.query} onChange={(event) => actions.changeQuery(event.target.value)} className="pl-9" />
        </div>
        <Select value={state.level} onValueChange={actions.selectLevel}>
          <SelectTrigger className="w-32" aria-label="日志级别"><SelectValue placeholder="所有级别" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">所有级别</SelectItem>
            <SelectItem value="debug">Debug</SelectItem>
            <SelectItem value="info">Info</SelectItem>
            <SelectItem value="warn">Warn</SelectItem>
            <SelectItem value="error">Error</SelectItem>
          </SelectContent>
        </Select>
        <label className="console-log-autoscroll">
          <Checkbox checked={state.autoScroll} onCheckedChange={(checked) => actions.changeAutoScroll(checked === true)} />
          <span>跟随最新</span>
        </label>
        <div className="console-log-toolbar-actions">
          <Button variant="ghost" size="sm" onClick={actions.refresh}><RefreshCw />刷新</Button>
          {!state.readOnly ? <Button variant="ghost" size="sm" onClick={() => actions.cleanup(7)}><Trash2 />清理旧日志</Button> : null}
          {!state.readOnly ? <Button variant="ghost" size="sm" onClick={() => actions.cleanup(undefined, 5000)}>保留 5000 条</Button> : null}
          {!state.readOnly ? <Button variant="ghost" size="sm" className="text-destructive" onClick={actions.clearAll}><Trash2 />清空</Button> : null}
        </div>
      </div>

      <div className="console-log-layout">
        <aside className="console-log-sources" aria-label="来源聚合">
          <header><span className="console-eyebrow">来源聚合</span><small>{sourceCounts.length} sources</small></header>
          <button type="button" className={!state.query ? 'is-selected' : undefined} onClick={() => actions.changeQuery('')}>
            <span>全部来源</span><strong>{visibleTotal}</strong>
          </button>
          {sourceCounts.map(([source, count]) => (
            <button key={source} type="button" className={state.query === source ? 'is-selected' : undefined} onClick={() => actions.changeQuery(source)} title={source}>
              <span>{source}</span><strong>{count}</strong>
            </button>
          ))}
        </aside>

        <section className="console-log-stream" aria-labelledby="log-stream-title">
          <header>
            <div><span className="console-eyebrow">Live projection</span><h2 id="log-stream-title">连续事件流</h2></div>
            <Badge variant="outline">{visibleTotal} visible</Badge>
          </header>
          <div className="console-log-stream-body">
            {state.error ? (
              <ErrorAlert error={state.error} onRetry={actions.retry} />
            ) : state.logs.length === 0 ? (
              <div className="console-log-empty"><FileText /><strong>当前筛选没有日志</strong><p>日志到达后会自动出现在此处。</p></div>
            ) : (
              logEntries.map(({ log, id }) => {
                const meta = getLevelMeta(log.level)
                const Icon = meta.icon
                return (
                  <button key={id} type="button" className={cn('console-log-event', meta.className, id === selectedEntry?.id && 'is-selected')} aria-pressed={id === selectedEntry?.id} onClick={() => setSelectedId(id)}>
                    <span className="console-log-event-icon"><Icon /></span>
                    <span className="console-log-event-body">
                      <span><time>{formatLogTime(log.timestamp)}</time><code>{log.source || 'runtime'}</code></span>
                      <strong>{log.message}</strong>
                    </span>
                    <ArrowRight className="console-log-event-arrow" />
                  </button>
                )
              })
            )}
            <div ref={endRef} />
          </div>
        </section>

        <LogInspector key={selectedEntry?.id ?? 'empty'} log={selected} onFilterSource={actions.changeQuery} />
      </div>
    </section>
  )
}

function LogInspector({ log, onFilterSource }: { log: LogEntry | null; onFilterSource(source: string): void }) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle')
  if (!log) {
    return <aside className="console-log-inspector is-empty" aria-label="事件 Inspector"><EmptyState compact title="选择一条事件" description="完整时间、来源与诊断动作会显示在这里。" /></aside>
  }
  const meta = getLevelMeta(log.level)
  const Icon = meta.icon
  const line = `[${log.timestamp}] [${log.level}] ${log.source ? `${log.source} ` : ''}${log.message}`
  const runtimeFilter = encodeURIComponent(log.source || log.message.slice(0, 80))
  return (
    <aside className="console-log-inspector" aria-label="事件 Inspector">
      <header>
        <span className="console-eyebrow">事件 Inspector</span>
        <div><span className={cn('console-log-inspector-level', meta.className)}><Icon />{meta.label}</span><time>{formatLogTime(log.timestamp, true)}</time></div>
        <h3>{log.message}</h3>
      </header>
      <dl>
        <div><dt>source</dt><dd>{log.source || 'runtime'}</dd></div>
        <div><dt>timestamp</dt><dd>{log.timestamp}</dd></div>
        <div><dt>level</dt><dd>{log.level}</dd></div>
      </dl>
      <div className="console-log-inspector-actions">
        <Button
          size="sm"
          variant="outline"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(line)
              setCopyState('copied')
            } catch {
              setCopyState('failed')
            }
          }}
        ><Copy />{copyState === 'copied' ? '已复制' : '复制事件'}</Button>
        {log.source ? <Button size="sm" variant="outline" onClick={() => onFilterSource(log.source)}><Filter />仅看此来源</Button> : null}
        <Button size="sm" variant="ghost" asChild><Link to={`/introspection?tab=commands&filter=${runtimeFilter}`}>查找运行时能力<ArrowRight /></Link></Button>
      </div>
      {copyState === 'failed' ? <p className="console-log-copy-error" role="status">浏览器拒绝了剪贴板访问，请展开原始事件后手动复制。</p> : null}
      <details>
        <summary>原始事件</summary>
        <pre>{line}</pre>
      </details>
    </aside>
  )
}

function formatLogTime(timestamp: string, complete = false): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return complete ? date.toLocaleString() : date.toLocaleTimeString([], { hour12: false })
}
