import { translate } from '../i18n/locale.mjs'
import { readTaskUseCases } from './task-center-model.mjs'
import { validatePluginList } from './plugin-list-model.mjs'
import { validateManagementState } from './plugin-management-model.mjs'
import { diagnosticConversationKey } from './endpoint-detail/message-diagnostics.mjs'
import { parseConfigDocument, configAtPath } from '../components/PluginConfigForm/source-model.mjs'

export const WELCOME_USE_CASE = 'group-welcome'
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 4096
// This is a conservative raw-source boundary, not a second environment parser.
const envReference = value => typeof value === 'string' && value.includes('${')
const targetHasReference = item => [item?.endpoint?.adapter, item?.endpoint?.id, item?.kind, item?.id,
  item?.parent?.kind, item?.parent?.id, item?.threadId].some(envReference)
export function readWelcomeUseCase(payload, locale = 'zh-CN') {
  const value = readTaskUseCases(payload, locale).find(item => item.id === WELCOME_USE_CASE && item.mode === 'plugin-configuration')
  if (!value) throw Error(translate(locale, "当前 Host 未提供群欢迎用途，请更新 Host 或使用原插件管理入口。"))
  return value
}
export function readWelcomeInstances(payload, packageName, locale = 'zh-CN') {
  const rows = validatePluginList(payload, locale).filter(item => item.packageName === packageName && item.manageable === true)
  const seen = new Set()
  return rows.map(item => {
    if (!text(item.instanceKey) || seen.has(item.instanceKey)) throw Error(translate(locale, "实例目录身份不完整或重复，请刷新 Host 目录。"))
    seen.add(item.instanceKey)
    return { instanceKey: item.instanceKey, packageName: item.packageName, status: item.status }
  })
}
export function welcomeReturnUrl(instanceKey) {
  return `/use-cases/group-welcome${instanceKey ? `?instance=${encodeURIComponent(instanceKey)}` : ''}`
}
export function welcomeConfigUrl(instanceKey) {
  return `/config?plugin=${encodeURIComponent(instanceKey)}&useCase=group-welcome`
}
export function welcomeDetailUrl(instanceKey) {
  return `/plugins/${encodeURIComponent(instanceKey)}?useCase=group-welcome`
}
/** Uses the existing read-only verification plan's opaque incarnation, even with no executable checks. */
export function readWelcomeEvidence(state, plan, instanceKey, packageName, source, locale = 'zh-CN') {
  const inspected = validateManagementState(state, instanceKey, locale)
  if (inspected.packageName !== packageName || !plan || plan.instanceKey !== instanceKey || plan.packageName !== packageName
    || plan.generation !== inspected.generation || plan.projectRevision !== inspected.projectRevision || !text(plan.checkRevision)
    || !Array.isArray(plan.checks)) throw Error(translate(locale, "实例或运行代证据已变化，请重新读取；未执行业务检查。"))
  if (!source || source.revision !== inspected.revision || !['yaml', 'json'].includes(source.format) || typeof source.source !== 'string'
    || !Array.isArray(source.configPaths?.[instanceKey])) throw Error(translate(locale, "配置文件版本或实例路径与应用证据不一致，请重新读取。"))
  let config
  try { config = configAtPath(parseConfigDocument(source.source, source.format, locale), source.configPaths[instanceKey], locale) }
  catch { throw Error(translate(locale, "配置源码无法安全读取，请在原配置页核对格式与实例路径。")) }
  const scopeUnknown = envReference(config?.welcomeConversations) || Array.isArray(config?.welcomeConversations) && config.welcomeConversations.some(targetHasReference)
  if (!config || typeof config !== 'object' || Array.isArray(config)
    || config.welcomeMessage !== undefined && typeof config.welcomeMessage !== 'string'
    || config.welcomeConversations !== undefined && !scopeUnknown && (!Array.isArray(config.welcomeConversations) || config.welcomeConversations.length > 100
      || config.welcomeConversations.some(target => !welcomeTargetKey(target)))
    || Array.isArray(config.welcomeConversations) && config.welcomeConversations.length > 100) throw Error(translate(locale, "群欢迎字段不是可识别的配置，请到原配置页核对。"))
  // Project only the relevant public scope and a content-present flag; discard the raw document and text.
  const welcome = { messagePresent: envReference(config.welcomeMessage) ? null : !!config.welcomeMessage, mode: scopeUnknown ? 'unknown' : config.welcomeConversations === undefined ? 'all'
    : config.welcomeConversations.length ? 'selected' : 'none', targets: (scopeUnknown ? [] : config.welcomeConversations ?? []).map(item => ({
      endpoint: { adapter: item.endpoint.adapter, id: item.endpoint.id }, kind: item.kind, id: item.id,
      ...(item.parent ? { parent: { kind: item.parent.kind, id: item.parent.id } } : {}),
      ...(item.threadId === undefined ? {} : { threadId: item.threadId }),
    })) }
  return { state: inspected, incarnation: plan.checkRevision, welcome }
}
export function welcomeEvidenceKey(evidence) {
  const s = evidence?.state
  return s ? JSON.stringify([s.packageName, s.instanceKey, s.version, s.revision, s.projectRevision, s.generation,
    s.published, s.disabled, s.restartRequired, s.status, evidence.incarnation, evidence.welcome]) : undefined
}
export function welcomeApplied(evidence) {
  const s = evidence?.state
  return !!s && s.status === 'enabled' && s.installed && s.declared && s.published && !s.disabled && !s.restartRequired
    && s.dependencies === 'passed' && s.validation?.valid === true && !s.validation.missingEnv.length && !s.issues.length
    && s.generation !== null && text(s.revision)
}
export function welcomeReady(evidence, target) {
  return welcomeApplied(evidence) && evidence.welcome.messagePresent === true && ['all', 'selected'].includes(evidence.welcome.mode)
    && (!target || evidence.welcome.mode === 'all' || evidence.welcome.targets.some(item => welcomeTargetKey(item) === welcomeTargetKey(target)))
}
export function welcomeTargetKey(target) {
  return target?.kind === 'group' && !targetHasReference(target) ? diagnosticConversationKey(target) : undefined
}
