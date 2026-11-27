import { translate } from '../../i18n/locale.mjs'
import { getConsoleAccess, hasConsolePermission } from '../../utils/console-access.mjs'
const base = '/api/agent/inference'
export class InferenceRequestError extends Error {
  constructor(code, status = 503, mutationOutcome, reason, path, details) {
    super(code)
    this.code = code
    this.status = status
    this.mutationOutcome = mutationOutcome
    if (reason) this.reason = reason
    if (path) this.path = path
    if (details) this.details = details
  }
}
/** Short enum-like codes only (`onboard-operation`, `UNSUPPORTED_CLIENT`, `invalid_grant`); never free text or a URL. */
const DIAGNOSTIC_CODE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/u
/**
 * The diagnostics of an expected failure (`details`, zhinjs/zhin#1270): failed step, upstream reason
 * code and HTTP status, driver code. Anything that is not a short code is dropped.
 */
function failureDetails(result) {
  const raw = result?.details
  if (!raw || typeof raw !== 'object') return undefined
  const details = {}
  for (const key of ['step', 'reason', 'preparationCode'])
    if (typeof raw[key] === 'string' && DIAGNOSTIC_CODE.test(raw[key])) details[key] = raw[key]
  if (Number.isInteger(raw.upstreamStatus) && raw.upstreamStatus >= 100 && raw.upstreamStatus <= 599) details.upstreamStatus = raw.upstreamStatus
  return Object.keys(details).length ? details : undefined
}
const PREPARATION_STEPS = {
  identity: (locale) => translate(locale, '读取账号身份'),
  'load-code-assist': (locale) => translate(locale, '读取项目'),
  'onboard-user': (locale) => translate(locale, '开通项目'),
  'onboard-operation': (locale) => translate(locale, '等待开通完成'),
}
/** 「（原因 UNSUPPORTED_CLIENT · 步骤：等待开通完成（onboard-operation） · 上游 HTTP 400）」, or '' without diagnostics. */
function detailsSuffix(details, locale) {
  if (!details) return ''
  const t = (message, values) => translate(locale, message, values)
  const parts = []
  if (details.reason) parts.push(t('原因 {0}', [details.reason]))
  if (details.step)
    parts.push(Object.hasOwn(PREPARATION_STEPS, details.step)
      ? t('步骤：{0}（{1}）', [PREPARATION_STEPS[details.step](locale), details.step])
      : t('步骤 {0}', [details.step]))
  if (details.upstreamStatus) parts.push(t('上游 HTTP {0}', [details.upstreamStatus]))
  return parts.length ? t('（{0}）', [parts.join(' · ')]) : ''
}
/** The configuration path a refusal names (`details.path`, #1250), e.g. `purposes.ambient.fallbacks[1]`. */
function refusalPath(result) {
  const path = result?.details?.path ?? result?.path
  return typeof path === 'string' && /^[A-Za-z0-9_.[\]:@/-]{1,200}$/u.test(path) ? path : undefined
}
/** Closed-set Host refusal reasons (#1250); the Host never sends values or provider text. */
const REFUSAL_TEXT = {
  'environment-console-user': (locale) => translate(locale, 'Console 用户的账号不能引用 Host 环境变量，请直接填写密钥，或由 Host 管理员在本机用命令添加（zhin ai account add）'),
  'environment-name': (locale) => translate(locale, '只能引用以 _API_KEY 结尾的环境变量（例如 OPENAI_API_KEY）'),
  'environment-service-address': (locale) => translate(locale, '引用 Host 环境变量的账号只能使用内置服务的官方地址或已存在的服务，不能在这次导入中新建或改成自定义地址'),
  'environment-local-only': (locale) => translate(locale, '该操作只能由 Host 管理员在本机用 zhin 命令完成'),
  'environment-missing': (locale) => translate(locale, '新的环境变量在 Host 上未设置或为空'),
  'environment-mismatch': (locale) => translate(locale, '新变量的值与当前凭据的指纹不一致；确认是同一账号的新密钥后加 --reauthorize 重试'),
  'environment-account': (locale) => translate(locale, '只有引用环境变量（env://）的 Host API Key 账号可以修改引用名，且原变量名必须一致'),
}
export function inferencePath(path = '', ownerId) {
  const url = new URL(base + path, 'https://console.invalid')
  if (ownerId) url.searchParams.set('owner', ownerId)
  return url.pathname + url.search
}
/** No provider body, credential or callback URL is reflected in a browser error. */
export async function inferenceRequest(fetch, { path = '', ownerId, body, method, signal }) {
  let response, result
  try {
    response = await fetch(inferencePath(path, ownerId), {
      method: method ?? (body === undefined ? 'GET' : 'POST'),
      cache: 'no-store',
      signal,
      ...(body === undefined
        ? {}
        : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
    })
    result = await response.json()
  } catch {
    // A Host without the Agent has no inference routes at all (404, possibly not JSON).
    throw new InferenceRequestError(response?.status === 404 ? 'not-installed' : 'unavailable', response?.status)
  }
  if (!response.ok || result.success !== true)
    throw new InferenceRequestError(
      typeof result.code === 'string' ? result.code : response.status === 404 ? 'not-installed' : 'unavailable',
      response.status,
      result.mutationOutcome === 'not-committed' || result.requestOutcome === 'not-dispatched'
        ? 'not-committed'
        : undefined,
      typeof result.reason === 'string' && Object.hasOwn(REFUSAL_TEXT, result.reason) ? result.reason : undefined,
      refusalPath(result),
      failureDetails(result)
    )
  return result.data
}
/**
 * `GET /agent/inference/*` needs only `agent.view`; every other method needs this permission
 * (`CONSOLE_HTTP_PERMISSIONS`). Built-in operator and viewer roles do not hold it.
 */
export const INFERENCE_CONFIGURE_PERMISSION = 'agent.configure'
/** Whether `access` may change models, accounts, services and purposes (an unreported session may). */
export function inferenceCanConfigure(access = getConsoleAccess()) {
  return hasConsolePermission(INFERENCE_CONFIGURE_PERMISSION, access)
}
export function inferenceError(error, locale = 'zh-CN') {
  const message = inferenceErrorText(error, locale)
  return error instanceof InferenceRequestError && !error.reason ? message + detailsSuffix(error.details, locale) : message
}
function inferenceErrorText(error, locale) {
  const code = error instanceof InferenceRequestError ? error.code : 'unavailable'
  if (error instanceof InferenceRequestError && error.reason) return REFUSAL_TEXT[error.reason](locale)
  // A failed account preparation (424 since zhinjs/zhin#1260); the driver code may also come as `details.preparationCode`.
  const preparation = [code, error?.details?.preparationCode].find(value => value === 'project-unavailable' || value === 'identity-unavailable')
  if (preparation === 'project-unavailable')
    return translate(locale, '完成准备失败：服务没有为这个账号开通项目。请确认这个账号已在对应服务中使用过，然后重试「完成准备」。')
  if (preparation === 'identity-unavailable')
    return translate(locale, '完成准备失败：无法读取账号身份。请重新登录这个账号后再试。')
  if (code === 'forbidden') return translate(locale, '当前身份无权执行此操作。')
  if (code === 'plan-conflict') return translate(locale, '连接或模型身份发生变化，请新增账号或模型并明确重新绑定。')
  if (['conflict', 'stale-reference', 'revision-conflict'].includes(code))
    return translate(locale, '配置已变化，请重新读取；已有草稿需重新打开编辑后再保存。')
  if (['invalid-plan', 'invalid-graph'].includes(code) && error.path) {
    const where = configPathLabel(error.path, locale)
    return code === 'invalid-graph'
      ? translate(locale, '{0} 引用的模型配置不存在或类型不对（删除模型配置前请先从这里移除）。', [where])
      : translate(locale, '{0} 无效，请检查后再保存。', [where])
  }
  if (['invalid-input', 'invalid-plan', 'invalid-graph'].includes(code))
    return translate(locale, '请检查必填项、参数和模型能力。')
  if (code === 'identity-change') return translate(locale, '凭据属于不同或无法核实的账号，请新增账号并重新绑定模型。')
  if (code === 'not-authorized') return translate(locale, '尚未授权或本次登录信息不匹配，请检查授权信息。')
  if (code === 'reauthorize') return translate(locale, '账号授权已失效，请重新登录。')
  if (code === 'disconnected') return translate(locale, '账号已断开，请登录或设置密钥后再使用。')
  if (code === 'target-denied') return translate(locale, '请求地址不在此账号的授权范围内。')
  if (code === 'rejected') return translate(locale, '服务拒绝了本次授权，请检查登录信息。')
  if (code === 'not-submitted') return translate(locale, '本次请求尚未提交，请检查登录配置。')
  if (code === 'operation-closed') return translate(locale, '本次操作已结束。')

  if (code === 'migration-required') return translate(locale, '此记录需要显式迁移后才能调整。')
  if (code === 'receipt-storage-unavailable') return translate(locale, '浏览器无法保存操作编号，尚未提交修改。')
  if (code === 'unsupported') return translate(locale, '此服务不提供该功能。')
  if (code === 'not-prepared') return translate(locale, '已登录，请先完成账号准备。')
  if (code === 'storage-integrity') return translate(locale, '模型存储完整性异常，请由管理员检查。')
  if (code === 'not-installed') return translate(locale, '这个 Host 没有模型接口：没有安装 Agent，或 Host 版本较旧。只用 IM 时可以忽略；需要 AI 回复时先在插件市场安装 Agent。')
  if (code === 'outcome-unknown') return translate(locale, '操作结果尚未确认，请查询结果后再操作。')
  return translate(locale, '操作未完成，请稍后重新读取。')
}
/**
 * What 「认证响应异常」 means for an account (#64 `inference-error-details-ignored`): the kind of
 * reply, the upstream HTTP status and OAuth error code when the Host recorded them, and what to do.
 * `null` for outcomes whose label already says it all (temporary, unknown).
 */
export function accountFailureDetails(failure, locale = 'zh-CN') {
  if (!failure || (failure.kind !== 'response-error' && failure.kind !== 'invalid-response')) return null
  const t = (message, values) => translate(locale, message, values)
  const lines = [failure.kind === 'response-error' ? t('认证服务返回了错误。') : t('认证服务的回复无法识别。')]
  if (Number.isInteger(failure.status) && failure.status >= 100 && failure.status <= 599) lines.push(t('认证服务返回 HTTP {0}', [failure.status]))
  if (typeof failure.oauthError === 'string' && DIAGNOSTIC_CODE.test(failure.oauthError)) lines.push(t('错误码 {0}', [failure.oauthError]))
  lines.push(t('可以重新「登录」这个账号；已经登录过的，先试「完成准备」。'))
  return lines
}
const AMBIENT_FIELD_LABELS = t => ({
  profile: t('插话判断模型'), fallbacks: t('备用链'), compare: t('对照模型'),
  minConfidence: t('门槛'), mode: t('只观察'), timeoutMs: t('决策模型超时'),
})
/**
 * A configuration path as people read it: `purposes.ambient.fallbacks[1]` → 「插话判断 · 备用链 第 2 项（purposes.ambient.fallbacks[1]）」;
 * other paths are shown as the Host sent them.
 */
export function configPathLabel(path, locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  const match = /^purposes\.ambient(?:\.([A-Za-z]+)(?:\[(\d+)\])?)?$/u.exec(path)
  if (!match) return t('配置 {0}', [path])
  const labels = AMBIENT_FIELD_LABELS(t)
  const field = match[1] && Object.hasOwn(labels, match[1]) ? labels[match[1]] : match[1]
  const item = match[2] !== undefined ? t('{0} 第 {1} 项', [field, Number(match[2]) + 1]) : field
  return t('{0}（{1}）', [item ? t('插话判断 · {0}', [item]) : t('插话判断'), path])
}
export function resourceBindings(view) {
  return Object.fromEntries(
    ['services', 'accounts', 'profiles'].map((kind) => [
      kind,
      Object.fromEntries(Object.keys(view[kind]).map((id) => [id, id])),
    ])
  )
}
export function driverKey(driver) {
  return JSON.stringify([driver.owner, driver.id, driver.contractVersion])
}
/** Resolve display metadata by the same complete Driver reference used by the graph. */
export function serviceDriver(view, serviceId) {
  const service = view.services[serviceId]
  return service && view.drivers.find(driver => driverKey(driver) === driverKey(service.driver))
}
/**
 * How the「模型」field of the add / edit model dialog reads (#64 `model-add-empty-catalog`).
 * With no catalog entries (nothing built in, nothing read from the service yet) a picker would only
 * hold its placeholder, so the field is a text input with a hint instead, and there is nothing to
 * switch back to. Editing keeps the text input it always had.
 */
export function modelEntryView({ editing = false, manualEntry = false, choiceCount = 0, discovery = false, discovered = false } = {}) {
  if (editing) return { input: true, canToggle: true, hint: null }
  if (choiceCount > 0) return { input: manualEntry, canToggle: true, hint: null }
  return {
    input: true,
    canToggle: false,
    hint: discovered ? 'none-returned' : discovery ? 'discoverable' : 'manual-only',
  }
}
/**
 * Defaults for the model capability form (#64 `model-capability-no-defaults`). A language model takes
 * text unless said otherwise, so ticking 「语言模型」 with no input declared ticks 「文字」 too; a
 * protocol whose contract offers a single kind selects that kind. Everything stays editable.
 */
export function withModelKind(value, kind, checked) {
  if (!checked) return { ...value, kinds: value.kinds.filter(item => item !== kind) }
  const next = { ...value, kinds: value.kinds.includes(kind) ? value.kinds : [...value.kinds, kind] }
  if (kind === 'language' && !(value.input?.length)) next.input = ['text']
  return next
}
export function withModelProtocol(value, protocol, driver) {
  const contract = driver?.modelContracts?.find(item => item.protocol === protocol)
  const base = { id: value.id, protocol, kinds: [] }
  return contract?.kinds?.length === 1 ? withModelKind(base, contract.kinds[0], true) : base
}
/**
 * A language model whose inputs were all unticked. A declaration that never listed `input` (catalog
 * entries from a service) is left alone, as the Host accepts it.
 */
export function languageInputMissing(value) {
  return Boolean(value?.kinds?.includes('language')) && Array.isArray(value.input) && value.input.length === 0
}
/**
 * Accounts with no model under them (#64 `account-ready-without-models`): such an account cannot be
 * picked in 用途, so its card says so next to 「可用」 and offers 「添加模型」.
 */
export function accountHasModels(view, accountId) {
  return Object.values(view?.profiles ?? {}).some(profile => profile?.accountId === accountId)
}
/**
 * What is wrong with a pasted OAuth callback address (#64 `oauth-callback-dead-page`), or null when it
 * can be submitted. After authorizing, the browser lands on the callback address (e.g.
 * `http://localhost:1455/auth/callback?code=…`), which nothing on this machine answers, so it shows a
 * 「无法访问」 page; the address bar still holds the code. `redirectUri` is the challenge's address.
 */
export function oauthCallbackProblem(value, redirectUri) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (!text) return 'empty'
  let pasted
  try { pasted = new URL(text) } catch { return 'not-url' }
  // `localhost:1455/…` parses with `localhost:` as its scheme: only a web address counts.
  if (pasted.protocol !== 'http:' && pasted.protocol !== 'https:') return 'not-url'
  let expected = null
  try { expected = redirectUri ? new URL(redirectUri) : null } catch { expected = null }
  if (expected && (pasted.origin !== expected.origin || pasted.pathname.replace(/\/$/, '') !== expected.pathname.replace(/\/$/, ''))) return 'other-address'
  // The provider may answer with `error=` instead of a code; the Host reports that one itself.
  if (!pasted.searchParams.get('code') && !pasted.searchParams.get('error')) return 'no-code'
  return null
}
/**
 * The authentication method a new account form uses (#64 `account-auth-single-option`): the one chosen,
 * or, when the service type offers exactly one, that one, so 「保存」 does not wait on a pick with no choice.
 */
