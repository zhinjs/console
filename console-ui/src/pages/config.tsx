import { useI18n } from '../i18n'
import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useConfigSource } from '../hooks/useConfigSource'
import { PluginConfigForm } from '../components/PluginConfigForm'
import { parse as parseYaml } from 'yaml'
import {
  Settings, AlertCircle, Save, Loader2, X,
  RefreshCw, FileCode
} from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs'
import { Input } from '../components/ui/input'
import { CodeEditor } from './files/code-editor'
import { Skeleton } from '../components/ui/skeleton'
import { useToast } from '../components/toast'
import { PageHeader } from '../components/PageHeader'
import { readErrorSummary } from '../utils/read-error.mjs'
import { isDemoMode } from '../utils/demo-mode'
import { editSourceDraft, saveSourceDraft, type SourceDraft } from './config-source-draft.mjs'
import { validateConfigSource } from './config-source-validation.mjs'
import { configSectionKeys, resolveConfigSection } from './config-navigation.mjs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { WelcomeFlowContext } from './WelcomeFlowContext'
import { configurationSaveSummary } from '../components/PluginConfigForm/config-evidence-model.mjs'

function EditableConfigPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Card className="p-4" role="status">{i18n.t("连接身份已变化，请登录当前 Host 后重新读取配置。")}</Card>
  return <EditableConfigSession key={scope} connectionScope={scope} />
}

