import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { ChevronDown, ChevronRight, Eraser, Pencil, Save, ToggleLeft, X } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { EmptyState } from '../../components/empty-state'
import { ErrorAlert } from '../../components/error-alert'
import { SchemaFieldEditor } from '../../components/PluginConfigForm/SchemaFieldEditor'
import type { SchemaEditorDrafts } from '../../components/PluginConfigForm/types'
import { featureGlobalHref } from '../../console-routes.mjs'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import {
  containsRedacted, featureFieldRows, featuresAtLevel, jsonSchemaToField, overrideDraftSeed, removeOverrideRequest, setEnabledRequest,
  setOverrideRequest, type FeatureFieldRow, type FeatureOverrideLevel, type FeatureSummary,
} from './feature-model.mjs'
import { useFeatureDetail, useFeatureList, useFeatureWriter } from './use-feature-data'
import { FeatureSwitch } from './feature-switch'
import { FeatureOverridesNotice } from './feature-overrides-notice'

interface LevelTarget {
  readonly level: FeatureOverrideLevel
  /** `alias` (adapter), `<alias>/<endpointId>` (endpoint) or `<alias>/<endpointId>/<kind>:<id>` (conversation). */
  readonly levelKey: string
  readonly adapter: string
  /** Endpoint id on the endpoint and conversation levels (lock links). */
  readonly endpoint?: string
}

function levelHeading(level: FeatureOverrideLevel, i18n: ReturnType<typeof useI18n>): { title: string; description: string } {
  if (level === 'adapter') return { title: i18n.t("功能覆盖"), description: i18n.t("在这里的修改只作用于该适配器下的账号；未覆盖的字段继承全局配置。") }
  if (level === 'endpoint') return { title: i18n.t("该账号的功能"), description: i18n.t("在这里的修改只作用于该账号；未覆盖的字段继承适配器或全局配置。") }
  return { title: i18n.t("该会话的功能"), description: i18n.t("在这里的修改只作用于这个会话；未覆盖的字段继承账号、适配器或全局配置。上级禁用的功能在这里不能打开。") }
}

/** Feature switches and field overrides of one adapter, endpoint or conversation level (ADR 0050 / 0052 / 0055). */
export function FeatureLevelPanel({ level, levelKey, adapter, endpoint }: LevelTarget) {
  const i18n = useI18n()
  const list = useFeatureList()
  const features = list.value ? featuresAtLevel(list.value.features, level) : []
  if (list.status === 'unsupported' || list.status === 'forbidden') return <FeatureOverridesNotice status={list.status} level={level} />
  return (
    <section aria-labelledby={`features-${level}`} className="space-y-3">
      <h2 id={`features-${level}`} className="text-base font-semibold">{levelHeading(level, i18n).title}</h2>
      <p className="text-sm text-muted-foreground">{levelHeading(level, i18n).description}</p>
      {list.error && list.status === 'error' ? <ErrorAlert error={list.error} onRetry={list.refresh} /> : null}
      {list.status === 'loading' ? (
        <div className="space-y-2">{[0, 1].map(index => <Skeleton key={index} className="h-14" />)}</div>
      ) : !features.length && list.value ? (
        <Card><EmptyState icon={ToggleLeft} compact title={i18n.t("没有可在此层配置的功能")}
          description={i18n.t("只支持全局配置的功能不会出现在这里。")} /></Card>
      ) : (
        <div className="space-y-2">
          {features.map(feature => <FeatureLevelCard key={feature.plugin} feature={feature} level={level} levelKey={levelKey} adapter={adapter} endpoint={endpoint} />)}
        </div>
      )}
    </section>
  )
}

