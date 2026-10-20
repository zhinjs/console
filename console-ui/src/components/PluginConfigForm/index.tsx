import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Settings, AlertCircle, Save, Loader2 } from 'lucide-react'
import type { PluginConfigFormProps, SchemaField } from './types.js'
import { usePluginConfigDraft } from './usePluginConfigDraft'
import { SchemaFieldEditor } from './SchemaFieldEditor'
import { objectFields, unsupportedFormFields, declaredDefaults, requiredGuidance, updateObjectField, hostValidationSummary } from './schema-model.mjs'
import { Card } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'
import { createConfigDraftGuard } from './draft-guard.mjs'
import { requestConsole } from '../../utils/console-rpc'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { ConfigFieldExplanation } from './ConfigFieldExplanation'

interface ConfigValidation { valid: boolean; schemaAvailable?: boolean; errors: Array<{ path: string; message: string }>; missingEnv: string[] }

type EditableConfigProps = Omit<PluginConfigFormProps, 'schema' | 'initialConfig'> & { onOpenYaml?: () => void }

export function PluginConfigForm(props: EditableConfigProps) {
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Card className="mt-4 p-4" role="status">连接身份已变化，请登录当前 Host 后重新读取配置。</Card>
  // A different Host or credential owns a fresh draft and confirmation session.
  return <PluginConfigFormSession key={JSON.stringify([scope, props.pluginName])} {...props} connectionScope={scope} />
}

