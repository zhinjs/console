import { useI18n } from '../../i18n'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Settings, AlertCircle, Save, Loader2 } from 'lucide-react'
import type { PluginConfigFormProps, SchemaField, SchemaEditorDrafts } from './types.js'
import { usePluginConfigDraft } from './usePluginConfigDraft'
import { SchemaFieldEditor } from './SchemaFieldEditor'
import { objectFields, declaredDefaults, initialSchemaValue, updateObjectField, hostValidationSummary } from './schema-model.mjs'
import { Card } from '../ui/card'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'
import { createConfigDraftGuard } from './draft-guard.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { configurationSaveSummary } from './config-evidence-model.mjs'

interface ConfigValidation { valid: boolean; schemaAvailable?: boolean; errors: Array<{ path: string; message: string }>; missingEnv: string[] }

type EditableConfigProps = Omit<PluginConfigFormProps, 'schema' | 'initialConfig'> & {
  sourceRevision?: string
  /** Presentation only: the owner retains one complete draft and CAS baseline. */
  fieldNames?: readonly string[]; excludedFieldNames?: readonly string[]
  displayTitle?: string
}

function initialFormDraft(schema: SchemaField | null, config: unknown, scoped: boolean): unknown {
  // A category must never turn unrelated inherited defaults into explicit file values.
  if (scoped) return config === undefined ? undefined : structuredClone(config)
  return schema ? declaredDefaults(schema, config === undefined && ['object', 'dict', 'list', 'tuple', 'intersect'].includes(schema.type) ? initialSchemaValue(schema) : config) : config
}

export function PluginConfigForm(props: EditableConfigProps) {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Card className="mt-4 p-4" role="status">{i18n.t("连接身份已变化，请登录当前 Host 后重新读取配置。")}</Card>
  // A different Host or credential owns a fresh draft and confirmation session.
  return <PluginConfigFormSession key={JSON.stringify([scope, props.pluginName])} {...props} connectionScope={scope} />
}

