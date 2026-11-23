import { useI18n } from '../../i18n'
import { RecordValueDisclosure } from './RecordValueDisclosure'
import { assertNewKey } from './mutation-model.mjs'
import { useMutation } from './use-mutation'
import { kvCheckResult, kvWriteFailure, type KvWritePlan } from './kv-write-model.mjs'
import { DdlCheckNotice, useDdlCheck } from './ddl-outcome'
import { useState, useEffect, useCallback } from 'react'
import type { KvEntry } from '@zhin.js/client'
import { Plus, Trash2, Pencil, RefreshCw, Loader2, AlertCircle, CheckCircle, Save, Key } from 'lucide-react'
import { Alert, AlertDescription, Button, ConfirmDialog, Dialog, DialogClose, DialogContent, DialogFooter, DialogHeader, DialogTitle, Input, Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@zhin.js/console-ui'
import { useToast } from '../../components/toast'
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
  const i18n = useI18n()
  const { busy, gate, run } = useMutation()
  const [entries, setEntries] = useState<KvEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [msg, setMsg] = useState<{ type: 'success' | 'error'; text: string; details?: string } | null>(null)
  const [editEntry, setEditEntry] = useState<KvEntry | null>(null)
  const [addEntry, setAddEntry] = useState(false)
  const [keyInput, setKeyInput] = useState('')
  const [valueInput, setValueInput] = useState('')
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null)
  const { success } = useToast()

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

  // A write whose outcome is unknown (#64): every write in this bucket stays blocked until 「核对」
  // reads the bucket again; a replay could overwrite, or be refused as 「键已存在」 for a write that landed.
  const check = useDdlCheck<KvWritePlan>(async plan => {
    const result = kvCheckResult((await kvEntries(tableName)).entries, plan, i18n.locale)
    if (result.applied && plan.action === 'set') { setEditEntry(null); setAddEntry(false); setKeyInput(''); setValueInput('') }
    await load()
    return result
  })
  const locked = busy || Boolean(check.held)

  const handleSave = async (isNew: boolean) => {
    if (readOnly || gate.pending || check.held) return
    await run(async () => {
    const key = keyInput.trim()
    let val: any
    try {
      if (!key) throw new Error(i18n.t("Key 不能为空。"))
      if (isNew) assertNewKey(key, (await kvEntries(tableName)).entries, i18n.locale)
      try { val = JSON.parse(valueInput) } catch { val = valueInput }
    } catch (err) {
      // Checks before anything is written: their own message says what to fix.
      setMsg({ type: 'error', text: (err as Error).message })
      return
    }
    try {
      await kvSet(tableName, key, val)
    } catch (err) {
      const failure = kvWriteFailure(err, 'set', i18n.locale)
      if (failure.unknown) { setMsg(null); check.hold({ subject: { action: 'set', key, value: val }, text: failure.text, details: failure.details }); return }
      setMsg({ type: 'error', text: failure.text, details: failure.details })
      return
    }
    check.clearResult()
    try {
      setMsg({ type: 'success', text: isNew ? i18n.t("添加成功") : i18n.t("更新成功") })
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
    if (gate.pending || readOnly || check.held) return
    setDeleteTarget(key)
  }

  const confirmDelete = async () => {
    if (!deleteTarget || gate.pending || readOnly || check.held) return
    const key = deleteTarget
    await run(async () => {
    try {
      await kvDelete(tableName, key)
      check.clearResult()
      success(i18n.t("删除成功"))
      await load()
    } catch (err) {
      const failure = kvWriteFailure(err, 'delete', i18n.locale)
      if (failure.unknown) check.hold({ subject: { action: 'delete', key }, text: failure.text, details: failure.details })
      else setMsg({ type: 'error', text: failure.text, details: failure.details })
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
          <AlertDescription>{msg.text}{msg.details ? <details className="mt-2 text-xs"><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><p className="mt-2 whitespace-pre-wrap break-words">{msg.details}</p></details> : null}</AlertDescription>
        </Alert>
      )}
      {editEntry === null && !addEntry ? <DdlCheckNotice controller={check} className="shrink-0" /> : null}

      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={load} disabled={loading || busy}>
          <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />{i18n.t("刷新")}</Button>
        {!readOnly && <Button size="sm" disabled={locked} onClick={() => { setAddEntry(true); setKeyInput(''); setValueInput('') }}>
          <Plus className="w-3.5 h-3.5 mr-1" />{i18n.t("添加键值")}</Button>}
        <span className="text-xs text-muted-foreground sm:ml-auto basis-full sm:basis-auto">{i18n.t("共 ")}{entries.length} {i18n.t(" 个键")}</span>
      </div>

      <div
        className="flex-1 min-h-[16rem] min-w-0 border rounded-md overflow-auto overscroll-contain touch-pan-x touch-pan-y bg-card"
        role="region"
        aria-label={i18n.t("键值表，宽表可在此区域内左右滑动")}
      >
        <Table containerClassName="overflow-visible" className="min-w-[28rem] table-fixed">
          <TableHeader sticky>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[30%]">Key</TableHead>
              <TableHead>Value</TableHead>
              {!readOnly && <TableHead numeric className="w-28">{i18n.t("操作")}</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && !entries.length ? (
              <TableRow><TableCell colSpan={readOnly ? 2 : 3} className="py-8 text-center"><Loader2 className="w-4 h-4 animate-spin inline-block" /></TableCell></TableRow>
            ) : !entries.length ? (
              <TableRow><TableCell colSpan={readOnly ? 2 : 3} className="py-8 text-center text-muted-foreground">{i18n.t("这个存储桶还没有键值。")}</TableCell></TableRow>
            ) : entries.map((entry) => (
              <TableRow key={entry.key}>
                <TableCell className="align-top">
                  <div className="flex min-w-0 items-start gap-1">
                    <Key className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <span className="line-clamp-2 break-all font-mono text-xs" title={entry.key}>{entry.key}</span>
                  </div>
                </TableCell>
                <TableCell className="min-w-0 align-top">
                  <RecordValueDisclosure value={entry.value} />
                </TableCell>
                {!readOnly && <TableCell numeric className="space-x-1 whitespace-nowrap align-top">
                  <Button size="sm" variant="outline" disabled={locked} aria-label={i18n.t("编辑记录")} onClick={() => {
                    setEditEntry(entry)
                    setAddEntry(false)
                    setKeyInput(entry.key)
                    setValueInput(typeof entry.value === 'object' ? JSON.stringify(entry.value, null, 2) : String(entry.value ?? ''))
                  }}><Pencil className="mr-1 h-3 w-3" />{i18n.t("编辑")}</Button>
                  <Button size="icon" variant="destructive" disabled={locked} aria-label={i18n.t("删除记录")} onClick={() => handleDelete(entry.key)}><Trash2 /></Button>
                </TableCell>}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {!readOnly && <Dialog open={editEntry !== null || addEntry} onOpenChange={(open) => { if (!open && !gate.pending) { setEditEntry(null); setAddEntry(false) } }}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{addEntry ? i18n.t("添加键值") : i18n.t("编辑键值")}</DialogTitle></DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Key</label>
              <Input value={keyInput} onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyInput(e.target.value)} className="font-mono text-xs" disabled={!addEntry || busy} />
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">{i18n.t("Value (JSON 或纯文本)")}</label>
              <textarea
                disabled={busy}
                value={valueInput}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setValueInput(e.target.value)}
                className="w-full h-32 font-mono text-xs p-3 border rounded-md resize-none bg-background"
                spellCheck={false}
              />
            </div>
          </div>
          {addEntry && entries.some(entry => entry.key === keyInput.trim()) && <p role="alert" className="text-xs text-destructive">{i18n.t("该 Key 已存在，请取消并编辑已有键值。")}</p>}
          {msg?.type === 'error' && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{msg.text}</p>{msg.details ? <details className="text-xs"><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><p className="mt-2 whitespace-pre-wrap break-words">{msg.details}</p></details> : null}</div>}
          <DdlCheckNotice controller={check} />
          <DialogFooter>
            <DialogClose asChild><Button variant="outline" size="sm" disabled={busy}>{i18n.t("取消")}</Button></DialogClose>
            <Button size="sm" disabled={locked || !keyInput.trim() || (addEntry && entries.some(entry => entry.key === keyInput.trim()))} onClick={() => handleSave(addEntry)}><Save className="w-3.5 h-3.5 mr-1" />{i18n.t("保存")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>}
      {!readOnly && <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => { if (!open && !gate.pending) setDeleteTarget(null) }}
        title={i18n.t("删除键值")}
        description={i18n.t("确定要删除键 \"{0}\" 吗？", [deleteTarget])}
        variant="destructive"
        confirmLabel={i18n.t("删除")}
        onConfirm={confirmDelete}
      />}
    </div>
  )
}
