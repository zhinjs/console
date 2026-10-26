import { translate } from '../../i18n/locale.mjs'
/** Value-free, saved-revision-bound field explanation. No mutation or persistence. */
const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
const record = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value)
const ownKeys = (value, keys) => record(value) && Object.keys(value).every(key => keys.includes(key))
const origins = ['file', 'schema-default', 'unset', 'unknown']
const matches = ['equal', 'different', 'redacted', 'unknown']
export const CONFIG_EXPLANATION_REASONS = Object.freeze({
  'schema-unavailable': 'Host 未提供可解释的 Schema。',
  'schema-drift': 'Schema 与当前运行代不一致，无法给出可靠解释。',
  'custom-resolver': '此实例使用自定义配置解析，Host 不推测字段来源。',
  'complex-schema': '此 Schema 超出首版可证明的静态字段范围。',
  'instance-unavailable': '当前没有可证明的实例运行证据。',
  'bound-exceeded': '字段数量或元数据大小超过解释上限，Host 未截断后冒充完整结果。',
  'candidate-invalid': '已保存的候选配置未通过解释所需的校验。',
})
export const CONFIG_CANDIDATE_ORIGINS = Object.freeze({ file: '配置文件明确设置', 'schema-default': 'Schema 声明默认值', unset: '未设置', unknown: '来源无法证明' })
export const CONFIG_GENERATION_MATCHES = Object.freeze({ equal: '读取时与运行代一致', different: '读取时与运行代不同', redacted: '敏感或环境引用，未比较', unknown: '一致性无法证明' })
export function validExplanationBinding(value) { return Boolean(value && typeof value.scope === 'string' && value.scope && typeof value.instanceKey === 'string' && value.instanceKey.trim() && value.instanceKey.length <= 128 && hash(value.revision)) }
export function explanationBindingKey(binding) { return validExplanationBinding(binding) ? JSON.stringify([binding.scope, binding.instanceKey, binding.revision]) : null }
class ExplanationVersionMismatch extends Error {}
export function readConfigExplanation(value, expected, locale = 'zh-CN') {
  const invalid = () => { throw new Error(translate(locale, "Host 返回的字段解释格式或版本不正确；请刷新已保存配置后重新读取。")) }
  if (!ownKeys(value, ['instanceKey', 'revision', 'projectRevision', 'generation', 'projection', 'reason', 'fields'])
    || typeof value.instanceKey !== 'string' || !value.instanceKey.trim() || value.instanceKey.length > 128 || !hash(value.revision) || !hash(value.projectRevision)
    || !(value.generation === null || Number.isSafeInteger(value.generation) && value.generation >= 0)
    || !['supported', 'unsupported'].includes(value.projection) || !Array.isArray(value.fields) || value.fields.length > 128) invalid()
  if (expected && (value.instanceKey !== expected.instanceKey || value.revision !== expected.revision)) throw new ExplanationVersionMismatch(translate(locale, "字段解释不属于当前已保存版本；请刷新配置并重新读取，草稿不会被覆盖。"))
  if (value.projection === 'unsupported') {
    if (value.fields.length || !Object.hasOwn(CONFIG_EXPLANATION_REASONS, value.reason)) invalid()
  } else if (Object.hasOwn(value, 'reason') || value.generation === null) invalid()
  const seen = new Set()
  const fields = value.fields.map(field => {
    if (!ownKeys(field, ['path', 'candidateOrigin', 'generationMatch', 'generationOrigin']) || !Array.isArray(field.path) || field.path.length < 1 || field.path.length > 8
      || field.path.some(part => typeof part !== 'string' || !part.length || part.length > 128)
      || !origins.includes(field.candidateOrigin) || !matches.includes(field.generationMatch) || field.generationOrigin !== 'unknown') invalid()
    const key = JSON.stringify(field.path)
    if (seen.has(key)) invalid(); seen.add(key)
    return { path: [...field.path], candidateOrigin: field.candidateOrigin, generationMatch: field.generationMatch, generationOrigin: 'unknown' }
  })
  if (new TextEncoder().encode(JSON.stringify(value.fields)).byteLength > 16 * 1024) invalid()
  return { instanceKey: value.instanceKey, revision: value.revision, projectRevision: value.projectRevision, generation: value.generation, projection: value.projection, ...(value.projection === 'unsupported' ? { reason: value.reason } : {}), fields }
}
/** Actual read handler: late responses cannot publish across a saved revision or authenticated connection. */
export function createConfigExplanationReader({ read, getBinding, active, publish }, locale = 'zh-CN') {
  let epoch = 0
  return {
    cancel() { epoch++ },
    async load() {
      const binding = getBinding(), key = explanationBindingKey(binding)
      if (!key || binding.disabled || !active(binding.scope)) return
      const id = ++epoch
      const current = () => id === epoch && explanationBindingKey(getBinding()) === key && !getBinding()?.disabled && active(binding.scope)
      publish({ kind: 'loading', key })
      try {
        const raw = await read({ instanceKey: binding.instanceKey, revision: binding.revision })
        if (!current()) return
        const data = readConfigExplanation(raw, binding, locale)
        publish({ kind: 'ready', key, data })
      } catch (error) {
        if (current()) publish({ kind: 'error', key, message: error instanceof ExplanationVersionMismatch
          ? translate(locale, "字段解释不属于当前已保存版本；请刷新配置并重新读取，草稿不会被覆盖。") : translate(locale, "暂时无法读取字段解释。请核对当前 Host 的 full 权限和版本，或刷新配置后重试；这不表示配置保存或应用失败。") })
      }
    },
  }
}
