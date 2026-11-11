import { useI18n } from '../../i18n'
import { useState, useCallback, useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import './file-tree.css'
import { type FileTreeNode } from '@zhin.js/client'
import { getConsoleTransport } from '../../utils/console-client'
import { RefreshCw, FolderOpen, Search, Info } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Input } from '../../components/ui/input'
import { ErrorAlert } from '../../components/error-alert'
import { ScrollArea } from '../../components/ui/scroll-area'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/empty-state'
import { TreeNode } from './tree-node'
import { getFileIcon } from './file-icons'
import { FileEditor } from './file-editor'
import { createFileDraftSessions, type FileDraft } from './draft-session.mjs'
import { locateTreePath, searchTreeFiles } from './file-tree-model.mjs'
import { isDemoMode } from '../../utils/demo-mode'
import { useConsoleRead } from '../../hooks/use-console-read'
import { readErrorSummary } from '../../utils/read-error.mjs'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { ConnectionRequiredState } from '../../components/connection-required'

// Navigation keeps drafts in memory only, scoped to the current Host client.
// A new connection/reset receives a new manager and cannot reuse old files.
const draftSessions = createFileDraftSessions()
let unloadGuardInstalled = false
function ensureUnloadGuard() {
  if (unloadGuardInstalled) return
  unloadGuardInstalled = true
  window.addEventListener('beforeunload', (event) => {
    if (!draftSessions.hasUnsaved(getConsoleTransport())) return
    event.preventDefault()
    event.returnValue = ''
  })
}

export default function FileManagePage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!isInboxCacheScopeActive(scope)) return <ConnectionRequiredState title={i18n.t("项目文件")} />
  return <FileManageSession key={scope} />
}

