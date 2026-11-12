import { Info } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription } from '../../components/ui/alert'

/** Why the per-level feature area is unavailable on this Host / for this identity. */
export function FeatureOverridesNotice({ status, level }: { status: 'unsupported' | 'forbidden'; level: 'adapter' | 'endpoint' | 'conversation' }) {
  const i18n = useI18n()
  const text = status === 'unsupported'
    ? level === 'adapter'
      ? i18n.t("按适配器覆盖功能配置需要更新的 Host。当前所有功能都使用全局配置。")
      : level === 'endpoint'
        ? i18n.t("按账号覆盖功能配置需要更新的 Host。当前该账号使用全局配置。")
        : i18n.t("按会话配置功能需要新版 Host。当前会话使用账号的配置。")
    : i18n.t("当前身份无权读取功能配置。")
  return (
    <Alert role="status">
      <Info className="h-4 w-4" />
      <AlertDescription>{text}</AlertDescription>
    </Alert>
  )
}
