import { useCallback, useRef, useState } from 'react'
import { useI18n } from '../i18n'
import { ActionReceipt, useActionReceipt, type ActionReceiptController } from '../components/ActionReceipt'
import type { ActionReceiptState } from '../components/action-receipt-model.mjs'
import { StatusState } from '../components/StatusState'
import type { GatewayPackageOperation, GatewayPluginConfigurationNeed } from '../contracts/gateway'
import { GATEWAY_RPC, readPackageList, readPackagePlan, type PackageProgressState } from './ops/gateway-model.mjs'
import { TransactionProgress } from './ops/ops-components'
import { ConfigurationNeedsPanel } from './ops/plugin-declare'
import { gatewayRequest, useGatewayTransaction } from './ops/use-gateway'
import {
  packagePlanRequest, packageReceiptPlan, packageSpec, packageTransactionRequest, transactionReceiptValue, verifyPackageState,
} from './plugin-package-model.mjs'

type TransactionResult = NonNullable<PackageProgressState['result']>

export interface PackageActionSubject {
  /** npm package name. */
  readonly name: string
  /** Target version (install / update); omitted means what the gateway resolves. */
  readonly version?: string
  /** Installed version, for the update title. */
  readonly from?: string | null
}

export interface PackageAction {
  readonly receipt: ActionReceiptController
  readonly progress: PackageProgressState
  readonly running: boolean
  /** Reading the gateway plan (before 准备). */
  readonly planning: boolean
  readonly planError: unknown
  /** Plugins the last install left undeclared until configured. */
  readonly needs: readonly GatewayPluginConfigurationNeed[]
  readonly result: TransactionResult | null
  /** The operation the receipt is about. */
  readonly operation: GatewayPackageOperation | null
  readonly busy: boolean
  /** Reads `gateway.packages.plan` and shows the receipt plan. */
  readonly prepare: (operation: GatewayPackageOperation, subject: PackageActionSubject) => Promise<void>
  readonly clearNeed: (instanceKey: string) => void
  readonly reset: () => void
}

/**
 * One package action on the plugin pages: `gateway.packages.plan` → 准备 → 确认 →
 * `gateway.packages.install|update|uninstall` (progress from `gateway.packages.progress`) →
 * 成功 / 部分完成（需要配置）/ 未执行（已回滚）/ 结果未知（只读核对 `gateway.packages.list`）.
 */
