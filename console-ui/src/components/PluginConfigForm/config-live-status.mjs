import { translate } from '../../i18n/locale.mjs'

const effects = new Set(['in-place', 'replace-resource', 'reconnect-endpoint', 'reload-plugin', 'restart-process'])
const statuses = new Set(['applied', 'restart-pending', 'blocked', 'failed', 'superseded', 'unknown'])
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0
const revisionNumber = value => Number.isSafeInteger(value) && value >= 0

/** Only transport metadata is retained; no config values or backend exception strings. */
function application(value) {
  if (!object(value) || !text(value.operationId) || !text(value.sourceRevision) || typeof value.saved !== 'boolean'
    || !revisionNumber(value.generation) || !revisionNumber(value.applicationRevision) || !Array.isArray(value.groups)) return null
  const ids = new Set()
  for (const group of value.groups) {
    if (!object(group) || !text(group.id) || ids.has(group.id) || !effects.has(group.effect) || !statuses.has(group.status)
      || !Array.isArray(group.paths) || !group.paths.every(path => Array.isArray(path) && path.every(text))
      || !Array.isArray(group.dependsOn) || !group.dependsOn.every(text)
      || group.reasonCode !== undefined && typeof group.reasonCode !== 'string') return null
    ids.add(group.id)
  }
  return value
}

/** A receipt from a different file revision never proves the current file is applied. */
export function configurationRuntimeStatus(result, revision, locale = 'zh-CN') {
  const t = message => translate(locale, message)
  if (result?.applicationError === 'superseded') return { kind: 'stale', summary: t('该次生效申请已被较新修订替代，请刷新当前文件状态。'), groups: [] }
  if (result?.applicationError === 'invalid') return { kind: 'failed', summary: t('配置应用校验失败；请修正配置后再应用。'), groups: [] }
  if (result?.applicationError !== undefined) return { kind: 'unknown', summary: t('配置应用结果未确认，请只读刷新核对；不要重复提交。'), groups: [] }
  if (!object(result) || !Object.hasOwn(result, 'application') || result.application === undefined) {
    return { kind: 'unsupported', summary: t('Host 未提供配置应用明细，保存不代表已经生效。'), groups: [] }
  }
  const value = application(result.application)
  if (!value || !text(revision)) return { kind: 'unknown', summary: t('配置应用结果未确认，请只读刷新核对；不要重复提交。'), groups: [] }
  if (value.sourceRevision !== revision) return { kind: 'stale', summary: t('运行证据属于其他文件版本，当前版本尚未确认生效。'), application: value, groups: value.groups }
  if (!value.groups.length) return value.saved && value.generation > 0
    ? { kind: 'applied', summary: t('此文件版本与当前运行配置一致。'), application: value, groups: [] }
    : { kind: 'unknown', summary: t('Host 尚未记录此文件版本的配置应用明细。'), application: value, groups: [] }
  const counts = new Set(value.groups.map(group => group.status))
  let kind, summary
  if (counts.has('unknown')) { kind = 'unknown'; summary = '配置应用结果未确认，请只读刷新核对；不要重复提交。' }
  else if (counts.has('superseded')) { kind = 'stale'; summary = '此应用结果已被后续变更替代，请刷新当前文件状态。' }
  else if (counts.has('failed')) { kind = 'failed'; summary = '存在配置应用失败；请查看各项状态。' }
  else if (counts.size === 1 && counts.has('applied')) { kind = 'applied'; summary = '此文件版本的配置变更已生效。' }
  else if (counts.has('applied')) { kind = 'partial'; summary = '部分配置已生效；其余待重启或等待依赖。' }
  else { kind = 'pending'; summary = counts.has('restart-pending') ? '配置等待进程重启，当前运行仍使用旧值。' : '配置暂未生效，依赖条件尚未满足。' }
  return { kind, summary: t(summary), application: value, groups: value.groups }
}

/** Known wire metadata proves this is a Host with the explicit apply protocol. */
export function configurationSupportsApply(result) {
  return object(result) && (application(result.application) !== null || ['unconfirmed', 'superseded', 'invalid'].includes(result.applicationError))
}

/** Only a successful read started after the receipt supersedes its evidence. */
export function configurationReceiptForRead(read, receipt) {
  return receipt && (read.readEpoch ?? 0) <= receipt.observedReadEpoch ? receipt.value : null
}

export function configurationEffectLabel(effect, locale = 'zh-CN') {
  return translate(locale, ({ 'in-place': '原地更新', 'replace-resource': '替换资源', 'reconnect-endpoint': '账号重连', 'reload-plugin': '插件重载', 'restart-process': '进程重启' })[effect] ?? '未识别的更新方式')
}

export function configurationGroupLabel(status, locale = 'zh-CN') {
  return translate(locale, ({ applied: '已生效', 'restart-pending': '待重启', blocked: '依赖阻塞', failed: '应用失败', superseded: '已被替代', unknown: '结果未确认' })[status] ?? '状态未识别')
}

export function configurationPath(path) {
  return `/${path.map(part => part.replaceAll('~', '~0').replaceAll('/', '~1')).join('/')}`
}
