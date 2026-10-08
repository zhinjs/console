import { useState, useEffect, useCallback, useRef } from 'react'
import { Save, Loader2, AlertCircle, CheckCircle, X } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { CodeEditor } from './code-editor'
import { getFileIcon } from './file-icons'
import { getLanguage } from './language'
import { readErrorSummary } from '../../utils/read-error.mjs'

export function FileEditor({
  filePath,
  readFile,
  saveFile,
  onClose,
  readOnly,
  draft,
  onDraftChange,
}: {
  filePath: string
  readFile: (path: string) => Promise<string>
  saveFile: (path: string, content: string) => Promise<unknown>
  onClose: () => void
  readOnly: boolean
  draft?: { content: string; originalContent: string }
  onDraftChange: (draft: { content: string; originalContent: string } | null) => void
}) {
  const [content, setContent] = useState(draft?.content ?? '')
  const [originalContent, setOriginalContent] = useState(draft?.originalContent ?? '')
  const [loading, setLoading] = useState(!draft)
  const [saving, setSaving] = useState(false)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; details?: string } | null>(null)

  const [loaded, setLoaded] = useState(Boolean(draft))
  const readFileRef = useRef(readFile)
  readFileRef.current = readFile
  const restoredDraft = useRef(draft)
  const saveInFlight = useRef(false)

  const loadContent = useCallback(async (cancelled?: () => boolean) => {
    setLoading(true)
    setMessage(null)
    try {
      const text = await readFileRef.current(filePath)
      // 切换文件后旧 readFile 晚返回时直接丢弃，避免覆盖新文件内容（及随后 Ctrl+S 写脏数据）
      if (cancelled?.()) return
      setContent(text)
      setOriginalContent(text)
      setLoaded(true)
    } catch (err) {
      if (cancelled?.()) return
      setMessage({ type: 'error', text: readErrorSummary(err, '文件内容'), details: err instanceof Error ? err.message : String(err) })
    } finally {
      if (!cancelled?.()) setLoading(false)
    }
  }, [filePath])

  useEffect(() => {
    if (restoredDraft.current) return
    let cancelled = false
    void loadContent(() => cancelled)
    return () => {
      cancelled = true
    }
  }, [loadContent])

  const handleSave = useCallback(async () => {
    if (readOnly || !loaded || saveInFlight.current) return
    saveInFlight.current = true
    setSaving(true)
    setMessage(null)
    try {
      await saveFile(filePath, content)
      onDraftChange(null)
      setOriginalContent(content)
      setMessage({ type: 'success', text: '已保存' })

    } catch (err) {
      setMessage({ type: 'error', text: '保存失败，未保存修改已保留。请重试。', details: err instanceof Error ? err.message : String(err) })
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }, [filePath, content, readOnly, saveFile, loaded, onDraftChange])

  const dirty = content !== originalContent
  useEffect(() => {
    onDraftChange(dirty ? { content, originalContent } : null)
  }, [content, originalContent, dirty, onDraftChange])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        if (!readOnly && dirty && !saving) void handleSave()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [dirty, saving, handleSave, readOnly])

  const fileName = filePath.split('/').pop() || filePath

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between gap-2 px-3 sm:px-4 py-2 border-b bg-muted/30 min-w-0">
        <div className="flex items-center gap-2 min-w-0">
          {getFileIcon(fileName)}
          <span className="text-sm font-medium truncate" title={filePath}>{filePath}</span>
          {dirty && <Badge variant="secondary" className="text-[10px] px-1.5 py-0 shrink-0">未保存</Badge>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button className="file-control" size="sm" variant="ghost" disabled={saving} onClick={onClose} title="关闭" aria-label="关闭文件">
            <X className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {draft && dirty && <p className="px-4 pt-2 text-xs text-muted-foreground">已恢复本标签页内的未保存修改。刷新或关闭标签页前请保存。</p>}
      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'success'} className="mx-4 mt-2 py-2">
          {message.type === 'error'
            ? <AlertCircle className="h-4 w-4" />
            : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{message.text}{message.details ? <details className="mt-2"><summary className="cursor-pointer">技术详情</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{message.details}</pre></details> : null}</AlertDescription>
        </Alert>
      )}

      <div className="flex-1 min-h-0">
        <CodeEditor
          value={content}
          onChange={setContent}
          language={getLanguage(fileName)}
          readOnly={readOnly || !loaded || saving}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-2 border-t bg-muted/30">
        {!readOnly && <Button className="file-control" size="sm" onClick={() => void handleSave()} disabled={saving || !dirty || !loaded}>
          {saving
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
            : <><Save className="w-4 h-4 mr-1" />保存</>}
        </Button>}
        {!readOnly && dirty && (
          <Button className="file-control" variant="outline" size="sm" disabled={saving} onClick={() => setDiscardOpen(true)}>
            撤销更改
          </Button>
        )}
        <span className="text-xs text-muted-foreground sm:ml-auto basis-full sm:basis-auto">
          {readOnly ? `Demo 只读 · ${content.split('\n').length} 行` : `${content.split('\n').length} 行 · Ctrl+S 保存`}
        </span>
      </div>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="放弃未保存的修改？"
        description={`将恢复 ${filePath} 上次保存的内容。`}
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        variant="destructive"
        onConfirm={() => { setContent(originalContent); setMessage(null) }}
      />
    </div>
  )
}
