import { useI18n } from '../../i18n'
import { useState, useMemo } from 'react'
import { useDatabaseConsole } from './use-database-console'
import type { DatabaseType, TableInfo } from '@zhin.js/client'
import { Database as DatabaseIcon, Table2, Trash2, RefreshCw, Key, ArrowLeft } from 'lucide-react'
import { Card, CardContent } from '../../components/ui/card'
import { Button } from '../../components/ui/button'
import { OpsLoadState } from '../ops/load-state'
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
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { useToast } from '../../components/toast'
import { withoutDroppedTables, type DroppedTables } from './drop-table-model.mjs'

export default function DatabasePage() {
  const i18n = useI18n()
  const readOnly = !hasConsolePermission('ops.database.write')
  const {
    info, tables, loaded, loading, error,
    loadInfo, loadTables, dropTable,
    select, insert, update, remove,
    kvGet, kvSet, kvDelete, kvEntries,
  } = useDatabaseConsole()
  const toast = useToast()

  const [selectedTable, setSelectedTable] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ name: string; label: string } | null>(null)
  // Tables already dropped while the list could not be refreshed: never offer them again from the stale snapshot.
  const [dropped, setDropped] = useState<DroppedTables<TableInfo> | null>(null)
  const visibleTables = useMemo(() => withoutDroppedTables(tables, dropped), [tables, dropped])
  const selectedTableInfo = useMemo(() => visibleTables.find((t: TableInfo) => t.name === selectedTable), [visibleTables, selectedTable])
  const dbType: DatabaseType = info?.type ?? 'related'
  const objectLabel = dbType === 'related' ? i18n.t("表") : dbType === 'document' ? i18n.t("集合") : i18n.t("桶")

  return (
    <>
    <div className="space-y-4 sm:space-y-6">
      <PageHeader
        title={i18n.t("数据库")}
        description={!info ? i18n.t("浏览和管理项目数据库中的数据；数据库由 Zhin 实例提供。") : readOnly ? i18n.t("浏览 {0} 中的数据（只读）。", [i18n.t(DB_TYPE_LABELS[dbType])]) : i18n.t("浏览和管理 {0} 中的数据；左栏选择对象，右侧查看与编辑。", [i18n.t(DB_TYPE_LABELS[dbType])])}
        actions={
          <div className="flex items-center gap-2">
            {info && (
              <Badge variant="secondary" className="font-normal hidden sm:inline-flex">
                {DIALECT_LABELS[info.dialect] || info.dialect} · {i18n.t(DB_TYPE_LABELS[info.type])}
              </Badge>
            )}
            <Button variant="outline" size="sm" onClick={() => { loadInfo().catch(() => {}); loadTables().catch(() => {}) }} disabled={loading}>
              <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />{i18n.t("刷新")}</Button>
          </div>
        }
      />

      {error && (
        <OpsLoadState error={error} resource={i18n.t("数据库信息")} permissions={['ops.database.read']} onRetry={() => { void loadInfo().catch(() => {}); void loadTables().catch(() => {}) }} />
      )}

      {/* A failed first read shows only its state: an empty explorer would read as "no tables". */}
      {error && !loaded && !tables.length ? null : <Card className="overflow-hidden border-border/80 shadow-sm">
        <CardContent className="p-0">
          <div className="flex flex-col md:flex-row h-[max(28rem,calc(100dvh-11rem))]">
            <div
              className={`w-full md:w-56 border-b md:border-b-0 md:border-r flex-col shrink-0 min-h-0 ${
                selectedTable ? 'hidden md:flex' : 'flex flex-1'
              }`}
            >
              <div className="px-3 py-2 border-b bg-muted/30">
                <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                  {dbType === 'related' ? i18n.t("数据表") : dbType === 'document' ? i18n.t("集合") : i18n.t("桶")}
                </span>
              </div>
              <ScrollArea className="flex-1">
                <div className="py-1">
                  {loading && !tables.length ? (
                    <div className="space-y-2 p-3">
                      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}
                    </div>
                  ) : !visibleTables.length && (!loaded || error) ? (
                    <EmptyState compact title={error ? i18n.t("数据库对象尚未读取成功") : i18n.t("等待读取数据库对象")} />
                  ) : !visibleTables.length ? (
                    <EmptyState compact title={i18n.t("暂无数据")} />
                  ) : visibleTables.map((t: TableInfo) => (
                    <button
                      key={t.name}
                      type="button"
                      data-table={t.name}
                      aria-current={selectedTable === t.name ? 'true' : undefined}
                      className={`
                        w-full flex items-center gap-2 px-3 py-1.5 text-sm text-left
                        hover:bg-accent transition-colors rounded-sm cursor-pointer
                        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset
                        ${selectedTable === t.name ? 'bg-accent text-accent-foreground font-medium' : ''}
                      `}
                      onClick={() => setSelectedTable(t.name)}
                    >
                      {dbType === 'keyvalue' ? <Key className="w-3.5 h-3.5 text-muted-foreground shrink-0" /> : <Table2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />}
                      <span className="truncate flex-1">{t.name}</span>
                      {t.columns && <Badge variant="secondary" size="sm" className="ml-auto">{Object.keys(t.columns).length} {i18n.t(" 列")}</Badge>}
                    </button>
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
                      aria-label={i18n.t("返回{0}列表", [objectLabel])}
                    >
                      <ArrowLeft className="w-4 h-4 mr-1" />
                      {i18n.t("返回")}</Button>
                    {dbType === 'keyvalue' ? (
                      <Key className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:block" />
                    ) : (
                      <Table2 className="w-4 h-4 text-muted-foreground shrink-0 hidden sm:block" />
                    )}
                    <h2 className="text-base sm:text-lg font-semibold truncate min-w-0">{selectedTable}</h2>
                    {!readOnly && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        data-action="drop-table"
                        className="ml-auto order-last shrink-0 text-destructive"
                        aria-label={i18n.t("删除{0} {1}", [objectLabel, selectedTable])}
                        onClick={() => setDeleteTarget({ name: selectedTable, label: objectLabel })}
                      >
                        <Trash2 className="w-3.5 h-3.5 sm:mr-1" />
                        <span className="hidden sm:inline">{i18n.t("删除{0}", [objectLabel])}</span>
                      </Button>
                    )}
                    {selectedTableInfo?.columns && (
                      <div className="hidden lg:flex gap-1 ml-2 flex-wrap min-w-0">
                        {(Object.entries(selectedTableInfo.columns) as [string, { type: string; primary?: boolean }][]).slice(0, 8).map(([col, def]) => (
                          <Badge key={col} variant="outline" size="sm">
                            {col}{def.primary ? ' 🔑' : ''}: {def.type}
                          </Badge>
                        ))}
                        {Object.keys(selectedTableInfo.columns).length > 8 && (
                          <Badge variant="outline" size="sm">+{Object.keys(selectedTableInfo.columns).length - 8}</Badge>
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
                      {error || !loaded ? i18n.t("数据库对象尚未读取成功，请先重试或使用有权限的身份连接。") : i18n.t("在左侧选择一个{0}{1}", [objectLabel, readOnly ? i18n.t("查看数据") : i18n.t("开始管理")])}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>}
    </div>
    {!readOnly && <ConfirmDialog
      open={!!deleteTarget}
      onOpenChange={(open) => { if (!open) setDeleteTarget(null) }}
      title={i18n.t("删除{0}", [deleteTarget?.label || ''])}
      description={i18n.t("确定要删除{0} \"{1}\" 吗？此操作不可撤销！", [deleteTarget?.label || '', deleteTarget?.name])}
      variant="destructive"
      confirmLabel={i18n.t("删除")}
      confirmText={deleteTarget?.name}
      onConfirm={async () => {
        if (!deleteTarget) return
        const { name, label } = deleteTarget
        // A failed drop rejects here and ConfirmDialog shows the error; only the drop decides that.
        const { refreshError } = await dropTable(name)
        if (selectedTable === name) setSelectedTable(null)
        setDeleteTarget(null)
        if (refreshError) {
          setDropped(previous => ({ source: tables, names: previous?.source === tables ? [...previous.names, name] : [name] }))
          toast.warning(i18n.t("已删除{0} \"{1}\"，但刷新列表失败，请稍后点击刷新。", [label, name]))
        } else {
          toast.success(i18n.t("已删除{0} \"{1}\"", [label, name]))
        }
      }}
    />}
    </>
  )
}
