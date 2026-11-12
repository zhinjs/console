/**
 * Plugin package actions from the plugin pages (插件管理 / 插件详情 / 插件市场). Every install,
 * update and uninstall is a gateway dependency transaction (`gateway.packages.*`, ADR 0054 §4):
 * the gateway stops the instance, runs the package manager, checks the result and starts the
 * instance again, rolling back on failure. The instance-side `plugin:install|update|uninstall`
 * path is gone; nothing here may call it.
 *
 * Pure: the hook (`use-package-action.ts`) and the tests share it.
 */
import { GATEWAY_RPC, instanceKeyFromPackage, operationLabel, phaseLabel } from './ops/gateway-model.mjs'

/** RPC per package operation. */
export const PACKAGE_OPERATION_RPC = Object.freeze({
  install: GATEWAY_RPC.PACKAGES_INSTALL,
  update: GATEWAY_RPC.PACKAGES_UPDATE,
  uninstall: GATEWAY_RPC.PACKAGES_UNINSTALL,
})

const PACKAGE_OPERATIONS = Object.keys(PACKAGE_OPERATION_RPC)
const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** `name` or `name@version`; uninstall never carries a version (the gateway refuses it). */
export function packageSpec(operation, name, version) {
  const base = String(name ?? '').trim()
  if (!base) throw new TypeError('package name is required')
  return operation !== 'uninstall' && typeof version === 'string' && version.trim() ? `${base}@${version.trim()}` : base
}

/** Body of `gateway.packages.plan`. */
export function packagePlanRequest(operation, packages) {
  if (!PACKAGE_OPERATIONS.includes(operation)) throw new TypeError(`unknown package operation ${String(operation)}`)
  return { operation, packages: [...packages] }
}

/**
 * The transaction RPC and its data. `startInstance` is only sent when the caller decided it
 * (default on the gateway: start again only if the instance was running before).
 */
export function packageTransactionRequest(operation, { packages, enable, startInstance, removeDependency } = {}) {
  const type = PACKAGE_OPERATION_RPC[operation]
  if (!type) throw new TypeError(`unknown package operation ${String(operation)}`)
  if (!Array.isArray(packages) || !packages.length) throw new TypeError('packages are required')
  const data = { packages: [...packages] }
  if (operation === 'install' && typeof enable === 'boolean') data.enable = enable
  if (operation === 'uninstall' && typeof removeDependency === 'boolean') data.removeDependency = removeDependency
  if (typeof startInstance === 'boolean') data.startInstance = startInstance
  return { type, data }
}

const RUNNING = new Set(['running', 'starting', 'backoff'])

/**
 * The receipt plan (准备) of one transaction, from the gateway's plan. `subject` names what the
 * user acted on (`{ name, version?, from? }`). Uninstall is a danger action (asks twice).
 */
export function packageReceiptPlan(operation, plan, subject, t) {
  const name = subject?.name ?? plan?.packages?.[0]?.name ?? ''
  const version = subject?.version
  const title = operation === 'install' ? t('安装 {0}', [version ? `${name}@${version}` : name])
    : operation === 'update' ? (subject?.from && version ? t('更新 {0}：{1} → {2}', [name, subject.from, version]) : t('更新 {0}', [version ? `${name}@${version}` : name]))
      : t('卸载 {0}', [name])
  const changes = []
  for (const item of plan?.packages ?? []) changes.push(t('包 {0}（来源：{1}）', [item.spec || item.name, sourceLabel(item.source, t)]))
  if (operation === 'uninstall') changes.push(t('移除插件声明与配置；没有其他引用时同时移除依赖'))
  if (operation === 'install') changes.push(t('写入插件声明；必填配置缺失时只安装不启用，之后填写配置再启用'))
  const state = plan?.instanceState ?? 'unmanaged'
  if (plan?.restartsInstance) changes.push(t('网关先停止实例，完成后重新启动并等待就绪'))
  else if (state === 'unmanaged') changes.push(t('网关没有托管实例：只改依赖，不会启停实例'))
  else if (!RUNNING.has(state)) changes.push(t('实例当前未运行，事务结束后不会自动启动'))
  changes.push(t('任何一步失败都会自动回滚到原来的依赖与配置'))
  if (plan?.packageManager) changes.push(t('包管理器：{0}', [plan.packageManager]))
  return {
    title,
    summary: t('依赖变更由管理网关作为一次事务执行：停止实例 → 安装 → 校验 → 启动。'),
    changes,
    danger: operation === 'uninstall',
    confirmLabel: t('确认{0}', [operationLabel(operation, t)]),
  }
}

