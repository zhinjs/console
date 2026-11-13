import { Link } from 'react-router-dom'
import { Loader2, Lock } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Switch } from '../../components/ui/switch'
import { adapterHref, endpointHref, featureGlobalHref } from '../../console-routes.mjs'
import { featureSwitchState, type FeatureLock } from './feature-model.mjs'

/** Where a lock comes from, with a link to the level that disabled the feature. */
export function FeatureLockNote({ lockedBy, plugin, adapter, endpoint }: { lockedBy: FeatureLock; plugin: string; adapter?: string; endpoint?: string }) {
  const i18n = useI18n()
  const to = lockedBy === 'endpoint' && adapter && endpoint ? endpointHref(adapter, endpoint, 'features')
    : lockedBy === 'adapter' && adapter ? adapterHref(adapter, 'features')
      : featureGlobalHref(plugin)
  const text = lockedBy === 'global' ? i18n.t("已在全局禁用")
    : lockedBy === 'adapter' ? i18n.t("已在适配器 {0} 禁用", [adapter ?? ''])
      : i18n.t("已在账号 {0} 禁用", [endpoint ?? ''])
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Lock className="h-3 w-3" aria-hidden="true" />
      <Link to={to} className="underline">{text}</Link>
    </span>
  )
}

interface FeatureSwitchProps {
  readonly label: string
  readonly enabled: boolean
  readonly lockedBy?: FeatureLock
  readonly plugin: string
  /** Adapter alias of the level (for an `adapter` lock link). */
  readonly adapter?: string
  /** Endpoint id of the level (for an `endpoint` lock link). */
  readonly endpoint?: string
  readonly overridden?: boolean
  readonly canToggle: boolean
  /** Tooltip when the identity may not toggle (default: 当前身份不能启停功能). */
  readonly deniedTitle?: string
  readonly pending?: boolean
  readonly onToggle: (enabled: boolean) => void
}

/**
 * Three-state switch: enabled / disabled / locked by a higher level (ADR 0050 §4, 0055 §4). A
 * locked switch can be neither enabled nor disabled, whatever its own level stores.
 */
export function FeatureSwitch({ label, enabled, lockedBy, plugin, adapter, endpoint, overridden, canToggle, deniedTitle, pending, onToggle }: FeatureSwitchProps) {
  const i18n = useI18n()
  const state = featureSwitchState({ enabled, lockedBy }, canToggle, pending)
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Switch
        aria-label={label}
        checked={state.checked}
        disabled={state.disabled}
        title={!canToggle && !state.locked ? deniedTitle ?? i18n.t("当前身份不能启停功能") : undefined}
        onCheckedChange={checked => { if (!state.disabled) onToggle(checked === true) }}
      />
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      {lockedBy ? <FeatureLockNote lockedBy={lockedBy} plugin={plugin} adapter={adapter} endpoint={endpoint} /> : null}
      {overridden ? <Badge variant="info" size="sm">{i18n.t("有覆盖")}</Badge> : null}
    </span>
  )
}
