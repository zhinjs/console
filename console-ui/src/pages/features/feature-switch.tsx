import { Link } from 'react-router-dom'
import { Loader2, Lock } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Badge } from '../../components/ui/badge'
import { Switch } from '../../components/ui/switch'
import { adapterHref, featureGlobalHref } from '../../console-routes.mjs'
import type { FeatureLock } from './feature-model.mjs'

/** Where a lock comes from, with a link to the level that disabled the feature. */
export function FeatureLockNote({ lockedBy, plugin, adapter }: { lockedBy: FeatureLock; plugin: string; adapter?: string }) {
  const i18n = useI18n()
  const to = lockedBy === 'global' || !adapter ? featureGlobalHref(plugin) : adapterHref(adapter)
  return (
    <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
      <Lock className="h-3 w-3" aria-hidden="true" />
      <Link to={to} className="underline">
        {lockedBy === 'global' ? i18n.t("已在全局禁用") : i18n.t("已在适配器 {0} 禁用", [adapter ?? ''])}
      </Link>
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
  readonly overridden?: boolean
  readonly canToggle: boolean
  readonly pending?: boolean
  readonly onToggle: (enabled: boolean) => void
}

/** Three-state switch: enabled / disabled / locked by a higher level (ADR 0050 §4). */
export function FeatureSwitch({ label, enabled, lockedBy, plugin, adapter, overridden, canToggle, pending, onToggle }: FeatureSwitchProps) {
  const i18n = useI18n()
  const locked = !!lockedBy
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <Switch
        aria-label={label}
        checked={!locked && enabled}
        disabled={locked || !canToggle || pending}
        title={!canToggle && !locked ? i18n.t("当前身份不能启停功能") : undefined}
        onCheckedChange={checked => onToggle(checked === true)}
      />
      {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
      {locked ? <FeatureLockNote lockedBy={lockedBy} plugin={plugin} adapter={adapter} /> : null}
      {overridden ? <Badge variant="info" size="sm">{i18n.t("有覆盖")}</Badge> : null}
    </span>
  )
}
