import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Eraser, Lock, Pencil, RefreshCw, Save, Search, X } from 'lucide-react'
import { cn } from '@zhin.js/client'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Input } from '../../components/ui/input'
import { Skeleton } from '../../components/ui/skeleton'
import { Switch } from '../../components/ui/switch'
import { StatusState } from '../../components/StatusState'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { SchemaFieldEditor } from '../../components/PluginConfigForm/SchemaFieldEditor'
import type { SchemaEditorDrafts } from '../../components/PluginConfigForm/types'
import { featureGlobalHref } from '../../console-routes.mjs'
import { FEATURE_RPC } from '../../contracts/zhin-console'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { ObjectSection } from '../../scope/ObjectPageLayout'
import { SCOPE_LEVEL_LABELS, scopeKey, type Scope } from '../../scope/scope-tree.mjs'
import {
  featuresAtLevel, jsonSchemaToField, overrideDraftSeed, readFeatureDetail, readFeatureWriteResult, removeOverrideRequest, setEnabledRequest,
  setOverrideRequest, type FeatureDetail, type FeatureFieldRow, type FeatureLevel, type FeatureOverrideLevel, type FeatureSummary,
} from './feature-model.mjs'
import {
  FEATURE_ROW_FILTERS, featureChangeApplied, featureFieldView, featureLevelRow, featureLockHref,
  featureReceiptOutcome, featureRowCounts, featureValueText, filterFeatureRows, parentFeatureTarget,
  type FeatureChange, type FeatureLevelRow, type FeatureRowFilter,
} from './feature-scope-model.mjs'
import { useFeatureList } from './use-feature-data'
import './feature-level-panel.css'

type I18n = ReturnType<typeof useI18n>
type DetailState = { status: 'loading' | 'ready' | 'failed'; value: FeatureDetail | null; error: unknown }

function levelCopy(level: FeatureOverrideLevel, i18n: I18n): { title: string; description: string } {
  if (level === 'adapter') return { title: i18n.t('这个适配器的功能'), description: i18n.t('这里的设置作用于该适配器下的所有账号与会话；没有覆盖的字段继承全局。') }
  if (level === 'endpoint') return { title: i18n.t('这个账号的功能'), description: i18n.t('这里的设置只作用于该账号及其会话；没有覆盖的字段继承适配器或全局。') }
  return { title: i18n.t('这个会话的功能'), description: i18n.t('这里的设置只作用于这个会话；只能改插件声明为会话可改的字段。上级禁用的功能在这里不能打开。') }
}

function filterLabel(id: FeatureRowFilter, i18n: I18n): string {
  return id === 'all' ? i18n.t('全部') : id === 'overridden' ? i18n.t('本层有覆盖') : id === 'disabled' ? i18n.t('已关闭') : i18n.t('已锁定')
}

function detailRequest(plugin: string, level: FeatureLevel, key?: string) {
  return { type: FEATURE_RPC.GET, plugin, level, ...(key ? { key } : {}) }
}

async function readDetail(plugin: string, level: FeatureLevel, key?: string): Promise<FeatureDetail> {
  return readFeatureDetail(await requestConsole<unknown>(detailRequest(plugin, level, key)))
}

/** `feature.get` of every listed plugin at one level, read in parallel; one plugin can be re-read alone. */
function useLevelDetails(plugins: readonly string[], level: FeatureLevel, key: string) {
  const [details, setDetails] = useState<Record<string, DetailState>>({})
  const generation = useRef(0)
  const names = plugins.join('\u0000')
  const loadOne = useCallback((plugin: string, ticket = generation.current) => {
    setDetails(previous => ({ ...previous, [plugin]: { status: previous[plugin]?.value ? previous[plugin].status : 'loading', value: previous[plugin]?.value ?? null, error: null } }))
    readDetail(plugin, level, key).then(
      value => { if (ticket === generation.current) setDetails(previous => ({ ...previous, [plugin]: { status: 'ready', value, error: null } })) },
      (error: unknown) => { if (ticket === generation.current) setDetails(previous => ({ ...previous, [plugin]: { status: 'failed', value: previous[plugin]?.value ?? null, error } })) },
    )
  }, [level, key])
  const loadAll = useCallback(() => {
    const ticket = ++generation.current
    for (const plugin of names ? names.split('\u0000') : []) loadOne(plugin, ticket)
  }, [names, loadOne])
  useEffect(() => {
    loadAll()
    return () => { generation.current += 1 }
  }, [loadAll])
  return { details, reload: loadOne, reloadAll: loadAll }
}

