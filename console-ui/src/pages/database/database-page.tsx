import { useState, useMemo, type MouseEvent } from 'react'
import { useDatabase } from '@zhin.js/client'
import type { DatabaseType, TableInfo } from '@zhin.js/client'
import { Database as DatabaseIcon, Table2, Trash2, RefreshCw, Key, ArrowLeft } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { ErrorAlert } from '../../components/error-alert'
import { EmptyState } from '../../components/empty-state'
import { Badge } from '../../components/ui/badge'
import { Skeleton } from '../../components/ui/skeleton'
import { ScrollArea } from '../../components/ui/scroll-area'
import { PageHeader } from '../../components/PageHeader'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { DB_TYPE_LABELS, DIALECT_LABELS } from './constants'
import { RelatedTableView } from './related-table-view'
import { DocumentCollectionView } from './document-collection-view'
import { KvBucketView } from './kv-bucket-view'
import { isDemoMode } from '../../utils/demo-mode'

export default function DatabasePage() {
  const readOnly = isDemoMode()
  const {
    info, tables, loading, error,
    loadInfo, loadTables, dropTable,
    select, insert, update, remove,
    kvGet, kvSet, kvDelete, kvEntries,
  } = useDatabase()

  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; label: string } | null>(null)
  const selectedTableInfo = useMemo(() => tables.find((t: TableInfo) => t.name === selectedTable), [tables, selectedTable])
  const dbType: DatabaseType = info?.type ?? 'related'
  const objectLabel = dbType === 'related' ? '表' : dbType === 'document' ? '集合' : '桶'

  return (
    <>
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title="数据库"
        description={readOnly ? `浏览 ${DB_TYPE_LABELS[dbType]} 中的数据（Demo 只读）。` : `浏览和管理 ${DB_TYPE_LABELS[dbType]} 中的数据；左栏选择对象，右侧查看与编辑。`}
        actions={
          <div className="flex items-center gap-2">
            {info && (
              <Badge variant="secondary" className="font-normal hidden sm:inline-flex">
                {DIALECT_LABELS[info.dialect] || info.dialect} · {DB_TYPE_LABELS[info.type]}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => { loadInfo().catch(() => {}); loadTables().catch(() => {}) }} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />刷新
            </Button>
          </div>
        }
      />

      {error && (
        <ErrorAlert error={error} onRetry={() => loadTables().catch(() => {})} />
      )}

      <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row h-[min(calc(100dvh-9.5rem),52rem)]">
            <div
              className={`w-full md:w-56 border-b md:border-b-0 md:border-r flex-col shrink-0 min-h-0 ${
                selectedTable ? 'hidden md:flex' : 'flex flex-1'
              }`}
            >
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {dbType === 'related' ? '数据表' : dbType === 'document' ? '集合' : '桶'}
                </span>
              </div>
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {loading && !tables.length ? (
                    <div className="space-y-2 p-3">
                      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                    </div>
                  ) : !tables.length ? (
                    <EmptyState compact title="暂无数据" />
                  ) : tables.map((t: TableInfo) => (
                    <div
                      key={t.name}
                      role="button"
                      tabIndex={0}
                      className={`
                        group w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left
                        hover:bg-accent transition-colors rounded-sm cursor-pointer
                        ${selectedTable === t.name ? 'bg-accent text-accent-foreground font-medium' : ''}
                      `}
                      onClick={() => setSelectedTable(t.name)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setSelectedTable(t.name)
                        }
                      }}
                    >
                      {dbType === 'keyvalue' ? <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <span className="truncate flex-1">{t.name}</span>
                      {t.columns && <Badge variant="secondary" className="ml-auto text-[10px] px-1 py-0">{Object.keys(t.columns).length}</Badge>}
                      {!readOnly && <Button
                        size="sm" variant="ghost"
                        className="h-5 w-5 p-0 opacity-0 group-hover:opacity-100 text-destructive shrink-0"
                        onClick={(e: MouseEvent) => {
                          e.stopPropagation()
                          setDeleteTarget({ name: t.name, label: objectLabel })
                        }}
                      >
                        <Trash2 className="w-3 h-3" />
                      </Button>}
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div
              className={`flex-1 min-w-0 min-h-0 flex-col ${
                selectedTable ? 'flex' : 'hidden md:flex'
              }`}
            >
              {selectedTable ? (
                <>
                  <div className="flex items-center gap-2 px-3 sm:px-4 py-2.5 border-b bg-muted/20 min-w-0 shrink-0">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="md:hidden shrink-0 -ml-1 px-2"
                      onClick={() => setSelectedTable(null)}
                      aria-label={`返回${objectLabel}列表`}
                    >
                      <ArrowLeft className="w-4 h-4 mr-1" />
                      返回
                    </Button>
                    {dbType === 'keyvalue' ? (
                      <Key className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:block" />
                    ) : (
                      <Table2 className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:block" />
                    )}
                    <h2 className="text-base sm:text-lg font-semibold truncate min-w-0">{selectedTable}</h2>
                    {selectedTableInfo?.columns && (
                      <div className="hidden lg:flex gap-1 ml-2 flex-wrap min-w-0">
                        {(Object.entries(selectedTableInfo.columns) as [string, { type: string; primary?: boolean }][]).slice(0, 8).map(([col, def]) => (
                          <Badge key={col} variant="outline" className="text-[10px] px-1.5 py-0">
                            {col}{def.primary ? ' 🔑' : ''}: {def.type}
                          </Badge>
                        ))}
                        {Object.keys(selectedTableInfo.columns).length > 8 && (
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0">+{Object.keys(selectedTableInfo.columns).length - 8}</Badge>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex-1 min-h-0 min-w-0 p-3 sm:p-4 overflow-hidden">
                    {dbType === 'keyvalue' ? (
                      <KvBucketView
                        key={selectedTable}
                        tableName={selectedTable}
                        kvGet={kvGet}
                        kvSet={kvSet}
                        kvDelete={kvDelete}
                        kvEntries={kvEntries}
                        readOnly={readOnly}
                      />
                    ) : dbType === 'document' ? (
                      <DocumentCollectionView
                        key={selectedTable}
                        tableName={selectedTable}
                        select={select}
                        insert={insert}
                        update={update}
                        remove={remove}
                        readOnly={readOnly}
                      />
                    ) : (
                      <RelatedTableView
                        key={selectedTable}
                        tableName={selectedTable}
                        tableInfo={selectedTableInfo}
                        select={select}
                        insert={insert}
                        update={update}
                        remove={remove}
                        readOnly={readOnly}
                      />
                    )}
                  </div>
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-muted-foreground p-4">
                  <div className="text-center">
                    <DatabaseIcon className="w-12 h-12 mx-auto mb-3 opacity-30" />
                    <p className="text-sm">
                      在左侧选择一个{objectLabel}开始管理
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    {!readOnly && <ConfirmDialog
      open={!!deleteTarget}
      onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      title={`删除${deleteTarget?.label || ''}`}
      description={`确定要删除${deleteTarget?.label || ''} "${deleteTarget?.name}" 吗？此操作不可撤销！`}
      variant="destructive"
      confirmLabel="删除"
      onConfirm={async () => {
        if (!deleteTarget) return
        await dropTable(deleteTarget.name)
        if (selectedTable === deleteTarget.name) setSelectedTable(null)
        setDeleteTarget(null)
      }}
    />}
    </>
  )
}
