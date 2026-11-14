import { translate } from '../../i18n/locale.mjs'
const base = '/api/agent/inference'
export class InferenceRequestError extends Error {
  constructor(code, status = 503, mutationOutcome, reason) {
    super(code)
    this.code = code
    this.status = status
    this.mutationOutcome = mutationOutcome
    if (reason) this.reason = reason
  }
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
      typeof result.reason === 'string' && Object.hasOwn(REFUSAL_TEXT, result.reason) ? result.reason : undefined
    )
  return result.data
}
export function inferenceError(error, locale = 'zh-CN') {
  const code = error instanceof InferenceRequestError ? error.code : 'unavailable'
  if (error instanceof InferenceRequestError && error.reason) return REFUSAL_TEXT[error.reason](locale)
  if (code === 'forbidden') return translate(locale, '当前身份无权执行此操作。')
  if (code === 'plan-conflict') return translate(locale, '连接或模型身份发生变化，请新增账号或模型并明确重新绑定。')
  if (['conflict', 'stale-reference', 'revision-conflict'].includes(code))
    return translate(locale, '配置已变化，请重新读取；已有草稿需重新打开编辑后再保存。')
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
export function purposePlan(draft, original = draft) {
  const ref = (id) => (id ? { profile: id } : null)
  const selection = (value) => ({ chat: ref(value?.chat), perception: value?.perception ?? null })
  const map = (current, before, convert) =>
    Object.fromEntries(
      [...new Set([...Object.keys(before ?? {}), ...Object.keys(current ?? {})])].map((key) => [
        key,
        Object.hasOwn(current ?? {}, key) ? convert(current[key]) : null,
      ])
    )
  return {
    chat: ref(draft.defaults.chat),
    summary: ref(draft.defaults.summary),
    ambient: ref(draft.defaults.ambient),
    image: ref(draft.defaults.image),
    perception: draft.defaults.perception ?? null,
    decisions: map(draft.decisions, original.decisions, (value) => value),
    agents: map(draft.agents, original.agents, ref),
    adapters: map(draft.adapters, original.adapters, selection),
    endpoints: map(draft.endpoints, original.endpoints, selection),
    scenes: map(draft.scenes, original.scenes, (value) => ({ chat: ref(value.chat) })),
  }
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
 * 「谁在用」：一个模型（Profile）被哪些用途引用。只读现有的用途配置（`view.purposes`），
 * 不推测运行时实际调用。纯函数。
 */

const decisionLabels = t => ({
  skills: t('技能选择'),
  tools: t('工具选择'),
  memory: t('记忆选择'),
  agents: t('Agent 选择'),
  approval: t('工具审批建议'),
  ambient: t('旁听参与判断'),
})

function scopeUses(models, profileId) {
  const uses = []
  if (models?.chat === profileId) uses.push('chat')
  if (models?.perception?.profile === profileId || models?.perception?.fallbacks?.includes(profileId)) uses.push('perception')
  return uses
}

/**
 * `[{ key, label, level }]`，`level` 为 `default` / `decision` / `agent` / `adapter` / `endpoint` / `scene`。
 * 没有用途配置（个人身份看不到用途）时返回 null，表示「不知道」而不是「没人用」。
 */
export function profileUsages(purposes, profileId, locale = 'zh-CN') {
  if (!purposes || typeof purposes !== 'object') return null
  const t = (text, values) => translate(locale, text, values)
  const rows = []
  const defaults = purposes.defaults ?? {}
  const defaultLabels = { chat: t('默认聊天'), summary: t('默认摘要'), ambient: t('默认旁听'), image: t('默认图片生成') }
  for (const key of ['chat', 'summary', 'ambient', 'image']) {
    if (defaults[key] === profileId) rows.push({ key: `default:${key}`, level: 'default', label: defaultLabels[key] })
  }
  if (defaults.perception?.profile === profileId) rows.push({ key: 'default:perception', level: 'default', label: t('默认识图') })
  else if (defaults.perception?.fallbacks?.includes(profileId)) rows.push({ key: 'default:perception-fallback', level: 'default', label: t('默认识图（备选）') })
  const decisions = decisionLabels(t)
  for (const [task, policy] of Object.entries(purposes.decisions ?? {})) {
    if (policy?.profile !== profileId) continue
    const name = Object.hasOwn(decisions, task) ? decisions[task] : task
    rows.push({ key: `decision:${task}`, level: 'decision', label: t('决策：{0}', [name]) })
  }
  for (const [agent, profile] of Object.entries(purposes.agents ?? {})) {
    if (profile === profileId) rows.push({ key: `agent:${agent}`, level: 'agent', label: t('Agent {0}', [agent]) })
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
    if (models?.chat === profileId) rows.push({ key: `scene:${key}`, level: 'scene', label: t('会话 {0} 的聊天', [key]) })
  }
  return rows
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
    const scope = (value) => {
      add(value?.chat)
      add(value?.perception?.profile)
      for (const id of value?.perception?.fallbacks ?? []) add(id)
    }
    scope(purposes?.defaults)
    add(purposes?.defaults?.summary)
    add(purposes?.defaults?.ambient)
    for (const value of Object.values(purposes?.adapters ?? {})) scope(value)
    for (const value of Object.values(purposes?.endpoints ?? {})) scope(value)
    for (const value of Object.values(purposes?.scenes ?? {})) add(value?.chat)
    for (const id of Object.values(purposes?.agents ?? {})) add(id)
    return ids
  }
  const before = collect(original)
  return [...collect(draft)].filter((id) => !before.has(id))
}
