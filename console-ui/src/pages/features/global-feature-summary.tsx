import { Link } from 'react-router-dom'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Card, CardContent } from '../../components/ui/card'
import { useConfirm } from '../../components/confirm-dialog'
import { adapterHref } from '../../console-routes.mjs'
import { useConsoleAccess } from '../../hooks/use-console-access'
import { hasConsolePermission } from '../../utils/console-access.mjs'
import { setEnabledRequest, type FeatureLevel } from './feature-model.mjs'
import { useFeatureDetail, useFeatureMatrix, useFeatureWriter } from './use-feature-data'
import { FeatureSwitch } from './feature-switch'

function levelLabel(level: FeatureLevel, i18n: ReturnType<typeof useI18n>): string {
  return level === 'global' ? i18n.t("全局") : level === 'adapter' ? i18n.t("适配器") : i18n.t("账号")
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
  const { write, pending } = useFeatureWriter()
  const { confirm, ConfirmDialog } = useConfirm()
  const value = detail.value
  if (!value) return null
  const row = matrix.source === 'rpc' ? matrix.rows.find(item => item.plugin === plugin) : undefined
  const adapters = row ? matrix.adapters.filter(alias => row.adapters[alias] && (row.adapters[alias]!.overridden || !row.adapters[alias]!.enabled)) : []
  const toggle = async (enabled: boolean) => {
    const ok = await confirm({
      title: enabled ? i18n.t("启用 {0}？", [plugin]) : i18n.t("在全局禁用 {0}？", [plugin]),
      description: enabled ? i18n.t("全局开关会重启 Host。") : i18n.t("全局开关会重启 Host；所有适配器和账号上的该功能都会停用。"),
      variant: enabled ? 'default' : 'destructive',
    })
    if (ok) await write(setEnabledRequest({ plugin, level: 'global', enabled, revision: value.revision }), () => { detail.refresh(); matrix.refresh() }, 'global')
  }
  return (
    <Card>
      <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-3 p-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">{i18n.t("全局开关")}</span>
          <FeatureSwitch label={i18n.t("{0} · 全局", [plugin])} plugin={plugin} enabled={value.enabled}
            canToggle={hasConsolePermission('feature.toggle', access) && !plugin.includes('/')} pending={pending === 'global'} onToggle={enabled => void toggle(enabled)} />
        </div>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-sm text-muted-foreground">{i18n.t("支持的层级：")}</span>
          {value.levels.map(level => <Badge key={level} variant="secondary" size="sm">{levelLabel(level, i18n)}</Badge>)}
        </div>
        {adapters.length ? (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-sm text-muted-foreground">{i18n.t("下级有覆盖：")}</span>
            {adapters.map(alias => <Link key={alias} to={adapterHref(alias)}><Badge variant="info" size="sm">{alias}</Badge></Link>)}
          </div>
        ) : null}
      </CardContent>
      {ConfirmDialog}
    </Card>
  )
}
