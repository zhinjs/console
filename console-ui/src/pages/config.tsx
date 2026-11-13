import { useI18n } from '../i18n'
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import { Link, Navigate, useSearchParams } from 'react-router-dom'
import { useConfigSource } from '../hooks/useConfigSource'
import { PluginConfigForm } from '../components/PluginConfigForm'
import { ConfigurationLiveStatus } from '../components/PluginConfigForm/ConfigurationLiveStatus'
import { configurationSupportsApply } from '../components/PluginConfigForm/config-live-status.mjs'
import { parse as parseYaml } from 'yaml'
import {
  Settings, AlertCircle, ChevronRight, ArrowLeft, SlidersHorizontal, Bot, Blocks
} from 'lucide-react'
import { Card } from '../components/ui/card'
import { Button } from '../components/ui/button'
import { Alert, AlertDescription } from '../components/ui/alert'
import { Input } from '../components/ui/input'
import { Skeleton } from '../components/ui/skeleton'
import { StatusState } from '../components/StatusState'
import { PageHeader } from '../components/PageHeader'
import { readErrorSummary } from '../utils/read-error.mjs'
import {
  buildSettingsCatalog, filterSettingsCatalog, resolveSettingsSelection, settingsLocationFromParams, settingsLocationParams,
  unresolvedSettingsLocation, type SettingsEntry,
} from './settings-model.mjs'
import { useInboxCacheScope } from '../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../utils/inbox-cache'
import { legacySettingsModelsRedirect } from './inference/models-entry.mjs'
import { WelcomeFlowContext } from './WelcomeFlowContext'
import { ListItemButton } from '../components/ui/list-item-button'
import { useUnsavedChangesGuard } from '../utils/useUnsavedChangesGuard'
import { setOwnerDirty } from '../utils/unsaved-changes-guard.mjs'

function EditableConfigPage() {
  const i18n = useI18n()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Card className="p-4" role="status">{i18n.t("连接身份已变化，请登录当前 Host 后重新读取配置。")}</Card>
  return <EditableConfigSession key={scope} connectionScope={scope} />
}

