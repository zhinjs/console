import { useI18n } from '../../i18n'
import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, RefreshCw, KeyRound, ListTree, Eye, X } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { Badge } from '../../components/ui/badge'
import { SelectField } from '../../components/ui/select'
import { Checkbox } from '../../components/ui/checkbox'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../components/ui/table'
import { StatusState } from '../../components/StatusState'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { useToast } from '../../components/toast'
import {
  isUnsupportedRpcError, parseDefaultInput, SCHEMA_COLUMN_TYPES, schemaWarningText,
} from './database-console-model.mjs'
import type { DatabaseAdmin } from './use-database-console'
import type { DbColumnSpec, DbColumnType, DbSchemaChange, DbSchemaPlan, DbTableSchema } from './database-types'

type Draft =
  | { kind: 'add-column'; name: string; type: DbColumnType; nullable: boolean; defaultText: string }
  | { kind: 'rename-column'; column: string; to: string }
  | { kind: 'alter-column'; column: string; type: DbColumnType | ''; nullable: 'keep' | 'yes' | 'no'; defaultText: string; dropDefault: boolean }
  | { kind: 'drop-column'; column: string }
  | { kind: 'create-index'; name: string; columns: string[]; unique: boolean }
  | { kind: 'drop-index'; name: string }

const typeOptions = SCHEMA_COLUMN_TYPES.map(type => ({ value: type, label: type }))

/** Builds the structured change of a draft, or the translated reason it is incomplete. */
function draftChange(table: string, draft: Draft, t: (message: string) => string): { change?: DbSchemaChange; error?: string } {
  switch (draft.kind) {
    case 'add-column': {
      const parsed = parseDefaultInput(draft.defaultText, draft.type)
      if (parsed.error) return { error: t('默认值与列类型不符。') }
      const column: DbColumnSpec = { name: draft.name.trim(), type: draft.type, nullable: draft.nullable, ...(parsed.none ? {} : { default: parsed.value as DbColumnSpec['default'] }) }
      return { change: { kind: 'add-column', table, column } }
    }
    case 'rename-column': return { change: { kind: 'rename-column', table, column: draft.column, to: draft.to.trim() } }
    case 'drop-column': return { change: { kind: 'drop-column', table, column: draft.column } }
    case 'alter-column': {
      const parsed = parseDefaultInput(draft.defaultText, draft.type || 'text')
      if (parsed.error) return { error: t('默认值与列类型不符。') }
      return { change: {
        kind: 'alter-column', table, column: draft.column,
        ...(draft.type ? { type: draft.type } : {}),
        ...(draft.nullable === 'keep' ? {} : { nullable: draft.nullable === 'yes' }),
        ...(draft.dropDefault ? { dropDefault: true } : parsed.none ? {} : { default: parsed.value as DbColumnSpec['default'] }),
      } }
    }
    case 'create-index':
      if (!draft.columns.length) return { error: t('请至少选择一列。') }
      return { change: { kind: 'create-index', table, name: draft.name.trim(), columns: draft.columns, ...(draft.unique ? { unique: true } : {}) } }
    case 'drop-index': return { change: { kind: 'drop-index', table, name: draft.name } }
  }
}

/** DDL preview with the Host's warnings; shared by the table editor and the create-table form. */
export function SchemaPlanPreview({ plan }: { plan: DbSchemaPlan }) {
  const i18n = useI18n()
  return (
    <div className="space-y-2" data-schema-plan>
      <p className="text-xs font-medium text-muted-foreground">{i18n.t('将执行的 DDL')}</p>
      <pre className="max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs whitespace-pre-wrap break-all">{plan.statements.join(';\n')};</pre>
      {plan.warnings.length ? <ul className="space-y-1 text-xs text-amber-700 dark:text-amber-400">
        {plan.warnings.map(code => <li key={code}>{schemaWarningText(code, i18n.locale)}</li>)}
      </ul> : null}
    </div>
  )
}

/**
 * The plan → confirm → apply step of a schema change. Destructive changes ask for the object's
 * name; every applied statement is audited by the Host.
 */