export function effectiveAuthMethod(chosen, methods) {
  if (typeof chosen === 'string' && chosen) return chosen
  return Array.isArray(methods) && methods.length === 1 ? methods[0] : ''
}
/**
 * The declaration a model ID that is not in the catalog starts from (#64 `model-edit-id-resets-capabilities`):
 * the draft being edited, else the catalog declaration of the ID it replaces (so renaming a model keeps
 * its protocol, kinds and inputs), else the driver's defaults. `inherited` names the catalog model whose
 * declaration was carried over, so the form can ask to confirm it.
 */
export function draftForModelId(id, { previous = null, replaced = null, defaults }) {
  if (previous) return { draft: { ...previous, id }, inherited: null }
  if (replaced && replaced.id !== id) return { draft: { ...structuredClone(replaced), id }, inherited: replaced.id }
  return { draft: defaults(id), inherited: null }
}
export function profileSupport(view, profile) {
  return serviceDriver(view, view.accounts[profile.accountId].serviceId)?.support
}
export function profileSelection(view, profile, kind = 'language') {
  const account = view.accounts[profile.accountId]
  return {
    id: profile.id,
    rootId: view.rootId,
    accountId: profile.accountId,
    accountIncarnation: account.incarnation,
    kind,
  }
}
export function selectableLanguageProfiles(view, locale = 'zh-CN') {
  return [
    ...Object.values(view.profiles).flatMap((profile) => {
      const account = view.accounts[profile.accountId],
        model = view.services[account.serviceId].models[profile.model],
        support = profileSupport(view, profile)
      return model.kinds.includes('language')
        ? [
            {
              id: profile.id,
              label: profile.label ?? profile.model,
              selection: profileSelection(view, profile),
              ...(support ? { support } : {}),
            },
          ]
        : []
    }),
    ...view.deployment
      .filter(
        (profile) =>
          !Object.hasOwn(view.profiles, profile.id) && profile.definition.kinds.includes('language')
      )
      .map((profile) => ({
        id: profile.id,
        label: translate(locale, '{0} · 部署模型', [profile.label ?? profile.model]),
        ...(profile.support ? { support: profile.support } : {}),
        selection: {
          id: profile.id,
          rootId: view.rootId,
          accountId: profile.accountId,
          accountIncarnation: profile.accountIncarnation,
          kind: 'language',
        },
      })),
  ]
}
/** Rendering projection only. The Driver remains the sole validator and source of defaults. */
export function schemaField(schema = {}) {
  const common = {
    ...(schema.title ? { title: schema.title } : {}),
    ...(schema.description ? { description: schema.description } : {}),
    ...(Object.hasOwn(schema, 'default') ? { default: schema.default } : {}),
    ...(schema.enum ? { enum: schema.enum } : {}),
    ...(schema.minimum !== undefined ? { min: schema.minimum } : {}),
    ...(schema.maximum !== undefined ? { max: schema.maximum } : {}),
  }
  if (schema.anyOf || schema.oneOf)
    return {
      ...common,
      type: 'union',
      mode: schema.anyOf ? 'anyOf' : 'oneOf',
      list: (schema.anyOf ?? schema.oneOf).map(schemaField),
    }
  if (Array.isArray(schema.type))
    return {
      ...common,
      type: 'union',
      mode: 'anyOf',
      list: schema.type.map((type) => schemaField({ ...schema, type })),
    }
  if (Object.hasOwn(schema, 'const')) return { ...common, type: 'const', value: schema.const }
  if (Array.isArray(schema.prefixItems))
    return { ...common, type: 'tuple', list: schema.prefixItems.map(schemaField) }
  if (schema.type === 'object' || schema.properties)
    return {
      ...common,
      type: 'object',
      object: Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([key, value]) => [
          key,
          { ...schemaField(value), required: schema.required?.includes(key) ?? false },
        ])
      ),
      ...(schema.additionalProperties === true
        ? { additional: { type: 'any' } }
        : typeof schema.additionalProperties === 'object'
        ? { additional: schemaField(schema.additionalProperties) }
        : {}),
    }
  if (schema.type === 'array') return { ...common, type: 'list', inner: schemaField(schema.items) }
  return {
    ...common,
    type: schema.type === 'integer' ? 'number' : schema.type ?? 'any',
    ...(schema.type === 'integer' ? { integer: true } : {}),
  }
}

