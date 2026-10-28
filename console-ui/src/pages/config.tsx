import { useI18n } from '../i18n'
import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useConfigSource } from '../hooks/useConfigSource'
import { PluginConfigForm } from '../components/PluginConfigForm'
import { parse as parseYaml } from 'yaml'
import {
  Settings, AlertCircle, Save, Loader2, X,
  RefreshCw, FileCode, ChevronRight, ArrowLeft, SlidersHorizontal, Brain, Bot, Blocks
} from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Input } from '../components/ui/input'
import { CodeEditor } from './files/code-editor'
import { Skeleton } from '../components/ui/skeleton'
import { useToast } from '../components/toast'
import { PageHeader } from '../components/PageHeader'
import { readErrorSummary } from '../utils/read-error.mjs'
import { isDemoMode } from '../utils/demo-mode'
import { editSourceDraft, saveSourceDraft, type SourceDraft } from './config-source-draft.mjs'
import { validateConfigSource } from './config-source-validation.mjs'
import { buildSettingsCatalog, resolveSettingsSelection, type SettingsEntry } from './settings-model.mjs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { WelcomeFlowContext } from './WelcomeFlowContext'
import { configurationSaveSummary } from '../components/PluginConfigForm/config-evidence-model.mjs'

/** Compact display for content-hash revisions; the full value stays in the title for copying. */
function shortRevision(revision: string): string {
  return revision.length > 16 ? `${revision.slice(0, 8)}…${revision.slice(-4)}` : revision
}

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
  const [visitedEntries, setVisitedEntries] = useState<Map<string, SettingsEntry>>(() => new Map())
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

  const catalog = useMemo(() => buildSettingsCatalog(parsedConfig, pluginKeys, snapshot?.configPaths), [parsedConfig, pluginKeys, snapshot?.configPaths])
  const selection = resolveSettingsSelection(activeSection, catalog)
  const activeEntry = selection.entry
  const activeGroup = catalog.find(group => group.id === selection.group) ?? catalog[0]
  const normalizedFilter = sectionFilter.trim().toLocaleLowerCase()
  const listEntries = activeGroup.entries.filter(entry =>
    [entry.title, entry.description, entry.configKey].some(value => i18n.t(value).toLocaleLowerCase().includes(normalizedFilter)))
  const sections = [...new Set(listEntries.map(entry => entry.section ?? 'general'))]
  const ownerKeys = [...new Set(catalog.flatMap(group => group.entries.map(entry => entry.configKey)))]
  useEffect(() => {
    if (loaded && activeEntry) setVisitedEntries(previous => previous.get(activeEntry.configKey)?.id === activeEntry.id
      ? previous : new Map(previous).set(activeEntry.configKey, activeEntry))
  }, [loaded, activeEntry])

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
        <PageHeader title={i18n.t("设置")} description={i18n.t("加载配置中...")} />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title={i18n.t("设置")}
        description={i18n.t("按用途查找设置；需要调整时，再打开对应配置。")}
        actions={
          <Button variant="outline" size="sm" onClick={handleRefresh} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1 ${loading ? 'animate-spin' : ''}`} />
            {i18n.t("刷新")}</Button>
        }
      />
      {snapshot?.revision ? <p className="text-xs text-muted-foreground">{i18n.t("已读取文件版本：")}<code className="console-revision" title={snapshot.revision}>{shortRevision(snapshot.revision)}</code>{i18n.t("。文件保存不代表当前运行已应用。")}</p> : null}

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

      {searchParams.get('useCase') === 'group-welcome' && pluginFromUrl && activeEntry?.configKey === pluginFromUrl && loaded
        ? <WelcomeFlowContext instanceKey={pluginFromUrl} kind="config" /> : null}

      {loaded ? <div className="console-settings-layout">
        <nav className="console-settings-nav" aria-label={i18n.t("设置分类")}>
          <div className="console-settings-nav-primary">
            {catalog.map(group => {
              const Icon = group.id === 'general' ? SlidersHorizontal : group.id === 'models' ? Brain : group.id === 'presets' ? Bot : Blocks
              return <button key={group.id} type="button" className="console-settings-nav-item"
                aria-current={!selection.source && activeGroup.id === group.id ? 'page' : undefined}
                onClick={() => { setActiveSection(group.id); setSectionFilter('') }}>
                <Icon aria-hidden="true" /><span>{i18n.t(group.title)}</span>
              </button>
            })}
          </div>
          <details className="console-settings-advanced" open={selection.source ? true : undefined}>
            <summary>{i18n.t("高级")}</summary>
            <button type="button" className="console-settings-nav-item" aria-current={selection.source === 'declarations' ? 'page' : undefined} onClick={() => setActiveSection('declarations')}>
              <Blocks aria-hidden="true" /><span>{i18n.t("插件声明")}</span>
            </button>
            <button type="button" className="console-settings-nav-item" aria-current={selection.source === 'yaml' ? 'page' : undefined} onClick={() => setActiveSection('yaml')}>
              <FileCode aria-hidden="true" /><span>{i18n.t("完整源码")}</span>
            </button>
          </details>
        </nav>

        <div className="console-settings-content">
          {!selection.source && !activeEntry ? <section aria-labelledby="settings-category-title" className="console-settings-category">
            <header className="console-settings-category-heading">
              <div><h2 id="settings-category-title">{i18n.t(activeGroup.title)}</h2><p>{i18n.t(activeGroup.description)}</p></div>
              {activeGroup.entries.length > 0 ? <Input type="search" aria-label={i18n.t("搜索设置")}
                placeholder={i18n.t("搜索名称或用途…")} value={sectionFilter} onChange={event => setSectionFilter(event.target.value)} /> : null}
            </header>
            {sections.map(section => <section className="console-settings-section" key={section}>
              {section !== 'general' ? <h3>{i18n.t(section === 'builtin' ? '内置能力' : section === 'extensions' ? '已安装与自定义' : '未识别配置')}</h3> : null}
              <div className="console-settings-list">
                {listEntries.filter(entry => (entry.section ?? 'general') === section).map(entry => <button key={entry.id} type="button"
                  className="console-settings-entry" onClick={() => setActiveSection(entry.id)}>
                  <span className="console-settings-entry-icon" aria-hidden="true"><Settings /></span>
                  <span className="console-settings-entry-copy"><strong>{i18n.t(entry.title)}</strong><span>{i18n.t(entry.description)}</span>
                    <small>{entry.configKey}{!entry.writable ? ` · ${i18n.t("只读")}` : ''}</small></span>
                  <ChevronRight className="console-settings-entry-arrow" aria-hidden="true" />
                </button>)}
              </div>
            </section>)}
            {!listEntries.length ? <div className="console-settings-empty" role="status">
              <Settings aria-hidden="true" /><h3>{i18n.t(activeGroup.entries.length ? '没有匹配的设置' : '当前没有可配置项目')}</h3>
              <p>{i18n.t(activeGroup.entries.length ? '换一个名称或用途重新搜索。' : '此处只展示当前 Host 提供的配置，不会自动安装或启用功能。')}</p>
              {normalizedFilter ? <Button variant="outline" onClick={() => setSectionFilter('')}>{i18n.t("清除搜索")}</Button> : null}
            </div> : null}
          </section> : null}

          {!selection.source && activeEntry ? <div className="console-settings-detail-heading">
            {activeGroup.id === 'general' || activeGroup.id === 'plugins' ? <Button type="button" variant="ghost" size="sm" onClick={() => { setActiveSection(activeGroup.id); setSectionFilter('') }}>
              <ArrowLeft aria-hidden="true" />{i18n.t("返回 {0}", [i18n.t(activeGroup.title)])}
            </Button> : null}
            <p>{i18n.t("未修改的可选项沿用默认值；保存只更新当前配置，运行状态需另行核对。")}</p>
            {activeEntry.configKey === 'ai' ? <p>{i18n.t("模型、预设和对话能力共用一份 AI 草稿；保存会包含这份草稿中的全部修改。")}</p> : null}
          </div> : null}

          {ownerKeys.map(key => {
            // A configuration owner has exactly one form and CAS-bound draft. In
            // particular, switching AI views never creates independent ai drafts.
            const entry = activeEntry?.configKey === key ? activeEntry : visitedEntries.get(key)
            const visible = !selection.source && activeEntry?.configKey === key
            return <section key={key} hidden={!visible} className="console-settings-form" aria-label={entry ? i18n.t(entry.title) : key}>
              {entry && !entry.writable ? <Card className="console-settings-empty">
                <Settings aria-hidden="true" /><h3>{i18n.t(entry.title)}</h3>
                <p>{i18n.t("Host 未提供此项的可编辑路径。可查看完整源码，或刷新后重新读取配置定义。")}</p>
                <Button variant="outline" onClick={() => setActiveSection('yaml')}>{i18n.t("查看完整源码")}</Button>
              </Card> : entry ? <PluginConfigForm pluginName={key} sourceRevision={snapshot?.revision}
                displayTitle={i18n.t(entry.title)} description={i18n.t(entry.description)}
                fieldNames={entry.fieldNames} excludedFieldNames={entry.excludedFieldNames ?? []}
                purposeFields={searchParams.get('useCase') === 'group-welcome' && key === pluginFromUrl ? ['welcomeMessage', 'welcomeConversations'] : undefined}
                onSuccess={() => { if (isInboxCacheScopeActive(connectionScope)) void load().catch(() => {}) }}
                onOpenYaml={() => { if (isInboxCacheScopeActive(connectionScope)) setActiveSection('yaml') }} /> : null}
            </section>
          })}

        <section hidden={selection.source !== 'declarations'} className="mt-0 min-w-0" aria-label={i18n.t("插件声明")}>
          <Card className="space-y-3 p-4">
            <h2 className="font-semibold">{i18n.t("插件实例与启停声明")}</h2>
            <p className="text-sm text-muted-foreground">{i18n.t("configVersion、plugins 和 disable_plugins 决定配置版本、插件挂载与启停。通过插件管理创建或调整实例；业务参数在对应配置项中编辑。")}</p>
            <Button asChild variant="outline"><Link to="/plugins">{i18n.t("管理插件实例")}</Link></Button>
            <div className="h-64 overflow-hidden rounded-lg border"><CodeEditor value={JSON.stringify(Object.fromEntries(['configVersion', 'plugins', 'disable_plugins'].filter(key => Object.hasOwn(parsedConfig, key)).map(key => [key, parsedConfig[key]])), null, 2)} language="json" readOnly ariaLabel={i18n.t("当前插件声明（只读）")} /></div>
          </Card>
        </section>

        <section hidden={selection.source !== 'yaml'} className="mt-0 min-w-0 space-y-3" aria-label={i18n.t("完整源码")}>
          <p className="text-sm text-muted-foreground">{i18n.t("完整源码包含已保存的全部设置；表单中的未保存草稿仍会保留，两种编辑方式不会自动合并。")}</p>
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
        </section>
        </div>
      </div> : null}
    </div>
  )
}

function DemoConfigPage() {
  const i18n = useI18n()
  return (
    <div className="space-y-4">
      <PageHeader
        title={i18n.t("设置")}
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
