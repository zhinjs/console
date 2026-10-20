import { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useConfigSource, type ConfigSource } from '../hooks/useConfigSource'
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
import { editSourceDraft, saveSourceDraft, type SourceDraft } from './config-source-draft.mjs'
import { validateConfigSource } from './config-source-validation.mjs'
import { generalConfigKeys, resolveConfigSection } from './config-navigation.mjs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { WelcomeFlowContext } from './WelcomeFlowContext'
import { configurationSaveSummary } from '../components/PluginConfigForm/config-evidence-model.mjs'

function GeneralConfigForm({
  config,
  pluginKeys,
  snapshot,
  onSave,
  saving,
  connectionScope,
}: {
  config: Record<string, any>
  pluginKeys: string[]
  snapshot: ConfigSource | null
  onSave: (patch: Record<string, any>, baseline: ConfigSource | null) => Promise<void>
  saving: boolean
  connectionScope: string
}) {
  const generalKeys = useMemo(() => generalConfigKeys(config, pluginKeys), [config, pluginKeys])

  const [localValues, setLocalValues] = useState<Record<string, any>>({})
  const [dirty, setDirty] = useState(false)
  const [baselineSnapshot, setBaselineSnapshot] = useState<ConfigSource | null>(snapshot)

  useEffect(() => {
    if (dirty) return
    const vals: Record<string, any> = {}
    for (const key of generalKeys) {
      vals[key] = config[key]
    }
    setLocalValues(vals)
    setBaselineSnapshot(snapshot)
    setDirty(false)
  }, [config, generalKeys, dirty, snapshot])

  const handleChange = (key: string, value: any) => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    setLocalValues(prev => ({ ...prev, [key]: value }))
    setDirty(true)
  }

  const handleSave = async () => {
    if (!isInboxCacheScopeActive(connectionScope) || baselineSnapshot?.connectionScope !== connectionScope) return
    try {
      await onSave(localValues, baselineSnapshot)
      if (!isInboxCacheScopeActive(connectionScope)) return
      setDirty(false)
    } catch {
      // Parent shows the save error; retain this form draft for retry.
    }
  }

  const handleReset = () => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    const vals: Record<string, any> = {}
    for (const key of generalKeys) {
      vals[key] = config[key]
    }
    setLocalValues(vals)
    setBaselineSnapshot(snapshot)
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
      <fieldset disabled={saving} className="space-y-3">
        {generalKeys.map(key => (
          <ConfigFieldEditor
            key={key}
            fieldKey={key}
            value={localValues[key]}
            onChange={val => handleChange(key, val)}
          />
        ))}
      </fieldset>
      <div className="flex items-center gap-2 pt-2">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          {saving
            ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />保存中...</>
            : <><Save className="w-4 h-4 mr-1" />保存</>}
        </Button>
        {dirty && (
          <Button variant="outline" size="sm" disabled={saving} onClick={handleReset}>
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
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Card className="p-4" role="status">连接身份已变化，请登录当前 Host 后重新读取配置。</Card>
  return <EditableConfigSession key={scope} connectionScope={scope} />
}

function EditableConfigSession({ connectionScope }: { connectionScope: string }) {
  const [searchParams] = useSearchParams()
  const pluginFromUrl = searchParams.get('plugin')?.trim() ?? ''
  const { source, format, configKeys: pluginKeys, loading, loaded, error, errorOperation, clearSaveError, load, saveBound, snapshot } = useConfigSource()
  const [activeSection, setActiveSection] = useState<string>(() => pluginFromUrl ? `plugin:${pluginFromUrl}` : 'general')
  const [sourceDraft, setSourceDraft] = useState<SourceDraft | null>(null)
  const sourceText = sourceDraft?.source ?? source
  const sourceDirty = sourceDraft !== null
  const draftFormat = sourceDraft?.snapshot.format ?? format
  const [saving, setSaving] = useState(false)
  const operation = useRef(0)
  useEffect(() => () => { operation.current++ }, [])
  const { success, error: toastError } = useToast()

  const parsedConfig = useMemo(() => {
    try {
      return (format === 'json' ? JSON.parse(source) : parseYaml(source)) || {}
    } catch {
      return {}
    }
  }, [source, format])

  const hasGeneral = generalConfigKeys(parsedConfig, pluginKeys).length > 0
  const visibleSection = resolveConfigSection(activeSection, pluginKeys, hasGeneral)

  const sourceIssue = useMemo(() => validateConfigSource(sourceText, draftFormat), [sourceText, draftFormat])

  const handleYamlSave = async () => {
    if (!isInboxCacheScopeActive(connectionScope) || sourceDraft?.snapshot.connectionScope !== connectionScope
      || saving || !sourceDirty || sourceIssue) return
    const operationId = ++operation.current
    const currentOperation = () => isInboxCacheScopeActive(connectionScope) && operation.current === operationId
    setSaving(true)
    try {
      const result = await saveSourceDraft(saveBound, sourceDraft)
      if (!currentOperation()) return
      setSourceDraft(null)
      success(`${configurationSaveSummary(result)} 文件版本：${result.revision}`)
    } catch (err) {
      if (currentOperation()) toastError('配置保存失败，草稿已保留。请查看页面中的技术详情。')
    } finally {
      if (currentOperation()) setSaving(false)
    }
  }

  const handleFormSave = async (patch: Record<string, any>, baseline: ConfigSource | null) => {
    if (!isInboxCacheScopeActive(connectionScope) || baseline?.connectionScope !== connectionScope) throw new Error('草稿属于旧连接，请重新读取当前 Host 配置')
    const operationId = ++operation.current
    const currentOperation = () => isInboxCacheScopeActive(connectionScope) && operation.current === operationId
    setSaving(true)
    try {
      if (!baseline?.revision) throw new Error('草稿版本未知，请撤销并重新读取配置')
      const currentParsed = (baseline.format === 'json' ? JSON.parse(baseline.source) : parseYaml(baseline.source)) || {}
      const merged = { ...currentParsed, ...patch }
      const nextSource = baseline.format === 'json'
        ? `${JSON.stringify(merged, null, 2)}\n`
        : stringifyYaml(merged, { lineWidth: 0 })
      const result = await saveBound(nextSource, baseline)
      if (!currentOperation()) throw new Error('保存结果已过期，请到原 Host 核实')
      success(`${configurationSaveSummary(result)} 文件版本：${result.revision}`)
    } catch (err) {
      if (currentOperation()) toastError('配置保存失败，草稿已保留。请查看页面中的技术详情。')
      throw err
    } finally {
      if (currentOperation()) setSaving(false)
    }
  }

  const handleRefresh = async () => {
    if (!isInboxCacheScopeActive(connectionScope)) return
    const operationId = ++operation.current
    const currentOperation = () => isInboxCacheScopeActive(connectionScope) && operation.current === operationId
    try {
      await load()
      if (!currentOperation()) return
      success('已刷新')
    } catch {
      if (currentOperation()) toastError('刷新失败')
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
      {snapshot?.revision ? <p className="break-all text-xs text-muted-foreground">已读取文件版本：<code>{snapshot.revision}</code>。文件保存不代表当前运行已应用。</p> : null}

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

      {searchParams.get('useCase') === 'group-welcome' && pluginFromUrl && visibleSection === `plugin:${pluginFromUrl}` && loaded
        ? <WelcomeFlowContext instanceKey={pluginFromUrl} kind="config" /> : null}

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
          <GeneralConfigForm config={parsedConfig} pluginKeys={pluginKeys} snapshot={snapshot} onSave={handleFormSave} saving={saving} connectionScope={connectionScope} />
        </TabsContent> : null}

        {pluginKeys.map((key) => (
          <TabsContent key={key} value={`plugin:${key}`} className="mt-4">
            <PluginConfigForm pluginName={key} purposeFields={searchParams.get('useCase') === 'group-welcome' && key === pluginFromUrl ? ['welcomeMessage', 'welcomeConversations'] : undefined} onSuccess={() => { if (isInboxCacheScopeActive(connectionScope)) void load().catch(() => {}) }} onOpenYaml={() => { if (isInboxCacheScopeActive(connectionScope)) setActiveSection('yaml') }} />
          </TabsContent>
        ))}

        <TabsContent value="yaml" className="mt-4 space-y-3">
          <div className="relative">
            <Textarea
              aria-label={`${draftFormat.toUpperCase()} 配置源码`}
              aria-invalid={sourceDirty && Boolean(sourceIssue)}
              aria-describedby={sourceDirty && sourceIssue ? 'config-source-error' : undefined}
              value={sourceText}
              disabled={saving}
              onChange={e => { if (!isInboxCacheScopeActive(connectionScope)) return; const value = e.target.value; setSourceDraft(previous => editSourceDraft(previous, snapshot, value)) }}
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
              <Button variant="outline" size="sm" disabled={saving} onClick={() => { setSourceDraft(null); clearSaveError() }}>
                <X className="w-4 h-4 mr-1" />撤销
              </Button>
            )}
            {sourceDirty && <span className="text-xs text-muted-foreground">有未保存的更改；草稿绑定开始编辑时的版本，刷新不会覆盖或自动合并草稿。冲突后请核对最新源码再重新编辑。</span>}
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