export function sourceLabel(source, t) {
  switch (source) {
    case 'market': return t('插件市场')
    case 'adapter': return t('适配器目录')
    case 'ai': return t('AI 目录')
    case 'database-driver': return t('数据库驱动目录')
    case 'npm': return t('任意 npm 包')
    default: return String(source ?? '')
  }
}

/**
 * What a finished transaction means for the receipt (`readSubmitResult` shape):
 * - succeeded → succeeded (one item per package)
 * - succeeded with `needsConfiguration` → partial: installed, but not enabled until configured
 * - rolledBack → failed (nothing changed: the old dependencies are back)
 * - rollbackFailed / no result → unknown (only a read-only check is offered)
 */
export function transactionReceiptValue(result, t) {
  if (!isRecord(result)) return { status: 'unknown', message: t('网关没有返回事务结果。请核对依赖列表，不要重复提交。') }
  const operation = result.operation
  const label = item => `${operationLabel(operation, t)} ${item.spec || item.name}`
  const instance = isRecord(result.instance) ? result.instance : {}
  const instanceLine = instance.after ? t('实例状态：{0}', [instanceStateText(instance.after, t)]) : undefined
  if (result.status === 'succeeded') {
    const needs = Array.isArray(result.needsConfiguration) ? result.needsConfiguration : []
    const items = (result.packages ?? []).map(item => ({ label: label(item), ok: true }))
    if (needs.length) {
      for (const need of needs) {
        const missing = [...(need.missing ?? []), ...(need.missingEnv ?? []).map(name => `$${name}`)]
        items.push({ label: t('{0} 需要配置后才能启用', [need.name]), ok: false, ...(missing.length ? { message: missing.join(', ') } : {}) })
      }
      return { status: 'partial', items, message: t('依赖已安装，实例保持健康；插件在填写配置前不会加载。') }
    }
    return { status: 'succeeded', items, ...(instanceLine ? { message: instanceLine } : {}) }
  }
  const failure = [
    result.failedPhase ? t('失败阶段：{0}', [phaseLabel(result.failedPhase, t)]) : '',
    result.error ? t('原因：{0}', [result.error]) : '',
  ].filter(Boolean).join(' ')
  if (result.status === 'rolledBack') {
    return { status: 'failed', message: [t('{0}没有完成，已回滚到原来的依赖与配置。', [operationLabel(operation, t)]), failure].filter(Boolean).join(' ') }
  }
  return {
    status: 'unknown',
    message: [t('{0}失败，回滚也没有完成，依赖可能处于中间状态，需要人工处理。', [operationLabel(operation, t)]), failure,
      result.rollbackError ? t('回滚问题：{0}', [result.rollbackError]) : ''].filter(Boolean).join(' '),
  }
}

function instanceStateText(state, t) {
  switch (state) {
    case 'running': return t('运行中')
    case 'stopped': return t('已停止')
    case 'starting': return t('启动中')
    case 'stopping': return t('停止中')
    case 'backoff': return t('等待重启')
    case 'crashed': return t('已崩溃')
    case 'unmanaged': return t('未托管')
    default: return String(state)
  }
}

/** The dependency entry of `name` in a `gateway.packages.list` reply (already read), or null. */
export function installedPackage(list, name) {
  return (list?.packages ?? []).find(item => item.name === name) ?? null
}

/**
 * Read-only check after an unknown outcome: did the transaction land? Compares the package list
 * with what was asked. `applied: undefined` when the list cannot tell (e.g. update without a
 * target version and the package present).
 */
export function verifyPackageState(operation, name, version, list, t) {
  const entry = installedPackage(list, name)
  if (operation === 'uninstall') {
    return entry ? { applied: false, message: t('{0} 仍在依赖列表中，卸载没有生效。', [name]) } : { applied: true, message: t('{0} 已不在依赖列表中。', [name]) }
  }
  if (!entry || !entry.installedVersion) return { applied: false, message: t('{0} 没有安装。', [name]) }
  if (version && entry.installedVersion !== version) {
    return { applied: false, message: t('{0} 当前是 {1}，不是 {2}。', [name, entry.installedVersion, version]) }
  }
  return version ? { applied: true, message: t('{0} 已是 {1}。', [name, entry.installedVersion]) } : { applied: undefined, message: t('{0} 当前是 {1}。', [name, entry.installedVersion]) }
}

/** A refusal because another dependency transaction is running (409 `conflict`). */
export function transactionBusy(error) {
  return isRecord(error) && (error.status === 409 || error.code === 'conflict')
}

/** Instance key the gateway will declare for `name` (needs and links before the instance reports it). */
export function defaultInstanceKey(name) {
  return instanceKeyFromPackage(name)
}
