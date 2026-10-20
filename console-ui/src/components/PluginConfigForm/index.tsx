import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Settings, AlertCircle, Save, Loader2 } from 'lucide-react'
import type { PluginConfigFormProps, SchemaField, SchemaEditorDrafts } from './types.js'
import { usePluginConfigDraft } from './usePluginConfigDraft'
import { SchemaFieldEditor } from './SchemaFieldEditor'
import { objectFields, declaredDefaults, initialSchemaValue, requiredGuidance, updateObjectField, hostValidationSummary } from './schema-model.mjs'
import { CodeEditor } from '../../pages/files/code-editor'
import { Card } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'
import { createConfigDraftGuard } from './draft-guard.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { ConfigFieldExplanation } from './ConfigFieldExplanation'
import { ConfigApplicationEvidence } from './ConfigApplicationEvidence'
import { configurationSaveSummary, isManagedConfigInstance } from './config-evidence-model.mjs'

interface ConfigValidation { valid: boolean; schemaAvailable?: boolean; errors: Array<{ path: string; message: string }>; missingEnv: string[] }

type EditableConfigProps = Omit<PluginConfigFormProps, 'schema' | 'initialConfig'> & { onOpenYaml?: () => void; sourceRevision?: string; purposeFields?: readonly string[] }

export function PluginConfigForm(props: EditableConfigProps) {
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Card className="mt-4 p-4" role="status">连接身份已变化，请登录当前 Host 后重新读取配置。</Card>
  // A different Host or credential owns a fresh draft and confirmation session.
  return <PluginConfigFormSession key={JSON.stringify([scope, props.pluginName])} {...props} connectionScope={scope} />
}

