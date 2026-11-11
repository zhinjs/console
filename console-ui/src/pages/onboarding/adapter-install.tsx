import { useState } from 'react'
import { Download } from 'lucide-react'
import { useI18n } from '../../i18n'
import { Button } from '../../components/ui/button'
import { Input } from '../../components/ui/input'
import { ConfirmDialog } from '../../components/confirm-dialog'
import { useToast } from '../../components/toast'
import type { GatewayPluginConfigurationNeed } from '../../contracts/gateway'
import { GATEWAY_RPC, gatewayErrorKind, parsePackageSpecs, transactionSummary } from '../ops/gateway-model.mjs'
import { GatewayLoadError, TransactionProgress } from '../ops/ops-components'
import { ConfigurationNeedsPanel } from '../ops/plugin-declare'
import { useGatewayTransaction } from '../ops/use-gateway'

/**
 * Onboarding step 4 (ADR 0053 §2): install adapter packages through the gateway, then declare
 * each one with its first account (`gateway.plugins.declare`) when the install reports
 * `needsConfiguration`. Plugins whose defaults already satisfy the schema are declared by the
 * install itself.
 */
export function AdapterInstallSection({ onAdapterReady }: { onAdapterReady?: () => void }) {
  const i18n = useI18n()
  const toast = useToast()
  const transaction = useGatewayTransaction()
  const [specText, setSpecText] = useState('')
  const [touched, setTouched] = useState(false)
  const [confirming, setConfirming] = useState<readonly string[] | null>(null)
  const [needs, setNeeds] = useState<readonly GatewayPluginConfigurationNeed[]>([])
  const [declaring, setDeclaring] = useState(false)
  const [unsupported, setUnsupported] = useState<string | null>(null)
  const parsed = parsePackageSpecs(specText, i18n.t)
  const busy = transaction.running || declaring

  const install = async (packages: readonly string[]) => {
    setNeeds([])
    const { result, error } = await transaction.run(GATEWAY_RPC.PACKAGES_INSTALL, { packages, enable: true })
    if (error && gatewayErrorKind(error) === 'unsupported') {
      setUnsupported(error instanceof Error ? error.message : String(error))
      transaction.reset()
      return
    }
    if (!result) return
    if (result.status === 'succeeded') setSpecText('')
    if (result.needsConfiguration?.length) setNeeds(result.needsConfiguration)
    else if (result.status === 'succeeded') {
      toast.success(transactionSummary(result, i18n.t).title)
      onAdapterReady?.()
    }
  }

  if (unsupported) return <GatewayLoadError error={unsupported} kind="unsupported" onRetry={() => setUnsupported(null)} />

  return (
    <div className="space-y-3">
      <form className="space-y-2" onSubmit={event => {
        event.preventDefault()
        setTouched(true)
        if (!parsed.problem) setConfirming(parsed.specs)
      }}>
        <label htmlFor="onboarding-adapter-specs" className="block text-sm font-medium">{i18n.t("安装适配器")}</label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input id="onboarding-adapter-specs" value={specText} disabled={busy} autoComplete="off" spellCheck={false}
            placeholder="@zhin.js/adapter-qq" aria-invalid={touched && parsed.problem ? true : undefined}
            onChange={event => setSpecText(event.target.value)} />
          <Button type="submit" size="sm" disabled={busy}><Download />{i18n.t("安装")}</Button>
        </div>
        {touched && parsed.problem ? <p className="text-xs text-destructive" role="alert">{parsed.problem}</p> : (
          <p className="text-xs text-muted-foreground">{i18n.t("填写适配器包名，可多个。安装后若需要账号信息，会在下方引导你添加第一个账号。")}</p>
        )}
      </form>
      {transaction.running || transaction.progress.id || transaction.error
        ? <TransactionProgress progress={transaction.progress} running={transaction.running} error={transaction.error} /> : null}
      <ConfigurationNeedsPanel needs={needs} disabled={transaction.running} onBusyChange={setDeclaring}
        onDeclared={need => {
          setNeeds(previous => previous.filter(item => item.instanceKey !== need.instanceKey))
          onAdapterReady?.()
        }} />
      {confirming ? (
        <ConfirmDialog open onOpenChange={open => { if (!open) setConfirming(null) }}
          title={i18n.t("安装 {0}？", [confirming.join(', ')])}
          description={i18n.t("网关会备份配置、停止实例、安装依赖并重新启动；失败会自动回滚。")}
          confirmLabel={i18n.t("安装")}
          onConfirm={() => { const packages = confirming; setConfirming(null); void install(packages) }} />
      ) : null}
    </div>
  )
}
