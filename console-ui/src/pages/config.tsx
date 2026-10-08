import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConfigSource } from '../hooks/useConfigSource'
import { PluginConfigForm } from '../components/PluginConfigForm'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  Settings, AlertCircle, Save, Loader2, X,
  RefreshCw, FileCode
} from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Textarea } from '../components/ui/textarea'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { Separator } from '../components/ui/separator'
import { useToast } from '../components/toast'
import { Switch } from '../components/ui/switch'
import { PageHeader } from '../components/PageHeader'
import { readErrorSummary } from '../utils/read-error.mjs'
import { isDemoMode } from '../utils/demo-mode'
import { validateConfigSource } from './config-source-validation.mjs'
import { generalConfigKeys, resolveConfigSection } from './config-navigation.mjs'

function GeneralConfigForm({
  config,
  pluginKeys,
  onSave,
  saving
}: {
  config: Record<string, any>
  pluginKeys: string[]
  onSave: (patch: Record<string, any>) => Promise<void>
  saving: boolean
}) {
  const generalKeys = useMemo(() => generalConfigKeys(config, pluginKeys), [config, pluginKeys])

  const [localValues, setLocalValues] = useState<Record<string, any>>({})
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    if (dirty) return
    const vals: Record<string, any> = {}
    for (const key of generalKeys) {
      vals[key] = config[key]
    }
    setLocalValues(vals)
    setDirty(false)
  }, [config, generalKeys, dirty])

  const handleChange = (key: string, value: any) => {
    setLocalValues(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    try {
      await onSave(localValues)
      setDirty(false)
    } catch {
      // Parent shows the save error; retain this form draft for retry.
    }
  }

  const handleReset = () => {
    const vals: Record<string, any> = {}
    for (const key of generalKeys) {
      vals[key] = config[key]
    }
    setLocalValues(vals)
    setDirty(false)
  }

  if (generalKeys.length === 0) {
    return (
      <Card>
        <CardContent className="flex flex-col items-center gap-3 py-12">
          <div className="flex items-center justify-center w-16 h-16 rounded-full bg-muted">
            <Settings className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold">暂无通用配置</h3>
          <p className="text-sm text-muted-foreground">配置文件中未发现可编辑的通用字段</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        {generalKeys.map(key => (
          <ConfigFieldEditor
            key={key}
            fieldKey={key}
            value={localValues[key]}
            onChange={val => handleChange(key, val)}
          />
        ))}
      </div>
      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
            : <><Save className="w-4 h-4 mr-1" />保存</>}
        </Button>
        {dirty && (
          <Button variant="outline" size="sm" onClick={handleReset}>
            <X className="w-4 h-4 mr-1" />撤销
          </Button>
        )}
        {dirty && <span className="text-xs text-muted-foreground">有未保存的更改</span>}
      </div>
    </div>
  )
}