/** Translate the graph projection into the existing explicit plan contract, including deliberate clears. */
/**
 * The plan body of the purposes page. A language purpose is written as `{ profile, fallbacks? }`
 * (#1250 chat-purpose-no-fallback): writing a purpose replaces its whole chain on the Host, so the
 * chain the page holds (`<key>Fallbacks`, `agentFallbacks`, the Host's graph shape) goes back with
 * it. `fallbacks: false` (a Host without fallback chains) never writes `fallbacks`.
 */
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]))
  : value

/**
 * Whether the 用途 draft would save anything (#64 `purposes-no-unsaved-guard`): the plan built from it
 * differs from the plan of what was read. Compared as saved, so key order and empty containers do not count.
 */
export function purposesDirty(draft, original, { fallbacks = true } = {}) {
  if (!draft || !original) return false
  const plan = value => JSON.stringify(canonical(purposePlan(value, original, { fallbacks })))
  return plan(draft) !== plan(original)
}

export function purposePlan(draft, original = draft, { fallbacks = true, ambientJudge } = {}) {
  const ref = (id, chain) => (id ? languageReference(id, fallbacks ? chain : undefined) : null)
  const selection = (value) => ({ chat: ref(value?.chat, value?.chatFallbacks), perception: value?.perception ?? null })
  const map = (current, before, convert) =>
    Object.fromEntries(
      [...new Set([...Object.keys(before ?? {}), ...Object.keys(current ?? {})])].map((key) => [
        key,
        Object.hasOwn(current ?? {}, key) ? convert(current[key], key) : null,
      ])
    )
  const defaults = draft.defaults
  // ADR 0066: with the merged interjection judge, `purposes.ambient` is the policy object (written
  // only when it changed) and `decisions.ambient` is no longer a decision purpose.
  const merged = ambientJudge !== undefined
  const withoutAmbient = (value) => (merged && value ? Object.fromEntries(Object.entries(value).filter(([task]) => task !== 'ambient')) : value)
  return {
    chat: ref(defaults.chat, defaults.chatFallbacks),
    summary: ref(defaults.summary, defaults.summaryFallbacks),
    ...(merged
      ? ambientJudge.entry === undefined ? {} : { ambient: ambientJudge.entry }
      : { ambient: ref(defaults.ambient, defaults.ambientFallbacks) }),
    image: defaults.image ? { profile: defaults.image } : null,
    perception: defaults.perception ?? null,
    decisions: map(withoutAmbient(draft.decisions), withoutAmbient(original.decisions), (value) => value),
    agents: map(draft.agents, original.agents, (id, key) => ref(id, draft.agentFallbacks?.[key])),
    adapters: map(draft.adapters, original.adapters, selection),
    endpoints: map(draft.endpoints, original.endpoints, selection),
    scenes: map(draft.scenes, original.scenes, (value) => ({ chat: ref(value.chat, value.chatFallbacks) })),
  }
}

