import { useState, useEffect, useMemo } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConfigYaml } from '@zhin.js/client'
import { PluginConfigForm } from '../components/PluginConfigForm'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import {
  Settings, AlertCircle, Save, Loader2, X,
  RefreshCw, FileCode, FormInput
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
import { ErrorAlert } from '../components/error-alert'
import { useToast } from '../components/toast'
import { Switch } from '../components/ui/switch'
import { PageHeader } from '../components/PageHeader'
import { isDemoMode } from '../utils/demo-mode'

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
  const generalKeys = useMemo(() => {
    const excludeSet = new Set(pluginKeys)
    excludeSet.add('plugins')
    return Object.keys(config).filter(k => !excludeSet.has(k))
  }, [config, pluginKeys])

  const [localValues, setLocalValues] = useState<Record<string, any>>({})
  const [dirty, setDirty] = useState(false)

  useEffect(() => {
    const vals: Record<string, any> = {}
    for (const key of generalKeys) {
      vals[key] = config[key]
    }
    setLocalValues(vals)
    setDirty(false)
  }, [config, generalKeys])

  const handleChange = (key: string, value: any) => {
    setLocalValues(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    await onSave(localValues)
    setDirty(false)
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
  const { yaml, pluginKeys, loading, error, load, save } = useConfigYaml()
  const [activeSection, setActiveSection] = useState<string>('general')
  const [mode, setMode] = useState<'form' | 'yaml'>('form')
  const [yamlText, setYamlText] = useState('')
  const [yamlDirty, setYamlDirty] = useState(false)
  const [saving, setSaving] = useState(false)
  const { success, error: toastError } = useToast()

  useEffect(() => {
    if (yaml) {
      setYamlText(yaml)
      setYamlDirty(false)
    }
  }, [yaml])

  const parsedConfig = useMemo(() => {
    try {
      return parseYaml(yaml) || {}
    } catch {
      return {}
    }
  }, [yaml])

  const handleYamlSave = async () => {
    setSaving(true)
    try {
      await save(yamlText)
      setYamlDirty(false)
      success('配置已保存，需重启生效')
    } catch (err) {
      toastError(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`)
    } finally {
      setSaving(false)
    }
  }

  const handleFormSave = async (patch: Record<string, any>) => {
    setSaving(true)
    try {
      const currentParsed = parseYaml(yaml) || {}
      const merged = { ...currentParsed, ...patch }
      const newYaml = stringifyYaml(merged, { lineWidth: 0 })
      await save(newYaml)
      success('配置已保存，需重启生效')
    } catch (err) {
      toastError(`保存失败: ${err instanceof Error ? err.message : '未知错误'}`)
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

  useEffect(() => {
    if (!pluginFromUrl || loading) return
    if (pluginKeys.includes(pluginFromUrl)) {
      setActiveSection(`plugin:${pluginFromUrl}`)
    }
  }, [pluginFromUrl, pluginKeys, loading])

  if (loading && !yaml) {
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
        description="编辑 Host 通用项与各插件配置；插件项保存后可热重载，YAML 全量保存需重启"
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        }
      />

      {error && (
        <ErrorAlert error={error} onRetry={load} />
      )}

      <Tabs value={activeSection} onValueChange={setActiveSection}>
        <TabsList className="flex flex-wrap h-auto gap-1">
          <TabsTrigger value="general">通用配置</TabsTrigger>
          {pluginKeys.map((key) => (
            <TabsTrigger key={key} value={`plugin:${key}`}>
              {key}
            </TabsTrigger>
          ))}
          <TabsTrigger value="yaml" className="gap-1.5">
            <FileCode className="w-4 h-4" />
            YAML 全量
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <Tabs value={mode} onValueChange={v => setMode(v as 'form' | 'yaml')}>
            <TabsList>
              <TabsTrigger value="form" className="gap-1.5">
                <FormInput className="w-4 h-4" />
                表单
              </TabsTrigger>
            </TabsList>
            <TabsContent value="form" className="mt-4">
              <GeneralConfigForm
                config={parsedConfig}
                pluginKeys={pluginKeys}
                onSave={handleFormSave}
                saving={saving}
              />
            </TabsContent>
          </Tabs>
        </TabsContent>

        {pluginKeys.map((key) => (
          <TabsContent key={key} value={`plugin:${key}`} className="mt-4">
            <PluginConfigForm pluginName={key} onSuccess={() => void load()} />
          </TabsContent>
        ))}

        <TabsContent value="yaml" className="mt-4 space-y-3">
          <div className="relative">
            <Textarea
              value={yamlText}
              onChange={e => { setYamlText(e.target.value); setYamlDirty(true) }}
              className="font-mono text-sm min-h-[400px] resize-y"
              placeholder="# zhin.config.yml"
              spellCheck={false}
            />
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleYamlSave} disabled={saving || !yamlDirty}>
              {saving
                ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
                : <><Save className="w-4 h-4 mr-1" />保存</>}
            </Button>
            {yamlDirty && (
              <Button variant="outline" size="sm" onClick={() => { setYamlText(yaml); setYamlDirty(false) }}>
                <X className="w-4 h-4 mr-1" />撤销
              </Button>
            )}
            {yamlDirty && <span className="text-xs text-muted-foreground">有未保存的更改（YAML 保存需重启生效）</span>}
          </div>
        </TabsContent>
      </Tabs>
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