function EditableConfigSession({ connectionScope }: { connectionScope: string }) {
  const i18n = useI18n()
  const [searchParams] = useSearchParams()
  const pluginFromUrl = searchParams.get('plugin')?.trim() ?? ''
  const { source, format, configKeys: pluginKeys, loading, loaded, error, errorOperation, clearSaveError, load, saveBound, snapshot } = useConfigSource()
  const [activeSection, setActiveSection] = useState<string>(() => pluginFromUrl ? `plugin:${pluginFromUrl}` : 'general')
  const [visitedSections, setVisitedSections] = useState<Set<string>>(() => new Set())
  const [sectionFilter, setSectionFilter] = useState('')
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

  const sectionKeys = useMemo(() => configSectionKeys(parsedConfig, pluginKeys), [parsedConfig, pluginKeys])
  const visibleSection = resolveConfigSection(activeSection, sectionKeys)
  useEffect(() => {
    if (loaded && visibleSection.startsWith('plugin:')) setVisitedSections(previous => previous.has(visibleSection) ? previous : new Set([...previous, visibleSection]))
  }, [loaded, visibleSection])

  const sourceIssue = useMemo(() => validateConfigSource(sourceText, draftFormat, i18n.locale), [sourceText, draftFormat, i18n])

  const handleYamlSave = async () => {
    if (!isInboxCacheScopeActive(connectionScope) || sourceDraft?.snapshot.connectionScope !== connectionScope
      || saving || !sourceDirty || sourceIssue) return
    const operationId = ++operation.current
    const currentOperation = () => isInboxCacheScopeActive(connectionScope) && operation.current === operationId
    setSaving(true)
    try {
      const result = await saveSourceDraft(saveBound, sourceDraft, i18n.locale)
      if (!currentOperation()) return
      setSourceDraft(null)
      success(i18n.t("{0} 文件版本：{1}", [configurationSaveSummary(result, i18n.locale), result.revision]))
    } catch (err) {
      if (currentOperation()) toastError(i18n.t("配置保存失败，草稿已保留。请查看页面中的技术详情。"))
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
      success(i18n.t("已刷新"))
    } catch {
      if (currentOperation()) toastError(i18n.t("刷新失败"))
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
        <PageHeader title={i18n.t("配置")} description={i18n.t("加载配置中...")} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={i18n.t("配置")}
        description={i18n.t("默认按字段定义编辑，每项配置均可切换表单与源码。")}
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {i18n.t("刷新")}</Button>
        }
      />
      {snapshot?.revision ? <p className="break-all text-xs text-muted-foreground">{i18n.t("已读取文件版本：")}<code>{snapshot.revision}</code>{i18n.t("。文件保存不代表当前运行已应用。")}</p> : null}

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>{errorOperation === 'save' ? i18n.t("配置保存失败，当前草稿已保留。请检查内容后重新保存，或撤销本次修改。") : readErrorSummary(error, i18n.t("配置"), i18n.locale)}</p>
            <details><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{error}</pre></details>
            {errorOperation === 'read' ? <Button variant="outline" size="sm" onClick={() => void load().catch(() => {})}>{i18n.t("重试读取")}</Button> : null}
          </AlertDescription>
        </Alert>
      )}

      {searchParams.get('useCase') === 'group-welcome' && pluginFromUrl && visibleSection === `plugin:${pluginFromUrl}` && loaded
        ? <WelcomeFlowContext instanceKey={pluginFromUrl} kind="config" /> : null}

      {loaded ? <Tabs value={visibleSection} onValueChange={setActiveSection}>
        <Input type="search" aria-label={i18n.t("筛选配置项")} placeholder={i18n.t("搜索配置项或插件实例…")} value={sectionFilter} onChange={event => setSectionFilter(event.target.value)} className="mb-2 max-w-md" />
        <TabsList className="flex max-h-48 flex-wrap justify-start overflow-y-auto h-auto gap-1">
          {sectionKeys.filter(key => key.toLowerCase().includes(sectionFilter.trim().toLowerCase())).map((key) => (
            <TabsTrigger key={key} value={`plugin:${key}`}>
              {key}
            </TabsTrigger>
          ))}
          <TabsTrigger value="declarations">{i18n.t("插件声明")}</TabsTrigger>
          <TabsTrigger value="yaml" className="gap-1.5">
            <FileCode className="w-4 h-4" />
            {i18n.t("完整源码")}</TabsTrigger>
        </TabsList>

        {sectionKeys.map((key) => (
          <TabsContent key={key} value={`plugin:${key}`} forceMount hidden={visibleSection !== `plugin:${key}`} className="mt-4">
            {visitedSections.has(`plugin:${key}`) || visibleSection === `plugin:${key}` ? <PluginConfigForm pluginName={key} sourceRevision={snapshot?.revision} purposeFields={searchParams.get('useCase') === 'group-welcome' && key === pluginFromUrl ? ['welcomeMessage', 'welcomeConversations'] : undefined} onSuccess={() => { if (isInboxCacheScopeActive(connectionScope)) void load().catch(() => {}) }} onOpenYaml={() => { if (isInboxCacheScopeActive(connectionScope)) setActiveSection('yaml') }} /> : null}
          </TabsContent>
        ))}

        <TabsContent value="declarations" className="mt-4">
          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">{i18n.t("插件实例与启停声明")}</h2>
            <p className="text-sm text-muted-foreground">{i18n.t("configVersion、plugins 和 disable_plugins 决定配置版本、插件挂载与启停。通过插件管理创建或调整实例；业务参数在对应配置项中编辑。")}</p>
            <Button asChild variant="outline"><Link to="/plugins">{i18n.t("管理插件实例")}</Link></Button>
            <div className="h-64 overflow-hidden rounded-lg border"><CodeEditor value={JSON.stringify(Object.fromEntries(['configVersion', 'plugins', 'disable_plugins'].filter(key => Object.hasOwn(parsedConfig, key)).map(key => [key, parsedConfig[key]])), null, 2)} language="json" readOnly ariaLabel={i18n.t("当前插件声明（只读）")} /></div>
          </Card>
        </TabsContent>

        <TabsContent value="yaml" className="mt-4 space-y-3">
          <p className="text-sm text-muted-foreground">{i18n.t("完整源码基于已保存配置；各项表单中尚未保存的草稿仍会保留。编辑单项时可在该项内切换源码，与表单共用草稿。")}</p>
          <div className="h-[min(65vh,640px)] min-h-[320px] overflow-hidden rounded-lg border">
            <CodeEditor
              ariaLabel={i18n.t("{0} 配置源码", [draftFormat.toUpperCase()])}
              invalid={sourceDirty && Boolean(sourceIssue)}
              errorId={sourceDirty && sourceIssue ? 'config-source-error' : undefined}
              value={sourceText}
              language={draftFormat}
              disabled={saving}
              onChange={value => { if (!isInboxCacheScopeActive(connectionScope)) return; setSourceDraft(previous => editSourceDraft(previous, snapshot, value, i18n.locale)) }}
            />
          </div>
          {sourceDirty && sourceIssue ? <p id="config-source-error" role="alert" className="text-sm text-destructive">{sourceIssue}</p> : null}
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleYamlSave} disabled={saving || !sourceDirty || Boolean(sourceIssue)}>
              {saving
                ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" />{i18n.t("保存中...")}</>
                : <><Save className="w-4 h-4 mr-1" />{i18n.t("保存")}</>}
            </Button>
            {sourceDirty && (
              <Button variant="outline" size="sm" disabled={saving} onClick={() => { setSourceDraft(null); clearSaveError() }}>
                <X className="w-4 h-4 mr-1" />{i18n.t("撤销")}</Button>
            )}
            {sourceDirty && <span className="text-xs text-muted-foreground">{i18n.t("有未保存的更改；草稿绑定开始编辑时的版本，刷新不会覆盖或自动合并草稿。冲突后请核对最新源码再重新编辑。")}</span>}
          </div>
        </TabsContent>
      </Tabs> : null}
    </div>
  )
}

function DemoConfigPage() {
  const i18n = useI18n()
  return (
    <div className="space-y-4">
      <PageHeader
        title={i18n.t("配置")}
        description={i18n.t("Demo 不读取 Host 原始配置；完整配置工作台仅在私有 full 模式开放")}
      />
      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertDescription>
          {i18n.t("原始 YAML 可能包含 Token、密钥与基础设施信息，因此公开 Demo 不请求、不缓存，也不渲染配置内容。")}</AlertDescription>
      </Alert>
      <Card>
        <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
          <Settings className="h-8 w-8 text-muted-foreground" />
          <div>
            <h2 className="font-semibold">{i18n.t("配置数据已隔离")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{i18n.t("部署 Console full 模式后，可使用表单和 YAML 两种方式管理配置。")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function ConfigPage() {
  return isDemoMode() ? <DemoConfigPage /> : <EditableConfigPage />
}
