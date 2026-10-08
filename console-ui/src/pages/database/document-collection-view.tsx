import { RecordValueDisclosure } from './RecordValueDisclosure'
import { valuePreview, fullValueText } from './record-value-preview.mjs'
import { documentTarget, parseDocument } from './mutation-model.mjs'
import { useMutation } from './use-mutation'
import { useState, useEffect, useCallback, type ChangeEvent } from 'react'
import type { SelectResult } from '@zhin.js/client'
import { Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle, CheckCircle, ChevronLeft, ChevronRight, Save } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
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
  const { busy, gate, run } = useMutation()
  const [data, setData] = useState<SelectResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editDoc, setEditDoc] = useState<any>(null)
  const [addDoc, setAddDoc] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<any>(null)
  const { success, error: toastError } = useToast()
  const pageSize = 20

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const result = await select(tableName, page, pageSize)
      setData(result)
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [tableName, page, select])

  useEffect(() => { load() }, [load])

  const handleSave = async (isNew: boolean) => {
    if (readOnly || gate.pending) return
    await run(async () => {
    try {
      const doc = parseDocument(jsonText)
      if (isNew) {
        await insert(tableName, doc)
      } else {
        const { _id, ...rest } = doc
        const target = documentTarget(editDoc)
        if (doc._id !== editDoc._id) throw new Error('编辑不能修改 _id。')
        await update(tableName, rest, target)
      }
      setMsg({ type: 'success', text: isNew ? '添加成功' : '更新成功' })
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
      await remove(tableName, documentTarget(deleteTarget))
      success('删除成功')
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
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
        </Button>
        {!readOnly && <Button size="sm" disabled={busy} onClick={() => { setAddDoc(true); setJsonText('{\n  \n}') }}>
          <Plus className="w-3.5 h-3.5 mr-1" />添加文档
        </Button>}
        <span className="text-xs text-muted-foreground sm:ml-auto basis-full sm:basis-auto">共 {data?.total ?? 0} 条 · 第 {page}/{totalPages || 1} 页</span>
      </div>

      <div className="flex-1 min-h-0 min-w-0 overflow-y-auto space-y-2 overscroll-contain">
        {loading && !data ? (
          <div className="text-center py-8"><Loader2 className="w-4 h-4 animate-spin inline-block" /></div>
        ) : !data?.rows?.length ? (
          <p className="text-center py-8 text-muted-foreground text-sm">暂无文档</p>
        ) : data.rows.map((doc: any, i: number) => (
          <Card key={`${tableName}:${page}:${doc._id ?? i}`} className="min-w-0 overflow-hidden">
            <CardContent className="p-3">
              <div className="flex items-start justify-between gap-2 min-w-0">
                <div className="min-w-0 flex-1 space-y-2">
                  <p className="truncate font-mono text-xs text-foreground" title={fullValueText(doc._id)}>ID · {doc._id == null ? '未提供' : fullValueText(doc._id)}</p>
                  <RecordValueDisclosure value={doc} summary={valuePreview(doc, 140, ['_id'])} label="查看完整 JSON" />
                </div>
                {!readOnly && <div className="flex items-start gap-1 shrink-0">
                  <Button size="sm" variant="outline" disabled={busy} aria-label="编辑记录" className="h-8 px-2" onClick={() => {
                    setEditDoc(doc)
                    setAddDoc(false)
                    setJsonText(JSON.stringify(doc, null, 2))
                  }}><Pencil className="mr-1 h-3 w-3" />编辑</Button>
                  <Button size="sm" variant="ghost" disabled={busy} aria-label="删除记录" className="h-8 w-8 p-0 text-destructive" onClick={() => handleDelete(doc)}><Trash2 className="w-3 h-3" /></Button>
                </div>}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 shrink-0">
          <Button size="sm" variant="outline" aria-label="上一页" disabled={busy || page <= 1} onClick={() => setPage((p: number) => p - 1)}><ChevronLeft className="w-4 h-4" /></Button>
          <span className="text-xs text-muted-foreground">{page} / {totalPages}</span>
          <Button size="sm" variant="outline" aria-label="下一页" disabled={busy || page >= totalPages} onClick={() => setPage((p: number) => p + 1)}><ChevronRight className="w-4 h-4" /></Button>
        </div>
      )}

      {!readOnly && <Dialog open={editDoc !== null || addDoc} onOpenChange={(open) => { if (!open && !gate.pending) { setEditDoc(null); setAddDoc(false) } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>{addDoc ? '添加文档' : '编辑文档'}</DialogTitle></DialogHeader>
          <textarea
            disabled={busy}
            value={jsonText}
            onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setJsonText(e.target.value)}
            className="w-full h-60 font-mono text-xs p-3 border rounded-md resize-none bg-background"
            spellCheck={false}
          />
          {msg?.type === 'error' && <p role="alert" className="text-sm text-destructive">{msg.text}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm" disabled={busy}>取消</Button></DialogClose>
            <Button size="sm" disabled={busy} onClick={() => handleSave(addDoc)}><Save className="w-3.5 h-3.5 mr-1" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {!readOnly && <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !gate.pending) setDeleteTarget(null) }}
        title="删除文档"
        description="确定要删除这条文档吗？"
        variant="destructive"
        confirmLabel="删除"
        onConfirm={confirmDelete}
      />}
    </div>
  )
}