/** The ordered chain without blanks, repeats or the primary itself (the Host rejects those). */
export function cleanFallbacks(primary, chain) {
  const seen = new Set([primary])
  const result = []
  for (const id of Array.isArray(chain) ? chain : []) {
    if (typeof id !== 'string' || !id || seen.has(id)) continue
    seen.add(id)
    result.push(id)
  }
  return result
}

/** `{ profile, fallbacks? }`; an empty chain is left out (the Host refuses `fallbacks: []`). */
export function languageReference(profile, chain) {
  const fallbacks = cleanFallbacks(profile, chain)
  return { profile, ...(fallbacks.length ? { fallbacks } : {}) }
}

/**
 * Whether the Host keeps fallback chains for every language purpose (#1250). Those Hosts send
 * `modelAvailability` with the purposes (same change); older ones send neither, and the page then
 * shows no fallback editor except the vision one it always had.
 */
export function supportsPurposeFallbacks(view) {
  return Boolean(view?.modelAvailability) && typeof view.modelAvailability === 'object'
}

/** Moves one chain entry up (`-1`) or down (`1`); out-of-range moves return the chain unchanged. */
export function moveFallback(chain, index, delta) {
  const list = [...(chain ?? [])]
  const target = index + delta
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list
  ;[list[index], list[target]] = [list[target], list[index]]
  return list
}