/**
 * 功能 tab below 全局 (ADR 0050 / 0052 / 0055): one row per plugin with its effective state, the level
 * that decided it, whether this level overrides it and which level locks it (linking to that level's
 * object page). Expanded, every field shows its inherited value, this level's override, the effective
 * value and its source. Writes go through an ActionReceipt; locked and conflicting writes are
 * reported with StatusState.
 */
export function FeatureLevelPanel({ scope }: { scope: Scope }) {
  const i18n = useI18n()
  const level = scope.level as FeatureOverrideLevel
  const key = scopeKey(scope) ?? ''
  const list = useFeatureList()
  const features = useMemo(() => list.value ? featuresAtLevel(list.value.features, level) : [], [list.value, level])
  const plugins = useMemo(() => features.map(feature => feature.plugin), [features])
  const { details, reload, reloadAll } = useLevelDetails(plugins, level, key)
  const [filter, setFilter] = useState<FeatureRowFilter>('all')
  const [query, setQuery] = useState('')
  const rows = useMemo(() => features.map(feature => featureLevelRow(feature, details[feature.plugin]?.value ?? null, level)), [features, details, level])
  const counts = featureRowCounts(rows)
  const visible = filterFeatureRows(rows, filter, query)
  const copy = levelCopy(level, i18n)
  const refresh = () => { list.refresh(); reloadAll() }
  if (list.status === 'unsupported' || list.status === 'forbidden') {
    return (
      <StatusState kind={list.status} permissions={list.status === 'forbidden' ? ['feature.view'] : undefined}
        description={list.status === 'unsupported' ? i18n.t('按{0}配置功能需要新版 Host。升级前这里沿用上级的配置。', [i18n.t(SCOPE_LEVEL_LABELS[level])]) : undefined} />
    )
  }
  return (
    <ObjectSection title={copy.title} description={copy.description}
      actions={<Button variant="outline" size="sm" onClick={refresh} disabled={list.status === 'loading'}><RefreshCw className={list.status === 'loading' ? 'animate-spin' : ''} />{i18n.t('刷新')}</Button>}>
      <FeatureReadOnlyNote />
      {list.status === 'error' ? <StatusState error={list.error} onRetry={list.refresh} /> : null}
      {list.status === 'loading' && !list.value ? (
        <div className="space-y-2">{[0, 1, 2].map(index => <Skeleton key={index} className="h-16" />)}</div>
      ) : list.value && !features.length ? (
        <StatusState kind="empty" title={i18n.t('没有可在这一层设置的功能')} description={i18n.t('只支持全局配置的功能不会出现在这里；它们在全局「功能」页签里。')} />
      ) : list.value ? (
        <>
          <div className="console-feature-toolbar">
            <div className="console-feature-filters" role="group" aria-label={i18n.t('筛选功能')}>
              {FEATURE_ROW_FILTERS.map(id => (
                <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)} className={cn('console-feature-filter', filter === id && 'is-active')}>
                  {filterLabel(id, i18n)}<span className="console-feature-filter-count">{counts[id]}</span>
                </button>
              ))}
            </div>
            <label className="console-feature-search">
              <Search aria-hidden="true" />
              <Input className="h-8" type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder={i18n.t('搜索功能')} aria-label={i18n.t('搜索功能')} />
            </label>
          </div>
          {!visible.length ? (
            <StatusState kind="empty" compact title={i18n.t('没有符合条件的功能')} actions={<Button size="sm" variant="outline" onClick={() => { setFilter('all'); setQuery('') }}>{i18n.t('清除筛选')}</Button>} />
          ) : (
            <Card className="console-feature-rows overflow-hidden p-0" role="list" aria-label={copy.title}>
              {visible.map(row => {
                const feature = features.find(item => item.plugin === row.plugin)!
                return <FeatureRow key={row.plugin} scope={scope} level={level} levelKey={key} feature={feature} row={row}
                  detail={details[row.plugin] ?? { status: 'loading', value: null, error: null }} reload={() => reload(row.plugin)} />
              })}
            </Card>
          )}
        </>
      ) : null}
    </ObjectSection>
  )
}

