import { useI18n } from '../../i18n'
import { ErrorAlert } from '../../components/error-alert'
import { readErrorSummary } from '../../utils/read-error.mjs'
import { relatedUpdateReadback } from './related-update-result.mjs'
import { relatedPrimaryKeys, relatedRowIdentity } from './related-row-identity.mjs'
import { databaseSaveError } from './save-error.mjs'
import { relatedRowIssues } from './related-row-validation.mjs'
import { parseRelatedRow } from './related-row-draft.mjs'
import { useMutation } from './use-mutation'
import { filterableColumns, filterColumnKind, sortCurrentPageRows } from './record-query.mjs'
import {
  cellText, columnFilterOperators, columnFiltersWhere, isSensitiveColumn, MASK, nextSort, operatorLabel, operatorNeedsValue,
  type ColumnFilter, type ColumnFilterOperator, type SortState,
} from './database-console-model.mjs'
import type { DbOrderBy } from './database-types'
import { useState, useEffect, useCallback, useMemo, useRef, type ChangeEvent, type FormEvent } from 'react'
import type { TableInfo, SelectResult } from '@zhin.js/client'
import { Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Save, ArrowUp, ArrowDown, ArrowUpDown, Search, X, Filter, Eye, EyeOff } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { SelectField } from '../../components/ui/select'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { Alert, AlertDescription } from '../../components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '../../components/ui/dialog'
import { JsonField } from './json-field'
import { useToast } from '../../components/toast'
import { ConfirmDialog } from '../../components/confirm-dialog'

type Row = Record<string, unknown>