const FALLBACK_REASON_TEXT = {
  quota_exhausted: (locale) => translate(locale, '额度用完'),
  billing: (locale) => translate(locale, '余额不足'),
  auth: (locale) => translate(locale, '密钥被拒'),
  timeout: (locale) => translate(locale, '连续超时'),
  context_overflow: (locale) => translate(locale, '上下文超长'),
}
function fallbackReason(reason, locale) {
  return FALLBACK_REASON_TEXT[reason]?.(locale) ?? translate(locale, '暂时不可用')
}

/** The active skip (`modelAvailability.unavailable`) of a Profile's account + model, if any. */
export function profileAvailability(view, profileId, now = Date.now()) {
  const profile = view?.profiles?.[profileId]
  const list = view?.modelAvailability?.unavailable
  if (!profile || !Array.isArray(list)) return undefined
  return list.find((entry) => entry && entry.accountId === profile.accountId && entry.model === profile.model
    && typeof entry.until === 'number' && entry.until > now)
}

/** 「暂时跳过：额度用完，<time> 恢复」 for one skip. */
export function describeUnavailability(entry, locale = 'zh-CN') {
  if (!entry) return ''
  return translate(locale, '暂时跳过：{0}，{1} 恢复', [fallbackReason(entry.reason, locale), clock(entry.until, locale)])
}

const PURPOSE_NAMES = {
  chat: (locale) => translate(locale, '聊天'),
  summary: (locale) => translate(locale, '摘要'),
  ambient: (locale) => translate(locale, '插话判断'),
  perception: (locale) => translate(locale, '识图'),
}
function purposeName(purpose, locale) {
  if (Object.hasOwn(PURPOSE_NAMES, purpose)) return PURPOSE_NAMES[purpose](locale)
  const agent = /^agent:(.+)$/u.exec(String(purpose ?? ''))
  return agent ? translate(locale, 'Agent {0}', [agent[1]]) : String(purpose ?? '')
}

/**
 * The Host's recent switches to a fallback (newest first), as display rows
 * `{ key, purpose, from, to, reason, at, selection }`; names come from the view when it still has them.
 */
export function recentFallbackRows(view, locale = 'zh-CN') {
  const events = view?.modelAvailability?.recentFallbacks
  if (!Array.isArray(events)) return []
  const name = (endpoint) => {
    const profile = view.profiles?.[endpoint?.profileId]
    return profile?.label ?? profile?.model ?? endpoint?.model ?? endpoint?.profileId ?? ''
  }
  return events.filter((event) => event && event.from && event.to).map((event, index) => ({
    key: `${event.at}:${index}`,
    purpose: purposeName(event.purpose, locale),
    from: name(event.from),
    to: name(event.to),
    reason: fallbackReason(event.reason, locale),
    at: clock(event.at, locale),
    selection: event.phase === 'selection',
  }))
}

/** Submit a freshly allocated ID exactly once. Existing IDs are recovered by receipt query,
 * never by calling this again; not-dispatched describes this request, not a prior mutation. */
export async function applyInferenceChange(fetch, { ownerId, prepared, mutationId }) {
  let result
  try {
    result = await inferenceRequest(fetch, {
      ownerId,
      path: '/apply',
      body: { prepared, mutationId },
    })
  } catch (error) {
    if (error instanceof InferenceRequestError && error.mutationOutcome === 'not-committed')
      return { status: 'not-committed', code: error.code }
    throw new InferenceRequestError('outcome-unknown')
  }
  if (!['committed', 'conflict', 'not-committed', 'commit-unknown'].includes(result?.status))
    throw new InferenceRequestError('outcome-unknown')
  return result
}

/** Receipt recovery stores only a mutation ID, partitioned by authenticated Host base and owner. */
export function pendingMutationKey(base, ownerId) {
  const url = new URL(base)
  return `zhin.inference.pending.v1:${JSON.stringify([
    url.origin + url.pathname.replace(/\/+$/u, ''),
    ownerId,
  ])}`
}
export function readPendingMutation(storage, base, ownerId) {
  return storage.getItem(pendingMutationKey(base, ownerId))
}
export function storePendingMutation(storage, { base, ownerId, mutationId }) {
  const key = pendingMutationKey(base, ownerId)
  if (mutationId === null) storage.removeItem(key)
  else storage.setItem(key, mutationId)
}

export function driverLabel(driver, drivers) {
  return drivers.filter((value) => value.label === driver.label).length > 1
    ? `${driver.label} · ${driver.source ?? driver.owner.split('\0').join('/')}`
    : driver.label
}