function StateBadge({ row }: { row: FeatureLevelRow }) {
  const i18n = useI18n()
  if (row.state === 'locked') return <Badge variant="secondary" size="sm"><Lock className="h-3 w-3" aria-hidden="true" />{i18n.t('已锁定')}</Badge>
  if (row.state === 'enabled') return <Badge variant="success" size="sm">{i18n.t('启用')}</Badge>
  if (row.state === 'disabled') return <Badge variant="outline" size="sm">{i18n.t('已关闭')}</Badge>
  return <Badge variant="outline" size="sm">{i18n.t('状态未知')}</Badge>
}

/** 「被 适配器 icqq 锁定」 linking to the locking level's 功能 tab. */
function LockLink({ row, scope }: { row: FeatureLevelRow; scope: Scope }) {
  const i18n = useI18n()
  if (!row.lockedBy) return null
  const target = row.lockedBy === 'global' ? i18n.t('全局')
    : row.lockedBy === 'adapter' ? `${i18n.t('适配器')} ${scope.adapter}` : `${i18n.t('账号')} ${scope.endpoint}`
  return (
    <Link to={featureLockHref(row.lockedBy, scope)} className="console-feature-lock-link">
      <Lock aria-hidden="true" />{i18n.t('被 {0} 锁定', [target])}
    </Link>
  )
}

interface PendingChange { readonly body: Record<string, unknown> & { type: string }; readonly change: FeatureChange }

interface FeatureRowProps {
  readonly scope: Scope
  readonly level: FeatureOverrideLevel
  readonly levelKey: string
  readonly feature: FeatureSummary
  readonly row: FeatureLevelRow
  readonly detail: DetailState
  readonly reload: () => void
}

