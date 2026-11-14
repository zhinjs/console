import { useI18n } from '../i18n'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useEnvFiles } from '@zhin.js/client'
import { getConsoleTransport } from '../utils/console-client'
import { requestConsole } from '../utils/console-rpc'
import {
  KeyRound, AlertCircle, Save, Loader2,
  RefreshCw, FileWarning, Eye, EyeOff, Pencil, Trash2, Plus, Check, X
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { PageHeader } from '../components/PageHeader'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { OpsLoadState } from './ops/load-state'
import { ConfirmDialog } from '../components/confirm-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Skeleton } from '../components/ui/skeleton'
import { StatusState } from '../components/StatusState'
import { Textarea } from '../components/ui/textarea'
import { Input } from '../components/ui/input'
import { createFileDraftSessions, type FileDraft } from './files/draft-session.mjs'
import {
  envEditorAccess, parseEnvRows, maskEnvValue, updateEnvRow, removeEnvRow, appendEnvRow,
  validateEnvRow, diffEnvContent, applyEnvChanges, envReadBackMismatch, type EnvRow, type EnvRowError,
  readEnvReply, maskEnvDisplay, maskedEnvRows, setEnvChange, deleteEnvChange, validateMaskedEnvRow,
  maskedEnvReadBackMismatch, type MaskedEnvView, type MaskedEnvChange, type MaskedEnvRow,
} from './env-editor-model.mjs'
import { readErrorSummary, shouldShowMissingEnv } from '../utils/read-error.mjs'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { useUnsavedChangesGuard } from '../utils/useUnsavedChangesGuard'
import { ApplyFeedback, type ApplyOutcome, type ReadBackMismatch } from '../components/ApplyFeedback'
import { outcomeFromEnvSave } from '../components/apply-outcome-model.mjs'

const envDraftSessions = createFileDraftSessions()
/**
 * Pending per-key changes on masking Hosts, kept while the page is open so switching files keeps
 * them. They hold the values typed in the editor, which can be secrets (including a value that was
 * revealed and then edited), so `EnvManagePage` drops them when the page is left (after the
 * unsaved-changes confirmation). Values shown with 显示 alone stay in the editor component only.
 */
const maskedEnvDraftSessions = createFileDraftSessions()
let unloadGuardInstalled = false
function ensureEnvUnloadGuard() {
  if (unloadGuardInstalled) return
  unloadGuardInstalled = true
  window.addEventListener('beforeunload', (event) => {
    const transport = getConsoleTransport()
    if (!envDraftSessions.hasUnsaved(transport) && !maskedEnvDraftSessions.hasUnsaved(transport)) return
    event.preventDefault()
    event.returnValue = ''
  })
}

type RowEditor = { originalKey: string | null; key: string; value: string; error: EnvRowError | null }
type EditorMessage =
  | { type: 'error'; text: string; details?: string }
  /** A save: what it did (需要重启, env files are read at start) and whether the read-back matches. */
  | { type: 'saved'; outcome: ApplyOutcome; mismatch: ReadBackMismatch | null; unverified: boolean }

function rowErrorText(i18n: ReturnType<typeof useI18n>, error: EnvRowError) {
  switch (error) {
    case 'key-required': return i18n.t("请填写变量名")
    case 'key-invalid': return i18n.t("变量名只能包含字母、数字、下划线、点和连字符")
    case 'key-duplicate': return i18n.t("已存在同名变量")
    case 'value-masked': return i18n.t("值不能是遮罩占位符，请输入真实值")
    case 'value-multiline': return i18n.t("多行值必须用引号包裹")
    case 'value-clear-unconfirmed': return i18n.t("当前值未显示，留空会在保存时清空它。要清空请点「确认清空」，否则输入新值或取消。")
  }
}

function EnvFileEditor({
  filename,
  getFile,
  saveFile,
  exists,
  readOnly,
  draft,
  onDraftChange,
}: {
  filename: string
  getFile: (f: string) => Promise<string>
  saveFile: (f: string, c: string) => Promise<any>
  exists: boolean | undefined
  readOnly: boolean
  draft?: FileDraft
  onDraftChange: (draft: FileDraft | null) => void
}) {
  const i18n = useI18n()
  const [content, setContent] = useState(draft?.content ?? '')
  const [originalContent, setOriginalContent] = useState(draft?.originalContent ?? '')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [revealed, setRevealed] = useState<ReadonlySet<string>>(() => new Set())
  const [editor, setEditor] = useState<RowEditor | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [message, setMessage] = useState<EditorMessage | null>(null)
  const [loaded, setLoaded] = useState(Boolean(draft))
  const getFileRef = useRef(getFile)
  getFileRef.current = getFile
  const restoredDraft = useRef(draft)
  const saveInFlight = useRef(false)

  const messages = useRef(i18n)
  messages.current = i18n

  const loadContent = useCallback(async (cancelled?: () => boolean) => {
    setLoading(true)
    setMessage(null)
    try {
      const text = await getFileRef.current(filename)
      if (cancelled?.()) return
      setContent(text)
      setOriginalContent(text)
      setRevealed(new Set())
      setEditor(null)
      setLoaded(true)
    } catch (err) {
      if (!cancelled?.()) setMessage({ type: 'error', text: readErrorSummary(err, messages.current.t("环境变量文件"), messages.current.locale), details: err instanceof Error ? err.message : String(err) })
    } finally {
      if (!cancelled?.()) setLoading(false)
    }
  }, [filename])

  useEffect(() => {
    if (restoredDraft.current) return
    let cancelled = false
    void loadContent(() => cancelled)
    return () => { cancelled = true }
  }, [loadContent])

  const dirty = content !== originalContent
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty
  // After 立即重启: show the file as the restarted Host holds it, unless a new draft was started meanwhile.
  const refreshAfterRestart = async () => {
    const text = await getFileRef.current(filename)
    if (dirtyRef.current) return
    setContent(text)
    setOriginalContent(text)
  }
  const access = envEditorAccess({ loaded, readOnly, saving, dirty, editing: editor !== null })

  const handleSave = async () => {
    if (!access.canSave || saveInFlight.current) return
    saveInFlight.current = true
    setSaving(true)
    setMessage(null)
    try {
      // The Host only accepts whole files: re-read it and change only the edited keys, so lines
      // nobody touched (including secrets that were never revealed) are written back as read.
      const changes = diffEnvContent(originalContent, content)
      const latest = await getFile(filename)
      const next = applyEnvChanges(latest, changes)
      await saveFile(filename, next)
      onDraftChange(null)
      // Read the file back: what the Host now holds must be what was written.
      let readBack: string | null = null
      try { readBack = await getFile(filename) } catch { readBack = null }
      const stored = readBack ?? next
      setContent(stored)
      setOriginalContent(stored)
      setRevealed(new Set())
      setMessage({ type: 'saved', outcome: outcomeFromEnvSave(), mismatch: readBack === null ? null : envReadBackMismatch(next, readBack), unverified: readBack === null })
    } catch (err) {
      setMessage({ type: 'error', text: i18n.t("保存失败；未保存修改已保留，请重试。"), details: err instanceof Error ? err.message : String(err) })
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  useEffect(() => {
    onDraftChange(dirty ? { content, originalContent } : null)
  }, [dirty, content, originalContent, onDraftChange])

  const rows = parseEnvRows(content)
  const toggleReveal = (key: string) => setRevealed(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })
  const startEdit = (row: EnvRow | null) => {
    if (!access.canEdit) return
    setEditor(row ? { originalKey: row.key, key: row.key, value: row.value, error: null } : { originalKey: null, key: '', value: '', error: null })
    setMessage(null)
  }
  const applyEdit = () => {
    if (!editor || !access.canEdit) return
    const next = { key: editor.key.trim(), value: editor.value }
    const error = validateEnvRow(content, next, editor.originalKey)
    if (error) { setEditor({ ...editor, error }); return }
    setContent(editor.originalKey === null ? appendEnvRow(content, next) : updateEnvRow(content, editor.originalKey, next))
    // The edited value goes back behind its mask once the row is closed.
    setRevealed(prev => { const out = new Set(prev); if (editor.originalKey !== null) out.delete(editor.originalKey); out.delete(next.key); return out })
    setEditor(null)
  }
  const removeRow = (key: string) => {
    if (!access.canEdit) return
    setContent(removeEnvRow(content, key))
    setRevealed(prev => { const out = new Set(prev); out.delete(key); return out })
    if (editor?.originalKey === key) setEditor(null)
    setMessage(null)
  }

  if (loading && !loaded) {
    return (
      <StatusState kind="loading" compact title={i18n.t("加载中...")} onRetry={() => void loadContent()} />
    )
  }

  const editorRow = (originalKey: string | null) => editor && editor.originalKey === originalKey ? (
    <li key={originalKey ?? '\u0000new'} className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <Input
          value={editor.key}
          aria-label={i18n.t("变量名")}
          placeholder="KEY"
          className="font-mono text-sm"
          spellCheck={false}
          autoComplete="off"
          onChange={e => setEditor({ ...editor, key: e.target.value, error: null })}
        />
        <Textarea
          value={editor.value}
          aria-label={originalKey === null ? i18n.t("新变量的值") : i18n.t("{0} 的值", [originalKey])}
          placeholder="VALUE"
          className="font-mono text-sm min-h-[2.5rem] resize-y"
          rows={editor.value.includes('\n') ? 4 : 1}
          spellCheck={false}
          autoComplete="off"
          onChange={e => setEditor({ ...editor, value: e.target.value, error: null })}
        />
      </div>
      {editor.error ? <p role="alert" className="text-xs text-destructive">{rowErrorText(i18n, editor.error)}</p> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" onClick={applyEdit}><Check className="w-4 h-4 mr-1" />{i18n.t("应用")}</Button>
        <Button size="sm" variant="ghost" onClick={() => setEditor(null)}><X className="w-4 h-4 mr-1" />{i18n.t("取消")}</Button>
      </div>
    </li>
  ) : null

  return (
    <div className="space-y-3">
      {shouldShowMissingEnv({ loaded, exists, dirty, readFailed: message?.type === 'error' }) && (
        <Alert className="py-2 border-warning/50 text-warning">
          <FileWarning className="h-4 w-4" />
          <AlertDescription>{readOnly ? i18n.t("文件不存在") : i18n.t("文件不存在，保存后将自动创建")}</AlertDescription>
        </Alert>
      )}

      {message?.type === 'error' && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {message.text}
            {message.details ? <details className="mt-2"><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{message.details}</pre></details> : null}
          </AlertDescription>
        </Alert>
      )}

      {!loaded && !loading ? <Button variant="outline" size="sm" onClick={() => void loadContent()}>{i18n.t("重试读取")}</Button> : null}
      {dirty ? <p className="text-xs text-muted-foreground">{i18n.t("未保存修改只在本标签页内保留；切换页面或文件可恢复，刷新前请保存。")}</p> : null}
      {loaded ? (
        <ul className="space-y-2" aria-label={i18n.t("{0} 中的变量", [filename])}>
          {rows.length === 0 && !editor ? <li><StatusState kind="empty" compact title={i18n.t("还没有变量")}
            description={readOnly ? i18n.t("这个文件里还没有 KEY=VALUE 行。") : i18n.t("新增变量后保存，重启 Host 后生效。")}
            actions={!readOnly ? <Button size="sm" variant="outline" disabled={!access.canEdit} onClick={() => startEdit(null)}><Plus className="w-4 h-4 mr-1" />{i18n.t("新增变量")}</Button> : undefined} /></li> : null}
          {rows.map(row => {
            const opened = editorRow(row.key)
            if (opened) return opened
            const shown = row.secret && (readOnly || !revealed.has(row.key)) ? maskEnvValue(row.value) : row.value
            return (
              <li key={row.key} className="flex items-start gap-2 rounded-md border border-border/70 px-3 py-2">
                <div className="min-w-0 flex-1 font-mono text-sm">
                  <span className="font-semibold">{row.key}</span>
                  <span className="text-muted-foreground">=</span>
                  <span className="whitespace-pre-wrap break-all">{shown}</span>
                </div>
                {!readOnly && row.secret ? (
                  <Button variant="ghost" size="sm" disabled={saving} onClick={() => toggleReveal(row.key)}
                    aria-label={revealed.has(row.key) ? i18n.t("隐藏 {0} 的值", [row.key]) : i18n.t("显示 {0} 的值", [row.key])}
                    title={revealed.has(row.key) ? i18n.t("隐藏 {0} 的值", [row.key]) : i18n.t("显示 {0} 的值", [row.key])}>
                    {revealed.has(row.key) ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                ) : null}
                {!readOnly ? <>
                  <Button variant="ghost" size="sm" disabled={!access.canEdit || editor !== null} onClick={() => startEdit(row)}
                    aria-label={i18n.t("编辑 {0}", [row.key])} title={i18n.t("编辑 {0}", [row.key])}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!access.canEdit || editor !== null} onClick={() => removeRow(row.key)}
                    aria-label={i18n.t("删除 {0}", [row.key])} title={i18n.t("删除 {0}", [row.key])}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </> : null}
              </li>
            )
          })}
          {editorRow(null)}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && <Button size="sm" onClick={handleSave} disabled={!access.canSave}>
          {saving
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />{i18n.t("保存中...")}</>
            : <><Save className="w-4 h-4 mr-1" />{i18n.t("保存")}</>}
        </Button>}
        {!readOnly && loaded && (
          <Button variant="outline" size="sm" disabled={!access.canEdit || editor !== null} onClick={() => startEdit(null)}>
            <Plus className="w-4 h-4 mr-1" />{i18n.t("新增变量")}</Button>
        )}
        {!readOnly && dirty && (
          <Button variant="outline" size="sm" disabled={saving} onClick={() => setDiscardOpen(true)}>
            {i18n.t("撤销")}</Button>
        )}
        {readOnly && <span className="text-xs text-muted-foreground">{i18n.t("只读 · 敏感值始终遮罩")}</span>}
        {editor && <span className="text-xs text-muted-foreground">{i18n.t("先应用或取消正在编辑的行再保存")}</span>}
        {dirty && <span className="text-xs text-muted-foreground">{i18n.t("有未保存的更改")}</span>}
      </div>
      {message?.type === 'saved' ? <ApplyFeedback outcome={message.outcome} mismatch={message.mismatch} unverified={message.unverified}
        onRestarted={refreshAfterRestart} /> : null}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={i18n.t("放弃未保存的修改？")}
        description={i18n.t("将恢复 {0} 上次保存的内容。", [filename])}
        confirmLabel={i18n.t("放弃修改")}
        cancelLabel={i18n.t("继续编辑")}
        variant="destructive"
        onConfirm={() => { setContent(originalContent); setEditor(null); setRevealed(new Set()); setMessage(null) }}
      />
    </div>
  )
}

type EnvRequest = <T>(request: { readonly type: string; readonly [key: string]: unknown }) => Promise<T>
type MaskedDraft = { changes: MaskedEnvChange[] }

/**
 * Masking Hosts (zhinjs/zhin#1250): `env:get` only gives masks; 显示 fetches one value with
 * `env:reveal` (audited) and keeps it in this component only, so it is gone once the page closes;
 * 保存 submits the changed keys (`env:save { changes }`), never the file.
 */
function MaskedEnvFileEditor({
  filename,
  readOnly,
  canReveal,
  draft,
  onDraftChange,
  onLegacyHost,
  request = requestConsole as EnvRequest,
}: {
  filename: string
  readOnly: boolean
  canReveal: boolean
  draft?: MaskedDraft
  onDraftChange: (draft: MaskedDraft | null) => void
  /** The Host answered `env:get` the old way (`{ content }`): show the legacy editor instead. */
  onLegacyHost: () => void
  request?: EnvRequest
}) {
  const i18n = useI18n()
  const [view, setView] = useState<MaskedEnvView | null>(null)
  const [changes, setChanges] = useState<MaskedEnvChange[]>(() => draft?.changes ?? [])
  const [revealed, setRevealed] = useState<ReadonlyMap<string, string>>(() => new Map())
  const [shownPending, setShownPending] = useState<ReadonlySet<string>>(() => new Set())
  const [revealing, setRevealing] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editor, setEditor] = useState<RowEditor | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [message, setMessage] = useState<EditorMessage | null>(null)
  const requestRef = useRef(request)
  requestRef.current = request
  const legacyRef = useRef(onLegacyHost)
  legacyRef.current = onLegacyHost
  const messages = useRef(i18n)
  messages.current = i18n
  const saveInFlight = useRef(false)

  const loadView = useCallback(async (cancelled?: () => boolean) => {
    setLoading(true)
    setMessage(null)
    try {
      const reply = readEnvReply(await requestRef.current<unknown>({ type: 'env:get', filename }))
      if (cancelled?.()) return
      if (reply.kind === 'legacy') { legacyRef.current(); return }
      setView(reply.view)
      setRevealed(new Map())
      setShownPending(new Set())
      setEditor(null)
    } catch (err) {
      if (!cancelled?.()) setMessage({ type: 'error', text: readErrorSummary(err, messages.current.t("环境变量文件"), messages.current.locale), details: err instanceof Error ? err.message : String(err) })
    } finally {
      if (!cancelled?.()) setLoading(false)
    }
  }, [filename])

  useEffect(() => {
    let cancelled = false
    void loadView(() => cancelled)
    return () => { cancelled = true }
  }, [loadView])

  const dirty = changes.length > 0
  useEffect(() => {
    onDraftChange(dirty ? { changes } : null)
  }, [dirty, changes, onDraftChange])

  const loaded = view !== null
  const access = envEditorAccess({ loaded, readOnly, saving, dirty, editing: editor !== null })

  const reveal = async (key: string) => {
    if (!canReveal || revealing) return
    setRevealing(key)
    setMessage(null)
    try {
      const data = await requestRef.current<{ value?: unknown }>({ type: 'env:reveal', filename, key })
      setRevealed(prev => new Map(prev).set(key, typeof data?.value === 'string' ? data.value : ''))
    } catch (err) {
      setMessage({ type: 'error', text: i18n.t("显示失败：需要 ops.env.read 与 ops.env.write 权限，或变量已被移除。"), details: err instanceof Error ? err.message : String(err) })
    } finally {
      setRevealing(null)
    }
  }
  const hide = (key: string) => {
    setRevealed(prev => { const next = new Map(prev); next.delete(key); return next })
    setShownPending(prev => { const next = new Set(prev); next.delete(key); return next })
  }

  const startEdit = (row: MaskedEnvRow | null) => {
    if (!access.canEdit) return
    setEditor(row
      ? { originalKey: row.key, key: row.key, value: row.pending ?? revealed.get(row.key) ?? '', error: null }
      : { originalKey: null, key: '', value: '', error: null })
    setMessage(null)
  }
  const applyEdit = (confirmClear = false) => {
    if (!editor || !view || !access.canEdit) return
    const next = { key: editor.originalKey ?? editor.key.trim(), value: editor.value }
    const shown = editor.originalKey !== null && revealed.has(editor.originalKey)
    const error = validateMaskedEnvRow(view, changes, next, editor.originalKey, { revealed: shown, confirmClear })
    if (error) { setEditor({ ...editor, error }); return }
    setChanges(setEnvChange(changes, next.key, next.value))
    hide(next.key)
    setEditor(null)
  }
  const removeRow = (key: string) => {
    if (!view || !access.canEdit) return
    setChanges(deleteEnvChange(view, changes, key))
    hide(key)
    if (editor?.originalKey === key) setEditor(null)
    setMessage(null)
  }

  const handleSave = async () => {
    if (!access.canSave || saveInFlight.current) return
    saveInFlight.current = true
    setSaving(true)
    setMessage(null)
    const submitted = changes
    try {
      // Only the changed keys: every other line stays as it is on the Host, secrets included.
      await requestRef.current({ type: 'env:save', filename, changes: submitted })
      setChanges([])
      onDraftChange(null)
      let stored: MaskedEnvView | null = null
      try {
        const reply = readEnvReply(await requestRef.current<unknown>({ type: 'env:get', filename }))
        stored = reply.kind === 'masked' ? reply.view : null
      } catch { stored = null }
      if (stored) setView(stored)
      setRevealed(new Map())
      setShownPending(new Set())
      setMessage({ type: 'saved', outcome: outcomeFromEnvSave(), mismatch: stored ? maskedEnvReadBackMismatch(submitted, stored) : null, unverified: stored === null })
    } catch (err) {
      setMessage({ type: 'error', text: i18n.t("保存失败；未保存修改已保留，请重试。"), details: err instanceof Error ? err.message : String(err) })
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }
  const refreshAfterRestart = async () => {
    if (changes.length) return
    await loadView()
  }

  if (loading && !loaded) {
    return <StatusState kind="loading" compact title={i18n.t("加载中...")} onRetry={() => void loadView()} />
  }

  const rows = view ? maskedEnvRows(view, changes) : []
  const editorRow = (originalKey: string | null) => editor && editor.originalKey === originalKey ? (
    <li key={originalKey ?? '\u0000new'} className="space-y-2 rounded-md border border-primary/40 bg-muted/30 p-3">
      <div className="grid gap-2 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
        <Input
          value={editor.key}
          aria-label={i18n.t("变量名")}
          placeholder="KEY"
          className="font-mono text-sm"
          spellCheck={false}
          autoComplete="off"
          disabled={originalKey !== null}
          onChange={e => setEditor({ ...editor, key: e.target.value, error: null })}
        />
        <Textarea
          value={editor.value}
          aria-label={originalKey === null ? i18n.t("新变量的值") : i18n.t("{0} 的值", [originalKey])}
          placeholder={originalKey !== null && !revealed.has(originalKey) ? i18n.t("输入新值（当前值未显示）") : 'VALUE'}
          className="font-mono text-sm min-h-[2.5rem] resize-y"
          rows={editor.value.includes('\n') ? 4 : 1}
          spellCheck={false}
          autoComplete="off"
          onChange={e => setEditor({ ...editor, value: e.target.value, error: null })}
        />
      </div>
      {editor.error ? <p role="alert" className="text-xs text-destructive">{rowErrorText(i18n, editor.error)}</p> : null}
      <div className="flex items-center gap-2">
        <Button size="sm" variant="secondary" disabled={editor.error === 'value-clear-unconfirmed'} onClick={() => applyEdit()}><Check className="w-4 h-4 mr-1" />{i18n.t("应用")}</Button>
        {editor.error === 'value-clear-unconfirmed' ? (
          <Button size="sm" variant="destructive" onClick={() => applyEdit(true)}><Trash2 className="w-4 h-4 mr-1" />{i18n.t("确认清空")}</Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={() => setEditor(null)}><X className="w-4 h-4 mr-1" />{i18n.t("取消")}</Button>
      </div>
    </li>
  ) : null

  const shownValue = (row: MaskedEnvRow) => {
    if (row.pending !== undefined) return shownPending.has(row.key) ? row.pending : maskEnvDisplay(row.pending)
    if (revealed.has(row.key)) return revealed.get(row.key)!
    return row.hasValue ? row.masked : ''
  }
  const isShown = (row: MaskedEnvRow) => row.pending !== undefined ? shownPending.has(row.key) : revealed.has(row.key)
  const toggle = (row: MaskedEnvRow) => {
    if (isShown(row)) { hide(row.key); return }
    if (row.pending !== undefined) { setShownPending(prev => new Set(prev).add(row.key)); return }
    void reveal(row.key)
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">{i18n.t("为保护密钥，值默认打码（不足 16 个字符全部打码，更长的值只显示前 2 位与后 2 位；掩码宽度固定，不显示长度）。「显示」会单独取回一个变量的原文并记入审计日志；保存只提交改动的变量。")}</p>
      {message?.type === 'error' && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {message.text}
            {message.details ? <details className="mt-2"><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{message.details}</pre></details> : null}
          </AlertDescription>
        </Alert>
      )}
      {!loaded && !loading ? <Button variant="outline" size="sm" onClick={() => void loadView()}>{i18n.t("重试读取")}</Button> : null}
      {dirty ? <p className="text-xs text-muted-foreground">{i18n.t("未保存修改在切换文件时保留；离开本页前会先确认，离开后丢弃（其中可能有密钥）。刷新前请保存。")}</p> : null}
      {loaded ? (
        <ul className="space-y-2" aria-label={i18n.t("{0} 中的变量", [filename])}>
          {rows.length === 0 && !editor ? <li><StatusState kind="empty" compact title={i18n.t("还没有变量")}
            description={readOnly ? i18n.t("这个文件里还没有 KEY=VALUE 行。") : i18n.t("新增变量后保存，重启 Host 后生效。")}
            actions={!readOnly ? <Button size="sm" variant="outline" disabled={!access.canEdit} onClick={() => startEdit(null)}><Plus className="w-4 h-4 mr-1" />{i18n.t("新增变量")}</Button> : undefined} /></li> : null}
          {rows.map(row => {
            const opened = editorRow(row.key)
            if (opened) return opened
            const shown = isShown(row)
            return (
              <li key={row.key} className="flex items-start gap-2 rounded-md border border-border/70 px-3 py-2">
                <div className="min-w-0 flex-1 font-mono text-sm">
                  <span className="font-semibold">{row.key}</span>
                  <span className="text-muted-foreground">=</span>
                  <span className="whitespace-pre-wrap break-all">{shownValue(row)}</span>
                  {!row.hasValue && row.pending === undefined ? <span className="ml-2 text-xs text-muted-foreground">{i18n.t("（空）")}</span> : null}
                  {row.isReference && row.pending === undefined ? <Badge variant="outline" size="sm" className="ml-2">{i18n.t("引用")}</Badge> : null}
                  {row.pending !== undefined ? <Badge variant="outline" size="sm" className="ml-2">{row.added ? i18n.t("新增，未保存") : i18n.t("已修改，未保存")}</Badge> : null}
                </div>
                {!readOnly && canReveal && (row.hasValue || row.pending !== undefined) ? (
                  <Button variant="ghost" size="sm" disabled={saving || revealing !== null} onClick={() => toggle(row)}
                    aria-label={shown ? i18n.t("隐藏 {0} 的值", [row.key]) : i18n.t("显示 {0} 的值", [row.key])}
                    title={shown ? i18n.t("隐藏 {0} 的值", [row.key]) : i18n.t("显示 {0} 的值", [row.key])}>
                    {revealing === row.key ? <Loader2 className="w-4 h-4 animate-spin" /> : shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </Button>
                ) : null}
                {!readOnly ? <>
                  <Button variant="ghost" size="sm" disabled={!access.canEdit || editor !== null} onClick={() => startEdit(row)}
                    aria-label={i18n.t("编辑 {0}", [row.key])} title={i18n.t("编辑 {0}", [row.key])}>
                    <Pencil className="w-4 h-4" />
                  </Button>
                  <Button variant="ghost" size="sm" disabled={!access.canEdit || editor !== null} onClick={() => removeRow(row.key)}
                    aria-label={i18n.t("删除 {0}", [row.key])} title={i18n.t("删除 {0}", [row.key])}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </> : null}
              </li>
            )
          })}
          {editorRow(null)}
        </ul>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {!readOnly && <Button size="sm" onClick={handleSave} disabled={!access.canSave}>
          {saving
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />{i18n.t("保存中...")}</>
            : <><Save className="w-4 h-4 mr-1" />{i18n.t("保存")}</>}
        </Button>}
        {!readOnly && loaded && (
          <Button variant="outline" size="sm" disabled={!access.canEdit || editor !== null} onClick={() => startEdit(null)}>
            <Plus className="w-4 h-4 mr-1" />{i18n.t("新增变量")}</Button>
        )}
        {!readOnly && dirty && (
          <Button variant="outline" size="sm" disabled={saving} onClick={() => setDiscardOpen(true)}>
            {i18n.t("撤销")}</Button>
        )}
        {readOnly && <span className="text-xs text-muted-foreground">{i18n.t("只读 · 值始终打码")}</span>}
        {editor && <span className="text-xs text-muted-foreground">{i18n.t("先应用或取消正在编辑的行再保存")}</span>}
        {dirty && <span className="text-xs text-muted-foreground">{i18n.t("有未保存的更改")}</span>}
      </div>
      {message?.type === 'saved' ? <ApplyFeedback outcome={message.outcome} mismatch={message.mismatch} unverified={message.unverified}
        onRestarted={refreshAfterRestart} /> : null}
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title={i18n.t("放弃未保存的修改？")}
        description={i18n.t("将恢复 {0} 上次保存的内容。", [filename])}
        confirmLabel={i18n.t("放弃修改")}
        cancelLabel={i18n.t("继续编辑")}
        variant="destructive"
        onConfirm={() => { setChanges([]); setEditor(null); setShownPending(new Set()); setMessage(null) }}
      />
    </div>
  )
}

/** Masked editor first; switches to the legacy (plain-text) editor when the Host predates masking. */
function EnvFileTab({
  filename, getFile, saveFile, exists, readOnly, canReveal, legacyDraft, maskedDraft, onLegacyDraftChange, onMaskedDraftChange, request,
}: {
  filename: string
  getFile: (f: string) => Promise<string>
  saveFile: (f: string, c: string) => Promise<any>
  exists: boolean | undefined
  readOnly: boolean
  canReveal: boolean
  legacyDraft?: FileDraft
  maskedDraft?: MaskedDraft
  onLegacyDraftChange: (draft: FileDraft | null) => void
  onMaskedDraftChange: (draft: MaskedDraft | null) => void
  request?: EnvRequest
}) {
  const i18n = useI18n()
  const [legacy, setLegacy] = useState(Boolean(legacyDraft))
  if (legacy) {
    return (
      <div className="space-y-3">
        <Alert className="py-2 border-warning/50 text-warning">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{i18n.t("当前 Host 版本会显示原文：页面拿到的是 .env 的全部内容（敏感值只在本页遮罩）。升级 Host 后默认只返回打码值。")}</AlertDescription>
        </Alert>
        <EnvFileEditor filename={filename} getFile={getFile} saveFile={saveFile} exists={exists} readOnly={readOnly} draft={legacyDraft} onDraftChange={onLegacyDraftChange} />
      </div>
    )
  }
  return <MaskedEnvFileEditor filename={filename} readOnly={readOnly} canReveal={canReveal} draft={maskedDraft}
    onDraftChange={onMaskedDraftChange} onLegacyHost={() => setLegacy(true)} {...(request ? { request } : {})} />
}

export default function EnvManagePage() {
  const i18n = useI18n()
  const readOnly = !hasConsolePermission('ops.env.write')
  // Showing a value as written needs both env permissions on masking Hosts (zhinjs/zhin#1250).
  const canReveal = !readOnly && hasConsolePermission('ops.env.read')
  const { files, loading, error, listFiles, getFile, saveFile } = useEnvFiles()
  ensureEnvUnloadGuard()
  const session = envDraftSessions.get(getConsoleTransport())
  const maskedSession = maskedEnvDraftSessions.get(getConsoleTransport())
  const [activeTab, setActiveTab] = useState(session.selected ?? '.env')
  const updateDraft = useCallback((draft: FileDraft | null) => {
    if (draft) session.drafts.set(activeTab, draft)
    else session.drafts.delete(activeTab)
  }, [session, activeTab])
  const [maskedDirty, setMaskedDirty] = useState(() => maskedSession.drafts.size > 0)
  const updateMaskedDraft = useCallback((draft: MaskedDraft | null) => {
    if (draft) maskedSession.drafts.set(activeTab, draft as unknown as FileDraft)
    else maskedSession.drafts.delete(activeTab)
    setMaskedDirty(maskedSession.drafts.size > 0)
  }, [maskedSession, activeTab])
  // Pending values on masking Hosts can be secrets: confirm before leaving, then drop them.
  const leaveGuard = useUnsavedChangesGuard(maskedDirty)
  useEffect(() => () => { maskedSession.drafts.clear() }, [maskedSession])
  const selectTab = (tab: string) => { session.selected = tab; setActiveTab(tab) }
  const saveAndRefresh = useCallback(async (filename: string, content: string) => {
    await saveFile(filename, content)
    // A list refresh failure must not turn a completed write into a failed save.
    try { await listFiles() } catch { /* the hook displays the list error */ }
  }, [saveFile, listFiles])

  const handleRefresh = async () => {
    try {
      await listFiles()
    } catch {
      // hook will set error state
    }
  }

  if (loading && files.length === 0) {
    return (
      <div className="space-y-6">
        <PageHeader title={i18n.t("环境变量")} description={i18n.t("加载文件列表…")} />
        <StatusState kind="loading" onRetry={handleRefresh} placeholder={<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>} />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {leaveGuard}
      <PageHeader
        title={i18n.t("环境变量")}
        description={readOnly ? i18n.t("查看 .env / .env.* 中的变量；只读，值始终打码。") : i18n.t("值默认打码，可逐个显示（记入审计）或编辑；保存只写入改动的变量，需重启 Host 后生效。")}
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {i18n.t("刷新")}</Button>
        }
      />

      {error && (
        <OpsLoadState error={error} resource={i18n.t("环境变量文件列表")} permissions={['ops.env.read']} onRetry={handleRefresh} />
      )}

      <Tabs value={activeTab} onValueChange={selectTab} className="space-y-4">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-muted/40 p-1">
          {['.env', '.env.development', '.env.production'].map(name => {
            const fileInfo = files.find(f => f.name === name)
            return (
              <TabsTrigger key={name} value={name} className="gap-1.5 data-[state=active]:shadow-sm">
                <KeyRound className="w-3.5 h-3.5" />
                {name}
                {fileInfo && !fileInfo.exists && (
                  <Badge variant="outline" size="sm" className="ml-1">{i18n.t("新")}</Badge>
                )}
              </TabsTrigger>
            )
          })}
        </TabsList>

        {['.env', '.env.development', '.env.production'].map(name => (
          <TabsContent key={name} value={name} className="mt-0">
            <Card className="border-border/80 shadow-sm">
              <CardHeader className="pb-2">
                <CardTitle className="text-base font-semibold">{name}</CardTitle>
                <CardDescription>
                  {i18n.t("格式 ")}<code className="rounded bg-muted px-1 py-0.5 text-xs">KEY=VALUE</code>
                  {i18n.t("，支持带引号的多行值。")}</CardDescription>
              </CardHeader>
              <CardContent>
                <EnvFileTab
                  filename={name}
                  getFile={getFile}
                  saveFile={saveAndRefresh}
                  exists={files.find(f => f.name === name)?.exists}
                  readOnly={readOnly}
                  canReveal={canReveal}
                  legacyDraft={session.drafts.get(name)}
                  maskedDraft={maskedSession.drafts.get(name) as unknown as MaskedDraft | undefined}
                  onLegacyDraftChange={updateDraft}
                  onMaskedDraftChange={updateMaskedDraft}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