/**
 * 「谁在用」：一个模型（Profile）被哪些用途引用。读用途配置（`view.purposes`），Host 管理员还读
 * `purposeEffects`（ADR 0066 D7）：插话判断按实际的判断器链列出（含跟随聊天时的聊天模型），
 * 没有生效的引用标 `ignored` 并带原因（插话未开启、决策已关闭），由页面灰显。纯函数。
 */

const decisionLabels = t => ({
  skills: t('技能选择'),
  tools: t('工具选择'),
  memory: t('记忆选择'),
  agents: t('Agent 选择'),
  approval: t('工具审批建议'),
  ambient: t('旁听参与判断'),
})

const IGNORED_REASONS = t => ({
  'ambient-not-configured': t('插话未开启'),
  'no-conversations': t('没有群开启插话'),
  'mode-off': t('决策已关闭'),
  'binding-name': t('同名的 Agent 绑定优先'),
  ambiguous: t('有多个同名子 Agent'),
  'no-target': t('没有这个名字的 Agent'),
})

/** Why a usage does not take effect, in words. */
export function ignoredReasonText(reason, locale = 'zh-CN') {
  const reasons = IGNORED_REASONS(message => translate(locale, message))
  return Object.hasOwn(reasons, reason) ? reasons[reason] : translate(locale, '未生效')
}