function FeatureLevelCard({ feature, level, levelKey, adapter, endpoint }: LevelTarget & { feature: FeatureSummary }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const canToggle = hasConsolePermission('feature.toggle', access)
  const canConfigure = hasConsolePermission('feature.configure', access)
  const detail = useFeatureDetail(feature.plugin, level, levelKey)
  const { write, pending } = useFeatureWriter()
  const [open, setOpen] = useState(false)
  const value = detail.value
  const rows = useMemo(() => value ? featureFieldRows(value, feature.conversationFields) : [], [value, feature.conversationFields])
  const overrides = rows.filter(row => row.overridden).length
  const configurable = feature.levels.includes(level)
  const revision = value?.revision
  const reload = detail.refresh
  const toggle = (enabled: boolean) => {
    // Locked by a higher level: neither enabling nor disabling here (the switch is inert, too).
    if (!value || value.lockedBy) return
    void write(setEnabledRequest({ plugin: feature.plugin, level, key: levelKey, enabled, revision }), reload, 'enabled')
  }
  const clearLevel = () => void write(removeOverrideRequest({ plugin: feature.plugin, level, key: levelKey, revision }), reload, 'clear')
  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center gap-3 p-3">
        <Button variant="ghost" size="sm" aria-expanded={open} disabled={!configurable || !value}
          aria-label={open ? i18n.t("收起 {0}", [feature.plugin]) : i18n.t("展开 {0}", [feature.plugin])} onClick={() => setOpen(previous => !previous)}>
          {open ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <div className="min-w-0 flex-1">
          <Link to={featureGlobalHref(feature.plugin)} className="font-medium hover:underline">{feature.displayName}</Link>
          {feature.displayName !== feature.plugin ? <span className="ml-2 text-xs text-muted-foreground">{feature.plugin}</span> : null}
          <div className="mt-1 flex flex-wrap gap-1">
            {overrides ? <Badge variant="info" size="sm">{i18n.t("{0} 项覆盖", [overrides])}</Badge> : null}
            {!configurable ? <Badge variant="outline" size="sm">{i18n.t("仅启停")}</Badge> : null}
          </div>
        </div>
        {value ? (
          <FeatureSwitch label={i18n.t("{0} · 启用", [feature.plugin])} plugin={feature.plugin} adapter={adapter} endpoint={endpoint}
            enabled={value.enabled} lockedBy={value.lockedBy} canToggle={canToggle} pending={pending === 'enabled'} onToggle={toggle} />
        ) : detail.status === 'loading' ? <Skeleton className="h-5 w-9" /> : null}
      </div>
      {detail.error && detail.status !== 'loading' ? <div className="px-3 pb-3"><ErrorAlert error={detail.error} onRetry={reload} /></div> : null}
      {open && value ? (
        <div className="space-y-3 border-t p-3">
          {!rows.length ? <p className="text-sm text-muted-foreground">{i18n.t("这个功能没有可配置的字段。")}</p> : null}
          {rows.map(row => (
            <FieldOverrideRow key={row.name} row={row} level={level} canConfigure={canConfigure} pending={pending === row.name}
              onSave={next => write(setOverrideRequest({ plugin: feature.plugin, level, key: levelKey, field: row.name, value: next, revision }), reload, row.name)}
              onRemove={() => void write(removeOverrideRequest({ plugin: feature.plugin, level, key: levelKey, field: row.name, revision }), reload, row.name)} />
          ))}
          {overrides && canConfigure ? (
            <div className="flex justify-end">
              <Button variant="outline" size="sm" disabled={pending === 'clear'} onClick={clearLevel}><Eraser />{i18n.t("移除此层全部覆盖")}</Button>
            </div>
          ) : null}
        </div>
      ) : null}
    </Card>
  )
}

function valuePreview(value: unknown, i18n: ReturnType<typeof useI18n>): string {
  if (value === undefined) return i18n.t("未设置")
  if (containsRedacted(value)) return i18n.t("已隐藏的敏感值")
  if (typeof value === 'string') return value
  const text = JSON.stringify(value)
  return text.length > 120 ? `${text.slice(0, 117)}...` : text
}

