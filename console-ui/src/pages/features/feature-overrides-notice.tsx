import { Info } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription } from '../../components/ui/alert'
import type { FeatureProbeStatus } from './feature-model.mjs'

/** What the per-level feature overrides area can show on this Host. */
export function FeatureOverridesNotice({ status, level }: { status: FeatureProbeStatus | 'checking'; level: 'adapter' | 'endpoint' }) {
  const i18n = useI18n()
  if (status === 'checking') return null
  const text = status === 'unsupported'
    ? level === 'adapter'
      ? i18n.t("按适配器覆盖功能配置需要更新的 Host。当前所有功能都使用全局配置。")
      : i18n.t("按账号覆盖功能配置需要更新的 Host。当前该账号使用全局配置。")
    : status === 'forbidden'
      ? i18n.t("当前身份无权读取功能配置。")
      : i18n.t("Host 已支持分层功能配置；在此编辑覆盖的界面将在后续版本提供。")
  return (
    <Alert role="status">
      <Info className="h-4 w-4" />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}
