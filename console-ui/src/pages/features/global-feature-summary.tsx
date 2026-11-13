import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import { ActionReceipt } from '../../components/ActionReceipt'
import { adapterHref } from '../../console-routes.mjs'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { conversationOverrideCounts, type FeatureLevel } from './feature-model.mjs'
import { useFeatureDetail, useFeatureMatrix } from './use-feature-data'
import { useGlobalPluginSwitch } from './use-global-plugin-switch'
import { GLOBAL_PLUGIN_SWITCH_PERMISSION, globalSwitchDeniedTitle } from './plugin-switch-model.mjs'
import { FeatureSwitch } from './feature-switch'
import { ConversationOverrideLinks } from './conversation-list'

function levelLabel(level: FeatureLevel, i18n: ReturnType<typeof useI18n>): string {
  return level === 'global' ? i18n.t("全局") : level === 'adapter' ? i18n.t("适配器") : level === 'endpoint' ? i18n.t("账号") : i18n.t("会话")
}

/**
 * Global switch, declared levels and where lower levels override this feature. Hidden when the
 * Host does not serve `feature.*` (the Schema form below still works).
 */
export function GlobalFeatureSummary({ plugin }: { plugin: string }) {
  const i18n = useI18n()
  const access = useConsoleAccess()
  const detail = useFeatureDetail(plugin, 'global')
  const matrix = useFeatureMatrix()
  const globalSwitch = useGlobalPluginSwitch(() => { detail.refresh(); matrix.refresh() })
  const value = detail.value
  if (!value) return null
  const row = matrix.source === 'rpc' ? matrix.rows.find(item => item.plugin === plugin) : undefined
  const adapters = row ? matrix.adapters.filter(alias => row.adapters[alias] && (row.adapters[alias]!.overridden || !row.adapters[alias]!.enabled)) : []
  // Per-endpoint conversation override counts for this plugin, when the Host reports them.
  const conversationAdapters = row ? matrix.adapters.filter(alias => conversationOverrideCounts(row.conversationOverrides, alias).length) : []
  // The global switch is a management gateway transaction (stop → write → start, rollback):
  // `plugin.manage`, not `feature.toggle` (upstream FEATURE_GLOBAL_SWITCH_PERMISSION).
  const canToggle = hasConsolePermission(GLOBAL_PLUGIN_SWITCH_PERMISSION, access)
  const toggle = (enabled: boolean) => {
    globalSwitch.prepare({ plugin, current: value.enabled, enabled, revision: value.revision })
  }
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{i18n.t("全局开关")}</span>
          <FeatureSwitch label={i18n.t("{0} · 全局", [plugin])} plugin={plugin} enabled={value.enabled}
            canToggle={canToggle && !plugin.includes('/') && !globalSwitch.busy} deniedTitle={canToggle ? undefined : globalSwitchDeniedTitle(i18n.t)}
            onToggle={toggle} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sm text-muted-foreground">{i18n.t("支持的层级：")}</span>
          {value.levels.map(level => <Badge key={level} variant="secondary" size="sm">{levelLabel(level, i18n)}</Badge>)}
        </div>
        {adapters.length ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-sm text-muted-foreground">{i18n.t("下级有覆盖：")}</span>
            {adapters.map(alias => <Link key={alias} to={adapterHref(alias, 'features')}><Badge variant="info" size="sm">{alias}</Badge></Link>)}
          </div>
        ) : null}
        {conversationAdapters.length ? (
          <div className="flex flex-wrap items-start gap-3">
            <span className="text-sm text-muted-foreground">{i18n.t("会话覆盖：")}</span>
            {conversationAdapters.map(alias => (
              <span key={alias} className="flex flex-col">
                <span className="text-xs font-medium">{alias}</span>
                <ConversationOverrideLinks counts={row?.conversationOverrides} adapter={alias} />
              </span>
            ))}
          </div>
        ) : null}
      </CardContent>
      <ActionReceipt controller={globalSwitch.receipt} className="mx-4 mb-4" />
    </Card>
  )
}