function PluginConfigFormSession({ pluginName, onSuccess, sourceRevision, fieldNames, excludedFieldNames, displayTitle, connectionScope }: EditableConfigProps & { connectionScope: string }) {
  const i18n = useI18n()
  const scoped = fieldNames !== undefined || excludedFieldNames !== undefined
  const filtersRootFields = fieldNames !== undefined || Boolean(excludedFieldNames?.length)
  const form = usePluginConfigDraft(pluginName)
  const [localConfig, setLocalConfig] = useState<unknown>(undefined)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(new Set())
  const [draftVersion, setDraftVersion] = useState(0)
  const editorDrafts = useRef<SchemaEditorDrafts>({ json: new Map(), unions: new Map(), originals: new Map() })
  // An unmounted category can still own an invalid JSON draft. Keep saving blocked until it is fixed or discarded.
  const hasInvalidFields = invalidFields.size > 0 || scoped && [...editorDrafts.current.json.values()].some(draft => draft.error)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [validation, setValidation] = useState<ConfigValidation | null>(null)
  const guard = useRef(createConfigDraftGuard())
  const operation = useRef(0)
  const currentName = useRef(pluginName)
  currentName.current = pluginName
  useEffect(() => {
    operation.current++; setSaving(false); setSaveError(null); setMessage(null); setValidation(null)
    return () => { operation.current++ }
  }, [pluginName, connectionScope])
  useEffect(() => {
    if (!form.loaded) return
    if (guard.current.receive(pluginName, form.config, form.snapshot)) {
      setDraftName(pluginName)
      const next = initialFormDraft(form.schema, form.config, scoped)
      setLocalConfig(next); setInvalidFields(new Set())
      editorDrafts.current.json.clear(); editorDrafts.current.unions.clear(); editorDrafts.current.originals?.clear(); setDraftVersion(previous => previous + 1)
      setSaveError(null); setValidation(null)
    }
  }, [pluginName, form.loaded, form.config, form.schema, form.snapshot])
  const externalRevision = useRef(sourceRevision)
  useEffect(() => {
    if (sourceRevision === externalRevision.current) return
    externalRevision.current = sourceRevision
    if (sourceRevision && sourceRevision !== form.snapshot?.revision) void form.load()
  }, [sourceRevision, form.load, form.snapshot?.revision])
  const fields = objectFields(form.schema)
  const objectConfig = localConfig && typeof localConfig === 'object' && !Array.isArray(localConfig) ? localConfig as Record<string, unknown>
    : localConfig === undefined && form.schema?.type === 'object' ? {} : undefined
  const rootObject = form.schema?.type === 'object' && objectConfig !== undefined
  const categoryFields = Object.entries(fields).filter(([name, field]) => !field.hidden
    && (fieldNames === undefined || fieldNames.includes(name)) && !excludedFieldNames?.includes(name))
  const changeValue = (value: unknown) => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    guard.current.edited(); setValidation(null); setMessage(null)
    setLocalConfig(value)
  }
  const change = (name: string, value: unknown) => changeValue(updateObjectField(localConfig, name, value))
  const fieldValidity = useCallback((path: string, invalid: boolean) => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    if (invalid) guard.current.edited()
    setInvalidFields(previous => {
      if (previous.has(path) === invalid) return previous
      const next = new Set(previous); invalid ? next.add(path) : next.delete(path); return next
    })
  }, [connectionScope])
  // Field-group headers stick right under the action bar, whose height changes as it wraps.
  const actionbarObserver = useRef<ResizeObserver | null>(null)
  const actionbarRef = useCallback((node: HTMLDivElement | null) => {
    actionbarObserver.current?.disconnect()
    actionbarObserver.current = null
    if (!node || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => node.parentElement?.style.setProperty('--config-sticky-top', `${node.offsetHeight}px`))
    observer.observe(node)
    actionbarObserver.current = observer
  }, [])
  const handleSave = async () => {
    if (!isInboxCacheScopeActive(connectionScope) || form.scope !== connectionScope || form.snapshot?.connectionScope !== connectionScope
      || saving || !form.loaded || draftName !== pluginName || hasInvalidFields || !form.schema) return
    const name = pluginName
    const operationId = ++operation.current
    const currentOperation = () => isInboxCacheScopeActive(connectionScope) && currentName.current === name && operation.current === operationId
    setSaving(true); setSaveError(null); setMessage(null)
    try {
      const checked = await requestConsole<ConfigValidation>({ type: 'plugin:validate-config', pluginName: name, data: localConfig })
      if (!currentOperation()) return
      setValidation(checked)
      if (checked.schemaAvailable === false) throw new Error(i18n.t("配置字段定义不可用，请在文件管理中查看配置。"))
      if (!checked.valid || checked.missingEnv.length > 0) return
      const result = await form.setConfig(localConfig, guard.current.snapshot)
      if (!currentOperation()) return
      guard.current.saved()
      setMessage(configurationSaveSummary(result, i18n.locale))
      onSuccess?.()
      await form.load()
    } catch (cause) { if (currentOperation()) setSaveError(cause instanceof Error ? cause.message : i18n.t("保存失败，草稿已保留")) }
    finally { if (currentOperation()) setSaving(false) }
  }
  if (!form.loaded && !form.error) return <Card className="mt-4 p-4" role="status">{i18n.t("正在读取插件配置和字段定义…")}</Card>
  if (form.error && !form.loaded) return <Card className="mt-4 p-4 space-y-2" role="alert"><p>{i18n.t("配置读取失败。")}</p><p className="text-xs">{form.error}</p><Button variant="outline" onClick={() => void form.load()}>{i18n.t("重试读取")}</Button><Link className="text-sm underline" to="/files">{i18n.t("打开文件管理")}</Link></Card>
  if (form.schemaError || !form.schema) return <Card className="mt-4 p-4 space-y-2" role="alert">
    <p>{i18n.t("配置字段定义不可用，请在文件管理中查看配置。")}</p>
    {form.schemaError ? <p className="text-xs text-muted-foreground">{form.schemaError}</p> : null}
    <Link className="text-sm underline" to="/files">{i18n.t("打开文件管理")}</Link>
  </Card>
  return <Card className="mt-0 p-4 pt-0 space-y-4">
    <div ref={actionbarRef} className="console-config-actionbar">
      <div className="flex min-w-0 items-center gap-2"><Settings className="h-4 w-4 shrink-0" /><h3 className="truncate font-semibold">{displayTitle ?? `${i18n.t("配置 · ")}${pluginName}`}</h3>{guard.current.dirty ? <span className="console-dirty-pill" role="status">{i18n.t("有未保存的修改")}</span> : null}</div>
      <Button size="sm" onClick={() => void handleSave()} disabled={saving || draftName !== pluginName || form.loading || !!form.error || hasInvalidFields}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}{scoped && pluginName === 'ai' ? i18n.t("保存全部修改") : i18n.t("保存配置")}</Button>
    </div>
    {(saveError || form.error) ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{saveError ?? form.error}{i18n.t("。草稿已保留。")}<Link className="ml-2 underline" to="/files">{i18n.t("打开文件管理")}</Link>{form.errorOperation === 'read' ? <Button variant="outline" size="sm" onClick={() => void form.load()}>{i18n.t("重试读取")}</Button> : null}</AlertDescription></Alert> : null}
    {validation ? <Alert variant={validation.valid && !validation.missingEnv.length ? 'default' : 'destructive'}><AlertDescription><p>{hostValidationSummary(validation, i18n.locale)}</p>{validation.errors.map(item => <p key={`${item.path}:${item.message}`}>{item.path}: {item.message}</p>)}{validation.missingEnv.length ? <p>{i18n.t("缺少环境变量：")}{validation.missingEnv.join('、')}。<Link className="underline" to="/env">{i18n.t("配置环境变量")}</Link>{i18n.t("后重新校验。")}</p> : null}</AlertDescription></Alert> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {hasInvalidFields && <p role="alert" className="text-sm text-destructive">{i18n.t("有字段 JSON 草稿格式错误，修正后才能保存。")}</p>}
    <fieldset key={draftVersion} disabled={saving || form.loading} className="space-y-3">{filtersRootFields && (!rootObject || !categoryFields.length) ? <div role="alert"><p>{i18n.t("此分类暂时无法编辑。")}</p><Link className="text-sm underline" to="/files">{i18n.t("打开文件管理")}</Link></div> : rootObject ? <>{categoryFields.map(([name, field]) => <SchemaFieldEditor key={name} path={`$/${JSON.stringify(name)}`} drafts={editorDrafts.current} onValidityChange={fieldValidity} name={name} useDeclaredDefaults={scoped} field={form.schema?.secret ? { ...field, secret: true } : field} value={objectConfig[name]} onChange={value => change(name, value)} />)}{(!Object.keys(fields).length && !Object.keys(objectConfig).length && !form.schema.additional) ? <p>{i18n.t("此项无需配置。")}</p> : null}{!filtersRootFields && (form.schema.additional || Object.keys(objectConfig).some(key => !Object.hasOwn(fields, key))) ? <SchemaFieldEditor name={i18n.t("其他字段")} path="$/additional" drafts={editorDrafts.current} onValidityChange={fieldValidity} reservedKeys={Object.keys(fields)} field={{ type: 'object', object: {}, additional: form.schema.additional, secret: form.schema.secret }} value={Object.fromEntries(Object.entries(objectConfig).filter(([key]) => !Object.hasOwn(fields, key)))} onChange={value => {
      const next = Object.fromEntries(Object.entries(objectConfig).filter(([key]) => Object.hasOwn(fields, key)))
      if (value && typeof value === 'object' && !Array.isArray(value)) for (const [key, child] of Object.entries(value)) if (!Object.hasOwn(fields, key)) Object.defineProperty(next, key, { value: child, enumerable: true, configurable: true, writable: true })
      changeValue(next)
    }} /> : null}</> : <SchemaFieldEditor name={displayTitle ?? pluginName} field={form.schema} value={localConfig} useDeclaredDefaults={scoped} onChange={changeValue} drafts={editorDrafts.current} onValidityChange={fieldValidity} />}</fieldset>
  </Card>
}
