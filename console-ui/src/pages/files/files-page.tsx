import { useState, useCallback } from 'react'
import './file-tree.css'
import { getWebSocketManager, type FileTreeNode } from '@zhin.js/client'
import { RefreshCw, AlertCircle, FolderOpen } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { ScrollArea } from '../../components/ui/scroll-area'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/empty-state'
import { TreeNode } from './tree-node'
import { FileEditor } from './file-editor'
import { createFileDraftSessions, type FileDraft } from './draft-session.mjs'
import { isDemoMode } from '../../utils/demo-mode'
import { useConsoleRead } from '../../hooks/use-console-read'
import { readErrorSummary } from '../../utils/read-error.mjs'

// Navigation keeps drafts in memory only, scoped to the current Host client.
// A new connection/reset receives a new manager and cannot reuse old files.
const draftSessions = createFileDraftSessions()
let unloadGuardInstalled = false
function ensureUnloadGuard() {
  if (unloadGuardInstalled) return
  unloadGuardInstalled = true
  window.addEventListener('beforeunload', (event) => {
    if (!draftSessions.hasUnsaved(getWebSocketManager())) return
    event.preventDefault()
    event.returnValue = ''
  })
}

export default function FileManagePage() {
  const readOnly = isDemoMode()
  const fileManager = getWebSocketManager()
  const { data: tree, loaded, loading, error, refresh: loadTree } = useConsoleRead<FileTreeNode[]>(async () => (await fileManager.getFileTree()).tree, [])
  const readFile = async (path: string) => (await fileManager.readFile(path)).content
  const saveFile = (path: string, content: string) => fileManager.saveFile(path, content)
  ensureUnloadGuard()
  const manager = getWebSocketManager()
  const session = draftSessions.get(manager)
  const [selectedFile, setSelectedFile] = useState<string | null>(session.selected)
  const [pendingSelection, setPendingSelection] = useState<{ path: string | null } | null>(null)
  const applySelection = (path: string | null) => {
    session.selected = path
    setSelectedFile(path)
  }
  const selectFile = (path: string | null) => {
    if (path === selectedFile) return
    if (selectedFile && session.drafts.has(selectedFile)) {
      setPendingSelection({ path })
      return
    }
    applySelection(path)
  }
  const updateDraft = useCallback((draft: FileDraft | null) => {
    if (!selectedFile) return
    if (draft) session.drafts.set(selectedFile, draft)
    else session.drafts.delete(selectedFile)
  }, [session, selectedFile])

  return (
    <div className="space-y-4">
      <PageHeader
        title="项目文件"
        description={readOnly ? '浏览工作空间中的配置文件和源代码（Demo 只读）' : '浏览和编辑工作空间中的配置文件和源代码'}
        actions={
          <Button className="file-control" variant="outline" size="sm" onClick={() => void loadTree().catch(() => {})} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        }
      />

      {selectedFile ? <p className="text-xs text-muted-foreground">切换页面会保留本标签页内的未保存修改；刷新或关闭标签页前请保存。文件列表刷新不会重新加载编辑内容。</p> : null}

      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{readErrorSummary(error, '文件列表')}<Button className="file-control" variant="outline" size="sm" onClick={() => void loadTree().catch(() => {})} disabled={loading}>重试</Button><details><summary>技术详情</summary><p>{error}</p></details></AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-col lg:flex-row h-[min(70vh,600px)] lg:h-[600px]">
            <div
              className={`w-full min-w-0 lg:w-64 border-b lg:border-b-0 lg:border-r flex-col shrink-0 ${
                selectedFile ? 'hidden lg:flex' : 'flex flex-1 lg:flex-none'
              }`}
            >
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">文件浏览器</span>
              </div>
              <ScrollArea className="file-tree-scroll flex-1 min-w-0 w-full">
                <div className="py-1">
                  {loading && tree.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : tree.length === 0 && (!loaded || error) ? (
                    <EmptyState compact title={error ? '文件列表尚未读取成功' : '等待读取文件列表'} />
                  ) : tree.length === 0 ? (
                    <EmptyState compact title="暂无文件" />
                  ) : (
                    tree.map((node) => (
                      <TreeNode
                        key={node.path}
                        node={node}
                        selectedPath={selectedFile}
                        onSelect={selectFile}
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
                    <p className="text-sm">{error || !loaded ? '文件列表尚未读取成功，请先重试或使用有权限的身份连接。' : readOnly ? '选择左侧文件查看内容' : '选择左侧文件开始编辑'}</p>
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
        title="放弃未保存的修改？"
        description={`将放弃 ${selectedFile ?? ''} 的修改${pendingSelection?.path ? '并切换文件' : '并关闭文件'}。`}
        confirmLabel={pendingSelection?.path ? '放弃并切换' : '放弃并关闭'}
        cancelLabel="继续编辑"
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
