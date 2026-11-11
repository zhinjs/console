import { ServerCog } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Alert, AlertDescription, AlertTitle } from '../../components/ui/alert'
import { ErrorAlert } from '../../components/error-alert'
import type { GatewayErrorKind } from './gateway-model.mjs'

/** Load failure of a gateway read; an old Host gets an upgrade notice instead of a retry loop. */
export function GatewayLoadError({ error, kind, onRetry }: { error: string; kind: GatewayErrorKind | null; onRetry: () => void }) {
  const i18n = useI18n()
  if (kind === 'unsupported') {
    return (
      <Alert variant="warning">
        <ServerCog className="h-4 w-4" />
        <AlertTitle>{i18n.t("需要新版网关")}</AlertTitle>
        <AlertDescription>{error || i18n.t("需要新版网关：当前 Host 不支持实例与依赖管理（ADR 0054）。")}</AlertDescription>
      </Alert>
    )
  }
  return <ErrorAlert error={error} onRetry={kind === 'forbidden' ? undefined : onRetry} kind={kind === 'unavailable' ? '503' : 'other'} />
}
