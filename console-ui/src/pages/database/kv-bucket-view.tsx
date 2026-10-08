import { RecordValueDisclosure } from './RecordValueDisclosure'
import { assertNewKey } from './mutation-model.mjs'
import { useMutation } from './use-mutation'
import { useState, useEffect, useCallback } from 'react'
import type { KvEntry } from '@zhin.js/client'
import { Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle, CheckCircle, Save, Key } from 'lucide-react'
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
import { Input } from '../../components/ui/input'
import { useToast } from '../../components/toast'
import { ConfirmDialog } from '../../components/confirm-dialog'
import type { ChangeEvent } from 'react'

export function KvBucketView({
  tableName,
  kvGet: _kvGet,
  kvSet,
  kvDelete,
  kvEntries,
  readOnly,
}: {
  tableName: string
  kvGet: (table: string, key: string) => Promise<{ key: string; value: any }>
  kvSet: (table: string, key: string, value: any, ttl?: number) => Promise<any>
  kvDelete: (table: string, key: string) => Promise<any>
  kvEntries: (table: string) => Promise<{ entries: KvEntry[] }>
  readOnly: boolean
}) {
  const { busy, gate, run } = useMutation()
  const [entries, setEntries] = useState<KvEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const [editEntry, setEditEntry] = useState<KvEntry | null>(null)
  const [addEntry, setAddEntry] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [valueInput, setValueInput] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const { success, error: toastError } = useToast()

  const load = useCallback(async () => {
    setLoading(true)
    setMsg(null)
    try {
      const result = await kvEntries(tableName)
      setEntries(result.entries)
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    } finally {
      setLoading(false)
    }
  }, [tableName, kvEntries])

  useEffect(() => { load() }, [load])

  const handleSave = async (isNew: boolean) => {
    if (readOnly || gate.pending) return
    await run(async () => {
    try {
      const key = keyInput.trim()
      if (!key) throw new Error('Key 不能为空。')
      if (isNew) assertNewKey(key, (await kvEntries(tableName)).entries)
      let val: any
      try { val = JSON.parse(valueInput) } catch { val = valueInput }
      await kvSet(tableName, key, val)
      setMsg({ type: 'success', text: isNew ? '添加成功' : '更新成功' })
      setEditEntry(null)
      setAddEntry(false)
      setKeyInput('')
      setValueInput('')
      setTimeout(() => setMsg(null), 2000)
      await load()
    } catch (err) {
      setMsg({ type: 'error', text: (err as Error).message })
    }
    })
  }

  const handleDelete = async (key: string) => {
    if (gate.pending || readOnly) return
    setDeleteTarget(key)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || gate.pending || readOnly) return
    await run(async () => {
    try {
      await kvDelete(tableName, deleteTarget)
      success('删除成功')
      await load()
    } catch (err) {
      toastError((err as Error).message)
    } finally {
      setDeleteTarget(null)
    }
    })
  }

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
        {!readOnly && <Button size="sm" disabled={busy} onClick={() => { setAddEntry(true); setKeyInput(''); setValueInput('') }}>
          <Plus className="w-3.5 h-3.5 mr-1" />添加键值
        </Button>}
        <span className="text-xs text-muted-foreground sm:ml-auto basis-full sm:basis-auto">共 {entries.length} 个键</span>
      </div>

      <div
        className="flex-1 min-h-[16rem] min-w-0 border rounded-md overflow-auto overscroll-contain touch-pan-x touch-pan-y bg-card"
        role="region"
        aria-label="键值表，宽表可在此区域内左右滑动"
      >
        <table className="w-full min-w-[28rem] table-fixed border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-muted/95 backdrop-blur-sm">
            <tr className="border-b border-border/80">
              <th className="px-3 py-2 text-left font-medium text-muted-foreground w-[30%]">Key</th>
              <th className="px-3 py-2 text-left font-medium text-muted-foreground ">Value</th>
              {!readOnly && <th className="px-3 py-2 text-right font-medium text-muted-foreground w-28">操作</th>}
            </tr>
          </thead>
          <tbody>
            {loading && !entries.length ? (
              <tr><td colSpan={readOnly ? 2 : 3} className="text-center py-8"><Loader2 className="w-4 h-4 animate-spin inline-block" /></td></tr>
            ) : !entries.length ? (
              <tr><td colSpan={readOnly ? 2 : 3} className="text-center py-8 text-muted-foreground">暂无数据</td></tr>
            ) : entries.map((entry) => (
              <tr key={entry.key} className="border-b border-border/60 hover:bg-muted/30 transition-colors">
                <td className="px-3 py-2 align-top">
                  <div className="flex min-w-0 items-start gap-1">
                    <Key className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="line-clamp-2 break-all font-mono text-xs" title={entry.key}>{entry.key}</span>
                  </div>
                </td>
                <td className="min-w-0 px-3 py-2 align-top">
                  <RecordValueDisclosure value={entry.value} />
                </td>
                {!readOnly && <td className="px-3 py-2 text-right align-top space-x-1 whitespace-nowrap">
                  <Button size="sm" variant="outline" disabled={busy} aria-label="编辑记录" className="h-8 px-2" onClick={() => {
                    setEditEntry(entry)
                    setAddEntry(false)
                    setKeyInput(entry.key)
                    setValueInput(typeof entry.value === 'object' ? JSON.stringify(entry.value, null, 2) : String(entry.value ?? ''))
                  }}><Pencil className="mr-1 h-3 w-3" />编辑</Button>
                  <Button size="sm" variant="ghost" disabled={busy} aria-label="删除记录" className="h-8 w-8 p-0 text-destructive" onClick={() => handleDelete(entry.key)}><Trash2 className="w-3 h-3" /></Button>
                </td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {!readOnly && <Dialog open={editEntry !== null || addEntry} onOpenChange={(open) => { if (!open && !gate.pending) { setEditEntry(null); setAddEntry(false) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{addEntry ? '添加键值' : '编辑键值'}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Key</label>
              <Input value={keyInput} onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyInput(e.target.value)} className="font-mono text-xs" disabled={!addEntry || busy} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Value (JSON 或纯文本)</label>
              <textarea
                disabled={busy}
                value={valueInput}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setValueInput(e.target.value)}
                className="w-full h-32 font-mono text-xs p-3 border rounded-md resize-none bg-background"
                spellCheck={false}
              />
            </div>
          </div>
          {addEntry && entries.some(entry => entry.key === keyInput.trim()) && <p role="alert" className="text-xs text-destructive">该 Key 已存在，请取消并编辑已有键值。</p>}
          {msg?.type === 'error' && <p role="alert" className="text-sm text-destructive">{msg.text}</p>}
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm" disabled={busy}>取消</Button></DialogClose>
            <Button size="sm" disabled={busy || !keyInput.trim() || (addEntry && entries.some(entry => entry.key === keyInput.trim()))} onClick={() => handleSave(addEntry)}><Save className="w-3.5 h-3.5 mr-1" />保存</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {!readOnly && <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !gate.pending) setDeleteTarget(null) }}
        title="删除键值"
        description={`确定要删除键 "${deleteTarget}" 吗？`}
        variant="destructive"
        confirmLabel="删除"
        onConfirm={confirmDelete}
      />}
    </div>
  )
}