function PluginConfigFormSession({ pluginName, onSuccess, onOpenYaml, connectionScope }: EditableConfigProps & { connectionScope: string }) {
  const form = usePluginConfigDraft(pluginName)
  const invalidRootConfig = form.loaded && form.config !== undefined && (!form.config || typeof form.config !== 'object' || Array.isArray(form.config))
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({})
  const [draftName, setDraftName] = useState<string | null>(null)
  const [mode, setMode] = useState<'all' | 'minimum'>('minimum')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [validation, setValidation] = useState<ConfigValidation | null>(null)
  const guard = useRef(createConfigDraftGuard())
  const operation = useRef(0)
  const currentName = useRef(pluginName)
  currentName.current = pluginName
  useEffect(() => {
    operation.current++; setSaving(false); setSaveError(null); setMessage(null); setValidation(null); setMode('minimum')
    return () => { operation.current++ }
  }, [pluginName, connectionScope])
  useEffect(() => {
    if (!form.loaded || invalidRootConfig) return
    if (guard.current.receive(pluginName, form.config ?? {}, form.snapshot)) {
      setDraftName(pluginName)
      setLocalConfig(form.schema ? declaredDefaults(form.schema as SchemaField, form.config ?? {}) : form.config ?? {})
      setSaveError(null); setValidation(null)
    }
  }, [pluginName, form.loaded, form.config, form.schema, form.snapshot, invalidRootConfig])
  const fields = objectFields(form.schema)
  const unsupported = form.schema ? unsupportedFormFields(form.schema) : []
  const required = form.schema ? requiredGuidance(form.schema as SchemaField, localConfig) : []
  const visibleFields = Object.entries(fields).filter(([name, field]) => !field.hidden && (mode === 'all' || field.required || required.some(path => path.startsWith(`$.${name}.`) || path.startsWith(`$.${name}[`))))
  const change = (name: string, value: unknown) => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    guard.current.edited(); setValidation(null); setMessage(null)
    setLocalConfig(previous => updateObjectField(previous, name, value))
  }
  const handleSave = async (checkOnly = false) => {
    if (!isInboxCacheScopeActive(connectionScope) || form.scope !== connectionScope || form.snapshot?.connectionScope !== connectionScope
      || saving || !form.loaded || draftName !== pluginName || unsupported.length || !form.schema) return
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
      setMessage(result.restartRequired ? '配置已保存；系统配置变更需要重启。' : '配置已保存，等待 Host 应用插件配置。')
      onSuccess?.()
      await form.load()
    } catch (cause) { if (currentOperation()) setSaveError(cause instanceof Error ? cause.message : '保存失败，草稿已保留') }
    finally { if (currentOperation()) setSaving(false) }
  }
  const reset = () => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    guard.current.saved(); guard.current.receive(pluginName, form.config ?? {}, form.snapshot); setLocalConfig(form.schema ? declaredDefaults(form.schema as SchemaField, form.config ?? {}) : {})
    setValidation(null); setSaveError(null); setMessage(null)
  }
  const explanation = <ConfigFieldExplanation instanceKey={pluginName} revision={form.snapshot?.revision} draftRevision={guard.current.snapshot?.revision} dirty={guard.current.dirty} disabled={saving || form.loading || !!form.error} onOpenSource={onOpenYaml} />
  if (!form.loaded && !form.error) return <Card className="mt-4 p-4" role="status">正在读取插件配置和字段定义…</Card>
  if (form.error && !form.loaded) return <Card className="mt-4 p-4 space-y-2" role="alert"><p>配置读取失败，尚未加载的配置不会被当作空值。</p><p className="text-xs">{form.error}</p><Button variant="outline" onClick={() => void form.load()}>重试读取</Button>{onOpenYaml ? <Button variant="outline" onClick={onOpenYaml}>打开完整源码</Button> : null}</Card>
  if (invalidRootConfig) return <Card className="mt-4 p-4 space-y-2" role="alert"><p>当前插件配置不是对象，不能当作空配置覆盖。请打开完整源码修正结构。</p>{onOpenYaml ? <Button variant="outline" onClick={onOpenYaml}>打开完整源码</Button> : <Link className="underline" to={`/config?plugin=${encodeURIComponent(pluginName)}`}>进入配置源码页</Link>}</Card>
  if (form.schemaError || !form.schema || unsupported.length > 0 || !Object.keys(fields).length) return <div className="space-y-4"><Card className="mt-4 p-4 space-y-2" role="status">
    <h3 className="font-semibold">配置需要源码编辑</h3><p className="text-sm">{form.schemaError ? 'Host 无法提供此 Schema 的表单投影。' : !form.schema ? '此插件没有可编辑的表单定义。' : unsupported.length ? '此 Schema 包含当前表单不支持的结构，不能只保存部分字段。' : '此插件没有可编辑的配置字段。'}</p>
    {form.schemaError ? <p className="text-xs text-muted-foreground">{form.schemaError}</p> : unsupported.map(issue => <p key={issue} className="text-xs text-muted-foreground">{issue}</p>)}
    {onOpenYaml ? <Button variant="outline" onClick={onOpenYaml}>打开完整源码</Button> : <Link className="text-sm underline" to={`/config?plugin=${encodeURIComponent(pluginName)}`}>进入配置源码页</Link>}
  </Card>{explanation}</div>
  return <Card className="mt-4 p-4 space-y-4">
    <div className="flex items-center gap-2"><Settings className="h-4 w-4" /><h3 className="font-semibold">插件配置</h3><Badge variant="secondary">{Object.keys(fields).length} 项</Badge></div>
    <p className="text-sm text-muted-foreground">先完成必填项；已有值和声明默认值会保留。Host 负责最终校验，保存使用读取时的版本，冲突时保留草稿。</p>
    <div className="flex gap-2"><Button variant={mode === 'minimum' ? 'default' : 'outline'} size="sm" onClick={() => setMode('minimum')}>最小必填配置</Button><Button variant={mode === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setMode('all')}>全部配置</Button></div>
    {required.length ? <Alert><AlertDescription>尚未填写必填配置：{required.join('、')}。必填是字段存在性提示，格式以 Host 校验结果为准。</AlertDescription></Alert> : mode === 'minimum' ? <p className="text-sm text-muted-foreground">当前没有缺少的必填项；仍需校验环境变量和字段格式。</p> : null}
    {(saveError || form.error) ? <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>{saveError ?? form.error}。草稿已保留；请刷新最新版本后确认修改。</AlertDescription></Alert> : null}
    {validation ? <Alert variant={validation.valid && !validation.missingEnv.length ? 'default' : 'destructive'}><AlertDescription><p>{hostValidationSummary(validation)}</p>{validation.errors.map(item => <p key={`${item.path}:${item.message}`}>{item.path}: {item.message}</p>)}{validation.missingEnv.length ? <p>缺少环境变量：{validation.missingEnv.join('、')}。<Link className="underline" to="/env">配置环境变量</Link>后重新校验。</p> : null}</AlertDescription></Alert> : null}
    {message ? <p role="status" className="text-sm">{message}</p> : null}
    {explanation}
    <fieldset disabled={saving || form.loading} className="space-y-3">{visibleFields.map(([name, field]) => <SchemaFieldEditor key={name} name={name} field={field} value={localConfig[name]} onChange={value => change(name, value)} />)}</fieldset>
    <div className="flex flex-wrap justify-end gap-2 border-t pt-3"><Button variant="outline" onClick={reset} disabled={saving}>撤销草稿</Button><Button variant="outline" onClick={() => void form.load()} disabled={saving || form.loading}>刷新版本（保留草稿）</Button>{onOpenYaml ? <Button variant="outline" onClick={onOpenYaml}>打开完整源码</Button> : null}<Button variant="outline" onClick={() => void handleSave(true)} disabled={saving || draftName !== pluginName || !!form.error}>校验配置</Button><Button onClick={() => void handleSave()} disabled={saving || draftName !== pluginName || form.loading || !!form.error}>{saving ? <Loader2 className="mr-1 h-4 w-4 animate-spin" /> : <Save className="mr-1 h-4 w-4" />}保存配置</Button></div>
  </Card>
}
