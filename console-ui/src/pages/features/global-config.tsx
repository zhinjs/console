import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { parse as parseYaml } from 'yaml'
import { AlertCircle, ArrowLeft, Package } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription, Button, Card, PageHeader, PageShell, Skeleton } from '@zhin.js/console-ui'
import { StatusState } from '../../components/StatusState'
import { PluginConfigForm } from '../../components/PluginConfigForm'
import { useConfigSource } from '../../hooks/useConfigSource'
import { isReadDenied, readErrorSummary } from '../../utils/read-error.mjs'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { useUnsavedChangesGuard } from '../../utils/useUnsavedChangesGuard'
import { buildSettingsCatalog, resolveSettingsSelection, settingsLocationFromParams, unresolvedSettingsLocation } from '../settings-model.mjs'
import { WelcomeFlowContext } from '../WelcomeFlowContext'
import { FEATURE_OVERRIDES_KEY } from '../../components/PluginConfigForm/feature-overrides-guard.mjs'
import { GlobalFeatureSummary } from './global-feature-summary'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { globalConfigView } from './global-config-model.mjs'
import { GlobalConfigDenied, GlobalConfigReadOnly } from './global-config-readonly'

/** `/features/global/:plugin`: one plugin's global (Schema form) configuration. */
export default function GlobalFeatureConfigPage() {
  const i18n = useI18n()
  const { plugin = '' } = useParams<{ plugin: string }>()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Card className="p-4" role="status">{i18n.t("连接身份已变化，请登录当前 Host 后重新读取配置。")}</Card>
  return <GlobalConfigByAccess key={`${scope}\u0000${plugin}`} plugin={plugin} connectionScope={scope} />
}

/**
 * The view follows the identity up front: the Schema form over the configuration source with
 * `ops.config.read`, otherwise the read-only `feature.get { level: 'global' }` view (`feature.view`).
 */
function GlobalConfigByAccess({ plugin, connectionScope }: { plugin: string; connectionScope: string }) {
  const access = useConsoleAccess()
  const view = globalConfigView(access)
  if (view === 'source') return <GlobalFeatureConfig plugin={plugin} connectionScope={connectionScope} />
  return <GlobalConfigFrame plugin={plugin} title={plugin}>{view === 'feature' ? <GlobalConfigReadOnly plugin={plugin} /> : <GlobalConfigDenied />}</GlobalConfigFrame>
}

function GlobalConfigFrame({ plugin, title, children }: { plugin: string; title: string; children: ReactNode }) {
  const i18n = useI18n()
  return (
    <PageShell>
      <div><Button asChild variant="ghost" size="sm"><Link to="/features"><ArrowLeft />{i18n.t("功能矩阵")}</Link></Button></div>
      <PageHeader
        title={title}
        description={i18n.t("全局配置：对所有适配器和账号生效，除非下级另有覆盖。")}
        actions={<Button asChild variant="secondary" size="sm"><Link to={`/plugins/${encodeURIComponent(plugin)}`}><Package />{i18n.t("插件详情")}</Link></Button>}
      />
      <GlobalFeatureSummary plugin={plugin} />
      {children}
    </PageShell>
  )
}

function GlobalFeatureConfig({ plugin, connectionScope }: { plugin: string; connectionScope: string }) {
  const i18n = useI18n()
  const [searchParams] = useSearchParams()
  const access = useConsoleAccess()
  const { source, format, configKeys, loading, loaded, error, errorOperation, load, snapshot } = useConfigSource()
  const [dirty, setDirty] = useState(false)
  const leaveConfirmation = useUnsavedChangesGuard(dirty)
  const parsedConfig = useMemo(() => {
    try {
      return (format === 'json' ? JSON.parse(source) : parseYaml(source)) || {}
    } catch {
      return {}
    }
  }, [source, format])
  const catalog = useMemo(() => buildSettingsCatalog(parsedConfig, configKeys, snapshot?.configPaths), [parsedConfig, configKeys, snapshot?.configPaths])
  const location = settingsLocationFromParams(new URLSearchParams({ plugin }), parsedConfig)
  const { entry } = resolveSettingsSelection(location.selection, catalog)
  const unresolved = loaded && !entry ? unresolvedSettingsLocation(location, catalog, parsedConfig) : null
  const reload = useCallback(() => { if (isInboxCacheScopeActive(connectionScope)) void load().catch(() => {}) }, [connectionScope, load])
  const title = entry ? i18n.t(entry.title) : plugin

  // The Host refused the source read (403) although the session allowed it: read-only view instead.
  const fallback = !loaded && errorOperation === 'read' && isReadDenied(error) && globalConfigView(access, { sourceDenied: true }) === 'feature'
  if (fallback) return <GlobalConfigFrame plugin={plugin} title={plugin}><GlobalConfigReadOnly plugin={plugin} /></GlobalConfigFrame>

  return (
    <GlobalConfigFrame plugin={plugin} title={title}>
      {searchParams.get('useCase') === 'group-welcome' && entry ? <WelcomeFlowContext instanceKey={plugin} kind="config" /> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>{readErrorSummary(error, i18n.t("配置"), i18n.locale)}</p>
            <Button variant="secondary" size="sm" onClick={reload}>{i18n.t("重试读取")}</Button>
          </AlertDescription>
        </Alert>
      ) : null}
      {loading && !loaded ? <StatusState kind="loading" onRetry={() => void load().catch(() => {})} placeholder={<Skeleton className="h-48" />} /> : null}
      {unresolved ? (
        <Alert role="status">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            {unresolved.kind === 'plugin-without-settings'
              ? i18n.t("插件「{0}」没有可在此编辑的配置项。", [plugin])
              : i18n.t("当前 Host 没有名为「{0}」的插件配置。", [plugin])}
          </AlertDescription>
        </Alert>
      ) : null}
      {entry && !entry.writable ? (
        <Alert role="status"><AlertDescription>{i18n.t("此项暂不支持表单编辑。")} <Link className="underline" to="/ops/files">{i18n.t("打开文件管理")}</Link></AlertDescription></Alert>
      ) : null}
      {entry && entry.writable ? (
        <PluginConfigForm pluginName={entry.configKey} sourceRevision={snapshot?.revision}
          displayTitle={title}
          fieldNames={entry.fieldNames} excludedFieldNames={[...(entry.excludedFieldNames ?? []), FEATURE_OVERRIDES_KEY]}
          onDirtyChange={setDirty}
          onSuccess={reload} />
      ) : null}
      {leaveConfirmation}
    </GlobalConfigFrame>
  )
}
