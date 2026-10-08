import { ErrorAlert } from '../../components/error-alert'
import { readErrorSummary } from '../../utils/read-error.mjs'
import { relatedUpdateReadback } from './related-update-result.mjs'
import { relatedPrimaryKeys, relatedRowIdentity } from './related-row-identity.mjs'
import { databaseSaveError } from './save-error.mjs'
import { relatedRowIssues } from './related-row-validation.mjs'
import { parseRelatedRow } from './related-row-draft.mjs'
import { useMutation } from './use-mutation'
import { useState, useEffect, useCallback, useMemo } from 'react'
import type { TableInfo, SelectResult } from '@zhin.js/client'
import { Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Save, ArrowUp, ArrowDown } from 'lucide-react'
import { Button } from '../../components/ui/button'
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

export function RelatedTableView({
  tableName,
  tableInfo,
  select,
  insert,
  update,
  remove,
  readOnly,
}: {
  tableName: string
  tableInfo?: TableInfo
  select: (table: string, page?: number, pageSize?: number, where?: any) => Promise<SelectResult>
  insert: (table: string, row: any) => Promise<any>
  update: (table: string, row: any, where: any) => Promise<any>
  remove: (table: string, where: any) => Promise<any>
  readOnly: boolean
}) {
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
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [sortCol, setSortCol] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const { success, error: toastError } = useToast()
  const pageSize = 50

  const load = useCallback(async () => {
    setLoading(true)
    setReadError(null)
    setMsg(null)
    try {
      const result = await select(tableName, page, pageSize)
      const lastPage = Math.max(1, Math.ceil(result.total / pageSize))
      if (page > lastPage) {
        setPage(lastPage)
        return true
      }
      setData(result)
      setSavedAwaitingRefresh(false)
      return true
    } catch (err) {
      setReadError(err instanceof Error ? err.message : String(err))
      return false
    } finally {
      setLoading(false)
    }
  }, [tableName, page, select])

  useEffect(() => { load() }, [load])

  const columns = useMemo(() => {
    if (tableInfo?.columns) return Object.keys(tableInfo.columns)
    if (data?.rows?.length) return Object.keys(data.rows[0] as Record<string, unknown>)
    return []
  }, [tableInfo, data])

  const primaryKeys = useMemo(() => relatedPrimaryKeys(tableInfo?.columns), [tableInfo])
  const canIdentify = primaryKeys.length > 0

  const fieldIssues = useMemo(() => relatedRowIssues(columns, formData, tableInfo?.columns), [columns, formData, tableInfo])
  const invalidDraft = Object.keys(fieldIssues).length > 0

  const handleSave = async (isNew: boolean) => {
    if (readOnly || gate.pending || invalidDraft || readError) return
    await run(async () => {
    setMsg(null)
    try {
      const row = parseRelatedRow(columns, formData, tableInfo?.columns, isNew ? undefined : editRow)
      if (isNew) {
        await insert(tableName, row)
      } else {
        const where = relatedRowIdentity(primaryKeys, editRow)
        const result = await update(tableName, row, where)
        if (result?.affected === 0) {
          const current = await select(tableName, 1, 2, where)
          const outcome = relatedUpdateReadback(current.rows, row, tableInfo?.columns)
          if (outcome !== 'saved') {
            setMsg({ type: 'error', text: outcome === 'missing' ? '记录已不存在或主键已改变。当前输入已保留，请取消后刷新列表。' : '未确认更新结果。当前输入已保留，请取消后刷新列表核对。' })
            return
          }
        }
      }
      setSavedAwaitingRefresh(true)
      setEditRow(null)
      setAddRow(false)
      setFormData({})
      const refreshed = await load()
      setMsg(refreshed ? { type: 'success', text: isNew ? '添加成功' : '更新成功' } : null)
    } catch (err) {
      setMsg(databaseSaveError(err))
    }
    })
  }

  const handleDelete = async (row: any) => {
    if (gate.pending || readOnly || readError) return
    setDeleteTarget(row)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || gate.pending || readOnly || readError) return
    await run(async () => {
    try {
      await remove(tableName, relatedRowIdentity(primaryKeys, deleteTarget))
      success('删除成功')
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

  const hasCurrentPage = !!data && data.page === page
  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  const handleSortClick = (col: string) => {
    if (sortCol === col) {
      setSortDir(prev => prev === 'asc' ? 'desc' : 'asc')
    } else {
      setSortCol(col)
      setSortDir('asc')
    }
  }

  const sortedRows = useMemo(() => {
    if (!data?.rows?.length || !sortCol) return data?.rows ?? []
    const sorted = (data.rows as Record<string, unknown>[]).slice().sort((a, b) => {
      const aVal = a[sortCol]
      const bVal = b[sortCol]
      if (aVal == null && bVal == null) return 0
      if (aVal == null) return 1
      if (bVal == null) return -1
      const aStr = typeof aVal === 'object' ? JSON.stringify(aVal) : String(aVal)
      const bStr = typeof bVal === 'object' ? JSON.stringify(bVal) : String(bVal)
      const cmp = aStr.localeCompare(bStr, undefined, { numeric: true, sensitivity: 'base' })
      return sortDir === 'asc' ? cmp : -cmp
    })
    return sorted
  }, [data?.rows, sortCol, sortDir])

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {msg && !(msg.type === 'error' && (editRow !== null || addRow)) && (
        <Alert variant={msg.type === 'error' ? 'destructive' : 'success'} className="py-2 shrink-0">
          {msg.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{msg.text}{msg.details ? <details className="mt-2 text-xs"><summary className="cursor-pointer">技术详情</summary><p className="mt-2 whitespace-pre-wrap break-words">{msg.details}</p></details> : null}</AlertDescription>
        </Alert>
      )}

      {readError ? <div className="space-y-2 shrink-0">
        <ErrorAlert error={savedAwaitingRefresh ? '记录已保存，但列表刷新失败。请重试读取列表。' : readErrorSummary(readError, '表数据')} onRetry={() => { void load() }} />
        {hasCurrentPage ? <p className="text-xs text-muted-foreground">当前显示上次加载的数据。</p> : null}
        <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">技术详情</summary><p className="mt-2 whitespace-pre-wrap break-words">{readError}</p></details>
      </div> : null}

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={load} disabled={loading || busy}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
        </Button>
        {!readOnly && <Button size="sm" disabled={loading || busy || !!readError} onClick={openAdd}><Plus className="w-3.5 h-3.5 mr-1" />添加</Button>}
        <span className="text-xs text-muted-foreground sm:ml-auto basis-full sm:basis-auto">
          {loading && !hasCurrentPage ? `正在加载第 ${page} 页…` : data ? `共 ${data.total} 条 · 第 ${page}/${totalPages || 1} 页${sortCol ? ' · 本页排序' : ''}` : loading ? '加载中…' : '未加载'}
        </span>
      </div>

      {!readOnly && !canIdentify ? <p className="text-xs text-muted-foreground">此表未声明主键，暂不支持编辑或删除记录。</p> : null}

      <div
        className="flex-1 min-h-[16rem] min-w-0 border rounded-md overflow-auto overscroll-contain scroll-smooth touch-pan-x touch-pan-y bg-card"
        role="region"
        aria-label="数据表，宽表可在此区域内左右滑动"
      >
        <table className="text-sm border-collapse min-w-full w-max">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm shadow-sm">
            <tr className="border-b">
              {columns.map((col: string) => (
                <th
                  key={col}
                  aria-sort={sortCol === col ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
                  className="px-3 py-2 text-left font-medium text-muted-foreground whitespace-nowrap border-b border-border/80"
                >
                  <button type="button" disabled={loading || busy}
                    aria-label={`按 ${col} ${sortCol === col && sortDir === 'asc' ? '降序' : '升序'}排列（当前页）`}
                    title="排序当前页"
                    onClick={() => handleSortClick(col)}
                    className="inline-flex items-center gap-1 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground disabled:opacity-50">
                    {col}
                    {sortCol === col && (
                      sortDir === 'asc'
                        ? <ArrowUp className="w-3 h-3" />
                        : <ArrowDown className="w-3 h-3" />
                    )}
                  </button>
                </th>
              ))}
              {!readOnly && <th className="px-3 py-2 text-right font-medium text-muted-foreground whitespace-nowrap border-b border-border/80 w-24 min-w-[5.5rem]">
                操作
              </th>}
            </tr>
          </thead>
          <tbody>
            {loading && !hasCurrentPage ? (
              <tr><td colSpan={columns.length + (readOnly ? 0 : 1)} className="text-center py-8"><span role="status" aria-label="正在加载表数据"><Loader2 className="w-4 h-4 animate-spin inline-block" /></span></td></tr>
            ) : readError && !hasCurrentPage ? (
              <tr><td colSpan={columns.length + (readOnly ? 0 : 1)} className="text-center py-8 text-muted-foreground">数据未加载</td></tr>
            ) : !data?.rows?.length ? (
              <tr><td colSpan={columns.length + (readOnly ? 0 : 1)} className="text-center py-8 text-muted-foreground">暂无数据</td></tr>
            ) : sortedRows.map((row: any, i: number) => (
              <tr key={i} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                {columns.map((col: string) => (
                  <td
                    key={col}
                    className="px-3 py-1.5 font-mono text-xs whitespace-nowrap align-top"
                    title={typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
                  >
                    {typeof row[col] === 'object' ? JSON.stringify(row[col]) : String(row[col] ?? '')}
                  </td>
                ))}
                {!readOnly && <td className="px-3 py-1.5 text-right space-x-1 whitespace-nowrap w-24 min-w-[5.5rem]">
                  <Button size="sm" variant="ghost" disabled={loading || busy || !!readError || !canIdentify} aria-label="编辑记录" className="h-6 w-6 p-0" onClick={() => openEdit(row)}><Pencil className="w-3 h-3" /></Button>
                  <Button size="sm" variant="ghost" disabled={loading || busy || !!readError || !canIdentify} aria-label="删除记录" className="h-6 w-6 p-0 text-destructive" onClick={() => handleDelete(row)}><Trash2 className="w-3 h-3" /></Button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 shrink-0">
          <Button size="sm" variant="outline" aria-label="上一页" disabled={loading || busy || page <= 1} onClick={() => setPage((p: number) => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" aria-label="下一页" disabled={loading || busy || page >= totalPages} onClick={() => setPage((p: number) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}

      {!readOnly && <Dialog open={editRow !== null || addRow} onOpenChange={(open) => { if (!open && !gate.pending) { setEditRow(null); setAddRow(false); setFormData({}); setMsg(null) } }}>
        <DialogContent className="max-w-md max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{addRow ? '添加记录' : '编辑记录'}</DialogTitle>
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
          {msg?.type === 'error' && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{msg.text}</p>{msg.details ? <details className="text-xs"><summary className="cursor-pointer">技术详情</summary><p className="mt-2 whitespace-pre-wrap break-words">{msg.details}</p></details> : null}</div>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm" disabled={busy}>取消</Button></DialogClose>
            <Button size="sm" disabled={busy || invalidDraft} onClick={() => handleSave(addRow)}><Save className="w-3.5 h-3.5 mr-1" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {!readOnly && <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !gate.pending) setDeleteTarget(null) }}
        title="删除记录"
        description={deleteTarget ? `将删除 ${tableName} 中 ${primaryKeys.map(key => `${key}=${String(deleteTarget[key])}`).join('、')} 的记录。此操作无法撤销。` : undefined}
        variant="destructive"
        confirmLabel="删除"
        onConfirm={confirmDelete}
      />}
    </div>
  )
}
