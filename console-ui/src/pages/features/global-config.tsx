import { useCallback, useMemo, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { parse as parseYaml } from 'yaml'
import { AlertCircle, ArrowLeft, Package } from 'lucide-react'
import { useI18n } from '../../i18n'
import { PageShell } from '../../components/PageShell'
import { PageHeader } from '../../components/PageHeader'
import { Alert, AlertDescription } from '../../components/ui/alert'
import { Button } from '../../components/ui/button'
import { Card } from '../../components/ui/card'
import { Skeleton } from '../../components/ui/skeleton'
import { StatusState } from '../../components/StatusState'
import { PluginConfigForm } from '../../components/PluginConfigForm'
import { useConfigSource } from '../../hooks/useConfigSource'
import { readErrorSummary } from '../../utils/read-error.mjs'
import { useInboxCacheScope } from '../../utils/useInboxCacheScope'
import { isInboxCacheScopeActive } from '../../utils/inbox-cache'
import { useUnsavedChangesGuard } from '../../utils/useUnsavedChangesGuard'
import { buildSettingsCatalog, resolveSettingsSelection, settingsLocationFromParams, unresolvedSettingsLocation } from '../settings-model.mjs'
import { WelcomeFlowContext } from '../WelcomeFlowContext'
import { FEATURE_OVERRIDES_KEY } from '../../components/PluginConfigForm/feature-overrides-guard.mjs'
import { GlobalFeatureSummary } from './global-feature-summary'

/** `/features/global/:plugin`: one plugin's global (Schema form) configuration. */
export default function GlobalFeatureConfigPage() {
  const i18n = useI18n()
  const { plugin = '' } = useParams<{ plugin: string }>()
  const scope = useInboxCacheScope()
  if (!scope || !isInboxCacheScopeActive(scope)) return <Card className="p-4" role="status">{i18n.t("连接身份已变化，请登录当前 Host 后重新读取配置。")}</Card>
  return <GlobalFeatureConfig key={`${scope}\u0000${plugin}`} plugin={plugin} connectionScope={scope} />
}

function GlobalFeatureConfig({ plugin, connectionScope }: { plugin: string; connectionScope: string }) {
  const i18n = useI18n()
  const [searchParams] = useSearchParams()
  const { source, format, configKeys, loading, loaded, error, load, snapshot } = useConfigSource()
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

  return (
    <PageShell>
      <div><Button asChild variant="ghost" size="sm"><Link to="/features"><ArrowLeft />{i18n.t("功能矩阵")}</Link></Button></div>
      <PageHeader
        title={title}
        description={i18n.t("全局配置：对所有适配器和账号生效，除非下级另有覆盖。")}
        actions={<Button asChild variant="outline" size="sm"><Link to={`/plugins/${encodeURIComponent(plugin)}`}><Package />{i18n.t("插件详情")}</Link></Button>}
      />
      <GlobalFeatureSummary plugin={plugin} />
      {searchParams.get('useCase') === 'group-welcome' && entry ? <WelcomeFlowContext instanceKey={plugin} kind="config" /> : null}
      {error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription className="space-y-2">
            <p>{readErrorSummary(error, i18n.t("配置"), i18n.locale)}</p>
            <Button variant="outline" size="sm" onClick={reload}>{i18n.t("重试读取")}</Button>
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
    </PageShell>
  )
}