function ConfigFieldEditor({
  fieldKey,
  value,
  onChange
}: {
  fieldKey: string
  value: any
  onChange: (val: any) => void
}) {
  const valueType = typeof value

  if (value === null || value === undefined) {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">null</Badge>
        </div>
        <Input
          value=""
          placeholder="(空值)"
          onChange={e => onChange(e.target.value || null)}
          className="h-8 text-sm"
        />
      </div>
    )
  }

  if (valueType === 'boolean') {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">{fieldKey}</span>
            <Badge variant="outline" className="text-[10px] px-1 py-0">boolean</Badge>
          </div>
          <Switch
            checked={value}
            onCheckedChange={onChange}
          />
        </div>
      </div>
    )
  }

  if (valueType === 'number') {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">number</Badge>
        </div>
        <Input
          type="number"
          value={value}
          onChange={e => onChange(Number(e.target.value))}
          className="h-8 text-sm"
        />
      </div>
    )
  }

  if (valueType === 'string') {
    const isMultiline = value.includes('\n') || value.length > 80
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">string</Badge>
        </div>
        {isMultiline ? (
          <Textarea
            value={value}
            onChange={e => onChange(e.target.value)}
            className="text-sm font-mono min-h-[80px]"
          />
        ) : (
          <Input
            value={value}
            onChange={e => onChange(e.target.value)}
            className="h-8 text-sm"
          />
        )}
      </div>
    )
  }

  if (Array.isArray(value)) {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">array[{value.length}]</Badge>
        </div>
        <Textarea
          value={stringifyYaml(value).trim()}
          onChange={e => {
            try {
              const parsed = parseYaml(e.target.value)
              if (Array.isArray(parsed)) onChange(parsed)
            } catch { /* ignore parse errors during typing */ }
          }}
          className="text-sm font-mono min-h-[80px]"
        />
      </div>
    )
  }

  if (valueType === 'object') {
    return (
      <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
        <div className="flex items-center gap-1.5">
          <span className="text-sm font-medium">{fieldKey}</span>
          <Badge variant="outline" className="text-[10px] px-1 py-0">object</Badge>
        </div>
        <Textarea
          value={stringifyYaml(value).trim()}
          onChange={e => {
            try {
              const parsed = parseYaml(e.target.value)
              if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) onChange(parsed)
            } catch { /* ignore parse errors during typing */ }
          }}
          className="text-sm font-mono min-h-[100px]"
        />
      </div>
    )
  }

  return (
    <div className="p-3 rounded-lg bg-muted/50 border space-y-1.5">
      <div className="flex items-center gap-1.5">
        <span className="text-sm font-medium">{fieldKey}</span>
        <Badge variant="outline" className="text-[10px] px-1 py-0">{valueType}</Badge>
      </div>
      <Input
        value={String(value)}
        onChange={e => onChange(e.target.value)}
        className="h-8 text-sm"
      />
    </div>
  )
}