function FileManageSession() {
  const i18n = useI18n()
  const readOnly = isDemoMode()
  const [searchParams, setSearchParams] = useSearchParams()
  const requestedPath = searchParams.get('path') || null
  const fileManager = getConsoleTransport()
  const { data: tree, loaded, loading, error, refresh: loadTree } = useConsoleRead<FileTreeNode[]>(async () => (await fileManager.getFileTree()).tree, [])
  const readFile = async (path: string) => (await fileManager.readFile(path)).content
  const saveFile = (path: string, content: string) => fileManager.saveFile(path, content)
  ensureUnloadGuard()
  const session = draftSessions.get(fileManager)
  const [selectedFile, setSelectedFile] = useState<string | null>(session.selected)
  const [pendingSelection, setPendingSelection] = useState<{ path: string | null } | null>(null)
  const syncSelectionPath = useCallback((path: string | null) => {
    if (path === requestedPath) return
    setSearchParams(previous => {
      const next = new URLSearchParams(previous)
      if (path) next.set('path', path)
      else next.delete('path')
      return next
    }, { replace: true })
  }, [requestedPath, setSearchParams])
  const applySelection = useCallback((path: string | null) => {
    session.selected = path
    setSelectedFile(path)
    syncSelectionPath(path)
  }, [session, syncSelectionPath])
  const selectFile = useCallback((path: string | null) => {
    if (path === selectedFile) return
    if (selectedFile && session.drafts.has(selectedFile)) {
      setPendingSelection({ path })
      // A URL is a selection request, not permission to replace the current draft.
      // Consume it now so cancel/close cannot replay the same request on remount.
      syncSelectionPath(selectedFile)
      return
    }
    applySelection(path)
  }, [selectedFile, session, syncSelectionPath, applySelection])
  useEffect(() => {
    if (requestedPath) selectFile(requestedPath)
  }, [requestedPath, selectFile])
  // Expanded directories by path. The Host returns the whole (depth-limited) tree in
  // one read, so revealing a linked file only has to open each loaded ancestor.
  const [expansion, setExpansion] = useState<ReadonlyMap<string, boolean>>(() => new Map())
  const toggleDirectory = useCallback((path: string, next: boolean) => {
    setExpansion(previous => new Map(previous).set(path, next))
  }, [])
  const location = selectedFile && loaded ? locateTreePath(tree, selectedFile) : null
  useEffect(() => {
    if (!selectedFile || !loaded) return
    const { ancestors } = locateTreePath(tree, selectedFile)
    setExpansion(previous => {
      if (ancestors.every(path => previous.get(path) === true)) return previous
      const next = new Map(previous)
      for (const path of ancestors) next.set(path, true)
      return next
    })
  }, [selectedFile, tree, loaded])
  const [searchQuery, setSearchQuery] = useState('')
  const searching = searchQuery.trim().length > 0
  const search = searching ? searchTreeFiles(tree, searchQuery) : null
  const chooseSearchResult = useCallback((path: string) => {
    setSearchQuery('')
    selectFile(path)
  }, [selectFile])
  const retryTree = loading ? undefined : () => void loadTree().catch(() => {})
  const treeError = error ? readErrorSummary(error, i18n.t("文件列表"), i18n.locale) : null

  const updateDraft = useCallback((draft: FileDraft | null) => {
    if (!selectedFile) return
    if (draft) session.drafts.set(selectedFile, draft)
    else session.drafts.delete(selectedFile)
  }, [session, selectedFile])

  return (
    <div className="space-y-4">
      <PageHeader
        title={i18n.t("项目文件")}
        description={readOnly ? i18n.t("浏览工作空间中的配置文件和源代码（Demo 只读）") : i18n.t("浏览和编辑工作空间中的配置文件和源代码")}
        actions={
          <Button className="file-control" variant="outline" size="sm" onClick={() => void loadTree().catch(() => {})} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {i18n.t("刷新")}</Button>
        }
      />

      {selectedFile ? <p className="text-xs text-muted-foreground">{i18n.t("切换页面会保留本标签页内的未保存修改；刷新或关闭标签页前请保存。文件列表刷新不会重新加载编辑内容。")}</p> : null}

      {treeError && tree.length > 0 ? (
        <ErrorAlert error={treeError} technicalDetail={error ?? undefined} onRetry={retryTree} className="py-2" />
      ) : null}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-col lg:flex-row h-[min(70vh,600px)] lg:h-[max(32rem,calc(100dvh-13rem))]">
            <div
              className={`w-full min-w-0 lg:w-64 border-b lg:border-b-0 lg:border-r flex-col shrink-0 ${
                selectedFile ? 'hidden lg:flex' : 'flex flex-1 lg:flex-none'
              }`}
            >
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{i18n.t("文件浏览器")}</span>
              </div>
              {tree.length > 0 ? (
                <div className="px-2 py-2 border-b space-y-1">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                    <Input type="search" aria-label={i18n.t("搜索文件名")} placeholder={i18n.t("搜索文件名…")} value={searchQuery} onChange={event => setSearchQuery(event.target.value)} className="pl-9" />
                  </div>
                  {searching ? <p className="text-xs text-muted-foreground">{i18n.t("仅搜索已加载的目录：Host 文件树只返回有限层级，更深的文件不会出现在结果中。")}</p> : null}
                </div>
              ) : null}
              {location && location.status !== 'found' && !searching ? (
                <p className="flex items-start gap-1.5 px-3 py-2 border-b text-xs text-muted-foreground" role="status">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-all">{location.status === 'beyond-tree'
                    ? i18n.t("{0} 超出 Host 文件树返回的目录深度，无法在文件树中定位，已直接打开。", [selectedFile ?? ''])
                    : location.status === 'directory'
                      ? i18n.t("{0} 是目录，请在文件树中选择其中的文件。", [selectedFile ?? ''])
                      : i18n.t("文件树中没有 {0}：该路径可能不存在、被隐藏或不在可管理范围内。", [selectedFile ?? ''])}</span>
                </p>
              ) : null}
              <ScrollArea className="file-tree-scroll flex-1 min-w-0 w-full">
                <div className="py-1">
                  {loading && tree.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : treeError && tree.length === 0 ? (
                    <ErrorAlert error={treeError} technicalDetail={error ?? undefined} onRetry={retryTree} className="mx-2 my-1 py-2" />
                  ) : tree.length === 0 && !loaded ? (
                    <EmptyState compact title={i18n.t("等待读取文件列表")} />
                  ) : tree.length === 0 ? (
                    <EmptyState compact title={i18n.t("暂无文件")} />
                  ) : search ? (
                    search.matches.length === 0 ? (
                      <p className="px-3 py-4 text-sm text-muted-foreground break-all">{i18n.t("已加载的目录中没有名称包含「{0}」的文件。", [searchQuery.trim()])}</p>
                    ) : (
                      <>
                        {search.matches.map(node => (
                          <button
                            key={node.path}
                            type="button"
                            data-search-result="true"
                            className={`w-full min-w-0 flex items-center gap-1.5 px-2 py-1 text-sm rounded-sm text-left hover:bg-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset ${node.path === selectedFile ? 'bg-accent text-accent-foreground font-medium' : ''}`}
                            title={node.path}
                            aria-current={node.path === selectedFile ? 'true' : undefined}
                            onClick={() => chooseSearchResult(node.path)}
                          >
                            {getFileIcon(node.name)}
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{node.name}</span>
                              <span className="block truncate text-xs text-muted-foreground">{node.path}</span>
                            </span>
                          </button>
                        ))}
                        {search.total > search.matches.length ? <p className="px-3 py-2 text-xs text-muted-foreground">{i18n.t("仅显示前 {0} 个，共 {1} 个", [search.matches.length, search.total])}</p> : null}
                      </>
                    )
                  ) : (
                    tree.map((node) => (
                      <TreeNode
                        key={node.path}
                        node={node}
                        selectedPath={selectedFile}
                        onSelect={selectFile}
                        expansion={expansion}
                        onToggle={toggleDirectory}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className={`flex-1 min-w-0 min-h-0 ${selectedFile ? 'flex flex-col' : 'hidden lg:block'}`}>
              {selectedFile ? (
                <FileEditor
                  key={selectedFile}
                  filePath={selectedFile}
                  readFile={readFile}
                  saveFile={saveFile}
                  readOnly={readOnly}
                  onClose={() => selectFile(null)}
                  draft={session.drafts.get(selectedFile)}
                  onDraftChange={updateDraft}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">{error || !loaded ? i18n.t("文件列表尚未读取成功，请先重试或使用有权限的身份连接。") : readOnly ? i18n.t("选择左侧文件查看内容") : i18n.t("选择左侧文件开始编辑")}</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
      <ConfirmDialog
        open={pendingSelection !== null}
        onOpenChange={open => { if (!open) setPendingSelection(null) }}
        title={i18n.t("放弃未保存的修改？")}
        description={i18n.t("将放弃 {0} 的修改{1}。", [selectedFile ?? '', pendingSelection?.path ? i18n.t("并切换文件") : i18n.t("并关闭文件")])}
        confirmLabel={pendingSelection?.path ? i18n.t("放弃并切换") : i18n.t("放弃并关闭")}
        cancelLabel={i18n.t("继续编辑")}
        variant="destructive"
        onConfirm={() => {
          if (!pendingSelection) return
          if (selectedFile) session.drafts.delete(selectedFile)
          applySelection(pendingSelection.path)
          setPendingSelection(null)
        }}
      />
    </div>
  )
}
