/**
 * PluginConfigForm - Plugin configuration form with accordion
 */

import type * as React from 'react'
import { useState, useEffect, useRef } from 'react'
import { useConfig } from '@zhin.js/client'
import type { PluginConfigFormProps, Schema, SchemaField } from './types.js'
import { Settings, ChevronDown, CheckCircle, AlertCircle, AlertTriangle, X, Save, Loader2 } from 'lucide-react'
import { FieldRenderer, isComplexField } from './FieldRenderer.js'
import { NestedFieldRenderer } from './NestedFieldRenderer.js'
import { Card } from '../ui/card'
import { Badge } from '../ui/badge'
import { Button } from '../ui/button'
import { Alert, AlertDescription } from '../ui/alert'
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from '../ui/accordion'
import { createConfigDraftGuard } from './draft-guard.mjs'
import { pluginConfigFormState } from './form-state.mjs'
import { numericConfigInvalid } from './numeric-validation.mjs'
import { requestConsole } from '../../utils/console-rpc'

interface ConfigValidation {
  valid: boolean
  errors: Array<{ path: string; message: string }>
  missingEnv: string[]
}

export function PluginConfigForm({ pluginName, onSuccess, onOpenYaml }: Omit<PluginConfigFormProps, 'schema' | 'initialConfig'> & { onOpenYaml?: () => void }) {
  const [localConfig, setLocalConfig] = useState<Record<string, any>>({})
  const draft = useRef(createConfigDraftGuard())
  const previousPlugin = useRef(pluginName)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [successMessage, setSuccessMessage] = useState<string | null>(null)
  const [isExpanded, setIsExpanded] = useState('')

  const { config, schema, loading, error, connected, setConfig } = useConfig(pluginName)

  useEffect(() => {
    if (previousPlugin.current !== pluginName) {
      previousPlugin.current = pluginName
      setSaveError(null)
      setIsExpanded('')
    }
    if (draft.current.receive(pluginName, config)) setLocalConfig(config as Record<string, any>)
  }, [config, pluginName])

  const [warnMessage, setWarnMessage] = useState<string | null>(null)
  const [validation, setValidation] = useState<ConfigValidation | null>(null)

  const handleSave = async () => {
    if (!connected || saving || numericInvalid) return
    setSaving(true)
    setSaveError(null)
    try {
      const checked = await requestConsole<ConfigValidation>({
        type: 'plugin:validate-config',
        pluginName,
        data: localConfig,
      })
      setValidation(checked)
      if (!checked.valid) return
      const result = await setConfig(localConfig)
      draft.current.saved()
      if (result?.reloaded) {
        setSuccessMessage('配置已保存，插件已重载')
      } else if (result?.message) {
        setWarnMessage(result.message)
        setSuccessMessage(null)
      } else {
        setSuccessMessage('配置已保存')
      }
      onSuccess?.()
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : '保存配置失败')
    } finally {
      setSaving(false)
    }
  }

  const handleCancel = () => {
    draft.current.saved()
    setLocalConfig((config ?? {}) as Record<string, any>)
    setValidation(null)
    setSaveError(null)
    setSuccessMessage(null)
    setWarnMessage(null)
    setIsExpanded('')
  }

  const handleFieldChange = (fieldName: string, value: any) => {
    draft.current.edited()
    setValidation(null)
    setLocalConfig(prev => ({ ...prev, [fieldName]: value }))
  }

  const handleNestedFieldChange = (parentPath: string, childKey: string, value: any) => {
    draft.current.edited()
    setValidation(null)
    setLocalConfig(prev => ({
      ...prev,
      [parentPath]: { ...(prev[parentPath] || {}), [childKey]: value }
    }))
  }

  const handleArrayItemChange = (fieldName: string, index: number, value: any) => {
    draft.current.edited()
    setValidation(null)
    setLocalConfig(prev => {
      const arr = Array.isArray(prev[fieldName]) ? [...prev[fieldName]] : []
      arr[index] = value
      return { ...prev, [fieldName]: arr }
    })
  }

  const renderField = (fieldName: string, field: SchemaField, parentPath?: string): React.ReactElement => {
    const value = parentPath
      ? localConfig[parentPath]?.[fieldName] ?? field.default
      : localConfig[fieldName] ?? field.default

    const onChange = parentPath
      ? (val: any) => handleNestedFieldChange(parentPath, fieldName, val)
      : (val: any) => handleFieldChange(fieldName, val)

    return (
      <FieldRenderer
        fieldName={fieldName} field={field} value={value} onChange={onChange}
        parentPath={parentPath} onNestedChange={handleNestedFieldChange}
        onArrayItemChange={handleArrayItemChange} renderField={renderField}
        renderNestedField={(fn, f, v, oc) => <NestedFieldRenderer fieldName={fn} field={f} value={v} onChange={oc} />}
      />
    )
  }

  const typedSchema = schema as Schema | null
  const fields = typedSchema?.object || typedSchema?.properties || typedSchema?.dict || {}
  const numericInvalid = numericConfigInvalid(fields, localConfig)
  const hasLoadedForm = config != null && schema != null
  const formState = pluginConfigFormState({
    loading: loading && !hasLoadedForm,
    error: hasLoadedForm ? null : error,
    connected: connected || hasLoadedForm,
    schema,
  })
  if (formState !== 'ready') {
    const message = formState === 'loading' ? '正在加载配置…'
      : formState === 'error' ? '配置读取失败，请检查连接后重试。'
      : formState === 'disconnected' ? '尚未连接 Host，配置暂不可读取。'
      : '此配置项没有表单定义，请打开完整源码编辑。'
    return (
      <Card className="mt-4 p-4 space-y-3" role={formState === 'error' ? 'alert' : 'status'}>
        <h3 className="text-sm font-semibold">配置表单</h3>
        <p className="text-sm text-muted-foreground">{message}</p>
        {formState === 'no-schema' && onOpenYaml ? <Button variant="outline" size="sm" onClick={onOpenYaml}>打开完整源码</Button> : null}
      </Card>
    )
  }

  return (
    <Card className="mt-4">
      <Accordion type="single" collapsible value={isExpanded} onValueChange={setIsExpanded}>
        <AccordionItem value="config" className="border-none">
          <AccordionTrigger className="px-4 hover:no-underline">
            <div className="flex items-center gap-2">
              <Settings className="w-4 h-4" />
              <span className="font-semibold">配置表单</span>
              <Badge variant="secondary">{Object.keys(fields).length} 项</Badge>
            </div>
          </AccordionTrigger>
          <AccordionContent className="px-4 pb-4">
            {successMessage && (
              <Alert variant="success" className="mb-3">
                <CheckCircle className="h-4 w-4" />
                <AlertDescription>{successMessage}</AlertDescription>
              </Alert>
            )}
            {warnMessage && !successMessage && (
              <Alert className="mb-3 border-yellow-500/50 text-yellow-700 dark:text-yellow-400">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>{warnMessage}</AlertDescription>
              </Alert>
            )}
            {(saveError || error) && (
              <Alert variant="destructive" className="mb-3">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{saveError || error}</AlertDescription>
              </Alert>
            )}
            {validation && (!validation.valid || validation.missingEnv.length > 0) && (
              <Alert variant={validation.valid ? 'default' : 'destructive'} className="mb-3">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {validation.errors.map(item => (
                    <div key={`${item.path}:${item.message}`}>{item.path}: {item.message}</div>
                  ))}
                  {validation.missingEnv.length > 0 && (
                    <div>缺少环境变量：{validation.missingEnv.join('、')}</div>
                  )}
                </AlertDescription>
              </Alert>
            )}

            <fieldset disabled={saving || loading} className="space-y-3">
              {Object.entries(fields).map(([fieldName, field]) => {
                const schemaField = field as SchemaField
                return (
                  <div key={fieldName} className="p-3 rounded-lg bg-muted/50 border space-y-2">
                    <div className="flex items-center gap-1">
                      <span className="text-sm font-semibold">{schemaField.key || fieldName}</span>
                      {schemaField.required && <span className="text-destructive font-bold">*</span>}
                    </div>
                    {schemaField.description && (
                      <p className="text-xs text-muted-foreground">{schemaField.description}</p>
                    )}
                    <div className="mt-1">{renderField(schemaField.key || fieldName, schemaField)}</div>
                  </div>
                )
              })}
            </fieldset>

            <div className="flex gap-2 justify-end mt-4 pt-3 border-t">
              <Button variant="outline" size="sm" onClick={handleCancel} disabled={loading || saving}>
                <X className="w-4 h-4 mr-1" /> 取消
              </Button>
              <Button size="sm" onClick={handleSave} disabled={loading || saving || !connected || numericInvalid}>
                {loading || saving ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</> : <><Save className="w-4 h-4 mr-1" />保存配置</>}
              </Button>
            </div>
          </AccordionContent>
        </AccordionItem>
      </Accordion>
    </Card>
  )
}