function scopeUses(models, profileId) {
  const uses = []
  if (models?.chat === profileId || models?.chatFallbacks?.includes(profileId)) uses.push('chat')
  if (models?.perception?.profile === profileId || models?.perception?.fallbacks?.includes(profileId)) uses.push('perception')
  return uses
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The interjection judge rows of one Profile (ADR 0066): 插话判断 / 插话判断（第 N 个备用）/
 * 插话判断（对照）, 「跟随聊天」 when the chain is the chat model's. From `purposeEffects.ambient`
 * when the Host sends it (the chain really used), else from the stored `purposes.ambient`.
 */
function ambientUsages(purposes, effects, profileId, t) {
  const effect = isRecord(effects?.ambient) ? effects.ambient : null
  const policy = isRecord(purposes?.ambient) ? purposes.ambient : null
  const chain = effect && Array.isArray(effect.chain) ? effect.chain.map(member => member?.profile)
    : policy?.profile ? [policy.profile, ...(Array.isArray(policy.fallbacks) ? policy.fallbacks : [])] : []
  const compare = effect ? effect.compare?.profile : policy?.compare
  const inherited = effect?.inheritedFrom === 'chat'
  const ignored = effect?.status === 'ignored' ? { ignored: true, reason: effect.reason ?? '' } : {}
  const rows = []
  chain.forEach((id, index) => {
    if (id !== profileId) return
    const label = index === 0
      ? inherited ? t('插话判断（跟随聊天）') : t('插话判断')
      : inherited ? t('插话判断（跟随聊天，第 {0} 个备用）', [index]) : t('插话判断（第 {0} 个备用）', [index])
    rows.push({ key: `ambient:${index}`, level: 'ambient', label, ...ignored })
  })
  if (compare === profileId) rows.push({ key: 'ambient:compare', level: 'ambient', label: t('插话判断（对照）'), ...ignored })
  return rows
}

/**
 * `[{ key, label, level, ignored?, reason? }]`，`level` 为 `default` / `ambient` / `decision` / `agent` /
 * `adapter` / `endpoint` / `scene`。没有用途配置（个人身份看不到用途）时返回 null，表示「不知道」而不是「没人用」。
 * `effects` 是管理视图的 `purposeEffects`；旧实例没有它（也没有 `purposes.ambient`）时按原来的两项列出。
 */
export function profileUsages(purposes, profileId, locale = 'zh-CN', effects) {
  if (!purposes || typeof purposes !== 'object') return null
  const t = (text, values) => translate(locale, text, values)
  const rows = []
  const defaults = purposes.defaults ?? {}
  // ADR 0066: the merged judge replaces 默认旁听 and the decision 旁听参与判断.
  const merged = isRecord(purposes.ambient) || isRecord(effects?.ambient)
  const defaultLabels = { chat: t('默认聊天'), summary: t('默认摘要'), ambient: t('默认旁听'), image: t('默认图片生成') }
  for (const key of ['chat', 'summary', ...(merged ? [] : ['ambient']), 'image']) {
    if (defaults[key] === profileId) rows.push({ key: `default:${key}`, level: 'default', label: defaultLabels[key] })
    else if (defaults[`${key}Fallbacks`]?.includes(profileId))
      rows.push({ key: `default:${key}-fallback`, level: 'default', label: t('{0}（备选）', [defaultLabels[key]]) })
  }
  if (defaults.perception?.profile === profileId) rows.push({ key: 'default:perception', level: 'default', label: t('默认识图') })
  else if (defaults.perception?.fallbacks?.includes(profileId)) rows.push({ key: 'default:perception-fallback', level: 'default', label: t('默认识图（备选）') })
  if (merged) rows.push(...ambientUsages(purposes, effects, profileId, t))
  const decisions = decisionLabels(t)
  for (const [task, policy] of Object.entries(purposes.decisions ?? {})) {
    if (policy?.profile !== profileId || (merged && task === 'ambient')) continue
    const name = Object.hasOwn(decisions, task) ? decisions[task] : task
    const effect = isRecord(effects?.[`decisions.${task}`]) ? effects[`decisions.${task}`] : null
    rows.push({ key: `decision:${task}`, level: 'decision', label: t('决策：{0}', [name]),
      ...(effect?.status === 'ignored' ? { ignored: true, reason: effect.reason ?? '' } : {}) })
  }
  for (const [agent, profile] of Object.entries(purposes.agents ?? {})) {
    if (profile === profileId) rows.push({ key: `agent:${agent}`, level: 'agent', label: t('Agent {0}', [agent]) })
    else if (purposes.agentFallbacks?.[agent]?.includes(profileId))
      rows.push({ key: `agent:${agent}:fallback`, level: 'agent', label: t('{0}（备选）', [t('Agent {0}', [agent])]) })
  }
  const scoped = (level, record, label) => {
    for (const [key, models] of Object.entries(record ?? {})) {
      for (const use of scopeUses(models, profileId)) {
        rows.push({ key: `${level}:${key}:${use}`, level, label: label(key, use === 'chat' ? t('聊天') : t('识图')) })
      }
    }
  }
  scoped('adapter', purposes.adapters, (key, use) => t('适配器 {0} 的{1}', [key, use]))
  scoped('endpoint', purposes.endpoints, (key, use) => t('账号 {0} 的{1}', [key, use]))
  for (const [key, models] of Object.entries(purposes.scenes ?? {})) {
    if (models?.chat === profileId || models?.chatFallbacks?.includes(profileId)) rows.push({ key: `scene:${key}`, level: 'scene', label: t('会话 {0} 的聊天', [key]) })
  }
  return rows
}

/**
 * The badge of the default chat model (#64 `current-chat-badge-default-only`): 「当前聊天模型」 only when
 * no adapter, account or conversation chats through another model; otherwise 「默认聊天模型 · N 处改用其他模型」
 * with the overrides in `title`. `null` for any other model, or without purposes.
 */
export function chatModelBadge(purposes, profileId, locale = 'zh-CN') {
  if (!isRecord(purposes) || purposes.defaults?.chat !== profileId) return null
  const t = (text, values) => translate(locale, text, values)
  const overrides = []
  const scopes = [['adapters', key => t('适配器 {0}', [key])], ['endpoints', key => t('账号 {0}', [key])], ['scenes', key => t('会话 {0}', [key])]]
  for (const [field, label] of scopes) {
    for (const [key, models] of Object.entries(isRecord(purposes[field]) ? purposes[field] : {})) {
      if (typeof models?.chat === 'string' && models.chat && models.chat !== profileId) overrides.push(label(key))
    }
  }
  if (!overrides.length) return { label: t('当前聊天模型'), title: null, overrides }
  return {
    label: t('默认聊天模型 · {0} 处改用其他模型', [overrides.length]),
    title: t('这些地方的聊天改用了其他模型：{0}', [overrides.join(t('、'))]),
    overrides,
  }
}

/**
 * Where a 「谁在用」 usage is set on the 用途 tab (#64 `profile-usage-not-linked`), as the `?purpose=`
 * value: `defaults` / `ambient` / `decisions` / `agents`, or `<level>:<key>` for an adapter, account or
 * conversation override. Undefined for a key this Console does not know.
 */
export function usagePurposeFocus(key) {
  if (typeof key !== 'string') return undefined
  const scoped = /^(adapter|endpoint):(.+):(?:chat|perception)$/u.exec(key)
  if (scoped) return `${scoped[1]}s:${scoped[2]}`
  if (key.startsWith('scene:') && key.length > 'scene:'.length) return `scenes:${key.slice('scene:'.length)}`
  const section = { default: 'defaults', ambient: 'ambient', decision: 'decisions', agent: 'agents' }[key.split(':')[0]]
  return section
}

/** DOM id of a section (or an override row) on the 用途 tab, so a `?purpose=` link can bring it into view. */
export function purposeElementId(focus) {
  if (focus?.section === 'scopes' && focus.level && focus.key) return `inference-purpose-${focus.level}-${encodeURIComponent(focus.key)}`
  return `inference-purpose-${focus?.section ?? ''}`
}

/** A profile label written for an Agent binding, e.g. 「子 Agent · 小编 planner · DeepSeek Flash」. */
const AGENT_LABEL = /^(?:主|子)?\s*Agent\s*[·:：|/-]|^sub-?agent\b/iu

/**
 * Which group a profile is listed under in the purpose pickers (zhinjs/zhin#1250 `ai-purposes-select`):
 * a profile only Agents use (by its purposes or by an Agent-binding label) goes to 「Agent 绑定」,
 * every other one under its service. `{ key, label, agent }`.
 */
export function profileChoiceGroup(view, profile, locale = 'zh-CN') {
  const usages = profileUsages(view?.purposes, profile.id, locale)
  const agentOnly = usages !== null && usages.length > 0 && usages.every(usage => usage.level === 'agent')
  if (agentOnly || AGENT_LABEL.test(profile.label ?? '')) return { key: 'agent', label: translate(locale, 'Agent 绑定'), agent: true }
  const account = view?.accounts?.[profile.accountId]
  const service = account ? view?.services?.[account.serviceId] : undefined
  const driver = service ? serviceDriver(view, service.id) : undefined
  const label = service?.label || (driver ? driverLabel(driver, view.drivers ?? []) : '') || service?.id || account?.label || profile.accountId
  return { key: `service:${service?.id ?? profile.accountId}`, label, agent: false }
}

/**
 * The profiles a purpose picker offers for `kind`, as searchable grouped options: `{ value, label, group,
 * description, keywords, profile, support }`, services first and the 「Agent 绑定」 group last; the
 * order inside a group is the view's own order.
 */
export function purposeProfileChoices(view, kind, locale = 'zh-CN') {
  const rows = []
  for (const profile of Object.values(view?.profiles ?? {})) {
    const account = view.accounts?.[profile.accountId]
    const service = account ? view.services?.[account.serviceId] : undefined
    if (!service?.models?.[profile.model]?.kinds?.includes(kind)) continue
    const group = profileChoiceGroup(view, profile, locale)
    const name = profile.label ?? profile.model
    rows.push({
      value: profile.id,
      group: group.label,
      agent: group.agent,
      description: [profile.model !== name ? profile.model : '', account?.label ?? ''].filter(Boolean).join(' · '),
      keywords: [name, profile.model, account?.label ?? '', service?.label ?? '', group.label].join(' '),
      profile,
    })
  }
  return [...rows.filter(row => !row.agent), ...rows.filter(row => row.agent)]
}

/**
 * Whether this Console caller may type a Host environment reference (`env://NAME`, `${NAME}`).
 * Hosts before #1250 send no `environmentReferences`: keep their Host-administrator rule.
 */
export function canReferenceEnvironment(view) {
  if (view.environmentReferences !== undefined)
    return view.environmentReferences === 'console-owner' || view.environmentReferences === 'local-cli'
  return view.hostAdministrator
}
/**
 * Whether the Host has 测试连接 (`POST /account/test`, zhinjs/zhin#1250). Those Hosts always send
 * `environmentReferences` in the view (`'none'` included); older ones have neither.
 */
export function supportsConnectionTest(view) {
  return typeof view?.environmentReferences === 'string'
}
/** The message for a failed 测试连接: a missing route means an older Host, not a missing Agent. */
export function connectionTestError(error, locale = 'zh-CN') {
  if (error instanceof InferenceRequestError && error.code === 'not-installed')
    return translate(locale, 'Host 版本较旧，暂不支持测试连接')
  return inferenceError(error, locale)
}
/** The `env://NAME` variable of an account, if it reads one. */
export function accountEnvironmentVariable(account) {
  return /^env:\/\/([A-Za-z_][A-Za-z0-9_]*)$/u.exec(account?.authentication?.source ?? '')?.[1]
}
const CALL_OUTCOME_TEXT = {
  ok: (locale) => translate(locale, '成功'),
  auth: (locale) => translate(locale, '鉴权失败'),
  'rate-limit': (locale) => translate(locale, '限流'),
  server: (locale) => translate(locale, '服务异常'),
  rejected: (locale) => translate(locale, '请求被拒绝'),
  timeout: (locale) => translate(locale, '超时'),
  network: (locale) => translate(locale, '网络错误'),
}
const PROBE_KIND_TEXT = {
  auth: (locale) => translate(locale, '鉴权失败'),
  rate_limit: (locale) => translate(locale, '限流'),
  quota_exhausted: (locale) => translate(locale, '额度用完'),
  billing: (locale) => translate(locale, '余额不足'),
  server: (locale) => translate(locale, '服务异常'),
  timeout: (locale) => translate(locale, '超时'),
  no_response: (locale) => translate(locale, '无响应'),
  network: (locale) => translate(locale, '网络错误'),
  bad_request: (locale) => translate(locale, '请求被拒绝（可能不支持工具调用）'),
  credential: (locale) => translate(locale, '凭据不可用'),
  'profile-not-found': (locale) => translate(locale, '模型配置不存在'),
  unavailable: (locale) => translate(locale, '模型配置不可用'),
}
function clock(at, locale) {
  try {
    return new Date(at).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN', { hour12: false })
  } catch {
    return ''
  }
}
/** "最近调用：鉴权失败（HTTP 401）· time" — outcome class, status and time only. */
export function describeLastCall(lastCall, locale = 'zh-CN') {
  if (!lastCall) return ''
  const outcome = CALL_OUTCOME_TEXT[lastCall.outcome]?.(locale) ?? translate(locale, '失败')
  const status = lastCall.status && lastCall.outcome !== 'ok' ? ` (HTTP ${lastCall.status})` : ''
  return `${translate(locale, '最近调用：')}${outcome}${status} · ${clock(lastCall.at, locale)}`
}
/** One line for a connectivity probe result. */
export function describeProbe(result, locale = 'zh-CN') {
  if (result.status === 'ok') return translate(locale, '连接正常（{0} ms）', [String(result.durationMs)])
  const kind = PROBE_KIND_TEXT[result.kind]?.(locale) ?? translate(locale, '失败')
  const status = result.httpStatus ? ` HTTP ${result.httpStatus}` : ''
  return translate(locale, '连接失败：{0}', [`${kind}${status}`])
}
/** Language Profiles a purposes draft binds that its baseline did not (probed before saving). */
export function newlyBoundLanguageProfiles(draft, original) {
  const collect = (purposes) => {
    const ids = new Set()
    const add = (id) => {
      if (typeof id === 'string' && id) ids.add(id)
    }
    const chain = (ids) => {
      for (const id of Array.isArray(ids) ? ids : []) add(id)
    }
    const scope = (value) => {
      add(value?.chat)
      chain(value?.chatFallbacks)
      add(value?.perception?.profile)
      chain(value?.perception?.fallbacks)
    }
    scope(purposes?.defaults)
    add(purposes?.defaults?.summary)
    chain(purposes?.defaults?.summaryFallbacks)
    add(purposes?.defaults?.ambient)
    chain(purposes?.defaults?.ambientFallbacks)
    for (const value of Object.values(purposes?.adapters ?? {})) scope(value)
    for (const value of Object.values(purposes?.endpoints ?? {})) scope(value)
    for (const value of Object.values(purposes?.scenes ?? {})) { add(value?.chat); chain(value?.chatFallbacks) }
    for (const id of Object.values(purposes?.agents ?? {})) add(id)
    for (const ids of Object.values(purposes?.agentFallbacks ?? {})) chain(ids)
    return ids
  }
  const before = collect(original)
  return [...collect(draft)].filter((id) => !before.has(id))
}

/**
 * When a purpose switches to its fallback models (zhinjs/zhin `docs/ai/model-policy.md` 备用模型), in
 * the interface language. The rules live in the Host (`packages/im/ai/src/llm/model-fallback.ts`).
 */
export function fallbackDocUrl(locale = 'zh-CN') {
  return locale === 'en' ? 'https://zhin.js.org/en/ai/model-policy#fallback-models' : 'https://zhin.js.org/ai/model-policy#%E5%A4%87%E7%94%A8%E6%A8%A1%E5%9E%8Bfallbacks'
}