function FeatureRow({ scope, level, levelKey, feature, row, detail, reload }: FeatureRowProps) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const canToggle = hasConsolePermission('feature.toggle', access)
  const canConfigure = hasConsolePermission('feature.configure', access)
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const value = detail.value
  const pending = useRef<PendingChange | null>(null)
  const receipt = useActionReceipt({
    submit: async () => {
      const current = pending.current
      if (!current) throw new Error('No change')
      try {
        const outcome = featureReceiptOutcome(readFeatureWriteResult(await requestConsole<unknown>(current.body)))
        if (outcome.locked) throw Object.assign(new Error(outcome.message), { code: 'locked', lockedBy: outcome.lockedBy })
        return outcome
      } finally {
        // Every outcome re-reads: a conflict or lock shows the newer state, a success its effect.
        reload()
      }
    },
    verify: async () => {
      const current = pending.current
      if (!current) return undefined
      return { applied: featureChangeApplied(await readDetail(feature.plugin, level, levelKey), current.change) }
    },
    onSettled: () => setEditing(null),
  })
  const busy = receipt.state.phase === 'submitting' || receipt.state.phase === 'verifying' || receipt.state.phase === 'prepared' || receipt.state.phase === 'confirming'
  const valueCopy = { unset: i18n.t('未设置'), masked: i18n.t('已隐藏的敏感值') }
  const where = `${i18n.t(SCOPE_LEVEL_LABELS[level])} ${level === 'conversation' ? `${scope.kind}:${scope.id}` : level === 'endpoint' ? `${scope.adapter} / ${scope.endpoint}` : scope.adapter}`
  const prepare = (change: PendingChange, plan: { title: string; changes?: string[]; danger?: boolean; confirmLabel?: string; summary?: string }) => {
    pending.current = change
    receipt.prepare(plan)
  }
  const toggle = (enabled: boolean) => {
    if (!value || value.lockedBy) return
    prepare({ body: setEnabledRequest({ plugin: feature.plugin, level, key: levelKey, enabled, revision: value.revision }), change: { kind: 'enabled', enabled } }, {
      title: enabled ? i18n.t('在{0}启用 {1}', [where, row.displayName]) : i18n.t('在{0}关闭 {1}', [where, row.displayName]),
      changes: [i18n.t('启用状态：{0} → {1}', [value.enabled ? i18n.t('启用') : i18n.t('关闭'), enabled ? i18n.t('启用') : i18n.t('关闭')])],
      summary: enabled ? undefined : i18n.t('关闭后，这一层以下的范围都不能再打开它。'),
      // Turning a feature off for a whole adapter affects every account under it.
      danger: !enabled && level === 'adapter',
      confirmLabel: enabled ? i18n.t('启用') : i18n.t('关闭'),
    })
  }
  const saveField = (field: FeatureFieldRow, next: unknown) => {
    if (!value) return
    prepare({ body: setOverrideRequest({ plugin: feature.plugin, level, key: levelKey, field: field.name, value: next, revision: value.revision }), change: { kind: 'set', field: field.name, value: next } }, {
      title: i18n.t('在{0}覆盖 {1} · {2}', [where, row.displayName, field.name]),
      changes: [i18n.t('{0}：{1} → {2}', [field.name, featureValueText(field.overridden ? field.stored : field.effective, valueCopy), featureValueText(next, valueCopy)])],
      confirmLabel: i18n.t('保存覆盖'),
    })
  }
  const removeField = (field: FeatureFieldRow) => {
    if (!value) return
    prepare({ body: removeOverrideRequest({ plugin: feature.plugin, level, key: levelKey, field: field.name, revision: value.revision }), change: { kind: 'remove', field: field.name } }, {
      title: i18n.t('移除{0}对 {1} · {2} 的覆盖', [where, row.displayName, field.name]),
      changes: [i18n.t('{0} 改回继承上级的值', [field.name])],
      danger: true,
      confirmLabel: i18n.t('移除覆盖'),
    })
  }
  const clearAll = () => {
    if (!value) return
    prepare({ body: removeOverrideRequest({ plugin: feature.plugin, level, key: levelKey, revision: value.revision }), change: { kind: 'clear' } }, {
      title: i18n.t('移除{0}对 {1} 的全部覆盖', [where, row.displayName]),
      changes: [
        ...(row.switchOverridden ? [i18n.t('启用状态改回继承上级')] : []),
        ...row.fields.filter(field => field.overridden).map(field => i18n.t('{0} 改回继承上级的值', [field.name])),
      ],
      danger: true,
      confirmLabel: i18n.t('全部移除'),
    })
  }
  // While a write is in flight the switch only reads as disabled (aria-disabled): a real `disabled`
  // would drop keyboard focus to the page start.
  const switchState = { checked: row.state === 'enabled', disabled: !value || row.state === 'locked' || !canToggle, busy }
  const sourceLabel = row.stateSource ? i18n.t(SCOPE_LEVEL_LABELS[row.stateSource]) : null
  const expandable = Boolean(value)
  return (
    <div role="listitem" className={cn('console-feature-row', open && 'is-open')}>
      <div className="console-feature-row-head">
        <Button variant="ghost" size="icon" className="console-feature-expand" data-feature-expand aria-expanded={open} disabled={!expandable}
          aria-label={open ? i18n.t('收起 {0}', [row.displayName]) : i18n.t('展开 {0}', [row.displayName])} onClick={() => setOpen(previous => !previous)}>
          {open ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <div className="console-feature-row-name">
          <Link to={featureGlobalHref(feature.plugin)} className="console-feature-row-title">{row.displayName}</Link>
          {row.displayName !== row.plugin ? <code className="console-feature-row-id" title={row.plugin}>{row.plugin}</code> : null}
        </div>
        <div className="console-feature-row-meta">
          {detail.status === 'loading' && !value ? <Skeleton className="h-5 w-24" /> : value ? <>
            <StateBadge row={row} />
            {row.lockedBy ? <LockLink row={row} scope={scope} />
              : sourceLabel ? <span className="console-feature-source">{row.stateSource === level ? i18n.t('本层设置') : i18n.t('继承自{0}', [sourceLabel])}</span> : null}
            {row.overriddenHere ? <Badge variant="info" size="sm">{row.fieldOverrides ? i18n.t('本层覆盖 {0} 项', [row.fieldOverrides + (row.switchOverridden ? 1 : 0)]) : i18n.t('本层覆盖开关')}</Badge> : null}
            {!row.configurable ? <Badge variant="outline" size="sm">{i18n.t('仅开关')}</Badge> : null}
          </> : null}
        </div>
        <div className="console-feature-row-switch">
          <Switch aria-label={i18n.t('{0} · 启用', [row.displayName])} checked={switchState.checked} disabled={switchState.disabled}
            aria-disabled={switchState.disabled || switchState.busy || undefined} className={switchState.busy ? 'cursor-wait opacity-60' : undefined}
            title={!canToggle ? i18n.t('当前身份不能启停功能') : undefined} onCheckedChange={checked => { if (!switchState.disabled && !switchState.busy) toggle(checked === true) }} />
        </div>
      </div>
      {detail.status === 'failed' ? <div className="console-feature-row-body"><StatusState compact error={detail.error} onRetry={reload} /></div> : null}
      <ActionReceipt controller={receipt} className="console-feature-row-receipt" lockHref={featureLockHref(receipt.state.status?.lockedBy ?? row.lockedBy ?? 'global', scope)} />
      {open && value ? (
        <div className="console-feature-row-body">
          <FeatureFields scope={scope} feature={feature} level={level} detail={value} row={row} editing={editing} setEditing={setEditing}
            canConfigure={canConfigure} busy={busy} onSave={saveField} onRemove={removeField} />
          {row.overriddenHere && canConfigure ? (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" disabled={busy} onClick={clearAll}><Eraser />{i18n.t('移除此层全部覆盖')}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

interface FeatureFieldsProps {
  readonly scope: Scope
  readonly feature: FeatureSummary
  readonly level: FeatureOverrideLevel
  readonly detail: FeatureDetail
  readonly row: FeatureLevelRow
  readonly editing: string | null
  readonly setEditing: (name: string | null) => void
  readonly canConfigure: boolean
  readonly busy: boolean
  readonly onSave: (field: FeatureFieldRow, value: unknown) => void
  readonly onRemove: (field: FeatureFieldRow) => void
}

/** Parent level's `feature.get`, only when a field is overridden (its 继承值 is not in this level's reply). */
function useParentDetail(plugin: string, level: FeatureOverrideLevel, key: string | undefined, needed: boolean) {
  const [state, setState] = useState<{ value: FeatureDetail | null; failed: boolean }>({ value: null, failed: false })
  const parent = parentFeatureTarget(level, key)
  const parentLevel = parent?.level
  const parentKey = parent?.key
  useEffect(() => {
    if (!needed || !parentLevel) return
    let cancelled = false
    readDetail(plugin, parentLevel, parentKey).then(
      value => { if (!cancelled) setState({ value, failed: false }) },
      () => { if (!cancelled) setState({ value: null, failed: true }) },
    )
    return () => { cancelled = true }
  }, [plugin, parentLevel, parentKey, needed])
  return state
}

function FeatureFields({ scope, feature, level, detail, row, editing, setEditing, canConfigure, busy, onSave, onRemove }: FeatureFieldsProps) {
  const i18n = useI18n()
  const parent = useParentDetail(feature.plugin, level, scopeKey(scope) ?? undefined, row.fieldOverrides > 0)
  if (!row.fields.length) {
    return <p className="console-feature-note">{row.configurable ? i18n.t('这个功能没有可配置的字段，只有开关。') : i18n.t('这个功能在这一层只有开关；字段在全局配置。')}</p>
  }
  const copy = { unset: i18n.t('未设置'), masked: i18n.t('已隐藏的敏感值') }
  const sourceText = (source: FeatureLevel | null) => source ? i18n.t(SCOPE_LEVEL_LABELS[source]) : '—'
  return (
    <>
      {level === 'conversation' ? (
        <p className="console-feature-note">{feature.conversationFields?.length
          ? i18n.t('会话层可改：{0}。其余字段只读。', [feature.conversationFields.join('、')])
          : i18n.t('这个功能在会话层只能开关，字段都只读。')}</p>
      ) : null}
      <div className="console-feature-fields" role="table" aria-label={i18n.t('{0} 的字段', [row.displayName])}>
        <div className="console-feature-field is-head" role="row">
          <span role="columnheader">{i18n.t('字段')}</span>
          <span role="columnheader">{i18n.t('继承值')}</span>
          <span role="columnheader">{i18n.t('本层覆盖')}</span>
          <span role="columnheader">{i18n.t('有效值')}</span>
          <span role="columnheader">{i18n.t('来源')}</span>
          <span role="columnheader" className="text-right">{i18n.t('操作')}</span>
        </div>
        {row.fields.map(field => {
          const view = featureFieldView(field, parent.value)
          const schema = jsonSchemaToField(field.schema)
          const title = schema.title ?? field.name
          return (
            <div key={field.name} role="rowgroup" className="console-feature-field-group">
              <div className={cn('console-feature-field', field.overridden && 'is-overridden')} role="row">
                <span role="cell" className="console-feature-field-name" data-label={i18n.t('字段')}>
                  <span className="font-medium">{title}</span>
                  {title !== field.name ? <code>{field.name}</code> : null}
                  {!field.editable ? <Badge variant="outline" size="sm">{level === 'conversation' ? i18n.t('会话层只读') : i18n.t('仅全局')}</Badge> : null}
                </span>
                <span role="cell" data-label={i18n.t('继承值')} className="console-feature-value is-muted">
                  {view.inherited.known ? featureValueText(view.inherited.value, copy) : parent.failed ? i18n.t('读取失败') : '…'}
                </span>
                <span role="cell" data-label={i18n.t('本层覆盖')} className="console-feature-value">
                  {view.here ? featureValueText(view.here.value, copy) : <span className="text-muted-foreground">—</span>}
                </span>
                <span role="cell" data-label={i18n.t('有效值')} className="console-feature-value is-strong">{featureValueText(view.effective, copy)}</span>
                <span role="cell" data-label={i18n.t('来源')}>
                  {field.overridden ? <Badge variant="info" size="sm">{i18n.t('本层')}</Badge> : <span className="text-muted-foreground">{sourceText(view.source)}</span>}
                </span>
                <span role="cell" className="console-feature-field-actions">
                  {field.editable && canConfigure && editing !== field.name ? <>
                    <Button variant="ghost" size="sm" disabled={busy} onClick={() => setEditing(field.name)}><Pencil />{field.overridden ? i18n.t('编辑') : i18n.t('覆盖')}</Button>
                    {field.overridden ? <Button variant="ghost" size="sm" disabled={busy} onClick={() => onRemove(field)}><Eraser />{i18n.t('移除')}</Button> : null}
                  </> : null}
                </span>
              </div>
              {editing === field.name ? (
                <FieldEditor field={field} busy={busy} onCancel={() => setEditing(null)} onSave={next => onSave(field, next)} />
              ) : null}
            </div>
          )
        })}
      </div>
    </>
  )
}

function FieldEditor({ field, busy, onCancel, onSave }: { field: FeatureFieldRow; busy: boolean; onCancel: () => void; onSave: (value: unknown) => void }) {
  const i18n = useI18n()
  const [draft, setDraft] = useState<unknown>(() => overrideDraftSeed(field))
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set())
  const [drafts] = useState<SchemaEditorDrafts>(() => ({ json: new Map(), unions: new Map(), originals: new Map() }))
  const schema = useMemo(() => jsonSchemaToField(field.schema), [field.schema])
  return (
    <div className="console-feature-editor">
      <SchemaFieldEditor name={field.name} field={schema} value={draft} onChange={setDraft} path={`$/${field.name}`} drafts={drafts}
        onValidityChange={(path, bad) => setInvalid(previous => {
          if (previous.has(path) === bad) return previous
          const next = new Set(previous); if (bad) next.add(path); else next.delete(path); return next
        })} />
      {draft === undefined ? <p className="console-feature-note">{i18n.t('填写一个值后才能保存覆盖。')}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}><X />{i18n.t('取消')}</Button>
        <Button size="sm" disabled={busy || draft === undefined || invalid.size > 0} onClick={() => onSave(draft)}><Save />{i18n.t('预览修改')}</Button>
      </div>
    </div>
  )
}

/** Shown above the rows when the identity may only read. */
export function FeatureReadOnlyNote() {
  const i18n = useI18n()
  const access = useConsoleAccess()
  if (hasConsolePermission('feature.configure', access) && hasConsolePermission('feature.toggle', access)) return null
  return <Alert role="status"><AlertDescription>{i18n.t('当前身份只能查看部分功能设置，无法修改。')}</AlertDescription></Alert>
}
