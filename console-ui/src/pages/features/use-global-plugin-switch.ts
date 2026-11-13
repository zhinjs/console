import { useCallback, useRef } from 'react'
import { useI18n } from '../../i18n'
import { useActionReceipt, type ActionReceiptController } from '../../components/ActionReceipt'
import { receiptBlocksActions, type ReceiptPlan } from '../../components/action-receipt-model.mjs'
import { apiFetch } from '../../utils/auth'
import { requestConsole } from '../../utils/console-rpc'
import { reportRequestFailure, reportRequestSuccess } from '../../utils/instance-availability.mjs'
import { FEATURE_RPC } from '../../contracts/zhin-console'
import { readGatewayReply } from '../ops/gateway-model.mjs'
import { readFeatureWriteResult, setEnabledRequest } from './feature-model.mjs'
import { featureReceiptOutcome } from './feature-scope-model.mjs'
import { outcomeFromPluginSwitch, readBackMismatch } from '../../components/apply-outcome-model.mjs'
import { globalSwitchPlanCopy, pluginSwitchRequestBody } from './plugin-switch-model.mjs'

type Translate = (message: string, values?: readonly unknown[]) => string

let requestSequence = 0

/**
 * Sends the global plugin switch (`feature.set-enabled` at `level: 'global'`).
 *
 * It is a management gateway transaction (stop the instance → write `disable_plugins` → start it,
 * waiting out the 5 s stability window; rollback on failure, ADR 0054 §4), which outlasts the
 * published SDK transport's fixed 10 s `requestTimeout` (`@zhin.js/client` ~1.1.32 has no
 * per-request deadline; the renewable package-transaction deadline arrives with the next
 * release). So, like the other gateway transactions here (`gatewayRequest` for
 * `gateway.packages.*` / `gateway.plugins.declare`), it is posted with `apiFetch` and no client
 * deadline: the gateway bounds the transaction and always answers. Failures keep the Host's code
 * and `transaction` (`GatewayRequestError.details`), which `statusFromError` reads; a reply that
 * cannot be read may have been applied (结果未知).
 */
export async function requestGlobalPluginSwitch(request: { readonly type: string; readonly [key: string]: unknown }, t: Translate): Promise<unknown> {
  try {
    const response = await apiFetch('/api/console/request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(pluginSwitchRequestBody(request, ++requestSequence)),
    })
    let json: unknown = null
    try { json = await response.json() } catch { json = null }
    if (json === null) {
      // A 4xx was refused before anything ran; anything else may have been applied.
      throw Object.assign(new Error(t('请求失败（HTTP {0}）', [response.status])), {
        details: { httpStatus: response.status, transport: response.status >= 400 && response.status < 500 ? 'refused' : 'invalid-response' },
      })
    }
    const value = readGatewayReply(response.status, json, t, response.headers.get('retry-after'))
    reportRequestSuccess(request.type)
    return value
  } catch (error) {
    reportRequestFailure(request.type, error)
    throw error
  }
}

export interface GlobalSwitchTarget {
  readonly plugin: string
  /** Display name (defaults to `plugin`). */
  readonly name?: string
  /** Current global state. */
  readonly current: boolean
  readonly enabled: boolean
  /** Configuration revision the page read (`expectedRevision`). */
  readonly revision?: string
}

/** One receipt for every global switch: the gateway runs one plugin transaction at a time. */
export const GLOBAL_SWITCH_RECEIPT_KEY = 'feature:global'

/**
 * The global plugin switch through the receipt (准备 → 再次确认 → 提交 → 成功 / 未执行 / 结果未知).
 * Kept outside the component (`persistKey`), so the list, the matrix and the feature page share
 * it and an unknown outcome cannot be sent again after switching views. `onSettled` reloads the
 * page's data after every answer.
 */
export function useGlobalPluginSwitch(onSettled?: () => void): {
  readonly receipt: ActionReceiptController
  readonly busy: boolean
  readonly prepare: (target: GlobalSwitchTarget) => void
} {
  const i18n = useI18n()
  const settled = useRef(onSettled)
  settled.current = onSettled
  const targetOf = (plan: ReceiptPlan) => plan.payload as GlobalSwitchTarget | undefined
  const receipt = useActionReceipt({
    persistKey: GLOBAL_SWITCH_RECEIPT_KEY,
    submit: async plan => {
      const target = targetOf(plan)
      if (!target) throw new Error('No change')
      try {
        const result = readFeatureWriteResult(await requestGlobalPluginSwitch(setEnabledRequest({ plugin: target.plugin, level: 'global', enabled: target.enabled, revision: target.revision }), i18n.t))
        const outcome = featureReceiptOutcome(result)
        if (outcome.locked) throw Object.assign(new Error(outcome.message), { code: 'locked', lockedBy: outcome.lockedBy })
        // The gateway restarted the instance for it (已生效); then read the switch back.
        const apply = outcomeFromPluginSwitch(result) ?? undefined
        if (result.status !== 'saved') return { ...outcome, apply }
        let enabled: unknown
        try {
          enabled = (await requestConsole<{ enabled?: boolean }>({ type: FEATURE_RPC.GET, plugin: target.plugin, level: 'global' }))?.enabled
        } catch {
          return { ...outcome, apply, message: [outcome.message, i18n.t('保存后没能重新读取核对，请刷新确认保存的值。')].filter(Boolean).join('\n') }
        }
        const mismatch = readBackMismatch({ enabled: target.enabled }, { enabled })
        return { ...outcome, apply, ...(mismatch ? { mismatch } : {}) }
      } finally {
        settled.current?.()
      }
    },
    verify: async plan => {
      const target = targetOf(plan)
      if (!target) return undefined
      const reply = await requestConsole<{ enabled?: boolean }>({ type: FEATURE_RPC.GET, plugin: target.plugin, level: 'global' })
      const applied = reply?.enabled === target.enabled
      // Checked after an unknown outcome: the switch is a gateway transaction that restarts the instance.
      return { applied, ...(applied ? { apply: outcomeFromPluginSwitch({ status: 'saved', restartRequired: true }) ?? undefined } : {}) }
    },
  })
  const { prepare: preparePlan } = receipt
  const prepare = useCallback((target: GlobalSwitchTarget) => {
    const copy = globalSwitchPlanCopy(target.enabled, target.name ?? target.plugin, i18n.t)
    const state = (value: boolean) => value ? i18n.t('启用') : i18n.t('关闭', undefined, 'state')
    preparePlan({
      payload: target,
      title: copy.title,
      summary: copy.summary,
      changes: [i18n.t('{0}：{1} → {2}', [target.plugin, state(target.current), state(target.enabled)])],
      danger: true,
      confirmLabel: copy.confirmLabel,
    })
  }, [i18n, preparePlan])
  return { receipt, busy: receiptBlocksActions(receipt.state), prepare }
}
