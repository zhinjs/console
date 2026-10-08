import { useState, useEffect, useCallback, useRef } from 'react'
import { useEnvFiles, getWebSocketManager } from '@zhin.js/client'
import {
  KeyRound, AlertCircle, CheckCircle, Save, Loader2,
  RefreshCw, FileWarning, Eye, EyeOff
} from 'lucide-react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card'
import { PageHeader } from '../components/PageHeader'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { ErrorAlert } from '../components/error-alert'
import { ConfirmDialog } from '../components/confirm-dialog'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Skeleton } from '../components/ui/skeleton'
import { Textarea } from '../components/ui/textarea'
import { createFileDraftSessions, type FileDraft } from './files/draft-session.mjs'
import { maskEnvContent, envEditorAccess } from './env-editor-model.mjs'
import { readErrorSummary, shouldShowMissingEnv } from '../utils/read-error.mjs'
import { isDemoMode } from '../utils/demo-mode'

const envDraftSessions = createFileDraftSessions()
let unloadGuardInstalled = false
function ensureEnvUnloadGuard() {
  if (unloadGuardInstalled) return
  unloadGuardInstalled = true
  window.addEventListener('beforeunload', (event) => {
    if (!envDraftSessions.hasUnsaved(getWebSocketManager())) return
    event.preventDefault()
    event.returnValue = ''
  })
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
  const [content, setContent] = useState(draft?.content ?? '')
  const [originalContent, setOriginalContent] = useState(draft?.originalContent ?? '')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [masked, setMasked] = useState(true)
  const [discardOpen, setDiscardOpen] = useState(false)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string; details?: string } | null>(null)
  const [loaded, setLoaded] = useState(Boolean(draft))
  const getFileRef = useRef(getFile)
  getFileRef.current = getFile
  const restoredDraft = useRef(draft)
  const saveInFlight = useRef(false)

  const loadContent = useCallback(async (cancelled?: () => boolean) => {
    setLoading(true)
    setMessage(null)
    try {
      const text = await getFileRef.current(filename)
      if (cancelled?.()) return
      setContent(text)
      setOriginalContent(text)
      setLoaded(true)
    } catch (err) {
      if (!cancelled?.()) setMessage({ type: 'error', text: readErrorSummary(err, '环境变量文件'), details: err instanceof Error ? err.message : String(err) })
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

  const handleSave = async () => {
    if (!loaded || readOnly || saving || saveInFlight.current || content === originalContent) return
    saveInFlight.current = true
    setSaving(true)
    setMessage(null)
    try {
      await saveFile(filename, content)
      onDraftChange(null)
      setOriginalContent(content)
      setMessage({ type: 'success', text: '已保存，需重启生效' })
    } catch (err) {
      setMessage({ type: 'error', text: '保存失败；未保存修改已保留，请重试。', details: err instanceof Error ? err.message : String(err) })
    } finally {
      saveInFlight.current = false
      setSaving(false)
    }
  }

  const dirty = content !== originalContent

  useEffect(() => {
    onDraftChange(dirty ? { content, originalContent } : null)
  }, [dirty, content, originalContent, onDraftChange])
  const access = envEditorAccess({ loaded, readOnly, saving, masked, dirty })
  const displayContent = masked || readOnly ? maskEnvContent(content) : content

  if (loading && !loaded) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        <span className="ml-2 text-sm text-muted-foreground">加载中...</span>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {shouldShowMissingEnv({ loaded, exists, dirty, readFailed: message?.type === 'error' }) && (
        <Alert className="py-2 border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
          <FileWarning className="h-4 w-4" />
          <AlertDescription>{readOnly ? '文件不存在' : '文件不存在，保存后将自动创建'}</AlertDescription>
        </Alert>
      )}

      {message && (
        <Alert variant={message.type === 'error' ? 'destructive' : 'success'} className="py-2">
          {message.type === 'error'
            ? <AlertCircle className="h-4 w-4" />
            : <CheckCircle className="h-4 w-4" />}
          <AlertDescription>{message.text}{message.details ? <details className="mt-2"><summary className="cursor-pointer">技术详情</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{message.details}</pre></details> : null}</AlertDescription>
        </Alert>
      )}

      {!loaded && !loading ? <Button variant="outline" size="sm" onClick={() => void loadContent()}>重试读取</Button> : null}
      {dirty ? <p className="text-xs text-muted-foreground">未保存修改只在本标签页内保留；切换页面或文件可恢复，刷新前请保存。</p> : null}
      <div className="relative">
        <Textarea
          value={displayContent}
          readOnly={!access.canEdit}
          aria-label={`${filename} 环境变量${readOnly ? '（只读且已遮罩）' : ''}`}
          onChange={e => { if (access.canEdit) { setContent(e.target.value); setMessage(null) } }}
          className="font-mono text-sm min-h-[350px] resize-y"
          placeholder="KEY=VALUE"
          spellCheck={false}
        />
      </div>

      <div className="flex items-center gap-2">
        {!readOnly && <Button size="sm" onClick={handleSave} disabled={!access.canSave}>
          {saving
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
            : <><Save className="w-4 h-4 mr-1" />保存</>}
        </Button>}
        {!readOnly && dirty && (
          <Button variant="outline" size="sm" disabled={saving} onClick={() => setDiscardOpen(true)}>
            撤销
          </Button>
        )}
        {!readOnly && <Button
          variant="ghost"
          size="sm"
          onClick={() => setMasked(prev => !prev)}
          disabled={!loaded || saving}
          title={masked ? '显示敏感值并编辑' : '隐藏敏感值'}
          aria-label={masked ? '显示敏感值并编辑' : '隐藏敏感值'}
        >
          {masked ? <><Eye className="w-4 h-4 mr-1" />显示敏感值并编辑</> : <><EyeOff className="w-4 h-4 mr-1" />隐藏敏感值</>}
        </Button>}
        {readOnly && <span className="text-xs text-muted-foreground">Demo 只读 · 敏感值始终遮罩</span>}
        {dirty && <span className="text-xs text-muted-foreground">有未保存的更改</span>}
      </div>
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="放弃未保存的修改？"
        description={`将恢复 ${filename} 上次保存的内容。`}
        confirmLabel="放弃修改"
        cancelLabel="继续编辑"
        variant="destructive"
        onConfirm={() => { setContent(originalContent); setMasked(true); setMessage(null) }}
      />
    </div>
  )
}

export default function EnvManagePage() {
  const readOnly = isDemoMode()
  const { files, loading, error, listFiles, getFile, saveFile } = useEnvFiles()
  ensureEnvUnloadGuard()
  const session = envDraftSessions.get(getWebSocketManager())
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
        <PageHeader title="环境变量" description="加载文件列表…" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-48" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="环境变量"
        description={readOnly ? '查看 .env / .env.* 中的键值；Demo 只读且敏感值不可揭示。' : '敏感值默认隐藏，保存后需重启生效。'}
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        }
      />

      {error && (
        <div className="space-y-2"><ErrorAlert error={readErrorSummary(error, '环境变量文件列表')} onRetry={handleRefresh} /><details className="text-xs"><summary className="cursor-pointer">技术详情</summary><pre className="mt-2 whitespace-pre-wrap break-words">{error}</pre></details></div>
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
                  <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">新</Badge>
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
                  格式 <code className="rounded bg-muted px-1 py-0.5 text-xs">KEY=VALUE</code>
                  ，支持带引号的多行值。
                </CardDescription>
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