export function RelatedTableView({
  tableName,
  tableInfo,
  select,
  insert,
  update,
  remove,
  readOnly,
  serverSort = false,
}: {
  tableName: string
  tableInfo?: TableInfo
  select: (table: string, page?: number, pageSize?: number, where?: any, orderBy?: DbOrderBy | null) => Promise<SelectResult>
  insert: (table: string, row: any) => Promise<any>
  update: (table: string, row: any, where: any) => Promise<any>
  remove: (table: string, where: any) => Promise<any>
  readOnly: boolean
  /** The Host orders `db:select` across the whole table (`capabilities.sort`); otherwise only the loaded page is reordered. */
  serverSort?: boolean
}) {
  const i18n = useI18n()
  const { busy, gate, run } = useMutation()
  const [data, setData] = useState<SelectResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [readError, setReadError] = useState<string | null>(null)
  const [savedAwaitingRefresh, setSavedAwaitingRefresh] = useState(false)
  const [page, setPage] = useState(1)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string; details?: string } | null>(null)
  const [editRow, setEditRow] = useState<any>(null)
  const [addRow, setAddRow] = useState(false)
  const [formData, setFormData] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] = useState<{ row: Row; count: number | null } | null>(null)
  const [pendingUpdate, setPendingUpdate] = useState<{ row: Row; where: Row; count: number | null } | null>(null)
  // Server-side order (serverSort) or the loaded-page order of an older Host.
  const [sort, setSort] = useState<SortState | null>(null)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [filterDraft, setFilterDraft] = useState<{ column: string; operator: ColumnFilterOperator | ''; value: string }>({ column: '', operator: '', value: '' })
  const [filterError, setFilterError] = useState<string | null>(null)
  // Conditions Host applies to the whole table (rows and total), one per column.
  const [filters, setFilters] = useState<ColumnFilter[]>([])
  const [applied, setApplied] = useState<{ filters: ColumnFilter[]; where: Record<string, unknown> } | null>(null)
  const [loadedFilter, setLoadedFilter] = useState<typeof applied>(null)
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  // Rows edited in place since the last load: they stay where they were until the next refresh.
  const [editedInPlace, setEditedInPlace] = useState(false)
  const requestSeq = useRef(0)
  const valueInput = useRef<HTMLInputElement | null>(null)
  const { success, error: toastError } = useToast()
  const pageSize = 50
  const orderBy = serverSort ? sort : null

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setReadError(null)
    setMsg(null)
    try {
      const result = orderBy
        ? await select(tableName, page, pageSize, applied?.where, orderBy)
        : await select(tableName, page, pageSize, applied?.where)
      if (seq !== requestSeq.current) return true
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize))
      if (page > lastPage) {
        setPage(lastPage)
        return true
      }
      setData(result)
      setLoadedFilter(applied)
      setSavedAwaitingRefresh(false)
      setRevealed(new Set())
      setEditedInPlace(false)
      return true
    } catch (err) {
      if (seq !== requestSeq.current) return true
      setReadError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [tableName, page, select, applied, orderBy])

  useEffect(() => { load() }, [load])

  const columns = useMemo(() => {
    if (tableInfo?.columns) return Object.keys(tableInfo.columns)
    if (data?.rows?.length) return Object.keys(data.rows[0] as Record<string, unknown>)
    return []
  }, [tableInfo, data])
  const definitions = tableInfo?.columns as Record<string, { type?: string; secret?: unknown }> | undefined

  const sampleRow = data?.rows?.[0] as Record<string, unknown> | undefined
  // Every column can be filtered: typed columns by value, json / date columns by NULL only.
  const searchable = useMemo(() => {
    const typed = new Map(filterableColumns(columns, definitions, sampleRow).map(column => [column.name, column.kind]))
    return columns.map(name => ({ name, kind: typed.get(name) ?? null }))
  }, [columns, definitions, sampleRow])
  const draftColumn = searchable.find(column => column.name === filterDraft.column) ?? searchable.find(column => column.kind) ?? searchable[0]
  const draftOperators = columnFilterOperators(draftColumn ? filterColumnKind(definitions?.[draftColumn.name], sampleRow?.[draftColumn.name]) : null)
  const draftOperator = draftOperators.includes(filterDraft.operator as ColumnFilterOperator) ? filterDraft.operator as ColumnFilterOperator : draftOperators[0]

  const applyFilters = (next: ColumnFilter[]) => {
    const result = columnFiltersWhere(next, definitions, sampleRow, i18n.locale)
    if (result.error !== undefined) { setFilterError(result.error); return false }
    setFilterError(null)
    setFilters(next)
    setApplied(next.length ? { filters: next, where: result.where } : null)
    setPage(1)
    return true
  }

  const submitFilter = (event?: FormEvent) => {
    event?.preventDefault()
    if (!draftColumn || !draftOperator) return
    const filter: ColumnFilter = { column: draftColumn.name, operator: draftOperator, value: operatorNeedsValue(draftOperator) ? filterDraft.value : '' }
    applyFilters([...filters.filter(item => item.column !== filter.column), filter])
  }

  const removeFilter = (column: string) => applyFilters(filters.filter(item => item.column !== column))

  const clearFilter = () => {
    setFilterDraft(prev => ({ ...prev, value: '' }))
    setFilterError(null)
    setFilters([])
    setApplied(null)
    setPage(1)
  }

  /** Header filter button: picks the column in the filter bar and focuses its value. */
  const focusFilter = (column: string) => {
    const existing = filters.find(item => item.column === column)
    setFilterDraft({ column, operator: existing?.operator ?? '', value: existing?.value ?? '' })
    setFilterError(null)
    valueInput.current?.focus()
  }

  const primaryKeys = useMemo(() => relatedPrimaryKeys(tableInfo?.columns), [tableInfo])
  const canIdentify = primaryKeys.length > 0

  const fieldIssues = useMemo(() => relatedRowIssues(columns, formData, tableInfo?.columns, i18n.locale), [columns, formData, tableInfo, i18n])
  const invalidDraft = Object.keys(fieldIssues).length > 0

  /** Rows a `where` matches, for 「将影响 N 行」; null when the count could not be read. */
  const countMatching = async (where: Row): Promise<number | null> => {
    try { return (await select(tableName, 1, 1, where)).total } catch { return null }
  }

  const closeEditor = () => { setEditRow(null); setAddRow(false); setFormData({}) }

  const handleSave = async (isNew: boolean) => {
    if (readOnly || gate.pending || invalidDraft || readError) return
    await run(async () => {
    setMsg(null)
    try {
      const row = parseRelatedRow(columns, formData, tableInfo?.columns, isNew ? undefined : editRow)
      if (isNew) {
        await insert(tableName, row)
        setSavedAwaitingRefresh(true)
        closeEditor()
        const refreshed = await load()
        setMsg(refreshed ? { type: 'success', text: i18n.t("添加成功") } : null)
        return
      }
      // An update is confirmed with the number of rows its primary key matches.
      const where = relatedRowIdentity(primaryKeys, editRow, i18n.locale)
      setPendingUpdate({ row, where, count: await countMatching(where) })
    } catch (err) {
      setMsg(databaseSaveError(err, i18n.locale))
    }
    })
  }

  const confirmUpdate = async () => {
    if (!pendingUpdate) return
    const { row, where } = pendingUpdate
    const index = (data?.rows ?? []).indexOf(editRow)
    try {
      const result = await update(tableName, row, where)
      let current: Row[] | null = null
      const merged = { ...editRow, ...row }
      const after = (() => { try { return relatedRowIdentity(primaryKeys, merged, i18n.locale) } catch { return where } })()
      if (result?.affected === 0) {
        current = (await select(tableName, 1, 2, after)).rows as Row[]
        const outcome = relatedUpdateReadback(current, row, tableInfo?.columns)
        if (outcome !== 'saved') {
          setPendingUpdate(null)
          setMsg({ type: 'error', text: outcome === 'missing' ? i18n.t("记录已不存在或主键已改变。当前输入已保留，请取消后刷新列表。") : i18n.t("未确认更新结果。当前输入已保留，请取消后刷新列表核对。") })
          return
        }
      }
      // Keep the edited row where it was (the order may no longer match the sort): re-read only that row.
      try { current ??= (await select(tableName, 1, 1, after)).rows as Row[] } catch { current = null }
      const fresh = current?.[0] ?? merged
      setData(previous => previous && index >= 0
        ? { ...previous, rows: previous.rows.map((item, i) => i === index ? fresh : item) }
        : previous)
      setEditedInPlace(true)
      setPendingUpdate(null)
      closeEditor()
      setMsg({ type: 'success', text: i18n.t("更新成功") })
    } catch (err) {
      setPendingUpdate(null)
      setMsg(databaseSaveError(err, i18n.locale))
    }
  }

  const handleDelete = async (row: Row) => {
    if (gate.pending || readOnly || readError) return
    let count: number | null = null
    try { count = await countMatching(relatedRowIdentity(primaryKeys, row, i18n.locale)) } catch { count = null }
    setDeleteTarget({ row, count })
  }

  const confirmDelete = async () => {
    if (!deleteTarget || gate.pending || readOnly || readError) return
    await run(async () => {
    try {
      await remove(tableName, relatedRowIdentity(primaryKeys, deleteTarget.row, i18n.locale))
      success(i18n.t("删除成功"))
      await load()
    } catch (err) {
      toastError((err as Error).message)
    } finally {
      setDeleteTarget(null)
    }
    })
  }

  const openEdit = (row: any) => {
    setMsg(null)
    setEditRow(row)
    setAddRow(false)
    const fd: Record<string, string> = {}
    for (const col of columns) {
      fd[col] = typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')
    }
    setFormData(fd)
  }

  const openAdd = () => {
    setMsg(null)
    setEditRow(null)
    setAddRow(true)
    const fd: Record<string, string> = {}
    for (const col of columns) fd[col] = ''
    setFormData(fd)
  }

  const hasCurrentPage = !!data && data.page === page && loadedFilter === applied
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  const handleSortClick = (col: string) => {
    if (serverSort) {
      setSort(previous => nextSort(previous, col))
      setPage(1)
      return
    }
    if (sortCol === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  // An older Host has no ordering parameter for `db:select`: then only the loaded page is reordered.
  const sortedRows = useMemo(() => serverSort ? (data?.rows as Row[] | undefined) ?? [] : sortCurrentPageRows(data?.rows as Row[] | undefined, sortCol, sortDir), [serverSort, data?.rows, sortCol, sortDir])
  const activeSort = serverSort ? sort : sortCol ? { column: sortCol, direction: sortDir } : null
  const filteredColumns = new Set(filters.map(item => item.column))
  const toggleReveal = (key: string) => setRevealed(previous => { const next = new Set(previous); if (next.has(key)) next.delete(key); else next.add(key); return next })
  const affectsText = (count: number | null) => count === null ? i18n.t('无法读取影响行数。') : i18n.t('将影响 {0} 行。', [count])

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {msg && !(msg.type === 'error' && (editRow !== null || addRow)) && (
        <Alert variant={msg.type === 'error' ? 'destructive' : 'success'} className="py-2 shrink-0">
          {msg.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{msg.text}{msg.details ? <details className="mt-2 text-xs"><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><p className="mt-2 whitespace-pre-wrap break-words">{msg.details}</p></details> : null}</AlertDescription>
        </Alert>
      )}

      {readError ? <div className="space-y-2 shrink-0">
        <ErrorAlert error={savedAwaitingRefresh ? i18n.t("记录已保存，但列表刷新失败。请重试读取列表。") : readErrorSummary(readError, i18n.t("表数据"), i18n.locale)} onRetry={() => { void load() }} />
        {hasCurrentPage ? <p className="text-xs text-muted-foreground">{i18n.t("当前显示上次加载的数据。")}</p> : null}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><p className="mt-2 whitespace-pre-wrap break-words">{readError}</p></details>
      </div> : null}

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={load} disabled={loading || busy}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />{i18n.t("刷新")}</Button>
        {!readOnly && <Button size="sm" disabled={loading || busy || !!readError} onClick={openAdd}><Plus className="w-3.5 h-3.5 mr-1" />{i18n.t("添加")}</Button>}
        <span className="text-xs text-muted-foreground sm:ml-auto basis-full sm:basis-auto">
          {loading && !hasCurrentPage ? i18n.t("正在加载第 {0} 页…", [page]) : data ? i18n.t("共 {0} 条 · 第 {1}/{2} 页{3}", [data.total, page, totalPages || 1, `${loadedFilter ? i18n.t(" · 已筛选") : ''}${!serverSort && sortCol ? i18n.t(" · 本页排序") : ''}${serverSort && sort ? i18n.t(' · 按 {0} {1}', [sort.column, sort.direction === 'asc' ? i18n.t('升序') : i18n.t('降序')]) : ''}`]) : loading ? i18n.t("加载中…") : i18n.t("未加载")}
        </span>
      </div>

      {searchable.length ? <form role="search" aria-label={i18n.t("按列查找记录")} onSubmit={submitFilter} className="flex flex-wrap items-start gap-2 shrink-0">
        <SelectField className="w-40" aria-label={i18n.t("查找的列")} disabled={loading || busy}
          value={draftColumn?.name ?? ''}
          options={searchable.map(column => ({ value: column.name, label: column.name }))}
          onValueChange={(column: string) => { setFilterDraft(prev => ({ ...prev, column })); setFilterError(null) }} />
        <SelectField className="w-28" aria-label={i18n.t("查找方式")} disabled={loading || busy || draftOperators.length < 2}
          value={draftOperator ?? ''}
          options={draftOperators.map(operator => ({ value: operator, label: operatorLabel(operator, i18n.locale) }))}
          onValueChange={(operator: string) => { setFilterDraft(prev => ({ ...prev, operator: operator as ColumnFilterOperator })); setFilterError(null) }} />
        <div className="min-w-[10rem] flex-1 space-y-1">
          <Input ref={valueInput} aria-label={i18n.t("查找的值")} disabled={loading || busy || !operatorNeedsValue(draftOperator)} value={operatorNeedsValue(draftOperator) ? filterDraft.value : ''}
            aria-invalid={filterError ? true : undefined}
            placeholder={!operatorNeedsValue(draftOperator) ? i18n.t("不需要输入值") : draftColumn?.kind === 'boolean' ? 'true / false' : draftColumn?.kind === 'text' ? i18n.t("输入文本") : i18n.t("输入数字")}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { const value = event.target.value; setFilterDraft(prev => ({ ...prev, value })); setFilterError(null) }} />
          {filterError ? <p role="alert" className="text-xs text-destructive">{filterError}</p> : null}
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={loading || busy}><Search className="w-3.5 h-3.5 mr-1" />{i18n.t("查找")}</Button>
      </form> : null}
      {applied ? <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground shrink-0" data-filter-summary>
        {applied.filters.map(filter => (
          <span key={filter.column} className="inline-flex items-center gap-1 rounded-full border bg-muted/40 px-2 py-0.5" data-filter-chip={filter.column}>
            {operatorNeedsValue(filter.operator)
              ? i18n.t("全表查找：{0} {1} “{2}”", [filter.column, operatorLabel(filter.operator, i18n.locale), filter.value])
              : i18n.t("全表查找：{0} {1}", [filter.column, operatorLabel(filter.operator, i18n.locale)])}
            {filter.operator === 'contains' ? i18n.t("（% 与 _ 按通配符处理）") : ''}
            <button type="button" className="rounded-full hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" disabled={busy}
              aria-label={i18n.t("移除 {0} 的条件", [filter.column])} onClick={() => removeFilter(filter.column)}><X className="w-3 h-3" /></button>
          </span>
        ))}
        <Button type="button" size="sm" variant="ghost" className="h-auto px-1 py-0 text-xs" data-action="clear-filter" disabled={busy} onClick={clearFilter}><X className="w-3 h-3 mr-1" />{i18n.t("清除条件")}</Button>
      </div> : null}
      {!serverSort && sortCol && totalPages > 1 ? <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground shrink-0" data-sort-scope>
        {i18n.t("排序只作用于当前页已加载的 {0} 条记录，Host 暂不支持全表排序。", [data?.rows?.length ?? 0])}
        <Button type="button" size="sm" variant="ghost" className="h-auto px-1 py-0 text-xs" onClick={() => setSortCol(null)}>{i18n.t("取消排序")}</Button>
      </p> : null}
      {editedInPlace ? <p className="text-xs text-muted-foreground shrink-0" data-edited-in-place>{i18n.t("已在原位置显示修改后的记录；刷新后按当前排序重新排列。")}</p> : null}

      {!readOnly && !canIdentify ? <p className="text-xs text-muted-foreground">{i18n.t("此表未声明主键，暂不支持编辑或删除记录。")}</p> : null}

      <div
        className="flex-1 min-h-[16rem] min-w-0 border rounded-md overflow-auto overscroll-contain scroll-smooth touch-pan-x touch-pan-y bg-card"
        role="region"
        aria-label={i18n.t("数据表，宽表可在此区域内左右滑动")}
      >
        <Table containerClassName="overflow-visible" className="min-w-full w-max">
          <TableHeader sticky>
            <TableRow className="hover:bg-transparent">
              {columns.map((col: string) => {
                const direction = activeSort?.column === col ? activeSort.direction : null
                return (
                  <TableHead
                    key={col}
                    aria-sort={direction === 'asc' ? 'ascending' : direction === 'desc' ? 'descending' : 'none'}
                  >
                    <span className="inline-flex items-center gap-0.5">
                      <button type="button" disabled={loading || busy}
                        aria-label={serverSort
                          ? i18n.t("按 {0} 排序：{1}", [col, direction === 'asc' ? i18n.t("降序") : direction === 'desc' ? i18n.t("取消排序") : i18n.t("升序")])
                          : i18n.t("按 {0} {1}排列（当前页）", [col, sortCol === col && sortDir === 'asc' ? i18n.t("降序") : i18n.t("升序")])}
                        title={serverSort ? i18n.t("点击切换：升序 → 降序 → 不排序") : i18n.t("排序当前页")}
                        data-sort-column={col}
                        onClick={() => handleSortClick(col)}
                        className="inline-flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:opacity-50">
                        {col}
                        {direction === 'asc' ? <ArrowUp className="w-3 h-3" /> : direction === 'desc' ? <ArrowDown className="w-3 h-3" /> : serverSort ? <ArrowUpDown className="w-3 h-3 opacity-30" /> : null}
                      </button>
                      <button type="button" disabled={loading || busy}
                        aria-label={i18n.t("筛选 {0}", [col])} aria-pressed={filteredColumns.has(col)}
                        data-filter-column={col}
                        onClick={() => focusFilter(col)}
                        className={`inline-flex h-5 w-5 items-center justify-center rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:opacity-50 ${filteredColumns.has(col) ? 'text-primary' : 'opacity-40 hover:opacity-100'}`}>
                        <Filter className="w-3 h-3" />
                      </button>
                    </span>
                  </TableHead>
                )
              })}
              {!readOnly && <TableHead numeric className="w-24 min-w-[5.5rem]">
                {i18n.t("操作")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !hasCurrentPage ? (
              <TableRow><TableCell colSpan={columns.length + (readOnly ? 0 : 1)} className="py-8 text-center"><span role="status" aria-label={i18n.t("正在加载表数据")}><Loader2 className="w-4 h-4 animate-spin inline-block" /></span></TableCell></TableRow>
            ) : readError && !hasCurrentPage ? (
              <TableRow><TableCell colSpan={columns.length + (readOnly ? 0 : 1)} className="py-8 text-center text-muted-foreground">{i18n.t("数据未加载")}</TableCell></TableRow>
            ) : !data?.rows?.length ? (
              <TableRow><TableCell colSpan={columns.length + (readOnly ? 0 : 1)} className="py-8 text-center text-muted-foreground">{loadedFilter ? i18n.t("没有符合条件的记录") : i18n.t("暂无数据")}</TableCell></TableRow>
            ) : sortedRows.map((row: any, i: number) => (
              <TableRow key={i}>
                {columns.map((col: string) => {
                  const value = row[col]
                  const sensitive = isSensitiveColumn(col, definitions?.[col]) && value !== null && value !== undefined && value !== ''
                  const key = `${i}:${col}`
                  const shown = !sensitive || revealed.has(key)
                  return (
                    <TableCell
                      key={col}
                      className="whitespace-nowrap py-1.5 align-top font-mono text-xs"
                      title={shown ? cellText(value) : undefined}
                    >
                      {sensitive ? (
                        <button type="button" data-masked={shown ? undefined : 'true'}
                          className="inline-flex items-center gap-1 rounded-sm hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          aria-label={shown ? i18n.t("隐藏 {0} 的值", [col]) : i18n.t("显示 {0} 的值", [col])}
                          onClick={() => toggleReveal(key)}>
                          {shown ? <><EyeOff className="w-3 h-3" />{cellText(value)}</> : <><Eye className="w-3 h-3" />{MASK}</>}
                        </button>
                      ) : cellText(value)}
                    </TableCell>
                  )
                })}
                {!readOnly && <TableCell numeric className="w-24 min-w-[5.5rem] space-x-1 whitespace-nowrap py-1.5">
                  <Button size="icon" variant="ghost" disabled={loading || busy || !!readError || !canIdentify} aria-label={i18n.t("编辑记录")} onClick={() => openEdit(row)}><Pencil /></Button>
                  <Button size="icon" variant="ghost" disabled={loading || busy || !!readError || !canIdentify} aria-label={i18n.t("删除记录")} className="text-destructive" onClick={() => { void handleDelete(row) }}><Trash2 /></Button>
                </TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 shrink-0">
          <Button size="sm" variant="outline" aria-label={i18n.t("上一页")} disabled={loading || busy || page <= 1} onClick={() => setPage((p: number) => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" aria-label={i18n.t("下一页")} disabled={loading || busy || page >= totalPages} onClick={() => setPage((p: number) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}

      {!readOnly && <Dialog open={editRow !== null || addRow} onOpenChange={(open) => { if (!open && !gate.pending) { closeEditor(); setMsg(null) } }}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{addRow ? i18n.t("添加记录") : i18n.t("编辑记录")}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {columns.map((col: string) => (
              <JsonField
                key={col}
                label={col}
                error={fieldIssues[col]}
                disabled={busy}
                value={formData[col] ?? ''}
                onChange={(v: string) => { setFormData((prev: Record<string, string>) => ({ ...prev, [col]: v })); setMsg(null) }}
              />
            ))}
          </div>
          {msg?.type === 'error' && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{msg.text}</p>{msg.details ? <details className="text-xs"><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><p className="mt-2 whitespace-pre-wrap break-words">{msg.details}</p></details> : null}</div>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm" disabled={busy}>{i18n.t("取消")}</Button></DialogClose>
            <Button size="sm" disabled={busy || invalidDraft} onClick={() => handleSave(addRow)}><Save className="w-3.5 h-3.5 mr-1" />{i18n.t("保存")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {!readOnly && <ConfirmDialog
        open={!!pendingUpdate}
        onOpenChange={(open) => { if (!open) setPendingUpdate(null) }}
        title={i18n.t("保存修改")}
        description={pendingUpdate ? `${i18n.t("将更新 {0} 中 {1} 的记录。", [tableName, Object.entries(pendingUpdate.where).map(([key, value]) => `${key}=${String(value)}`).join('、')])} ${affectsText(pendingUpdate.count)}` : undefined}
        confirmLabel={i18n.t("保存")}
        onConfirm={confirmUpdate}
      />}
      {!readOnly && <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !gate.pending) setDeleteTarget(null) }}
        title={i18n.t("删除记录")}
        description={deleteTarget ? `${i18n.t("将删除 {0} 中 {1} 的记录。此操作无法撤销。", [tableName, primaryKeys.map(key => `${key}=${String(deleteTarget.row[key])}`).join('、')])} ${affectsText(deleteTarget.count)}` : undefined}
        variant="destructive"
        confirmLabel={i18n.t("删除")}
        onConfirm={confirmDelete}
      />}
    </div>
  )
}
