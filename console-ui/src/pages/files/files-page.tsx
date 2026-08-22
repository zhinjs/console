import { useState } from 'react'
import { useFiles } from '@zhin.js/client'
import { RefreshCw, AlertCircle, FolderOpen } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { ScrollArea } from '../../components/ui/scroll-area'
import { PageHeader } from '../../components/PageHeader'
import { EmptyState } from '../../components/empty-state'
import { useHljsTheme } from './use-hljs-theme'
import { TreeNode } from './tree-node'
import { FileEditor } from './file-editor'
import { isDemoMode } from '../../utils/demo-mode'

export default function FileManagePage() {
  const readOnly = isDemoMode()
  useHljsTheme()
  const { tree, loading, error, loadTree, readFile, saveFile } = useFiles()
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  return (
    <div className="space-y-4">
      <PageHeader
        title="项目文件"
        description={readOnly ? '浏览工作空间中的配置文件和源代码（Demo 只读）' : '浏览和编辑工作空间中的配置文件和源代码'}
        actions={
          <Button variant="outline" size="sm" onClick={() => loadTree()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive" className="py-2">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Card className="overflow-hidden">
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row h-[min(70vh,600px)] md:h-[600px]">
            <div
              className={`w-full md:w-64 border-b md:border-b-0 md:border-r flex-col shrink-0 ${
                selectedFile ? 'hidden md:flex' : 'flex flex-1 md:flex-none'
              }`}
            >
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">文件浏览器</span>
              </div>
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {loading && tree.length === 0 ? (
                    <div className="flex items-center justify-center py-8">
                      <RefreshCw className="w-4 h-4 animate-spin text-muted-foreground" />
                    </div>
                  ) : tree.length === 0 ? (
                    <EmptyState compact title="暂无文件" />
                  ) : (
                    tree.map((node) => (
                      <TreeNode
                        key={node.path}
                        node={node}
                        selectedPath={selectedFile}
                        onSelect={setSelectedFile}
                      />
                    ))
                  )}
                </div>
              </ScrollArea>
            </div>

            <div className={`flex-1 min-w-0 min-h-0 ${selectedFile ? 'flex flex-col' : 'hidden md:block'}`}>
              {selectedFile ? (
                <FileEditor
                  key={selectedFile}
                  filePath={selectedFile}
                  readFile={readFile}
                  saveFile={saveFile}
                  readOnly={readOnly}
                  onClose={() => setSelectedFile(null)}
                />
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="text-center">
                    <FolderOpen className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">选择左侧文件开始编辑</p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
