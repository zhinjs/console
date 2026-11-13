import { useState } from 'react'
import { ChevronLeft, ChevronRight, FileText, Filter, MoreHorizontal, RefreshCw, Search } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Button } from '../../components/ui/button'
import { Checkbox } from '../../components/ui/checkbox'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuCheckboxItem } from '../../components/ui/dropdown-menu'
import { ErrorAlert } from '../../components/error-alert'
import { ListItemButton } from '../../components/ui/list-item-button'
import { selectedHistoryEntry } from './history-model.mjs'
import { formatLogTime, getLevelMeta, LogInspector, type LogEntry, type LogWorkbenchActions, type LogWorkbenchState } from './LogWorkbench'
import type { RefObject } from 'react'

const LEVEL_OPTIONS = ['debug', 'info', 'warn', 'error'] as const
const PAGE_SIZES = [50, 100, 200] as const

/**
 * The bottom log panel's dense layout of the same state and actions as LogWorkbench (the /logs page keeps
 * LogWorkbench): one toolbar row, single-line rows (time · level · source · message, truncated), the
 * count and pager in a one-line footer, page size and maintenance in the overflow menu. Selecting a row
 * opens the shared inspector beside the list.
 */
export function LogPanelWorkbench({ state, actions, endRef }: { state: LogWorkbenchState; actions: LogWorkbenchActions; endRef: RefObject<HTMLDivElement | null> }) {
  const i18n = useI18n()
  const [sourcesOpen, setSourcesOpen] = useState(false)
  const [selection, setSelection] = useState<LogEntry | null>(null)
  const selected = selection ? selectedHistoryEntry(state.logs, selection) : null
  const selectedOnPage = selected ? state.logs.some(log => String(log.id) === String(selected.id)) : false
  const sourceLabel = state.source ? i18n.t('来源：{0}', [state.source]) : i18n.t('来源筛选')
  return (
    <section className="console-log-workbench console-log-panel-workbench" aria-label={i18n.t('日志诊断工作台')}>
      <div className="console-log-panel-toolbar">
        <div className="console-log-panel-search">
          <Search aria-hidden="true" />
          <Input type="search" aria-label={i18n.t('搜索日志消息或来源')} placeholder={i18n.t('搜索消息、来源…')} value={state.query} onChange={event => actions.changeQuery(event.target.value)} />
        </div>
        <SelectField value={state.level} onValueChange={actions.selectLevel} className="console-log-panel-level" aria-label={i18n.t('日志级别')}
          options={[{ value: 'all', label: i18n.t('所有级别') }, ...LEVEL_OPTIONS.map(value => ({ value, label: getLevelMeta(value).label }))]} />
        <label className="console-log-panel-follow" title={i18n.t('跟随最新')}>
          <Checkbox checked={state.autoScroll} onCheckedChange={checked => actions.changeAutoScroll(checked === true)} aria-label={i18n.t('跟随最新')} />
          <span>{i18n.t('跟随最新')}</span>
        </label>
        <Button variant="ghost" size="icon" className="console-log-panel-tool" aria-label={i18n.t('刷新')} title={i18n.t('刷新')} onClick={actions.refresh}><RefreshCw /></Button>
        <Button variant="ghost" size="icon" className={cn('console-log-panel-tool', state.source && 'is-active')} aria-label={sourceLabel} title={sourceLabel}
          aria-expanded={sourcesOpen} aria-controls="log-panel-source-directory" onClick={() => setSourcesOpen(open => !open)}><Filter /></Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="console-log-panel-tool" aria-label={i18n.t('更多日志选项')} title={i18n.t('更多日志选项')}><MoreHorizontal /></Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuLabel>{i18n.t('每页日志条数')}</DropdownMenuLabel>
            {PAGE_SIZES.map(size => (
              <DropdownMenuCheckboxItem key={size} checked={state.pageSize === size} onSelect={() => actions.changePageSize(size)}>
                {i18n.t('每页 ')}{size}{i18n.t(' 条')}
              </DropdownMenuCheckboxItem>
            ))}
            {!state.readOnly ? <>
              <DropdownMenuSeparator />
              <DropdownMenuLabel>{i18n.t('日志维护')}</DropdownMenuLabel>
              <DropdownMenuItem disabled={!state.canManage} onSelect={() => actions.cleanup(7)}>{i18n.t('清理 7 天前的日志')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!state.canManage} onSelect={() => actions.cleanup(undefined, 5000)}>{i18n.t('仅保留最近 5000 条')}</DropdownMenuItem>
              <DropdownMenuItem disabled={!state.canManage} className="text-destructive" onSelect={actions.clearAll}>{i18n.t('清空全部日志')}</DropdownMenuItem>
            </> : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className={cn('console-log-panel-layout', sourcesOpen && 'has-sources', selected && 'has-inspector')}>
        {sourcesOpen ? <aside id="log-panel-source-directory" className="console-log-sources" aria-label={i18n.t('来源聚合')}>
          <ListItemButton type="button" className={!state.source ? 'is-selected' : undefined} onClick={() => actions.selectSource('')}>
            <span>{i18n.t('全部来源')}</span><strong>{state.logsKnown ? state.sources.reduce((sum, row) => sum + row.count, 0) : '—'}</strong>
          </ListItemButton>
          {state.sources.map(({ source, count }) => (
            <ListItemButton key={source} type="button" disabled={!source} className={state.source === source ? 'is-selected' : undefined} onClick={() => actions.selectSource(source)} title={source}>
              <span>{source || i18n.t('未标注来源')}</span><strong>{state.logsKnown ? count : '—'}</strong>
            </ListItemButton>
          ))}
        </aside> : null}

        <div className="console-log-panel-rows" role="list" aria-label={i18n.t('历史事件')}>
          <div ref={endRef} />
          {state.loading && !state.logsKnown ? <p className="console-log-panel-note" role="status">{i18n.t('正在读取日志历史…')}</p> : state.error ? (
            <div className="console-log-panel-note"><ErrorAlert error={state.error} onRetry={actions.retry} /></div>
          ) : state.logs.length === 0 ? (
            <p className="console-log-panel-note"><FileText aria-hidden="true" />{i18n.t('当前筛选没有日志')}</p>
          ) : state.logs.map(log => {
            const meta = getLevelMeta(log.level)
            const Icon = meta.icon
            const id = String(log.id)
            const isSelected = id === String(selected?.id)
            return (
              <div role="listitem" key={id}>
                <button type="button" className={cn('console-log-panel-row', meta.className, isSelected && 'is-selected')} aria-pressed={isSelected}
                  title={log.message} onClick={() => setSelection(isSelected ? null : log)}>
                  <time>{formatLogTime(log.timestamp, false, i18n.locale)}</time>
                  <Icon aria-label={meta.label} />
                  <code>{log.source || 'runtime'}</code>
                  <span>{log.message}</span>
                </button>
              </div>
            )
          })}
        </div>

        {selected ? <LogInspector key={String(selected.id)} log={selected} offPage={!selectedOnPage} onFilterSource={actions.selectSource} onClose={() => setSelection(null)} /> : null}
      </div>

      <nav className="console-log-panel-footer" aria-label={i18n.t('日志历史分页')}>
        <Button variant="ghost" size="icon" className="console-log-panel-tool" aria-label={i18n.t('上一页')} title={i18n.t('上一页')}
          disabled={state.loading || !state.logsKnown || state.page <= 1} onClick={() => actions.changePage(state.page - 1)}><ChevronLeft /></Button>
        <span aria-live="polite">{state.logsKnown ? i18n.t('{0}/{1} · {2} 条', [state.page, state.totalPages, state.total]) : i18n.t('分页总数暂时未知')}</span>
        <Button variant="ghost" size="icon" className="console-log-panel-tool" aria-label={i18n.t('下一页')} title={i18n.t('下一页')}
          disabled={state.loading || !state.logsKnown || state.page >= (state.totalPages ?? 1)} onClick={() => actions.changePage(state.page + 1)}><ChevronRight /></Button>
      </nav>
    </section>
  )
}
