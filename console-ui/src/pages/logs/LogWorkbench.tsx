import { useState, type RefObject } from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  ArrowRight,
  Circle,
  Copy,
  FileText,
  Filter,
  Info,
  MoreHorizontal,
  X,
  RefreshCw,
  Search,
  Trash2,
  XCircle,
} from 'lucide-react'
import { selectedHistoryEntry } from './history-model.mjs'
import { cn } from '@zhin.js/client'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from '../../components/ui/dropdown-menu'
import './disclosure.css'
import { EmptyState } from '../../components/empty-state'
import { ErrorAlert } from '../../components/error-alert'

export interface LogEntry {
  id: string | number
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
  loading: boolean
  source: string
  page: number
  pageSize: number
  total: number | null
  totalPages: number | null
  sources: {source:string;count:number}[]
  logs: LogEntry[]
  stats: LogStats | null
  level: 'all' | 'debug' | 'info' | 'warn' | 'error'
  query: string
  autoScroll: boolean
  error: string | null
  logsKnown: boolean
  canManage: boolean
  readOnly: boolean
}

export interface LogWorkbenchActions {
  selectSource(source:string):void
  changePage(page:number):void
  changePageSize(size:number):void
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

export function LogWorkbench({ state, actions, endRef }: LogWorkbenchProps) {
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [selection, setSelection] = useState<LogEntry | null>(null)
  const selected = selection ? selectedHistoryEntry(state.logs,selection) : null
  const logEntries = state.logs.map(log => ({log,id:String(log.id)}))
  const selectedOnPage = selected ? state.logs.some(log => String(log.id) === String(selected.id)) : false
  const sourceCounts = state.sources
  const levelCount = (level: KnownLogLevel) => state.stats?.byLevel[level] ?? 0
  const visibleTotal = state.logs.length


  return (
    <section className="console-log-workbench" aria-label="日志诊断工作台">
      <header className="console-log-overview">
        <button type="button" className={cn('console-log-signal', state.level === 'all' && 'is-selected')} onClick={() => actions.selectLevel('all')} aria-pressed={state.level === 'all'}>

          <strong>{state.stats?.total ?? '—'}</strong>
          <small>总日志</small>
        </button>
        {OVERVIEW_LEVELS.map((level) => {
          const meta = LEVEL_META[level]
          const Icon = meta.icon
          return (
            <button key={level} type="button" className={cn('console-log-signal', meta.className, state.level === level && 'is-selected')} onClick={() => actions.selectLevel(level)} aria-pressed={state.level === level}>
              <Icon aria-hidden="true" />
              <strong>{state.stats ? levelCount(level) : '—'}</strong>
              <small>{meta.label}</small>
            </button>
          )
        })}

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
          <Button variant="outline" size="sm" aria-expanded={sourcesOpen} aria-controls="log-source-directory" onClick={() => setSourcesOpen(open => !open)}><Filter />{state.source ? `来源：${state.source}` : '来源筛选'}</Button>
          {!state.readOnly ? <DropdownMenu>
            <DropdownMenuTrigger asChild><Button variant="ghost" size="sm" disabled={!state.canManage} aria-label="日志维护操作"><MoreHorizontal />维护</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>日志维护</DropdownMenuLabel>
              <DropdownMenuItem disabled={!state.canManage} onSelect={() => actions.cleanup(7)}>清理 7 天前的日志</DropdownMenuItem>
              <DropdownMenuItem disabled={!state.canManage} onSelect={() => actions.cleanup(undefined, 5000)}>仅保留最近 5000 条</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!state.canManage} className="text-destructive" onSelect={actions.clearAll}>清空全部日志</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu> : null}
        </div>
      </div>

      <div className={cn("console-log-layout console-log-layout--disclosure", sourcesOpen && "has-sources", selection && "has-inspector")}>
        {sourcesOpen ? <aside id="log-source-directory" className="console-log-sources" aria-label="来源聚合">
          <header><span className="console-eyebrow">全部历史来源（按级别与搜索筛选）</span><small>{state.logsKnown ? sourceCounts.length : '—'} sources</small></header>
          <button type="button" className={!state.source ? 'is-selected' : undefined} onClick={() => actions.selectSource('')}>
            <span>全部来源</span><strong>{state.logsKnown ? sourceCounts.reduce((sum,row)=>sum+row.count,0) : '—'}</strong>
          </button>
          {state.source && !sourceCounts.some(row=>row.source === state.source) ? <button type="button" className="is-selected" onClick={()=>actions.selectSource('')}><span>当前来源：{state.source} · 清除</span></button> : null}
          {sourceCounts.map(({source, count}) => (
            <button key={source} type="button" disabled={!source} className={state.source === source ? 'is-selected' : undefined} onClick={() => actions.selectSource(source)} title={source}>
              <span>{source || '未标注来源'}</span><strong>{state.logsKnown ? count : '—'}</strong>
            </button>
          ))}
        </aside> : null}

        <section className="console-log-stream" aria-labelledby="log-stream-title">
          <header>
            <div><h2 id="log-stream-title">历史事件</h2></div>
            <Badge variant="outline">本页 {state.logsKnown ? visibleTotal : '—'} 条</Badge>
          </header>
          <div className="console-log-stream-body">
            <div ref={endRef} />
            {state.loading && !state.logsKnown ? <p role="status">正在读取日志历史…</p> : state.error ? (
              <ErrorAlert error={state.error} onRetry={actions.retry} />
            ) : state.logs.length === 0 ? (
              <div className="console-log-empty"><FileText /><strong>当前筛选没有日志</strong><p>日志到达后会自动出现在此处。</p></div>
            ) : (
              logEntries.map(({ log, id }) => {
                const meta = getLevelMeta(log.level)
                const Icon = meta.icon
                return (
                  <button key={id} type="button" className={cn('console-log-event', meta.className, id === String(selected?.id) && 'is-selected')} aria-pressed={id === String(selected?.id)} onClick={() => setSelection(log)}>
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
          </div>
          <nav className="console-log-pagination" aria-label="日志历史分页">
            <Button variant="outline" size="sm" disabled={state.loading || !state.logsKnown || state.page <= 1} onClick={()=>actions.changePage(state.page-1)}>上一页</Button>
            <span className="console-log-page-summary" aria-live="polite">{state.logsKnown ? `第 ${state.page} / ${state.totalPages} 页 · 筛选结果 ${state.total} 条` : '分页总数暂时未知'}</span>
            <select aria-label="每页日志条数" value={state.pageSize} onChange={event=>actions.changePageSize(Number(event.target.value))}>{[50,100,200].map(size=><option key={size} value={size}>每页 {size} 条</option>)}</select>
            <Button variant="outline" size="sm" disabled={state.loading || !state.logsKnown || state.page >= (state.totalPages ?? 1)} onClick={()=>actions.changePage(state.page+1)}>下一页</Button>
          </nav>
        </section>

        {selected ? <LogInspector key={String(selected.id)} log={selected} offPage={!selectedOnPage} onFilterSource={actions.selectSource} onClose={() => setSelection(null)} /> : null}
      </div>
    </section>
  )
}

function LogInspector({ log, offPage, onFilterSource, onClose }: { log: LogEntry | null; offPage:boolean; onFilterSource(source: string): void; onClose(): void }) {
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
        <div className="flex items-center justify-between gap-2"><span className="console-eyebrow">事件详情</span><Button variant="ghost" size="sm" aria-label="关闭事件详情" onClick={onClose}><X /></Button></div>
        <div><span className={cn('console-log-inspector-level', meta.className)}><Icon />{meta.label}</span><time>{formatLogTime(log.timestamp, true)}</time></div>
        <h3>{log.message}</h3>
      </header>
      {offPage ? <p role="status">所选事件不在当前页或当前筛选中；下方保留该事件快照。</p> : null}
      <details>
        <summary>技术字段</summary>
        <dl>
        <div><dt>source</dt><dd>{log.source || 'runtime'}</dd></div>
        <div><dt>timestamp</dt><dd>{log.timestamp}</dd></div>
        <div><dt>level</dt><dd>{log.level}</dd></div>
        </dl>
      </details>
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
        <Button size="sm" variant="ghost" asChild><Link to={`/introspection?tab=commands&filter=${runtimeFilter}`}>在能力目录中搜索来源名称<ArrowRight /></Link></Button>
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
