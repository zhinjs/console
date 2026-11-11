import { useI18n } from '../../i18n'
import { RecordValueDisclosure } from './RecordValueDisclosure'
import { valuePreview, fullValueText } from './record-value-preview.mjs'
import { documentTarget, parseDocument } from './mutation-model.mjs'
import { useMutation } from './use-mutation'
import { documentFilterWhere } from './record-query.mjs'
import { useState, useEffect, useCallback, useRef, type ChangeEvent, type FormEvent } from 'react'
import type { SelectResult } from '@zhin.js/client'
import { Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Save, Search, X } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Alert, AlertDescription } from '../../components/ui/alert'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '../../components/ui/dialog'
import { useToast } from '../../components/toast'
import { ConfirmDialog } from '../../components/confirm-dialog'

export function DocumentCollectionView({
  tableName,
  select,
  insert,
  update,
  remove,
  readOnly,
}: {
  tableName: string
  select: (table: string, page?: number, pageSize?: number, where?: any) => Promise<SelectResult>
  insert: (table: string, row: any) => Promise<any>
  update: (table: string, row: any, where: any) => Promise<any>
  remove: (table: string, where: any) => Promise<any>
  readOnly: boolean
}) {
  const i18n = useI18n()
  const { busy, gate, run } = useMutation()
  const [data, setData] = useState<SelectResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editDoc, setEditDoc] = useState<any>(null)
  const [addDoc, setAddDoc] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const [filterDraft, setFilterDraft] = useState({ field: '', value: '' })
  const [filterError, setFilterError] = useState<string | null>(null)
  // Equality condition Host applies to the whole collection (documents and total).
  const [applied, setApplied] = useState<{ field: string; value: string; where: Record<string, unknown> } | null>(null)
  const [loadedFilter, setLoadedFilter] = useState<typeof applied>(null)
  const requestSeq = useRef(0)
  const { success, error: toastError } = useToast()
  const pageSize = 20

  const load = useCallback(async () => {
    const seq = ++requestSeq.current
    setLoading(true)
    setMsg(null)
    try {
      const result = await select(tableName, page, pageSize, applied?.where)
      if (seq !== requestSeq.current) return
      setData(result)
      setLoadedFilter(applied)
    } catch (err) {
      if (seq !== requestSeq.current) return
      setMsg({ type: 'error', text: (err as Error).message })
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [tableName, page, select, applied])

  const applyFilter = (event?: FormEvent) => {
    event?.preventDefault()
    const result = documentFilterWhere(filterDraft, i18n.locale)
    if (result.error !== undefined) { setFilterError(result.error); return }
    setFilterError(null)
    setApplied({ field: filterDraft.field.trim(), value: filterDraft.value, where: result.where })
    setPage(1)
  }

  const clearFilter = () => {
    setFilterDraft(prev => ({ ...prev, value: '' }))
    setFilterError(null)
    setApplied(null)
    setPage(1)
  }

  useEffect(() => { load() }, [load])

  const handleSave = async (isNew: boolean) => {
    if (readOnly || gate.pending) return
    await run(async () => {
    try {
      const doc = parseDocument(jsonText, i18n.locale)
      if (isNew) {
        await insert(tableName, doc)
      } else {
        const { _id, ...rest } = doc
        const target = documentTarget(editDoc, i18n.locale)
        if (doc._id !== editDoc._id) throw new Error(i18n.t("编辑不能修改 _id。"))
        await update(tableName, rest, target)
      }
      setMsg({ type: 'success', text: isNew ? i18n.t("添加成功") : i18n.t("更新成功") })
      setEditDoc(null)
      setAddDoc(false)
      setJsonText('')
      setTimeout(() => setMsg(null), 2000)
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    }
    })
  }

  const handleDelete = async (doc: any) => {
    if (gate.pending || readOnly) return
    setDeleteTarget(doc)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || gate.pending || readOnly) return
    await run(async () => {
    try {
      await remove(tableName, documentTarget(deleteTarget, i18n.locale))
      success(i18n.t("删除成功"))
      await load()
    } catch (err) {
      toastError((err as Error).message)
    } finally {
      setDeleteTarget(null)
    }
    })
  }

  const totalPages = data ? Math.ceil(data.total / pageSize) : 0

  return (
    <div className="flex flex-col h-full min-h-0 gap-3">
      {msg && (
        <Alert variant={msg.type === 'error' ? 'destructive' : 'success'} className="py-2 shrink-0">
          {msg.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{msg.text}</AlertDescription>
        </Alert>
      )}

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={load} disabled={loading || busy}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />{i18n.t("刷新")}</Button>
        {!readOnly && <Button size="sm" disabled={busy} onClick={() => { setAddDoc(true); setJsonText('{\n  \n}') }}>
          <Plus className="w-3.5 h-3.5 mr-1" />{i18n.t("添加文档")}</Button>}
        <span className="text-xs text-muted-foreground sm:ml-auto basis-full sm:basis-auto">{i18n.t("共 ")}{data?.total ?? 0} {i18n.t(" 条 · 第 ")}{page}/{totalPages || 1} {i18n.t(" 页")}{loadedFilter ? i18n.t(" · 已筛选") : ''}</span>
      </div>

      <form role="search" aria-label={i18n.t("按字段查找文档")} onSubmit={applyFilter} className="flex flex-wrap items-start gap-2 shrink-0">
        <Input className="w-40" aria-label={i18n.t("字段名")} placeholder={i18n.t("字段名")} disabled={loading || busy} value={filterDraft.field}
          onChange={(event: ChangeEvent<HTMLInputElement>) => { const field = event.target.value; setFilterDraft(prev => ({ ...prev, field })); setFilterError(null) }} />
        <span className="self-center text-xs text-muted-foreground">{i18n.t("等于")}</span>
        <div className="min-w-[10rem] flex-1 space-y-1">
          <Input aria-label={i18n.t("查找的值")} placeholder={i18n.t("值（按 JSON 解析，如 42、true、\"42\"）")} disabled={loading || busy} value={filterDraft.value}
            aria-invalid={filterError ? true : undefined}
            onChange={(event: ChangeEvent<HTMLInputElement>) => { const value = event.target.value; setFilterDraft(prev => ({ ...prev, value })); setFilterError(null) }} />
          {filterError ? <p role="alert" className="text-xs text-destructive">{filterError}</p> : null}
        </div>
        <Button type="submit" size="sm" variant="outline" disabled={loading || busy}><Search className="w-3.5 h-3.5 mr-1" />{i18n.t("查找")}</Button>
      </form>
      {applied ? <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground shrink-0" data-filter-summary>
        <span>{i18n.t("全表查找：{0} {1} “{2}”", [applied.field, i18n.t("等于"), applied.value])}</span>
        <Button type="button" size="sm" variant="ghost" className="h-auto px-1 py-0 text-xs" data-action="clear-filter" disabled={busy} onClick={clearFilter}><X className="w-3 h-3 mr-1" />{i18n.t("清除条件")}</Button>
      </p> : null}

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto space-y-2 overscroll-contain">
        {loading && !data ? (
          <div className="text-center py-8"><Loader2 className="w-4 h-4 animate-spin inline-block" /></div>
        ) : !data?.rows?.length ? (
          <p className="text-center py-8 text-muted-foreground text-sm">{loadedFilter ? i18n.t("没有符合条件的文档") : i18n.t("暂无文档")}</p>
        ) : data.rows.map((doc: any, i: number) => (
          <Card key={`${tableName}:${page}:${doc._id ?? i}`} className="min-w-0 overflow-hidden">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="truncate font-mono text-xs text-foreground" title={fullValueText(doc._id)}>ID · {doc._id == null ? i18n.t("未提供") : fullValueText(doc._id)}</p>
                  <RecordValueDisclosure value={doc} summary={valuePreview(doc, 140, ['_id'], i18n.locale)} label={i18n.t("查看完整 JSON")} />
                </div>
                {!readOnly && <div className="flex items-start gap-1 shrink-0">
                  <Button size="sm" variant="outline" disabled={busy} aria-label={i18n.t("编辑记录")} onClick={() => {
                    setEditDoc(doc)
                    setAddDoc(false)
                    setJsonText(JSON.stringify(doc, null, 2))
                  }}><Pencil className="mr-1 h-3 w-3" />{i18n.t("编辑")}</Button>
                  <Button size="icon" variant="ghost" disabled={busy} aria-label={i18n.t("删除记录")} className="text-destructive" onClick={() => handleDelete(doc)}><Trash2 /></Button>
                </div>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 shrink-0">
          <Button size="sm" variant="outline" aria-label={i18n.t("上一页")} disabled={busy || page <= 1} onClick={() => setPage((p: number) => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" aria-label={i18n.t("下一页")} disabled={busy || page >= totalPages} onClick={() => setPage((p: number) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}

      {!readOnly && <Dialog open={editDoc !== null || addDoc} onOpenChange={(open) => { if (!open && !gate.pending) { setEditDoc(null); setAddDoc(false) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{addDoc ? i18n.t("添加文档") : i18n.t("编辑文档")}</DialogTitle></DialogHeader>
          <textarea
            disabled={busy}
            value={jsonText}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setJsonText(e.target.value)}
            className="w-full h-60 font-mono text-xs p-3 border rounded-md resize-none bg-background"
            spellCheck={false}
          />
          {msg?.type === 'error' && <p role="alert" className="text-sm text-destructive">{msg.text}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm" disabled={busy}>{i18n.t("取消")}</Button></DialogClose>
            <Button size="sm" disabled={busy} onClick={() => handleSave(addDoc)}><Save className="w-3.5 h-3.5 mr-1" />{i18n.t("保存")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {!readOnly && <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !gate.pending) setDeleteTarget(null) }}
        title={i18n.t("删除文档")}
        description={i18n.t("确定要删除这条文档吗？")}
        variant="destructive"
        confirmLabel={i18n.t("删除")}
        onConfirm={confirmDelete}
      />}
    </div>
  )
}