export function usePackageAction({ onSettled }: { onSettled?: (state: ActionReceiptState, result: TransactionResult | null) => void } = {}): PackageAction {
  const i18n = useI18n()
  const transaction = useGatewayTransaction()
  const pending = useRef<{ operation: GatewayPackageOperation; subject: PackageActionSubject; spec: string } | null>(null)
  const [planning, setPlanning] = useState(false)
  const [planError, setPlanError] = useState<unknown>(null)
  const [needs, setNeeds] = useState<readonly GatewayPluginConfigurationNeed[]>([])
  const [result, setResult] = useState<TransactionResult | null>(null)
  const [operation, setOperation] = useState<GatewayPackageOperation | null>(null)
  const resultRef = useRef<TransactionResult | null>(null)

  const receipt = useActionReceipt({
    submit: async () => {
      const current = pending.current
      if (!current) throw new Error(i18n.t('没有要执行的依赖事务。'))
      const request = packageTransactionRequest(current.operation, { packages: [current.spec] })
      const outcome = await transaction.run(request.type, request.data)
      if (outcome.error) throw outcome.error
      resultRef.current = outcome.result
      setResult(outcome.result)
      setNeeds(outcome.result?.needsConfiguration ?? [])
      return transactionReceiptValue(outcome.result, i18n.t)
    },
    verify: async () => {
      const current = pending.current
      if (!current) return undefined
      const list = readPackageList(await gatewayRequest(GATEWAY_RPC.PACKAGES_LIST, {}, i18n.t))
      return verifyPackageState(current.operation, current.subject.name, current.subject.version, list, i18n.t)
    },
    onSettled: state => onSettled?.(state, resultRef.current),
  })

  const prepare = useCallback(async (nextOperation: GatewayPackageOperation, subject: PackageActionSubject) => {
    if (planning || transaction.running) return
    const spec = packageSpec(nextOperation, subject.name, subject.version)
    setPlanning(true)
    setPlanError(null)
    setNeeds([])
    setResult(null)
    resultRef.current = null
    transaction.reset()
    receipt.reset()
    try {
      const plan = readPackagePlan(await gatewayRequest(GATEWAY_RPC.PACKAGES_PLAN, packagePlanRequest(nextOperation, [spec]), i18n.t))
      pending.current = { operation: nextOperation, subject, spec }
      setOperation(nextOperation)
      receipt.prepare(packageReceiptPlan(nextOperation, plan, subject, i18n.t))
    } catch (error) {
      setPlanError(error)
    } finally {
      setPlanning(false)
    }
  }, [planning, transaction, receipt, i18n])

  const clearNeed = useCallback((instanceKey: string) => setNeeds(previous => previous.filter(need => need.instanceKey !== instanceKey)), [])
  const reset = useCallback(() => {
    receipt.reset(); transaction.reset(); setPlanError(null); setNeeds([]); setResult(null); setOperation(null); pending.current = null; resultRef.current = null
  }, [receipt, transaction])

  return {
    receipt, progress: transaction.progress, running: transaction.running, planning, planError, needs, result, operation,
    busy: planning || transaction.running || receipt.state.phase === 'submitting' || receipt.state.phase === 'verifying',
    prepare, clearNeed, reset,
  }
}

/**
 * The inline surface of a {@link usePackageAction}: plan refusal, the receipt, live transaction
 * phases while it runs (output folded afterwards) and the 需要配置 cards that open the
 * `gateway.plugins.declare` form.
 */
export function PackageActionPanel({ action, onDeclared, readOnly }: {
  action: PackageAction
  onDeclared?: (need: GatewayPluginConfigurationNeed) => void
  readOnly?: boolean
}) {
  const i18n = useI18n()
  const [declaring, setDeclaring] = useState(false)
  const { receipt, progress, running, planError, needs } = action
  const finished = !running && (progress.output || progress.result?.logTail.length)
  return (
    <div className="console-package-action space-y-3">
      {planError ? (
        <StatusState compact error={planError}
          title={i18n.t('无法生成依赖事务计划')}
          description={planErrorText(planError, i18n.t)} />
      ) : null}
      <ActionReceipt controller={receipt} />
      {running ? <TransactionProgress progress={progress} running error={null} /> : null}
      {finished ? (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer">{i18n.t('包管理器输出与实例日志')}</summary>
          {progress.output ? <pre className="mt-2 max-h-56 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{progress.output}</pre> : null}
          {progress.result?.logTail.length ? <pre className="mt-2 max-h-40 overflow-auto rounded-md bg-muted p-2 font-mono text-xs">{progress.result.logTail.join('\n')}</pre> : null}
        </details>
      ) : null}
      {needs.length && !readOnly ? (
        <ConfigurationNeedsPanel needs={needs} disabled={running || declaring} onBusyChange={setDeclaring}
          onDeclared={need => { action.clearNeed(need.instanceKey); onDeclared?.(need) }} />
      ) : null}
    </div>
  )
}

function planErrorText(error: unknown, t: (message: string, values?: readonly unknown[]) => string): string | undefined {
  const record = error && typeof error === 'object' ? error as { status?: number; code?: string } : {}
  if (record.status === 409 || record.code === 'conflict') return t('另一个依赖事务正在进行。等它结束后再试；进度在「运维 → 实例」页。')
  if (record.code === 'unsupported') return t('当前网关不支持依赖事务（需要 ADR 0054 网关）。')
  if (record.status === 403 || record.code === 'forbidden') return t('需要 plugin.manage 权限才能安装、更新或卸载插件。')
  return undefined
}