function PluginConfigFormSession({ pluginName, onSuccess, onOpenYaml, sourceRevision, purposeFields, connectionScope }: EditableConfigProps & { connectionScope: string }) {
  const form = usePluginConfigDraft(pluginName)
  const [localConfig, setLocalConfig] = useState<unknown>(undefined)
  const [draftName, setDraftName] = useState<string | null>(null)
  const [mode, setMode] = useState<'all' | 'minimum'>('all')
  const [view, setView] = useState<'form' | 'source'>('form')
  const [sourceText, setSourceText] = useState(''), [sourceError, setSourceError] = useState<string | null>(null)
  const [invalidFields, setInvalidFields] = useState<ReadonlySet<string>>(new Set())
  const [draftVersion, setDraftVersion] = useState(0)
  const editorDrafts = useRef<SchemaEditorDrafts>({ json: new Map(), unions: new Map() })
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [validation, setValidation] = useState<ConfigValidation | null>(null)
  const guard = useRef(createConfigDraftGuard())
  const operation = useRef(0)
  const currentName = useRef(pluginName)
  currentName.current = pluginName
  useEffect(() => {
    operation.current++; setSaving(false); setSaveError(null); setMessage(null); setValidation(null); setMode('all')
    return () => { operation.current++ }
  }, [pluginName, connectionScope])
  useEffect(() => {
    if (!form.loaded) return
    if (guard.current.receive(pluginName, form.config, form.snapshot)) {
      setDraftName(pluginName)
      const next = form.schema ? declaredDefaults(form.schema, form.config === undefined && ['object', 'dict', 'list', 'tuple', 'intersect'].includes(form.schema.type) ? initialSchemaValue(form.schema) : form.config) : form.config
      setLocalConfig(next); setSourceText(next === undefined ? '' : JSON.stringify(next, null, 2)); setSourceError(null); setInvalidFields(new Set())
      editorDrafts.current.json.clear(); editorDrafts.current.unions.clear(); setDraftVersion(previous => previous + 1)
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
  const objectConfig = localConfig && typeof localConfig === 'object' && !Array.isArray(localConfig) ? localConfig as Record<string, unknown> : undefined
  const rootObject = form.schema?.type === 'object' && objectConfig !== undefined
  const required = form.schema ? requiredGuidance(form.schema, localConfig) : []
  const visibleFields = Object.entries(fields).filter(([name, field]) => !field.hidden && (mode === 'all' || purposeFields?.includes(name) || field.required || required.some(path => path.startsWith(`$.${name}.`) || path.startsWith(`$.${name}[`))))
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
  const handleSave = async (checkOnly = false) => {
    if (!isInboxCacheScopeActive(connectionScope) || form.scope !== connectionScope || form.snapshot?.connectionScope !== connectionScope
      || saving || !form.loaded || draftName !== pluginName || invalidFields.size || sourceError || !form.schema) return
    const name = pluginName
    const operationId = ++operation.current
    const currentOperation = () => isInboxCacheScopeActive(connectionScope) && currentName.current === name && operation.current === operationId
    setSaving(true); setSaveError(null); setMessage(null)
    try {
      const checked = await requestConsole<ConfigValidation>({ type: 'plugin:validate-config', pluginName: name, data: localConfig })
      if (!currentOperation()) return
      setValidation(checked)
      if (checked.schemaAvailable === false) throw new Error('Host 字段定义已变化或不可用，请刷新或打开完整源码')
      if (checkOnly || !checked.valid || checked.missingEnv.length > 0) return
      const result = await form.setConfig(localConfig, guard.current.snapshot)
      if (!currentOperation()) return
      guard.current.saved()
      setMessage(`${configurationSaveSummary(result)} 文件版本：${result.revision}`)
      onSuccess?.()
      await form.load()
    } catch (cause) { if (currentOperation()) setSaveError(cause instanceof Error ? cause.message : '保存失败，草稿已保留') }
    finally { if (currentOperation()) setSaving(false) }
  }
  const reset = () => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    guard.current.saved(); guard.current.receive(pluginName, form.config, form.snapshot)
    const next = form.schema ? declaredDefaults(form.schema, form.config === undefined && ['object', 'dict', 'list', 'tuple', 'intersect'].includes(form.schema.type) ? initialSchemaValue(form.schema) : form.config) : form.config
    setLocalConfig(next); setSourceText(next === undefined ? '' : JSON.stringify(next, null, 2)); setSourceError(null); setInvalidFields(new Set()); editorDrafts.current.json.clear(); editorDrafts.current.unions.clear(); setDraftVersion(previous => previous + 1)
    setValidation(null); setSaveError(null); setMessage(null)
  }
  const explanation = <ConfigFieldExplanation instanceKey={pluginName} revision={form.snapshot?.revision} draftRevision={guard.current.snapshot?.revision} dirty={guard.current.dirty} disabled={saving || form.loading || !!form.error} onOpenSource={onOpenYaml} />
  if (!form.loaded && !form.error) return <Card className="mt-4 p-4" role="status">正在读取插件配置和字段定义…</Card>
  if (form.error && !form.loaded) return <Card className="mt-4 p-4 space-y-2" role="alert"><p>配置读取失败，尚未加载的配置不会被当作空值。</p><p className="text-xs">{form.error}</p><Button variant="outline" onClick={() => void form.load()}>重试读取</Button>{onOpenYaml ? <Button variant="outline" onClick={onOpenYaml}>打开完整源码</Button> : null}</Card>
  if (form.schemaError || !form.schema) return <div className="space-y-4"><Card className="mt-4 p-4 space-y-2" role="status">
    <h3 className="font-semibold">配置 Schema 不可用</h3><p className="text-sm">{form.schemaError ? 'Host 无法提供此配置的字段定义，不能伪造表单。' : 'Host 尚未提供此配置的 Schema。可选择完整源码编辑。'}</p>
    {form.schemaError ? <p className="text-xs text-muted-foreground">{form.schemaError}</p> : null}
    {onOpenYaml ? <Button variant="outline" onClick={onOpenYaml}>打开完整源码</Button> : <Link className="text-sm underline" to={`/config?plugin=${encodeURIComponent(pluginName)}`}>进入配置源码页</Link>}
  </Card>{explanation}</div>
  return <Card className="mt-4 p-4 space-y-4">
    <div className="flex items-center gap-2"><Settings className="h-4 w-4" /><h3 className="font-semibold">配置 · {pluginName}</h3><Badge variant="secondary">{rootObject ? `${Object.keys(fields).length} 项` : form.schema.type}</Badge></div>
    <p className="text-sm text-muted-foreground">先完成必填项；已有值和声明默认值会保留。Host 负责最终校验，保存使用读取时的版本，冲突时保留草稿。</p>
    <div className="flex flex-wrap gap-2"><Button variant={view === 'form' ? 'default' : 'outline'} size="sm" onClick={() => { if (sourceError) { setSaveError('此项源码有格式错误，草稿已保留；请修正后再切回表单。'); return } setView('form') }}>表单</Button><Button variant={view === 'source' ? 'default' : 'outline'} size="sm" onClick={() => { if (invalidFields.size) { setSaveError('字段 JSON 草稿有格式错误，请修正后切换。'); return } if (view !== 'source') setSourceText(localConfig === undefined ? '' : JSON.stringify(localConfig, null, 2)); setView('source') }}>此项源码</Button>{view === 'form' && rootObject && <><Button variant={mode === 'minimum' ? 'default' : 'outline'} size="sm" disabled={invalidFields.size > 0} onClick={() => { if (!invalidFields.size) setMode('minimum') }}>{purposeFields?.length ? '用途与必填配置' : '最小必填配置'}</Button><Button variant={mode === 'all' ? 'default' : 'outline'} size="sm" disabled={invalidFields.size > 0} onClick={() => { if (!invalidFields.size) setMode('all') }}>全部配置</Button></>}</div>
    {purposeFields?.length ? <p className="text-sm text-muted-foreground">已显示本用途相关字段；不代表这些字段必填。其他字段与已有值仍完整保留，保存继续使用同一配置对象与版本。</p> : null}
    {required.length ? <Alert><AlertDescription>尚未填写必填配置：{required.join('、')}。必填是字段存在性提示，格式以 Host 校验结果为准。</AlertDescription></Alert> : mode === 'minimum' ? <p className="text-sm text-muted-foreground">当前没有缺少的必填项；仍需校验环境变量和字段格式。</p> : null}
    {(saveError || form.error) ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{saveError ?? form.error}。草稿已保留；请刷新最新版本后确认修改。</AlertDescription></Alert> : null}
    {validation ? <Alert variant={validation.valid && !validation.missingEnv.length ? 'default' : 'destructive'}><AlertDescription><p>{hostValidationSummary(validation)}</p>{validation.errors.map(item => <p key={`${item.path}:${item.message}`}>{item.path}: {item.message}</p>)}{validation.missingEnv.length ? <p>缺少环境变量：{validation.missingEnv.join('、')}。<Link className="underline" to="/env">配置环境变量</Link>后重新校验。</p> : null}</AlertDescription></Alert> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {explanation}
    <ConfigApplicationEvidence pluginName={pluginName} revision={form.snapshot?.revision} draftRevision={guard.current.snapshot?.revision}
      dirty={guard.current.dirty} disabled={saving || form.loading || !!form.error}
      managed={isManagedConfigInstance(form.snapshot, pluginName)} />
    {invalidFields.size > 0 && <p role="alert" className="text-sm text-destructive">有字段 JSON 草稿格式错误，修正后才能保存。</p>}
    {view === 'source' ? <div className="space-y-2"><p className="text-xs text-muted-foreground">此项 JSON 与表单共用当前草稿，切换无需保存。完整文件源码基于已保存版本，与此项草稿独立；保存仍使用草稿原版本。</p><div className="h-80 overflow-hidden rounded-md border"><CodeEditor language="json" ariaLabel={`${pluginName} 此项源码`} value={sourceText} disabled={saving || form.loading} invalid={!!sourceError} onChange={text => {
      guard.current.edited(); setSourceText(text); setValidation(null); setMessage(null)
      try { setLocalConfig(JSON.parse(text)); setSourceError(null); editorDrafts.current.json.clear(); editorDrafts.current.unions.clear(); setDraftVersion(previous => previous + 1) }
      catch { setSourceError('JSON 格式错误，当前草稿已保留。') }
    }} /></div>{sourceError && <p role="alert" className="text-xs text-destructive">{sourceError}</p>}</div> : <fieldset key={draftVersion} disabled={saving || form.loading} className="space-y-3">{rootObject ? <>{visibleFields.map(([name, field]) => <SchemaFieldEditor key={name} path={`$/${JSON.stringify(name)}`} drafts={editorDrafts.current} onValidityChange={fieldValidity} name={name} field={form.schema?.secret ? { ...field, secret: true } : field} value={objectConfig[name]} onChange={value => change(name, value)} />)}{(!Object.keys(fields).length && !Object.keys(objectConfig).length && !form.schema.additional) ? <p>此项无需配置。</p> : null}{(form.schema.additional || Object.keys(objectConfig).some(key => !Object.hasOwn(fields, key))) ? <SchemaFieldEditor name="其他字段" path="$/additional" drafts={editorDrafts.current} onValidityChange={fieldValidity} reservedKeys={Object.keys(fields)} field={{ type: 'object', object: {}, additional: form.schema.additional, secret: form.schema.secret }} value={Object.fromEntries(Object.entries(objectConfig).filter(([key]) => !Object.hasOwn(fields, key)))} onChange={value => {
      const next = Object.fromEntries(Object.entries(objectConfig).filter(([key]) => Object.hasOwn(fields, key)))
      if (value && typeof value === 'object' && !Array.isArray(value)) for (const [key, child] of Object.entries(value)) if (!Object.hasOwn(fields, key)) Object.defineProperty(next, key, { value: child, enumerable: true, configurable: true, writable: true })
      changeValue(next)
    }} /> : null}</> : <SchemaFieldEditor name={pluginName} field={form.schema} value={localConfig} onChange={changeValue} drafts={editorDrafts.current} onValidityChange={fieldValidity} />}</fieldset>}
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={reset} disabled={saving}>撤销草稿</Button><Button variant="outline" onClick={() => void form.load()} disabled={saving || form.loading}>刷新版本（保留草稿）</Button>{onOpenYaml ? <Button variant="outline" onClick={onOpenYaml}>打开完整源码</Button> : null}<Button variant="outline" onClick={() => void handleSave(true)} disabled={saving || draftName !== pluginName || !!form.error || !!sourceError || invalidFields.size > 0}>校验配置</Button><Button onClick={() => void handleSave()} disabled={saving || draftName !== pluginName || form.loading || !!form.error || !!sourceError || invalidFields.size > 0}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}保存配置</Button></div>
  </Card>
}