export function useSchemaApply(admin: DatabaseAdmin, onApplied: (plan: DbSchemaPlan) => void) {
  const i18n = useI18n()
  const toast = useToast()
  const [plan, setPlan] = useState<DbSchemaPlan | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<unknown>(null)
  const [confirming, setConfirming] = useState(false)
  const preview = async (change: DbSchemaChange) => {
    setPlanning(true)
    setPlanError(null)
    try { setPlan(await admin.preview(change)) } catch (error) { setPlan(null); setPlanError(error) } finally { setPlanning(false) }
  }
  const reset = () => { setPlan(null); setPlanError(null); setConfirming(false) }
  const dialog = (
    <ConfirmDialog
      open={confirming && !!plan}
      onOpenChange={open => { if (!open) setConfirming(false) }}
      title={i18n.t('应用结构修改')}
      description={plan?.destructive ? i18n.t('这项修改无法撤销。请输入 “{0}” 确认。', [plan.confirm ?? '']) : i18n.t('确认在数据库上执行以下语句？')}
      variant={plan?.destructive ? 'destructive' : 'default'}
      confirmLabel={i18n.t('应用')}
      {...(plan?.destructive && plan.confirm ? { confirmText: plan.confirm } : {})}
      onConfirm={async () => {
        if (!plan) return
        const applied = await admin.apply(plan.change, plan.destructive ? plan.confirm : undefined)
        setConfirming(false)
        setPlan(null)
        toast.success(i18n.t('结构已修改'))
        onApplied(applied)
      }}
    >
      {plan ? <SchemaPlanPreview plan={plan} /> : null}
      <p className="text-xs text-muted-foreground">{i18n.t('语句文本会写入审计日志。')}</p>
    </ConfirmDialog>
  )
  return { plan, planning, planError, preview, reset, confirm: () => setConfirming(true), dialog }
}