function EditableConfigPage() {
  const [searchParams] = useSearchParams()
  const pluginFromUrl = searchParams.get('plugin')?.trim() ?? ''
  const { source, format, configKeys: pluginKeys, loading, loaded, error, errorOperation, clearSaveError, load, save } = useConfigSource()
  const [activeSection, setActiveSection] = useState<string>(() => pluginFromUrl ? `plugin:${pluginFromUrl}` : 'general')
  const [sourceText, setSourceText] = useState('')
  const [sourceDirty, setSourceDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const { success, error: toastError } = useToast()

  useEffect(() => {
    if (sourceDirty) return
    setSourceText(source)
    setSourceDirty(false)
  }, [source, sourceDirty])

  const parsedConfig = useMemo(() => {
    try {
      return (format === 'json' ? JSON.parse(source) : parseYaml(source)) || {}
    } catch {
      return {}
    }
  }, [source, format])

  const hasGeneral = generalConfigKeys(parsedConfig, pluginKeys).length > 0
  const visibleSection = resolveConfigSection(activeSection, pluginKeys, hasGeneral)

  const sourceIssue = useMemo(() => validateConfigSource(sourceText, format), [sourceText, format])

  const handleYamlSave = async () => {
    if (saving || !sourceDirty || sourceIssue) return
    setSaving(true)
    try {
      await save(sourceText)
      setSourceDirty(false)
      success('配置已保存，需重启生效')
    } catch (err) {
      toastError('配置保存失败，草稿已保留。请查看页面中的技术详情。')
    } finally {
      setSaving(false)
    }
  }

  const handleFormSave = async (patch: Record<string, any>) => {
    setSaving(true)
    try {
      const currentParsed = (format === 'json' ? JSON.parse(source) : parseYaml(source)) || {}
      const merged = { ...currentParsed, ...patch }
      const nextSource = format === 'json'
        ? `${JSON.stringify(merged, null, 2)}\n`
        : stringifyYaml(merged, { lineWidth: 0 })
      await save(nextSource)
      success('配置已保存，需重启生效')
    } catch (err) {
      toastError('配置保存失败，草稿已保留。请查看页面中的技术详情。')
      throw err
    } finally {
      setSaving(false)
    }
  }

  const handleRefresh = async () => {
    try {
      await load()
      success('已刷新')
    } catch {
      toastError('刷新失败')
    }
  }

  const previousPluginUrl = useRef(pluginFromUrl)
  useEffect(() => {
    if (previousPluginUrl.current === pluginFromUrl) return
    previousPluginUrl.current = pluginFromUrl
    setActiveSection(pluginFromUrl ? `plugin:${pluginFromUrl}` : 'general')
  }, [pluginFromUrl])

  if (loading && !source) {
    return (
      <div className="space-y-4">
        <PageHeader title="配置" description="加载配置中..." />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="配置"
        description="按配置项编辑，或修改完整源码。"
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        }
      />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>{errorOperation === 'save' ? '配置保存失败，当前草稿已保留。请检查内容后重新保存，或撤销本次修改。' : readErrorSummary(error, '配置')}</p>
            <details><summary className="cursor-pointer">技术详情</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{error}</pre></details>
            {errorOperation === 'read' ? <Button variant="outline" size="sm" onClick={() => void load().catch(() => {})}>重试读取</Button> : null}
          </AlertDescription>
        </Alert>
      )}

      {loaded ? <Tabs value={visibleSection} onValueChange={setActiveSection}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          {hasGeneral ? <TabsTrigger value="general">其他配置</TabsTrigger> : null}
          {pluginKeys.map((key) => (
            <TabsTrigger key={key} value={`plugin:${key}`}>
              {key}
            </TabsTrigger>
          ))}
          <TabsTrigger value="yaml" className="gap-1.5">
            <FileCode className="w-4 h-4" />
            {format.toUpperCase()} 全量
          </TabsTrigger>
        </TabsList>

        {hasGeneral ? <TabsContent value="general" className="mt-4">
          <GeneralConfigForm config={parsedConfig} pluginKeys={pluginKeys} onSave={handleFormSave} saving={saving} />
        </TabsContent> : null}

        {pluginKeys.map((key) => (
          <TabsContent key={key} value={`plugin:${key}`} className="mt-4">
            <PluginConfigForm pluginName={key} onSuccess={() => void load()} onOpenYaml={() => setActiveSection('yaml')} />
          </TabsContent>
        ))}

        <TabsContent value="yaml" className="mt-4 space-y-3">
          <div className="relative">
            <Textarea
              aria-label={`${format.toUpperCase()} 配置源码`}
              aria-invalid={sourceDirty && Boolean(sourceIssue)}
              aria-describedby={sourceDirty && sourceIssue ? 'config-source-error' : undefined}
              value={sourceText}
              onChange={e => { setSourceText(e.target.value); setSourceDirty(true) }}
              className="font-mono text-sm min-h-[400px] resize-y"
              placeholder={format === 'json' ? '{ "plugins": {} }' : '# zhin.config.yml'}
              spellCheck={false}
            />
          </div>
          {sourceDirty && sourceIssue ? <p id="config-source-error" role="alert" className="text-sm text-destructive">{sourceIssue}</p> : null}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleYamlSave} disabled={saving || !sourceDirty || Boolean(sourceIssue)}>
              {saving
                ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
                : <><Save className="w-4 h-4 mr-1" />保存</>}
            </Button>
            {sourceDirty && (
              <Button variant="outline" size="sm" disabled={saving} onClick={() => { setSourceText(source); setSourceDirty(false); clearSaveError() }}>
                <X className="w-4 h-4 mr-1" />撤销
              </Button>
            )}
            {sourceDirty && <span className="text-xs text-muted-foreground">有未保存的更改（全量保存需重启生效）</span>}
          </div>
        </TabsContent>
      </Tabs> : null}
    </div>
  )
}

function DemoConfigPage() {
  return (
    <div className="space-y-4">
      <PageHeader
        title="配置"
        description="Demo 不读取 Host 原始配置；完整配置工作台仅在私有 full 模式开放"
      />
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          原始 YAML 可能包含 Token、密钥与基础设施信息，因此公开 Demo 不请求、不缓存，也不渲染配置内容。
        </AlertDescription>
      </Alert>
      <Card>
        <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
          <Settings className="h-8 w-8 text-muted-foreground" />
          <div>
            <h2 className="font-semibold">配置数据已隔离</h2>
            <p className="mt-1 text-sm text-muted-foreground">部署 Console full 模式后，可使用表单和 YAML 两种方式管理配置。</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function ConfigPage() {
  return isDemoMode() ? <DemoConfigPage /> : <EditableConfigPage />
}
