import { useI18n } from '../i18n'
import { useState, useEffect, useMemo, useRef } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useConfigSource } from '../hooks/useConfigSource'
import { PluginConfigForm } from '../components/PluginConfigForm'
import { parse as parseYaml } from 'yaml'
import {
  Settings, AlertCircle, ChevronRight, ArrowLeft, SlidersHorizontal, Brain, Bot, Blocks
} from 'lucide-react'
import { Card, CardContent } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { PageHeader } from '../components/PageHeader'
import { readErrorSummary } from '../utils/read-error.mjs'
import { isDemoMode } from '../utils/demo-mode'
import { buildSettingsCatalog, resolveSettingsSelection, type SettingsEntry } from './settings-model.mjs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { WelcomeFlowContext } from './WelcomeFlowContext'

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
  const { source, format, configKeys: pluginKeys, loading, loaded, error, load, snapshot } = useConfigSource()
  const [activeSection, setActiveSection] = useState<string>(() => pluginFromUrl ? `plugin:${pluginFromUrl}` : 'general')
  const [visitedEntries, setVisitedEntries] = useState<Map<string, SettingsEntry>>(() => new Map())
  const [sectionFilter, setSectionFilter] = useState('')
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
      <PageHeader title={i18n.t("设置")} />

      {error && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>{readErrorSummary(error, i18n.t("配置"), i18n.locale)}</p>
            <details><summary className="cursor-pointer">{i18n.t("技术详情")}</summary><pre className="mt-2 whitespace-pre-wrap break-words text-xs">{error}</pre></details>
            <Button variant="outline" size="sm" onClick={() => void load().catch(() => {})}>{i18n.t("重试读取")}</Button>
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
                aria-current={activeGroup.id === group.id ? 'page' : undefined}
                onClick={() => { setActiveSection(group.id); setSectionFilter('') }}>
                <Icon aria-hidden="true" /><span>{i18n.t(group.title)}</span>
              </button>
            })}
          </div>
        </nav>

        <div className="console-settings-content">
          {!activeEntry ? <section aria-labelledby="settings-category-title" className="console-settings-category">
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
                    {!entry.writable ? <small>{i18n.t("只读")}</small> : null}</span>
                  <ChevronRight className="console-settings-entry-arrow" aria-hidden="true" />
                </button>)}
              </div>
            </section>)}
            {!listEntries.length ? <div className="console-settings-empty" role="status">
              <Settings aria-hidden="true" /><h3>{i18n.t(activeGroup.entries.length ? '没有匹配的设置' : '当前没有可配置项目')}</h3>
              {activeGroup.entries.length ? <p>{i18n.t("换一个名称或用途重新搜索。")}</p> : null}
              {normalizedFilter ? <Button variant="outline" onClick={() => setSectionFilter('')}>{i18n.t("清除搜索")}</Button> : null}
            </div> : null}
          </section> : null}

          {activeEntry && (activeGroup.id === 'general' || activeGroup.id === 'plugins') ? <div className="console-settings-detail-heading">
            <Button type="button" variant="ghost" size="sm" onClick={() => { setActiveSection(activeGroup.id); setSectionFilter('') }}>
              <ArrowLeft aria-hidden="true" />{i18n.t("返回 {0}", [i18n.t(activeGroup.title)])}
            </Button>
          </div> : null}

          {ownerKeys.map(key => {
            // A configuration owner has exactly one form and CAS-bound draft. In
            // particular, switching AI views never creates independent ai drafts.
            const entry = activeEntry?.configKey === key ? activeEntry : visitedEntries.get(key)
            const visible = activeEntry?.configKey === key
            return <section key={key} hidden={!visible} className="console-settings-form" aria-label={entry ? i18n.t(entry.title) : key}>
              {entry && !entry.writable ? <Card className="console-settings-empty">
                <Settings aria-hidden="true" /><h3>{i18n.t(entry.title)}</h3>
                <p>{i18n.t("此项暂不支持表单编辑。")}</p>
                <Button asChild variant="outline"><Link to="/files">{i18n.t("打开文件管理")}</Link></Button>
              </Card> : entry ? <PluginConfigForm pluginName={key} sourceRevision={snapshot?.revision}
                displayTitle={i18n.t(entry.title)}
                fieldNames={entry.fieldNames} excludedFieldNames={entry.excludedFieldNames ?? []}
                onSuccess={() => { if (isInboxCacheScopeActive(connectionScope)) void load().catch(() => {}) }} /> : null}
            </section>
          })}

        </div>
      </div> : null}
    </div>
  )
}

function DemoConfigPage() {
  const i18n = useI18n()
  return (
    <div className="space-y-4">
      <PageHeader title={i18n.t("设置")} />
      <Card>
        <CardContent className="flex min-h-56 flex-col items-center justify-center gap-3 text-center">
          <Settings className="h-8 w-8 text-muted-foreground" />
          <div>
            <h2 className="font-semibold">{i18n.t("演示模式")}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{i18n.t("连接自己的 Host 后管理设置。")}</p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}

export default function ConfigPage() {
  return isDemoMode() ? <DemoConfigPage /> : <EditableConfigPage />
}