export function SchemaEditor({ tableName, admin, canEdit, supported, reason, onChanged }: {
  tableName: string
  admin: DatabaseAdmin
  /** The principal holds `ops.database.schema`. */
  canEdit: boolean
  /** The Host reports `capabilities.schema`. */
  supported: boolean
  reason?: string
  /** After a change: refresh the table list and the data view. */
  onChanged: () => void
}) {
  const i18n = useI18n()
  const [schema, setSchema] = useState<DbTableSchema | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(false)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [draftError, setDraftError] = useState<string | null>(null)
  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try { setSchema(await admin.describe(tableName)) } catch (err) { setError(err) } finally { setLoading(false) }
  }, [admin, tableName])
  const apply = useSchemaApply(admin, () => { setDraft(null); void load(); onChanged() })
  useEffect(() => { if (supported) void load() }, [supported, load])

  if (!supported || (error && isUnsupportedRpcError(error))) {
    return <StatusState kind="unsupported" title={i18n.t('表结构编辑不可用')}
      description={reason || i18n.t('当前 Host 或数据库不支持查看和修改表结构（需要 SQLite、MySQL 或 PostgreSQL，并升级 Host）。')} />
  }
  if (error && !schema) return <StatusState error={error} onRetry={() => { void load() }} />

  const open = (next: Draft) => { apply.reset(); setDraftError(null); setDraft(next) }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!draft) return
    const built = draftChange(tableName, draft, message => i18n.t(message))
    if (built.error || !built.change) { setDraftError(built.error ?? null); return }
    setDraftError(null)
    void apply.preview(built.change)
  }
  const columns = schema?.columns ?? []
  const update = (patch: Partial<Draft>) => { apply.reset(); setDraft(previous => previous ? { ...previous, ...patch } as Draft : previous) }

  return (
    <div className="flex h-full min-h-0 flex-col gap-3 overflow-auto" data-schema-editor>
      <div className="flex flex-wrap items-center gap-2 shrink-0">
        <Button size="sm" variant="outline" onClick={() => { void load() }} disabled={loading}><RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? 'animate-spin' : ''}`} />{i18n.t('刷新')}</Button>
        {canEdit ? <>
          <Button size="sm" onClick={() => open({ kind: 'add-column', name: '', type: 'text', nullable: true, defaultText: '' })}><Plus className="w-3.5 h-3.5 mr-1" />{i18n.t('添加列')}</Button>
          <Button size="sm" variant="outline" onClick={() => open({ kind: 'create-index', name: `${tableName}_idx`.replace(/[^A-Za-z0-9_]/g, '_').slice(0, 60), columns: [], unique: false })}><ListTree className="w-3.5 h-3.5 mr-1" />{i18n.t('添加索引')}</Button>
        </> : <span className="text-xs text-muted-foreground">{i18n.t('修改表结构需要 ops.database.schema 权限。')}</span>}
      </div>

      {draft ? (
        <form onSubmit={submit} className="shrink-0 space-y-3 rounded-md border bg-muted/20 p-3" aria-label={i18n.t('结构修改')} data-schema-draft={draft.kind}>
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium">
              {draft.kind === 'add-column' ? i18n.t('添加列') : draft.kind === 'rename-column' ? i18n.t('重命名列 {0}', [draft.column])
                : draft.kind === 'alter-column' ? i18n.t('修改列 {0}', [draft.column]) : draft.kind === 'drop-column' ? i18n.t('删除列 {0}', [draft.column])
                  : draft.kind === 'create-index' ? i18n.t('添加索引') : i18n.t('删除索引 {0}', [draft.name])}
            </p>
            <Button type="button" size="icon" variant="ghost" className="ml-auto" aria-label={i18n.t('取消')} onClick={() => { setDraft(null); apply.reset() }}><X /></Button>
          </div>
          {draft.kind === 'add-column' ? <div className="grid gap-2 sm:grid-cols-2">
            <Input aria-label={i18n.t('列名')} placeholder={i18n.t('列名')} value={draft.name} onChange={event => update({ name: event.target.value })} />
            <SelectField aria-label={i18n.t('类型')} value={draft.type} options={typeOptions} onValueChange={(type: string) => update({ type: type as DbColumnType })} />
            <Input aria-label={i18n.t('默认值')} placeholder={i18n.t('默认值（可选，NULL 表示空）')} value={draft.defaultText} onChange={event => update({ defaultText: event.target.value })} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.nullable} onCheckedChange={checked => update({ nullable: checked === true })} />{i18n.t('允许为空')}</label>
          </div> : null}
          {draft.kind === 'rename-column' ? <Input aria-label={i18n.t('新列名')} placeholder={i18n.t('新列名')} value={draft.to} onChange={event => update({ to: event.target.value })} /> : null}
          {draft.kind === 'alter-column' ? <div className="grid gap-2 sm:grid-cols-2">
            <SelectField aria-label={i18n.t('类型')} value={draft.type} options={[{ value: '', label: i18n.t('不修改类型') }, ...typeOptions]} onValueChange={(type: string) => update({ type: type as DbColumnType | '' })} />
            <SelectField aria-label={i18n.t('可空')} value={draft.nullable} options={[{ value: 'keep', label: i18n.t('不修改可空') }, { value: 'yes', label: i18n.t('允许为空') }, { value: 'no', label: i18n.t('不可为空') }]} onValueChange={(nullable: string) => update({ nullable: nullable as 'keep' | 'yes' | 'no' })} />
            <Input aria-label={i18n.t('默认值')} placeholder={i18n.t('新默认值（留空表示不修改）')} disabled={draft.dropDefault} value={draft.defaultText} onChange={event => update({ defaultText: event.target.value })} />
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.dropDefault} onCheckedChange={checked => update({ dropDefault: checked === true })} />{i18n.t('移除默认值')}</label>
          </div> : null}
          {draft.kind === 'drop-column' ? <p className="text-sm text-destructive">{i18n.t('删除列会永久删除这一列的全部数据。')}</p> : null}
          {draft.kind === 'create-index' ? <div className="space-y-2">
            <Input aria-label={i18n.t('索引名')} placeholder={i18n.t('索引名')} value={draft.name} onChange={event => update({ name: event.target.value })} />
            <fieldset className="flex flex-wrap gap-3">
              <legend className="mb-1 text-xs text-muted-foreground">{i18n.t('索引列（按勾选顺序）')}</legend>
              {columns.map(column => (
                <label key={column.name} className="flex items-center gap-1.5 text-sm">
                  <Checkbox checked={draft.columns.includes(column.name)}
                    onCheckedChange={checked => update({ columns: checked === true ? [...draft.columns, column.name] : draft.columns.filter(name => name !== column.name) })} />
                  <span className="font-mono text-xs">{column.name}</span>
                </label>
              ))}
            </fieldset>
            <label className="flex items-center gap-2 text-sm"><Checkbox checked={draft.unique} onCheckedChange={checked => update({ unique: checked === true })} />{i18n.t('唯一索引')}</label>
          </div> : null}
          {draftError ? <p role="alert" className="text-xs text-destructive">{draftError}</p> : null}
          {apply.planError ? <StatusState compact error={apply.planError} title={i18n.t('无法生成修改')} /> : null}
          {apply.plan ? <SchemaPlanPreview plan={apply.plan} /> : null}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" variant="outline" disabled={apply.planning}><Eye className="w-3.5 h-3.5 mr-1" />{i18n.t('预览 DDL')}</Button>
            <Button type="button" size="sm" variant={apply.plan?.destructive ? 'destructive' : 'default'} disabled={!apply.plan} onClick={apply.confirm} data-action="apply-schema">{i18n.t('应用…')}</Button>
          </div>
        </form>
      ) : null}

      <section className="shrink-0" aria-label={i18n.t('列')}>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{i18n.t('列')}</h3>
        <div className="overflow-auto rounded-md border bg-card">
          <Table className="min-w-full">
            <TableHeader><TableRow className="hover:bg-transparent">
              <TableHead>{i18n.t('列名')}</TableHead><TableHead>{i18n.t('类型')}</TableHead><TableHead>{i18n.t('可空')}</TableHead><TableHead>{i18n.t('默认值')}</TableHead>
              {canEdit ? <TableHead numeric>{i18n.t('操作')}</TableHead> : null}
            </TableRow></TableHeader>
            <TableBody>
              {loading && !schema ? <TableRow><TableCell colSpan={5} className="py-6 text-center text-muted-foreground">{i18n.t('加载中…')}</TableCell></TableRow>
                : columns.map(column => (
                  <TableRow key={column.name}>
                    <TableCell className="font-mono text-xs">{column.name}{column.primary ? <Badge variant="secondary" size="sm" className="ml-1.5"><KeyRound className="w-3 h-3 mr-0.5" />{i18n.t('主键')}</Badge> : null}</TableCell>
                    <TableCell className="font-mono text-xs">{column.nativeType || column.type}</TableCell>
                    <TableCell className="text-xs">{column.nullable ? i18n.t('是') : i18n.t('否')}</TableCell>
                    <TableCell className="font-mono text-xs">{column.defaultSql ?? ''}</TableCell>
                    {canEdit ? <TableCell numeric className="whitespace-nowrap">
                      <Button size="icon" variant="ghost" aria-label={i18n.t('重命名列 {0}', [column.name])} onClick={() => open({ kind: 'rename-column', column: column.name, to: column.name })}><Pencil /></Button>
                      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" aria-label={i18n.t('修改列 {0}', [column.name])} onClick={() => open({ kind: 'alter-column', column: column.name, type: '', nullable: 'keep', defaultText: '', dropDefault: false })}>{i18n.t('修改')}</Button>
                      <Button size="icon" variant="ghost" className="text-destructive" disabled={column.primary} aria-label={i18n.t('删除列 {0}', [column.name])} onClick={() => open({ kind: 'drop-column', column: column.name })}><Trash2 /></Button>
                    </TableCell> : null}
                  </TableRow>
                ))}
            </TableBody>
          </Table>
        </div>
      </section>

      <section className="shrink-0" aria-label={i18n.t('索引')}>
        <h3 className="mb-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">{i18n.t('索引')}</h3>
        {schema && !schema.indexes.length ? <p className="text-xs text-muted-foreground">{i18n.t('没有索引。')}</p> : (
          <div className="overflow-auto rounded-md border bg-card">
            <Table className="min-w-full">
              <TableHeader><TableRow className="hover:bg-transparent">
                <TableHead>{i18n.t('索引名')}</TableHead><TableHead>{i18n.t('列')}</TableHead><TableHead>{i18n.t('唯一')}</TableHead>
                {canEdit ? <TableHead numeric>{i18n.t('操作')}</TableHead> : null}
              </TableRow></TableHeader>
              <TableBody>
                {(schema?.indexes ?? []).map(index => (
                  <TableRow key={index.name}>
                    <TableCell className="font-mono text-xs">{index.name}</TableCell>
                    <TableCell className="font-mono text-xs">{index.columns.join(', ')}</TableCell>
                    <TableCell className="text-xs">{index.unique ? i18n.t('是') : i18n.t('否')}</TableCell>
                    {canEdit ? <TableCell numeric>
                      <Button size="icon" variant="ghost" className="text-destructive" disabled={index.primary} aria-label={i18n.t('删除索引 {0}', [index.name])} onClick={() => open({ kind: 'drop-index', name: index.name })}><Trash2 /></Button>
                    </TableCell> : null}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </section>
      {apply.dialog}
    </div>
  )
}

interface CreateColumnDraft { name: string; type: DbColumnType; nullable: boolean; primary: boolean; autoIncrement: boolean; defaultText: string }

/** New table: name, columns, DDL preview, apply. */
export function CreateTableEditor({ admin, supported, reason, onCreated, onCancel }: {
  admin: DatabaseAdmin
  supported: boolean
  reason?: string
  onCreated: (table: string) => void
  onCancel: () => void
}) {
  const i18n = useI18n()
  const [name, setName] = useState('')
  const [columns, setColumns] = useState<CreateColumnDraft[]>([
    { name: 'id', type: 'integer', nullable: false, primary: true, autoIncrement: true, defaultText: '' },
    { name: 'name', type: 'text', nullable: true, primary: false, autoIncrement: false, defaultText: '' },
  ])
  const [draftError, setDraftError] = useState<string | null>(null)
  const apply = useSchemaApply(admin, plan => onCreated(plan.change.table))
  if (!supported) {
    return <StatusState kind="unsupported" title={i18n.t('表结构编辑不可用')}
      description={reason || i18n.t('当前 Host 或数据库不支持查看和修改表结构（需要 SQLite、MySQL 或 PostgreSQL，并升级 Host）。')} />
  }
  const edit = (index: number, patch: Partial<CreateColumnDraft>) => {
    apply.reset()
    setColumns(previous => previous.map((column, i) => i === index ? { ...column, ...patch } : patch.primary ? { ...column, primary: false, autoIncrement: false } : column))
  }
  const submit = (event: FormEvent) => {
    event.preventDefault()
    const specs: DbColumnSpec[] = []
    for (const column of columns) {
      const parsed = parseDefaultInput(column.defaultText, column.type)
      if (parsed.error) { setDraftError(i18n.t('列 {0} 的默认值与类型不符。', [column.name])); return }
      specs.push({
        name: column.name.trim(), type: column.type, nullable: column.nullable,
        ...(column.primary ? { primary: true } : {}), ...(column.primary && column.autoIncrement ? { autoIncrement: true } : {}),
        ...(parsed.none ? {} : { default: parsed.value as DbColumnSpec['default'] }),
      })
    }
    setDraftError(null)
    void apply.preview({ kind: 'create-table', table: name.trim(), columns: specs })
  }
  return (
    <form onSubmit={submit} className="flex h-full min-h-0 flex-col gap-3 overflow-auto" aria-label={i18n.t('新建表')} data-create-table>
      <div className="flex items-center gap-2 shrink-0">
        <Input className="max-w-xs" aria-label={i18n.t('表名')} placeholder={i18n.t('表名（字母、数字、下划线）')} value={name} onChange={event => { apply.reset(); setName(event.target.value) }} />
        <Button type="button" size="sm" variant="ghost" className="ml-auto" onClick={onCancel}>{i18n.t('取消')}</Button>
      </div>
      <div className="shrink-0 overflow-auto rounded-md border bg-card">
        <Table className="min-w-full">
          <TableHeader><TableRow className="hover:bg-transparent">
            <TableHead>{i18n.t('列名')}</TableHead><TableHead>{i18n.t('类型')}</TableHead><TableHead>{i18n.t('主键')}</TableHead><TableHead>{i18n.t('自增')}</TableHead>
            <TableHead>{i18n.t('允许为空')}</TableHead><TableHead>{i18n.t('默认值')}</TableHead><TableHead numeric>{i18n.t('操作')}</TableHead>
          </TableRow></TableHeader>
          <TableBody>
            {columns.map((column, index) => (
              <TableRow key={index}>
                <TableCell><Input className="h-8 font-mono text-xs" aria-label={i18n.t('第 {0} 列列名', [index + 1])} value={column.name} onChange={event => edit(index, { name: event.target.value })} /></TableCell>
                <TableCell><SelectField className="w-28" aria-label={i18n.t('第 {0} 列类型', [index + 1])} value={column.type} options={typeOptions} onValueChange={(type: string) => edit(index, { type: type as DbColumnType })} /></TableCell>
                <TableCell><Checkbox aria-label={i18n.t('第 {0} 列为主键', [index + 1])} checked={column.primary} onCheckedChange={checked => edit(index, { primary: checked === true, ...(checked === true ? { nullable: false } : { autoIncrement: false }) })} /></TableCell>
                <TableCell><Checkbox aria-label={i18n.t('第 {0} 列自增', [index + 1])} disabled={!column.primary || (column.type !== 'integer' && column.type !== 'bigint')} checked={column.autoIncrement} onCheckedChange={checked => edit(index, { autoIncrement: checked === true })} /></TableCell>
                <TableCell><Checkbox aria-label={i18n.t('第 {0} 列允许为空', [index + 1])} disabled={column.primary} checked={column.nullable} onCheckedChange={checked => edit(index, { nullable: checked === true })} /></TableCell>
                <TableCell><Input className="h-8 font-mono text-xs" aria-label={i18n.t('第 {0} 列默认值', [index + 1])} value={column.defaultText} onChange={event => edit(index, { defaultText: event.target.value })} /></TableCell>
                <TableCell numeric><Button type="button" size="icon" variant="ghost" className="text-destructive" disabled={columns.length < 2} aria-label={i18n.t('移除第 {0} 列', [index + 1])} onClick={() => { apply.reset(); setColumns(previous => previous.filter((_, i) => i !== index)) }}><Trash2 /></Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      <div className="flex flex-wrap gap-2 shrink-0">
        <Button type="button" size="sm" variant="outline" onClick={() => { apply.reset(); setColumns(previous => [...previous, { name: '', type: 'text', nullable: true, primary: false, autoIncrement: false, defaultText: '' }]) }}><Plus className="w-3.5 h-3.5 mr-1" />{i18n.t('添加列')}</Button>
        <Button type="submit" size="sm" variant="outline" disabled={apply.planning}><Eye className="w-3.5 h-3.5 mr-1" />{i18n.t('预览 DDL')}</Button>
        <Button type="button" size="sm" disabled={!apply.plan} onClick={apply.confirm} data-action="apply-schema">{i18n.t('创建…')}</Button>
      </div>
      {draftError ? <p role="alert" className="text-xs text-destructive shrink-0">{draftError}</p> : null}
      {apply.planError ? <StatusState compact error={apply.planError} title={i18n.t('无法生成修改')} /> : null}
      {apply.plan ? <div className="shrink-0"><SchemaPlanPreview plan={apply.plan} /></div> : null}
      {apply.dialog}
    </form>
  )
}