function SourceBadge({ row, level }: { row: FeatureFieldRow; level: FeatureOverrideLevel }) {
  const i18n = useI18n()
  if (row.badge === 'here') return <Badge variant="info" size="sm">{i18n.t("在此覆盖")}</Badge>
  if (row.badge === 'endpoint' && level === 'conversation') return <Badge variant="secondary" size="sm">{i18n.t("继承自账号")}</Badge>
  if (row.badge === 'adapter' && level !== 'adapter') return <Badge variant="secondary" size="sm">{i18n.t("继承自适配器")}</Badge>
  if (row.badge === 'global') return <Badge variant="secondary" size="sm">{i18n.t("继承自全局")}</Badge>
  return <Badge variant="outline" size="sm">{i18n.t("未设置")}</Badge>
}

interface FieldOverrideRowProps {
  readonly row: FeatureFieldRow
  readonly level: FeatureOverrideLevel
  readonly canConfigure: boolean
  readonly pending: boolean
  readonly onSave: (value: unknown) => Promise<unknown>
  readonly onRemove: () => void
}

function FieldOverrideRow({ row, level, canConfigure, pending, onSave, onRemove }: FieldOverrideRowProps) {
  const i18n = useI18n()
  const [draft, setDraft] = useState<{ value: unknown } | null>(null)
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set())
  const [drafts] = useState<SchemaEditorDrafts>(() => ({ json: new Map(), unions: new Map(), originals: new Map() }))
  const field = useMemo(() => jsonSchemaToField(row.schema), [row.schema])
  const title = field.title ?? row.name
  const save = async () => {
    if (!draft || draft.value === undefined || invalid.size) return
    const result = await onSave(draft.value)
    // Keep the draft on conflict / invalid: the row reloads and the user can retry.
    const status = result && typeof result === 'object' ? (result as { status?: string }).status : undefined
    if (status === 'saved' || status === 'unchanged') setDraft(null)
  }
  return (
    <div className="rounded-md border p-3">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium">{title}</span>
            {title !== row.name ? <code className="text-xs text-muted-foreground">{row.name}</code> : null}
            <SourceBadge row={row} level={level} />
            {!row.editable ? <Badge variant="outline" size="sm">{level === 'conversation' ? i18n.t("会话层不可改") : i18n.t("仅全局")}</Badge> : null}
          </div>
          {field.description ? <p className="mt-0.5 text-xs text-muted-foreground">{field.description}</p> : null}
          <p className="mt-1 break-all text-sm"><span className="text-muted-foreground">{i18n.t("有效值：")}</span>{valuePreview(row.effective, i18n)}</p>
        </div>
        {row.editable && canConfigure && !draft ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDraft({ value: overrideDraftSeed(row) })}>
              <Pencil />{row.overridden ? i18n.t("编辑覆盖") : i18n.t("覆盖")}
            </Button>
            {row.overridden ? <Button variant="outline" size="sm" disabled={pending} onClick={onRemove}><Eraser />{i18n.t("移除覆盖")}</Button> : null}
          </div>
        ) : null}
      </div>
      {draft ? (
        <div className="mt-3 space-y-2">
          <SchemaFieldEditor name={row.name} field={field} value={draft.value} onChange={value => setDraft({ value })}
            path={`$/${row.name}`} drafts={drafts}
            onValidityChange={(path, bad) => setInvalid(previous => {
              if (previous.has(path) === bad) return previous
              const next = new Set(previous); if (bad) next.add(path); else next.delete(path); return next
            })} />
          {draft.value === undefined ? <p className="text-xs text-muted-foreground">{i18n.t("填写一个值后才能保存覆盖。")}</p> : null}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setDraft(null)}><X />{i18n.t("取消")}</Button>
            <Button size="sm" disabled={pending || draft.value === undefined || invalid.size > 0} onClick={() => void save()}><Save />{i18n.t("保存覆盖")}</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/** Alert shown instead of editors when the identity may only read. */
export function FeatureReadOnlyNote() {
  const i18n = useI18n()
  const access = useConsoleAccess()
  if (hasConsolePermission('feature.configure', access) && hasConsolePermission('feature.toggle', access)) return null
  return <Alert role="status"><AlertDescription>{i18n.t("当前身份只能查看部分功能设置，无法修改。")}</AlertDescription></Alert>
}
