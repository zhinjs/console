import { useI18n } from '../i18n'
import { useState, useEffect, useCallback, useRef } from 'react'
import { useEnvFiles } from '@zhin.js/client'
import { getConsoleTransport } from '../utils/console-client'
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
} from './env-editor-model.mjs'
import { readErrorSummary, shouldShowMissingEnv } from '../utils/read-error.mjs'
import { hasConsolePermission } from '../utils/console-access.mjs'
import { ApplyFeedback, type ApplyOutcome, type ReadBackMismatch } from '../components/ApplyFeedback'
import { outcomeFromEnvSave } from '../components/apply-outcome-model.mjs'

const envDraftSessions = createFileDraftSessions()
let unloadGuardInstalled = false
function ensureEnvUnloadGuard() {
  if (unloadGuardInstalled) return
  unloadGuardInstalled = true
  window.addEventListener('beforeunload', (event) => {
    if (!envDraftSessions.hasUnsaved(getConsoleTransport())) return
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

export default function EnvManagePage() {
  const i18n = useI18n()
  const readOnly = !hasConsolePermission('ops.env.write')
  const { files, loading, error, listFiles, getFile, saveFile } = useEnvFiles()
  ensureEnvUnloadGuard()
  const session = envDraftSessions.get(getConsoleTransport())
  const [activeTab, setActiveTab] = useState(session.selected ?? '.env')
  const updateDraft = useCallback((draft: FileDraft | null) => {
    if (draft) session.drafts.set(activeTab, draft)
    else session.drafts.delete(activeTab)
  }, [session, activeTab])
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
      <PageHeader
        title={i18n.t("环境变量")}
        description={readOnly ? i18n.t("查看 .env / .env.* 中的键值；只读且敏感值不可揭示。") : i18n.t("敏感值默认遮罩，可逐行显示或编辑；保存只写入改动的变量，需重启 Host 后生效。")}
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
                <EnvFileEditor
                  filename={name}
                  getFile={getFile}
                  saveFile={saveAndRefresh}
                  exists={files.find(f => f.name === name)?.exists}
                  readOnly={readOnly}
                  draft={session.drafts.get(name)}
                  onDraftChange={updateDraft}
                />
              </CardContent>
            </Card>
          </TabsContent>
        ))}
      </Tabs>
    </div>
  )
}
