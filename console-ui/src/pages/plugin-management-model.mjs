import { translate } from '../i18n/locale.mjs'
const statuses = Object.freeze({ 'not-installed': '尚未安装', installed: '依赖已安装', declared: '实例已声明', 'missing-config': '需要完善配置', 'pending-restart': '等待应用', enabled: '当前代已应用', degraded: '状态降级' });
const text = value => typeof value === 'string' && value.trim().length > 0;
const generation = value => value === null || Number.isSafeInteger(value) && value >= 0;
export function validateManagementState(state, instanceKey, locale = 'zh-CN') {
  if (!state || !(state.version === null || text(state.version)) || !(state.revision === null || text(state.revision)) || !(state.validation === null || state.validation && typeof state.validation.valid === 'boolean' && Array.isArray(state.validation.errors) && state.validation.errors.every(issue => issue && typeof issue.path === 'string' && text(issue.message)) && Array.isArray(state.validation.missingEnv) && state.validation.missingEnv.every(text)) || !text(state.packageName) || !text(state.instanceKey) || !Object.hasOwn(statuses, state.status) || !text(state.projectRevision) || !generation(state.generation) || !['installed','plugin','declared','published','restartRequired','disabled'].every(key => typeof state[key] === 'boolean') || !['unchecked','passed','failed'].includes(state.dependencies) || !['unknown','ready','pending','degraded'].includes(state.readiness) || !['not-configured','available'].includes(state.verification) || !Array.isArray(state.issues) || !state.issues.every(text) || instanceKey && state.instanceKey !== instanceKey) throw Error(translate(locale, "插件状态证据格式或实例身份不正确"));
  return state;
}
export function managementLabel(state, locale = 'zh-CN') { return state ? (statuses[state.status] ? translate(locale, statuses[state.status]) : undefined) ?? translate(locale, "状态未知") : translate(locale, "状态未确认"); }
export function canApplyPlugin(state) { return !!state && state.declared && state.restartRequired && (state.disabled || state.installed && state.plugin && state.dependencies === 'passed' && !['missing-config','degraded'].includes(state.status)); }
export function canVerifyPlugin(state) { return !!state && state.status === 'enabled' && !state.disabled && state.published && state.verification === 'available' && state.generation !== null; }
export function captureVerificationPlan(plan, state, locale = 'zh-CN') {
  validateManagementState(state, undefined, locale);
  if (!plan || plan.instanceKey !== state.instanceKey || plan.packageName !== state.packageName || plan.generation !== state.generation || !canVerifyPlugin(state) || plan.projectRevision !== state.projectRevision || !text(plan.checkRevision) || !Array.isArray(plan.checks)) throw Error(translate(locale, "验证计划已变化，请刷新当前状态和验证计划"));
  const ids = new Set();
  const checks = plan.checks.map(check => {
    if (!check || !text(check.id) || ids.has(check.id) || !text(check.title) || !['local','platform'].includes(check.scope) || !Array.isArray(check.effects) || !check.effects.every(text)) throw Error(translate(locale, "业务检查描述不完整"));
    ids.add(check.id);
    return Object.freeze({ ...check, effects: Object.freeze([...check.effects]) });
  });
  return Object.freeze({ ...plan, checks: Object.freeze(checks) });
}
export function verificationRequest(plan, checkId, state, locale = 'zh-CN') {
  const captured = captureVerificationPlan(plan, state, locale);
  if (!captured.checks.some(check => check.id === checkId)) throw Error(translate(locale, "未知业务检查"));
  return { type: 'plugin:verify', instanceKey: captured.instanceKey, checkId, expectedGeneration: captured.generation, expectedProjectRevision: captured.projectRevision, expectedCheckRevision: captured.checkRevision };
}
export async function verifyApprovedPlugin(request, plan, checkId, state, locale = 'zh-CN') {
  const result = await request(verificationRequest(plan, checkId, state, locale));
  if (!result || result.instanceKey !== plan.instanceKey || result.packageName !== plan.packageName || result.checkId !== checkId || result.generation !== plan.generation || typeof result.current !== 'boolean' || !['passed','failed','not-configured'].includes(result.status) || result.status !== 'not-configured' && result.scope !== plan.checks.find(check => check.id === checkId)?.scope || !['local','platform',null].includes(result.scope) || result.status === 'passed' && result.scope === null || !text(result.summary) || !Array.isArray(result.evidence) || !result.evidence.every(text)) throw Error(translate(locale, "业务验证结果未确认，请核对日志；勿自动重复执行"));
  return result;
}
export function verificationSummary(result, locale = 'zh-CN') {
  if (!result) return translate(locale, "尚未执行业务检查");
  if (!result.current) return translate(locale, "检查执行后当前代已变化，此结果不能证明当前插件可用");
  if (result.status === 'not-configured') return translate(locale, "当前插件未配置该业务检查");
  if (result.status === 'failed') return translate(locale, "业务检查未通过");
  return result.scope === 'local' ? translate(locale, "本地业务检查通过；尚未验证平台投递") : translate(locale, "所选平台业务检查通过");
}
/** Explicit provider metadata only; unknown third-party copy and the approved plan stay intact. */
function displayTranslation(original, translations, locale, accepts) {
  const translated = translations && Object.hasOwn(translations, locale) ? translations[locale] : undefined;
  return accepts(translated) ? translated : original;
}
const textList = (value, original) => Array.isArray(value) && value.length === original.length && value.every(text);
export function verificationCheckDisplay(check, locale = 'zh-CN') {
  return { title: displayTranslation(check.title, check.titleI18n, locale, text), effects: displayTranslation(check.effects, check.effectsI18n, locale, value => textList(value, check.effects)) };
}
export function verificationResultDisplay(result, locale = 'zh-CN') {
  return { summary: displayTranslation(result.summary, result.summaryI18n, locale, text), evidence: displayTranslation(result.evidence, result.evidenceI18n, locale, value => textList(value, result.evidence)) };
}
export function mutationRequest(type, plan, extra = {}, locale = 'zh-CN') {
  if (!plan || !text(plan.packageName) || !text(plan.instanceKey) || !text(plan.projectRevision)) throw Error(translate(locale, "操作计划缺少项目版本，请重新读取计划后确认"));
  if (type === 'plugin:install' && plan.requestedSpec && plan.requestedSpec !== plan.packageName && !plan.requestedSpec.startsWith(`${plan.packageName}@`)) throw Error(translate(locale, "安装请求与批准的包身份不一致"));
  return { ...extra, type, packageName: type === 'plugin:install' ? plan.requestedSpec ?? plan.packageName : plan.instanceKey, expectedProjectRevision: plan.projectRevision, ...(text(plan.configurationRevision) ? { expectedRevision: plan.configurationRevision } : {}) };
}
export function applyRequest(state, locale = 'zh-CN') {
  validateManagementState(state, undefined, locale);
  if (!canApplyPlugin(state)) throw Error(translate(locale, "插件未满足应用条件，请先完善配置或处理依赖问题"));
  return { type: 'plugin:apply', instanceKey: state.instanceKey, expectedProjectRevision: state.projectRevision };
}
function matchesAppliedState(state, disabled) {
  return disabled ? state.disabled && !state.published && !state.restartRequired
    : state.status === 'enabled' && !state.disabled && state.published && !state.restartRequired && state.generation !== null;
}
async function waitForCurrentManagement(read, previous, signal, matches, options, locale = 'zh-CN') {
  validateManagementState(previous, undefined, locale);
  const pause = options.pause ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
  for (let index = 0; index < (options.attempts ?? 20) && !signal.aborted; index++) {
    try {
      const state = validateManagementState(await read(), previous.instanceKey, locale);
      if (signal.aborted) return null;
      if (state.packageName !== previous.packageName || state.version !== previous.version || state.revision !== previous.revision) throw Error('Approved package/configuration evidence changed');
      if (matches(state)) return state;
    } catch { /* A restarting Host may be temporarily unavailable. Read only; never retry a mutation. */ }
    if (index + 1 < (options.attempts ?? 20) && !signal.aborted) await pause(1500, signal);
  }
  return null;
}
export function waitForManagementState(read, previous, signal, options = {}, locale = 'zh-CN') {
  return waitForCurrentManagement(read, previous, signal,
    state => state.projectRevision === previous.projectRevision && matchesAppliedState(state, previous.disabled), options, locale);
}
/** Lifecycle changes alter projectRevision; current publication, exact config and package remain required. */
export function waitForEnabledManagementState(read, previous, enabled, signal, options = {}, locale = 'zh-CN') {
  return waitForCurrentManagement(read, previous, signal, state => matchesAppliedState(state, !enabled), options, locale);
}
export function verificationIsCurrent(result, plan, state, currentPlan, locale = 'zh-CN') {
  if (currentPlan !== undefined) {
    try { if (captureVerificationPlan(currentPlan, state, locale).checkRevision !== plan?.checkRevision) return false }
    catch { return false }
  }
  return Boolean(result?.current && state && plan && canVerifyPlugin(state)
    && result.instanceKey === state.instanceKey && result.packageName === state.packageName
    && plan.instanceKey === state.instanceKey && plan.packageName === state.packageName
    && result.generation === state.generation && plan.generation === state.generation
    && plan.projectRevision === state.projectRevision);
}
