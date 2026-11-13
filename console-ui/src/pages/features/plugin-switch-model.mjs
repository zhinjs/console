/**
 * The global plugin switch (`disable_plugins`) is plugin lifecycle, not a feature switch: the
 * management gateway runs it as a transaction — stop the instance → write `disable_plugins` →
 * start it, restoring the file and the old instance on failure (ADR 0054 §4) — and authorizes it
 * with `plugin.manage`. This covers `plugin:set-enabled` and `feature.set-enabled` at `level:
 * 'global'`; the adapter / endpoint / conversation levels stay on `feature.toggle`.
 *
 * Upstream these are `FEATURE_GLOBAL_SWITCH_PERMISSION` / `isGlobalFeatureSwitch` of
 * `@zhin.js/console-protocol` (zhin "run the Console's global plugin switch as a gateway
 * transaction"); the published 1.2.0 does not export them yet, so they are mirrored here. Switch
 * to the protocol exports once the Console depends on a release that has them.
 *
 * Pure: the pages and the tests share it.
 */
import { FEATURE_RPC } from '@zhin.js/console-protocol'
import { phaseLabel } from '../ops/gateway-model.mjs'

/** Permission of the global plugin switch (upstream `FEATURE_GLOBAL_SWITCH_PERMISSION`). */
export const GLOBAL_PLUGIN_SWITCH_PERMISSION = 'plugin.manage'

/** Permission of a feature switch below the global level. */
export const FEATURE_TOGGLE_PERMISSION = 'feature.toggle'

/** The permission `feature.set-enabled` needs at `level`. */
export function featureSwitchPermission(level) {
  return level === 'global' ? GLOBAL_PLUGIN_SWITCH_PERMISSION : FEATURE_TOGGLE_PERMISSION
}

const identity = value => value

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * Whether a Console RPC message is the global plugin switch (`feature.set-enabled` at `global`),
 * reading the payload like the Host does: `data` when it is an object, else the message itself
 * (upstream `isGlobalFeatureSwitch`).
 */
export function isGlobalFeatureSwitch(message) {
  if (!isRecord(message) || message.type !== FEATURE_RPC.SET_ENABLED) return false
  const input = isRecord(message.data) ? message.data : message
  return input.level === 'global'
}

/**
 * Body of the switch request on `POST {base}/console/request`: the same flat message the SDK
 * transport sends (`{ type, …fields, requestId }`), so a Host that answers it itself (an older
 * gateway forwards it to the instance) reads it unchanged.
 */
export function pluginSwitchRequestBody(request, requestId) {
  return { ...request, requestId }
}

/**
 * Title and description of a refused switch (`StatusReading.transaction.outcome`), through `t`:
 * - `rolled-back` (500 `transaction_failed`): 未执行 — the gateway restored the file and the instance;
 * - `rollback-failed` (500 `rollback_failed`): the instance may be stopped — check the instance page;
 * - `gateway-required` (409 / 400 under `zhin start --standalone`): no gateway to run the transaction.
 */
export function transactionFailureCopy(outcome, t = identity) {
  if (outcome === 'rollback-failed') {
    return { title: t('操作失败，回滚也没有完成'), description: t('管理网关切换插件失败，恢复原状态时又出错。实例可能已停止或处于异常状态，请到「实例」页查看并处理。') }
  }
  if (outcome === 'gateway-required') {
    return { title: t('需要管理网关'), description: t('插件的全局启停由管理网关执行。请用 zhin start 启动项目后在 Console 中操作，或在项目目录运行 zhin enable / zhin disable <插件>。') }
  }
  return { title: t('操作没有完成，已自动回滚'), description: t('管理网关在切换插件时失败，已把配置和实例恢复到操作前的状态，插件开关没有变化。查看技术详情了解原因后可以重新准备。') }
}

/** Whether the refusal should link to the instance page (`/ops/instance`). */
export function transactionNeedsInstanceCheck(transaction) {
  return transaction?.outcome === 'rollback-failed'
}

/**
 * The 技术详情 text of a refused switch: the Host's code and text, the failed phase, the rollback
 * error and the instance's last log lines. `t` translates the labels (phase names included).
 */
export function transactionDetailText(reading, t = identity) {
  if (!reading) return ''
  const lines = []
  if (reading.message) lines.push(`${reading.serverCode ? `${reading.serverCode}: ` : ''}${reading.message}`)
  const transaction = reading.transaction
  if (transaction?.failedPhase) lines.push(t('失败阶段：{0}', [phaseLabel(transaction.failedPhase, t)]))
  if (transaction?.cause && !reading.message?.includes(transaction.cause)) lines.push(t('原因：{0}', [transaction.cause]))
  if (transaction?.rollbackError && !reading.message?.includes(transaction.rollbackError)) lines.push(t('回滚错误：{0}', [transaction.rollbackError]))
  if (transaction?.logTail?.length) lines.push(t('实例最后的日志：'), ...transaction.logTail)
  return lines.join('\n')
}

/**
 * The read-only note above a set of switches, or null when every shown switch can be used.
 * `global`: may use the global switch (`plugin.manage`); `lower`: may use the adapter / endpoint /
 * conversation switches (`feature.toggle`); `hasLower`: lower-level switches are shown at all.
 */
export function switchPermissionNote({ global, lower, hasLower }, t = identity) {
  if (global && (lower || !hasLower)) return null
  if (!global && (!lower || !hasLower)) {
    return hasLower ? t('当前身份只能查看功能开关，无法启停。') : t('全局开关需要 plugin.manage 权限：它由管理网关停止并重启实例。当前身份只能查看。')
  }
  if (!global) return t('全局开关需要 plugin.manage 权限：它由管理网关停止并重启实例。适配器上的开关仍可启停。')
  return t('适配器上的开关需要 feature.toggle 权限；全局开关可以启停。')
}

/** Tooltip of a global switch the identity may not use. */
export function globalSwitchDeniedTitle(t = identity) {
  return t('需要 plugin.manage 权限才能在全局启停插件')
}

/**
 * The receipt plan copy of one global switch: the gateway stops and restarts the instance, and
 * rolls a failure back by itself. `name` is the feature's display name.
 */
export function globalSwitchPlanCopy(enabled, name, t = identity) {
  return enabled
    ? { title: t('在全局启用 {0}', [name]), summary: t('管理网关会停止实例、写入插件开关，再重新启动实例，期间机器人暂时不可用。失败会自动回滚到操作前的状态。'), confirmLabel: t('启用') }
    : { title: t('在全局关闭 {0}', [name]), summary: t('管理网关会停止实例、写入插件开关，再重新启动实例，期间机器人暂时不可用。失败会自动回滚到操作前的状态。所有适配器、账号与会话上的这个功能都会停用。'), confirmLabel: t('关闭') }
}