function EditableConfigSession({ connectionScope }: { connectionScope: string }) {
  const i18n = useI18n()
  const [searchParams, setSearchParams] = useSearchParams()
  const pluginFromUrl = searchParams.get('plugin')?.trim() ?? ''
  const { source, format, configKeys: pluginKeys, loading, loaded, error, load, snapshot, applyConfiguration, applyLoading, applyError, applyBlocked } = useConfigSource()
  const [visitedEntries, setVisitedEntries] = useState<Map<string, SettingsEntry>>(() => new Map())
  const contentRef = useRef<HTMLDivElement>(null)
  // The search box owns its text (router updates run as transitions, which would fight a
  // controlled input); the URL mirrors it so refresh and shared links restore the search.
  const urlQuery = searchParams.get('q') ?? ''
  const [sectionFilter, setFilterText] = useState(urlQuery)
  const writtenQuery = useRef(urlQuery)
  // Hidden forms stay mounted, so switching sections keeps their drafts; leaving the page does not.
  const [dirtyOwners, setDirtyOwners] = useState<ReadonlySet<string>>(() => new Set())
  const reportDirty = useCallback((key: string, dirty: boolean) => setDirtyOwners(previous => setOwnerDirty(previous, key, dirty)), [])
  const leaveConfirmation = useUnsavedChangesGuard(dirtyOwners.size > 0)
  const parsedConfig = useMemo(() => {
    try {
      return (format === 'json' ? JSON.parse(source) : parseYaml(source)) || {}
    } catch {
      return {}
    }
  }, [source, format])

  const catalog = useMemo(() => buildSettingsCatalog(parsedConfig, pluginKeys, snapshot?.configPaths), [parsedConfig, pluginKeys, snapshot?.configPaths])
  // The URL is the only record of where the user is, so refresh, shared links and links from
  // other pages (`?plugin=<instance>`) all land on the same place. Writes replace the current
  // history entry: Back leaves the settings page instead of stepping through every category,
  // and the page itself stays mounted so hidden forms keep their drafts.
  const settingsLocation = settingsLocationFromParams(searchParams, parsedConfig)
  const activeSection = settingsLocation.selection
  const showLocation = useCallback((selection: string, query = '') => {
    setFilterText(query)
    writtenQuery.current = query.trim() ? query : ''
    setSearchParams(current => settingsLocationParams(current, selection, query), { replace: true })
  }, [setSearchParams])
  const setActiveSection = (selection: string) => showLocation(selection)
  const setSectionFilter = (query: string) => showLocation(activeGroup.id, query)
  const selection = resolveSettingsSelection(activeSection, catalog)
  const unresolved = loaded ? unresolvedSettingsLocation(settingsLocation, catalog, parsedConfig) : null
  const activeEntry = selection.entry
  const activeGroup = catalog.find(group => group.id === selection.group) ?? catalog[0]
  const normalizedFilter = sectionFilter.trim().toLocaleLowerCase()
  // Search covers every group; results are listed under the group they belong to.
  const searchResults = normalizedFilter
    ? filterSettingsCatalog(catalog, sectionFilter, message => i18n.t(message)).filter(group => group.entries.length) : []
  const listEntries = activeGroup.entries
  const sections = [...new Set(listEntries.map(entry => entry.section ?? 'general'))]
  const ownerKeys = [...new Set(catalog.flatMap(group => group.entries.map(entry => entry.configKey)))]
  useEffect(() => {
    if (loaded && activeEntry) setVisitedEntries(previous => previous.get(activeEntry.configKey)?.id === activeEntry.id
      ? previous : new Map(previous).set(activeEntry.configKey, activeEntry))
  }, [loaded, activeEntry])

  // Another link to this page (for example the command center's plain /config) replaces the search.
  useEffect(() => {
    if (urlQuery === writtenQuery.current) return
    writtenQuery.current = urlQuery
    setFilterText(urlQuery)
  }, [urlQuery])

  // Query-only navigation keeps the scroll position; bring an opened entry into view when the
  // list that led to it was scrolled past the top of the settings content.
  const activeEntryId = activeEntry?.id
  useEffect(() => {
    const content = contentRef.current
    if (!loaded || !activeEntryId || !content) return
    if (content.getBoundingClientRect().top < 0) content.scrollIntoView({ block: 'start' })
  }, [loaded, activeEntryId])

  if (loading && !source) {
    return (
      <div className="space-y-4">
        <PageHeader title={i18n.t("配置文件")} description={i18n.t("加载配置中...")} />
        <StatusState kind="loading" onRetry={() => void load().catch(() => {})} placeholder={<div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-24" />)}
        </div>} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHeader title={i18n.t("配置文件")} />

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
              const Icon = group.id === 'general' ? SlidersHorizontal : group.id === 'presets' ? Bot : Blocks
              return <ListItemButton key={group.id} type="button" className="console-settings-nav-item"
                aria-current={activeGroup.id === group.id ? 'page' : undefined}
                onClick={() => showLocation(group.id)}>
                <Icon aria-hidden="true" /><span>{i18n.t(group.title)}</span>
                {group.entries.some(entry => dirtyOwners.has(entry.configKey)) ? <small className="console-dirty-pill">{i18n.t("未保存")}</small> : null}
              </ListItemButton>
            })}
          </div>
        </nav>

        <div className="console-settings-content" ref={contentRef}>
          {unresolved ? <Alert role="status">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="space-y-2">
              <p>{unresolved.kind === 'plugin-without-settings'
                ? i18n.t("插件「{0}」没有可在此编辑的配置项，已显示{1}。", [unresolved.value, i18n.t(activeGroup.title)])
                : unresolved.kind === 'unknown-plugin'
                  ? i18n.t("当前 Host 没有名为「{0}」的插件配置，已显示{1}。", [unresolved.value, i18n.t(activeGroup.title)])
                  : i18n.t("链接中的设置位置「{0}」不存在，已显示{1}。", [unresolved.value, i18n.t(activeGroup.title)])}</p>
              {unresolved.kind !== 'unknown-section' ? <Button asChild variant="outline" size="sm">
                <Link to={`/plugins/${encodeURIComponent(unresolved.value)}`}>{i18n.t("查看插件详情")}</Link>
              </Button> : null}
            </AlertDescription>
          </Alert> : null}
          {!activeEntry ? <ConfigurationLiveStatus result={snapshot} revision={snapshot?.revision}
            onRefresh={() => void load().catch(() => {})}
            onApply={configurationSupportsApply(snapshot) ? () => void applyConfiguration() : undefined}
            disabled={loading || applyBlocked} applying={applyLoading} actionError={applyError} /> : null}
          {!activeEntry ? <section aria-labelledby="settings-category-title" className="console-settings-category">
            <header className="console-settings-category-heading">
              {normalizedFilter
                ? <div><h2 id="settings-category-title">{i18n.t("搜索结果")}</h2>
                  <p>{i18n.t("在所有分类中找到 {0} 项。", [searchResults.reduce((count, group) => count + group.entries.length, 0)])}</p></div>
                : <div><h2 id="settings-category-title">{i18n.t(activeGroup.title)}</h2><p>{i18n.t(activeGroup.description)}</p></div>}
              {catalog.some(group => group.entries.length > 0) ? <Input type="search" aria-label={i18n.t("搜索设置")}
                placeholder={i18n.t("搜索名称或用途…")} value={sectionFilter} onChange={event => setSectionFilter(event.target.value)} /> : null}
            </header>
            {normalizedFilter ? searchResults.map(group => <section className="console-settings-section" key={group.id}
              aria-label={i18n.t("{0}中的搜索结果", [i18n.t(group.title)])}>
              <h3>{i18n.t(group.title)}</h3>
              <div className="console-settings-list">
                {group.entries.map(entry => <ListItemButton key={entry.id} type="button"
                  className="console-settings-entry" onClick={() => setActiveSection(entry.id)}>
                  <span className="console-settings-entry-icon" aria-hidden="true"><Settings /></span>
                  <span className="console-settings-entry-copy"><strong>{i18n.t(entry.title)}</strong><span>{i18n.t(entry.description)}</span>
                    <small>{entry.section === 'general' ? i18n.t(group.title) : i18n.t("{0} · {1}", [i18n.t(group.title), i18n.t(entry.sectionTitle)])}</small>
                    {!entry.writable ? <small>{i18n.t("只读")}</small> : null}
                    {dirtyOwners.has(entry.configKey) ? <small className="console-dirty-pill">{i18n.t("未保存")}</small> : null}</span>
                  <ChevronRight className="console-settings-entry-arrow" aria-hidden="true" />
                </ListItemButton>)}
              </div>
            </section>) : sections.map(section => <section className="console-settings-section" key={section}>
              {section !== 'general' ? <h3>{i18n.t(section === 'builtin' ? '内置能力' : section === 'extensions' ? '已安装与自定义' : '未识别配置')}</h3> : null}
              <div className="console-settings-list">
                {listEntries.filter(entry => (entry.section ?? 'general') === section).map(entry => <ListItemButton key={entry.id} type="button"
                  className="console-settings-entry" onClick={() => setActiveSection(entry.id)}>
                  <span className="console-settings-entry-icon" aria-hidden="true"><Settings /></span>
                  <span className="console-settings-entry-copy"><strong>{i18n.t(entry.title)}</strong><span>{i18n.t(entry.description)}</span>
                    {!entry.writable ? <small>{i18n.t("只读")}</small> : null}
                    {dirtyOwners.has(entry.configKey) ? <small className="console-dirty-pill">{i18n.t("未保存")}</small> : null}</span>
                  <ChevronRight className="console-settings-entry-arrow" aria-hidden="true" />
                </ListItemButton>)}
              </div>
            </section>)}
            {(normalizedFilter ? !searchResults.length : !listEntries.length) ? <div className="console-settings-empty" role="status">
              <Settings aria-hidden="true" /><h3>{i18n.t(normalizedFilter ? '没有匹配的设置' : '当前没有可配置项目')}</h3>
              {normalizedFilter ? <p>{i18n.t("换一个名称或用途重新搜索。")}</p> : null}
              {normalizedFilter ? <Button variant="outline" onClick={() => setSectionFilter('')}>{i18n.t("清除搜索")}</Button> : null}
            </div> : null}
          </section> : null}

          {activeEntry && (activeGroup.id === 'general' || activeGroup.id === 'plugins') ? <div className="console-settings-detail-heading">
            <Button type="button" variant="ghost" size="sm" onClick={() => setActiveSection(activeGroup.id)}>
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
                <Button asChild variant="outline"><Link to="/ops/files">{i18n.t("打开文件管理")}</Link></Button>
              </Card> : entry ? <PluginConfigForm pluginName={key} sourceRevision={snapshot?.revision}
                displayTitle={i18n.t(entry.title)}
                fieldNames={entry.fieldNames} excludedFieldNames={entry.excludedFieldNames ?? []}
                onDirtyChange={dirty => reportDirty(key, dirty)}
                onSuccess={() => { if (isInboxCacheScopeActive(connectionScope)) void load().catch(() => {}) }} /> : null}
            </section>
          })}

        </div>
      </div> : null}
      {leaveConfirmation}
    </div>
  )
}

export default function ConfigPage() {
  // Model management lives only in the AI section; old `?section=models` links land on it.
  const [searchParams] = useSearchParams()
  const models = legacySettingsModelsRedirect(searchParams)
  if (models) return <Navigate to={models} replace />
  return <EditableConfigPage />
}
