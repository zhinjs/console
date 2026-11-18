import { translate } from '../../i18n/locale.mjs'
import { applyInferenceChange, inferenceRequest, InferenceRequestError, purposeProfileChoices, resourceBindings } from './model.mjs'

/**
 * 插话判断（zhinjs/zhin ADR 0066）的纯逻辑：原来的用途「旁听」和决策「旁听参与判断」合成一项
 * `purposes.ambient`，一个模型选择（语言模型和决策模型都可以选）、一条可以混排两类模型的备用链、
 * 可选的对照模型、一个门槛和「只观察」开关。
 *
 * 兼容旧实例：实例不返回 `purposes.ambient`、`purposeEffects.ambient`，也没有
 * `GET /agent/inference/ambient-judge` 时，页面退回原来的两项（`defaults.ambient` + `decisions.ambient`）。
 */

/** The six keys of `purposes.ambient` (ADR 0066 D1); the Host refuses any other key. */
export const AMBIENT_JUDGE_KEYS = Object.freeze(['profile', 'fallbacks', 'compare', 'minConfidence', 'mode', 'timeoutMs'])
/** The one threshold when none is set (D4). */
export const DEFAULT_AMBIENT_MIN_CONFIDENCE = 0.7
/** One decision-model evaluation when `timeoutMs` is unset (D2). */
export const DEFAULT_AMBIENT_JUDGE_TIMEOUT_MS = 3000
const MAX_TIMEOUT_MS = 2_147_483_647
/** The migration record id of ADR 0066. */
export const AMBIENT_JUDGE_MIGRATION_ID = 'adr-0066-ambient-judge'
/** Decision purposes after ADR 0066 (`ambient` left them). */
export const DECISION_TASKS = Object.freeze(['skills', 'tools', 'memory', 'agents', 'approval'])
/** The revert command of D5.5, printed as is (never translated). */
export const AMBIENT_JUDGE_REVERT_COMMAND = 'zhin ai purposes revert ambient-judge'

const KINDS = ['language', 'decision']
const SOURCES = ['stored', 'legacy', 'default']
const ROLES = ['primary', 'fallback', 'compare']

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isCount = value => typeof value === 'number' && Number.isFinite(value) && value >= 0
const isId = value => typeof value === 'string' && value.length > 0 && value === value.trim()

/** The upgrade note (zhin.js.org) for the interjection judge, in the interface language. */
export function ambientJudgeDocUrl(locale = 'zh-CN') {
  return locale === 'en' ? 'https://zhin.js.org/en/migrations/ambient-judge' : 'https://zhin.js.org/migrations/ambient-judge'
}

/**
 * `GET /agent/inference/ambient-judge` (ADR 0066), checked: `{ policy, source, chain, inheritedFrom?, migration? }`,
 * or null when the body is not that shape (it is then not used, never guessed).
 */
export function readAmbientJudgeView(data) {
  if (!isRecord(data) || !isRecord(data.policy) || !SOURCES.includes(data.source) || !Array.isArray(data.chain)) return null
  if (!data.chain.every(member => isRecord(member) && isId(member.profile) && (member.kind === undefined || KINDS.includes(member.kind)))) return null
  const migration = isRecord(data.migration) && data.migration.id === AMBIENT_JUDGE_MIGRATION_ID
    && ['migrated', 'failed', 'reverted'].includes(data.migration.status) && isCount(data.migration.at) ? data.migration : undefined
  return {
    policy: data.policy,
    source: data.source,
    chain: data.chain.map(member => ({ profile: member.profile, ...(member.kind ? { kind: member.kind } : {}) })),
    ...(data.inheritedFrom === 'chat' ? { inheritedFrom: 'chat' } : {}),
    ...(migration ? { migration } : {}),
  }
}

/** A refusal that means the Host has no such route (an instance before ADR 0066). */
export function isMissingRoute(error) {
  return error instanceof InferenceRequestError && (error.code === 'not-installed' || error.code === 'not-found' || error.status === 404)
}

/**
 * Whether the instance has the merged interjection judge: `merged` (ADR 0066), `legacy` (an older
 * instance: the route is missing and nothing in the view has the new shape) or `unknown`.
 */
export function ambientJudgeSupport({ view, judge, judgeError } = {}) {
  if (judge || view?.purposes?.ambient !== undefined || isRecord(view?.purposeEffects?.ambient)) return 'merged'
  if (judgeError && isMissingRoute(judgeError)) return 'legacy'
  return 'unknown'
}

/** The stored policy as the editor holds it: text fields for the number inputs. */
export function ambientJudgeDraft(policy) {
  const value = isRecord(policy) ? policy : {}
  return {
    profile: isId(value.profile) ? value.profile : '',
    fallbacks: Array.isArray(value.fallbacks) ? value.fallbacks.filter(isId) : [],
    compare: isId(value.compare) ? value.compare : '',
    minConfidence: typeof value.minConfidence === 'number' ? String(value.minConfidence) : '',
    mode: value.mode === 'shadow' ? 'shadow' : 'active',
    timeoutMs: typeof value.timeoutMs === 'number' ? String(value.timeoutMs) : '',
  }
}

/** The Profile kind the judge uses for `id` (language first, like the Host), or undefined. */
export function ambientJudgeKind(view, id) {
  const profile = view?.profiles?.[id]
  const account = profile ? view.accounts?.[profile.accountId] : undefined
  const kinds = account ? view.services?.[account.serviceId]?.models?.[profile.model]?.kinds ?? [] : []
  return kinds.includes('language') ? 'language' : kinds.includes('decision') ? 'decision' : undefined
}

/**
 * The policy a draft writes: only the keys that are set. A threshold or timeout that is not a valid
 * number is kept as written, so validation reports it instead of silently dropping it.
 */
export function ambientJudgePolicyFromDraft(draft) {
  const number = text => text.trim() === '' ? undefined : Number(text.trim())
  const minConfidence = number(draft.minConfidence ?? '')
  const timeoutMs = number(draft.timeoutMs ?? '')
  const fallbacks = draft.profile ? draft.fallbacks.filter(Boolean) : []
  return {
    ...(draft.profile ? { profile: draft.profile } : {}),
    ...(fallbacks.length ? { fallbacks: [...fallbacks] } : {}),
    ...(draft.compare ? { compare: draft.compare } : {}),
    ...(minConfidence !== undefined ? { minConfidence } : {}),
    // The draft always holds a mode; whether it is written is decided by ambientJudgePlanEntry.
    mode: draft.mode === 'shadow' ? 'shadow' : 'active',
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  }
}

const fieldLabels = t => ({
  profile: t('插话判断模型'),
  fallbacks: t('备用链'),
  compare: t('对照模型'),
  minConfidence: t('门槛'),
  mode: t('只观察'),
  timeoutMs: t('决策模型超时'),
})

/** Display name of one `purposes.ambient` field. */
export function ambientJudgeFieldLabel(field, locale = 'zh-CN') {
  const labels = fieldLabels(message => translate(locale, message))
  return Object.hasOwn(labels, field) ? labels[field] : field
}

/**
 * The same checks the Host makes (`normalizeAmbientJudgePolicy`, ADR 0066 D1.6), so a bad value is
 * reported next to the field before anything is sent. `[{ field, message }]`; empty means valid.
 */
export function validateAmbientJudgeDraft(draft, view, locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  const problems = []
  const policy = ambientJudgePolicyFromDraft(draft)
  const usable = id => KINDS.includes(ambientJudgeKind(view, id))
  if (policy.profile && !usable(policy.profile)) problems.push({ field: 'profile', message: t('插话判断只能选语言模型或决策模型。') })
  if (draft.fallbacks.filter(Boolean).length && !policy.profile) problems.push({ field: 'fallbacks', message: t('先选插话判断模型，才能设置备用链；跟随聊天时用的是聊天的备用链。') })
  const seen = new Set(policy.profile ? [policy.profile] : [])
  for (const [index, id] of (policy.fallbacks ?? []).entries()) {
    if (seen.has(id)) problems.push({ field: 'fallbacks', message: t('第 {0} 个备用和前面的模型重复。', [index + 1]) })
    else if (!usable(id)) problems.push({ field: 'fallbacks', message: t('第 {0} 个备用不是语言模型或决策模型。', [index + 1]) })
    seen.add(id)
  }
  if (policy.compare) {
    if (seen.has(policy.compare)) problems.push({ field: 'compare', message: t('对照模型不能同时在判断链里。') })
    else if (!usable(policy.compare)) problems.push({ field: 'compare', message: t('对照模型只能选语言模型或决策模型。') })
  }
  if (policy.minConfidence !== undefined && !(Number.isFinite(policy.minConfidence) && policy.minConfidence >= 0 && policy.minConfidence <= 1))
    problems.push({ field: 'minConfidence', message: t('门槛要在 0 到 1 之间，例如 0.7。') })
  if (policy.timeoutMs !== undefined && !(Number.isSafeInteger(policy.timeoutMs) && policy.timeoutMs >= 1 && policy.timeoutMs <= MAX_TIMEOUT_MS))
    problems.push({ field: 'timeoutMs', message: t('超时要填正整数毫秒，例如 3000。') })
  return problems
}

/**
 * Advisory notes that do not block saving: a threshold below 0.5 with a decision model in the chain
 * (a decision model that picks 「插话」 already has P ≥ 0.5, D4.2).
 */
export function ambientJudgeHints(draft, view, chatChain = [], locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  const policy = ambientJudgePolicyFromDraft(draft)
  const chain = policy.profile ? [policy.profile, ...(policy.fallbacks ?? [])] : chatChain
  const hints = []
  if (policy.minConfidence !== undefined && policy.minConfidence < 0.5 && chain.some(id => ambientJudgeKind(view, id) === 'decision'))
    hints.push(t('决策模型选「插话」时把握本来就不低于 0.5，门槛低于 0.5 对它等于没设。'))
  return hints
}

const stable = value => JSON.stringify(Object.fromEntries(Object.entries(value ?? {}).sort(([a], [b]) => a.localeCompare(b))))

/** Whether two policies are the same (key order and an omitted empty chain do not matter). */
export function sameAmbientJudgePolicy(a, b) {
  return stable(a) === stable(b)
}

/**
 * The `purposes.ambient` entry of a plan: undefined when the draft equals what was read (nothing is
 * written), otherwise the whole policy (the object form replaces the item, D1.3).
 *
 * `mode` is written only when the person changed 「只观察」, or when the stored policy already holds
 * it (`source: 'stored'`). Otherwise it is left out, so a Host that has not migrated yet fills it from
 * the yml key it still honours (`triggerDefaults`) instead of a guess written by the Console.
 */
export function ambientJudgePlanEntry(draft, original, { source = 'stored' } = {}) {
  const next = ambientJudgePolicyFromDraft(draft)
  const before = ambientJudgePolicyFromDraft(ambientJudgeDraft(original))
  if (stable(next) === stable(before)) return undefined
  const modeChanged = next.mode !== before.mode
  const keepMode = modeChanged || (source === 'stored' && isRecord(original) && original.mode !== undefined)
  const { mode, ...rest } = next
  return keepMode ? { ...rest, mode } : rest
}

/**
 * The pickers' options: language and decision Profiles together, grouped by kind then service
 * (`{ value, label, group, kind, description, keywords, profile }`). A Profile that is both kinds is
 * listed once, as language (the kind the judge uses for it).
 */
export function ambientJudgeChoices(view, locale = 'zh-CN') {
  const t = message => translate(locale, message)
  const kindLabel = { language: t('语言模型'), decision: t('决策模型') }
  const seen = new Set()
  const rows = []
  for (const kind of KINDS) {
    for (const choice of purposeProfileChoices(view, kind, locale)) {
      if (seen.has(choice.value)) continue
      seen.add(choice.value)
      rows.push({ ...choice, kind, group: `${kindLabel[kind]} · ${choice.group}` })
    }
  }
  return rows
}

/** The kind label shown next to a member. */
export function ambientJudgeKindLabel(kind, locale = 'zh-CN') {
  if (kind === 'decision') return translate(locale, '决策模型')
  if (kind === 'language') return translate(locale, '语言模型')
  return translate(locale, '类型未知')
}

/** Profile display name from the view, else the id. */
export function profileName(view, id) {
  const profile = view?.profiles?.[id]
  return profile?.label ?? profile?.model ?? id
}

const noteText = (t, note, name = id => id) => {
  const raw = note?.value === undefined ? '' : String(note.value)
  // Profile notes name the model as the Host lists it; numbers stay as they are.
  const value = ['language-judge-became-fallback', 'off-profile-not-migrated'].includes(note?.code) && raw ? name(raw) : raw
  switch (note?.code) {
    case 'language-judge-became-fallback': return t('原来的旁听模型 {0} 现在是第一个备用：决策模型失败时由它接手判断。', [value])
    case 'inherited-chat-not-added': return t('原来的旁听跟随聊天，聊天模型没有自动加成备用；需要时在插话判断里自己添加。')
    case 'threshold-max': return t('门槛取两道旧门槛中较大的值 {0}，迁移后不会多插话。', [value])
    case 'shadow-threshold-dropped': return t('原「仅评估」的门槛 {0} 只影响陪跑记录，迁移时丢弃。', [value])
    case 'off-profile-not-migrated': return t('已关闭的决策模型 {0} 本来就不被调用，没有迁移（模型配置保留）。', [value])
    default: return null
  }
}

/**
 * The one-time banner of ADR 0066 P3 #5: shown while the record says `migrated` and nobody has seen
 * it (`noticedAt` empty). `{ at, rows: [{ key, field, value, from }], notes: string[] }` or null.
 */
export function ambientMigrationNotice(judge, view, locale = 'zh-CN') {
  const migration = judge?.migration
  if (!migration || migration.status !== 'migrated' || migration.noticedAt !== undefined) return null
  const t = (message, values) => translate(locale, message, values)
  const name = id => profileName(view, id)
  const rows = (Array.isArray(migration.rows) ? migration.rows : []).filter(row => isRecord(row) && typeof row.field === 'string').map((row, index) => ({
    key: `${index}:${row.field}`,
    field: ambientJudgeFieldLabel(row.field, locale),
    value: Array.isArray(row.value) ? row.value.map(name).join(' → ')
      : row.field === 'mode' ? (row.value === 'shadow' ? t('已开启') : t('未开启：判断通过就插话'))
        : ['profile', 'compare'].includes(row.field) ? name(String(row.value)) : String(row.value),
    from: typeof row.from === 'string' ? row.from : '',
  }))
  const notes = (Array.isArray(migration.notes) ? migration.notes : []).map(note => noteText(t, note, name)).filter(Boolean)
  return { at: migration.at, rows, notes }
}

/** A failed migration (the instance runs the in-memory conversion) as one line, or null. */
export function ambientMigrationFailure(judge, locale = 'zh-CN') {
  const migration = judge?.migration
  if (migration?.status !== 'failed') return null
  const t = (message, values) => translate(locale, message, values)
  const reasons = {
    'invalid-graph': t('迁移结果没有通过检查'),
    'not-visible': t('引用的模型配置已不属于 Host'),
    conflict: t('写入冲突重试 3 次仍失败'),
    'not-committed': t('写入没有提交'),
    unavailable: t('模型配置库暂时不可用'),
  }
  const reason = reasons[migration.failure?.reason] ?? t('原因未报告')
  const path = typeof migration.failure?.path === 'string' ? migration.failure.path : ''
  return path ? t('自动迁移没有成功（{0}，位置 {1}）：实例按旧配置换算后运行，行为不变；修好后下次加载会再试。', [reason, path])
    : t('自动迁移没有成功（{0}）：实例按旧配置换算后运行，行为不变；修好后下次加载会再试。', [reason])
}

/** `POST /agent/inference/ambient-judge/migration/noticed`: the banner was closed or confirmed. */
export async function noticeAmbientJudgeMigration(request) {
  return request('/ambient-judge/migration/noticed', {}, 'POST')
}

// ------------------------------------------------------------- ambient status (plugin.root.ambient)

function percent(part, whole) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0
}

/**
 * Agreement with the compared model (ADR 0066 D3, 24 hours): from `compare`; an instance without it
 * gives `decisionShadow` (the older 仅评估 record). Null when there is nothing to show.
 * `{ source, rate, total, agreed, primaryOnly, comparedOnly, failed, disagreed, text, detail, byMember }`.
 */
export function ambientAgreement(status, locale = 'zh-CN', names = id => id) {
  const t = (message, values) => translate(locale, message, values)
  const compare = isRecord(status?.compare) ? status.compare : null
  if (compare) {
    const total = compare.agreed + compare.primaryOnly + compare.comparedOnly
    if (total + compare.failed === 0) return null
    const memberLabel = member => member === 0 ? t('主判断') : t('第 {0} 个备用', [member])
    return {
      source: 'compare', rate: percent(compare.agreed, total), total,
      agreed: compare.agreed, primaryOnly: compare.primaryOnly, comparedOnly: compare.comparedOnly, failed: compare.failed,
      disagreed: compare.primaryOnly + compare.comparedOnly,
      text: total ? t('与对照模型一致 {0}%（共 {1} 次，最近 24 小时）', [percent(compare.agreed, total), total]) : t('对照模型最近 24 小时还没有给出结果'),
      detail: t('主判断插话、对照不插 {0} 次 · 主判断不插、对照插话 {1} 次 · 对照失败 {2} 次', [compare.primaryOnly, compare.comparedOnly, compare.failed]),
      byMember: (compare.byMember ?? []).map(row => {
        const count = row.agreed + row.primaryOnly + row.comparedOnly
        return { key: String(row.member), label: row.profile ? `${memberLabel(row.member)} · ${names(row.profile)}` : memberLabel(row.member),
          text: count ? t('一致 {0}%（{1} 次）', [percent(row.agreed, count), count]) : t('没有可比较的结果'), failed: row.failed }
      }),
    }
  }
  const shadow = isRecord(status?.decisionShadow) ? status.decisionShadow : null
  if (!shadow) return null
  const total = shadow.agreed + shadow.disagreed
  if (!total) return null
  return {
    source: 'decisionShadow', rate: percent(shadow.agreed, total), total, agreed: shadow.agreed, disagreed: shadow.disagreed,
    primaryOnly: null, comparedOnly: null, failed: null,
    text: t('与对照模型一致 {0}%（共 {1} 次，最近 24 小时）', [percent(shadow.agreed, total), total]),
    detail: t('不一致 {0} 次（实例版本较旧，分不出哪一边想插话）', [shadow.disagreed]),
    byMember: [],
  }
}

const SKIP_REASONS = t => ({
  quota_exhausted: t('额度用完'),
  billing: t('余额不足'),
  auth: t('密钥被拒'),
  timeout: t('连续超时'),
  network: t('网络错误'),
  server: t('服务异常'),
  context_overflow: t('上下文超长'),
})

/**
 * The chain card of the interjection page: `judgeChain` members in order with their role, kind and
 * skip period. `[{ key, role, label, kind, skipped }]`; empty for an older instance.
 */
export function ambientJudgeChainRows(status, locale = 'zh-CN', now = Date.now()) {
  const t = (message, values) => translate(locale, message, values)
  const chain = Array.isArray(status?.judgeChain) ? status.judgeChain : []
  let fallback = 0
  return chain.map((member, index) => {
    const role = member.role === 'fallback' ? t('第 {0} 个备用', [++fallback]) : member.role === 'compare' ? t('对照（只记录）') : t('主判断')
    const until = typeof member.skippedUntil === 'number' && member.skippedUntil > now ? member.skippedUntil : null
    const reason = until ? SKIP_REASONS(t)[member.skipReason] ?? t('暂时不可用') : ''
    return {
      key: `${index}:${member.profile}`,
      roleCode: member.role,
      role,
      label: member.label || member.profile,
      kind: ambientJudgeKindLabel(member.kind, locale),
      skipped: until ? t('暂时跳过：{0}，{1} 恢复', [reason, clock(until, locale)]) : '',
    }
  })
}

function clock(at, locale) {
  try { return new Date(at).toLocaleString(locale === 'en' ? 'en-US' : 'zh-CN', { hour12: false }) } catch { return '' }
}

function dayKey(at, timeZone) {
  // `en-CA` formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

/**
 * 「机器人状态」的插话判断用量（#1250 第 47 批）：最近 7 天每天的判断次数、失败、切到备用、token。
 * Null for an instance that does not report `judgeDaily` (nothing is shown then). Each row has
 * `known`: false means the instance may hold no record of that day (「无数据」), so it is not a 0.
 */
export function ambientJudgeDaily(status, locale = 'zh-CN', now = Date.now()) {
  if (!Array.isArray(status?.judgeDaily)) return null
  const byDay = new Map(status.judgeDaily.map(day => [day.day, day]))
  const timeZone = typeof status.judgeTimeZone === 'string' && status.judgeTimeZone ? status.judgeTimeZone : undefined
  const window = judgeDailyWindow(status, [...byDay.keys()].filter(key => DAY_KEY.test(key)).sort(), timeZone, now)
  const empty = { calls: 0, failed: 0, fallbacks: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, unreportedCalls: 0 }
  const rows = window.keys.map(key => byDay.has(key) ? { day: key, known: true, ...empty, ...byDay.get(key) } : { day: key, known: window.known(key), ...empty })
  const total = rows.reduce((sum, row) => ({
    calls: sum.calls + row.calls, failed: sum.failed + row.failed, fallbacks: sum.fallbacks + row.fallbacks,
    inputTokens: sum.inputTokens + row.inputTokens, outputTokens: sum.outputTokens + row.outputTokens, unreportedCalls: sum.unreportedCalls + row.unreportedCalls,
  }), { calls: 0, failed: 0, fallbacks: 0, inputTokens: 0, outputTokens: 0, unreportedCalls: 0 })
  return {
    timeZone: timeZone ?? '',
    rows: rows.map(row => ({ ...row, tokens: row.inputTokens + row.outputTokens, label: dayLabel(row.day, locale) })),
    total,
    unreported: total.unreportedCalls > 0,
  }
}

/**
 * The seven days shown and which empty days are a real 0 (console#152 re-review, low 1 and 2).
 *
 * - `judgeToday` (zhin batch 48): today on the instance clock in `judgeTimeZone`. The instance keeps
 *   `judgeToday` and the 6 days before it, which is exactly the window, so the browser clock is not
 *   read at all and every day without a row really had no calls.
 * - An older instance (no `judgeToday`): the window still follows today in the instance zone on the
 *   browser clock, but it is clamped to what the instance reported. It ends no earlier than the latest
 *   reported day (a browser behind the instance does not cut that day off; the start is then no earlier
 *   than 6 days before it) and no later than 6 days after the earliest reported day (a browser far
 *   ahead does not push the instance's real last days out; this is never more than 6 days after the
 *   latest one). Inside it, only days between the earliest and latest reported day are known: a later
 *   day may be the instance's today or not reached yet, and an earlier one may already be pruned (the
 *   instance's today is only known to be on or after the latest reported day), so both read 「无数据」.
 *   A zone this browser does not know: only the reported days.
 */
function judgeDailyWindow(status, reported, timeZone, now) {
  if (typeof status.judgeToday === 'string' && DAY_KEY.test(status.judgeToday)) return { keys: lastSevenDays(status.judgeToday), known: () => true }
  const first = reported[0]
  const last = reported.at(-1)
  let today
  try { today = dayKey(now, timeZone) } catch { return { keys: reported, known: () => true } }
  if (!last) return { keys: lastSevenDays(today), known: () => true }
  const latestEnd = [last, shiftDay(first, 6)].sort().at(-1)
  const end = today < last ? last : today > latestEnd ? latestEnd : today
  return { keys: lastSevenDays(end), known: key => key >= first && key <= last }
}

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/u

/** `YYYY-MM-DD` moved by `days` calendar days (date arithmetic in UTC, no zone). */
function shiftDay(day, days) {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date + days)).toISOString().slice(0, 10)
}

/** `YYYY-MM-DD` and the six calendar days before it, oldest first. */
function lastSevenDays(last) {
  return Array.from({ length: 7 }, (_, index) => shiftDay(last, index - 6))
}

function dayLabel(day, locale) {
  const [year, month, date] = day.split('-').map(Number)
  if (!year || !month || !date) return day
  try { return new Date(Date.UTC(year, month - 1, date)).toLocaleDateString(locale === 'en' ? 'en-US' : 'zh-CN', { timeZone: 'UTC', month: 'short', day: 'numeric', weekday: 'short' }) } catch { return day }
}

// ------------------------------------------------------------- writing purposes.ambient from another page

/**
 * Changes only 「只观察」 (`purposes.ambient.mode`) from another page (the 群聊插话 page), through the
 * same prepare / apply the 用途 page uses (Host owner → view for the Profile bindings → `/plan` →
 * `/apply`). The judge is read again right before writing and the new mode is applied to that
 * latest policy; when it differs from `expected` (what the page showed) nothing is written and
 * `status: 'stale'` asks the person to reload instead of silently overwriting someone else's change.
 * `{ status: 'committed' | 'conflict' | 'not-committed' | 'commit-unknown' | 'stale', code?, warnings, policy? }`.
 */
export async function writeAmbientJudgeMode(fetch, mode, { expected, mutationId = globalThis.crypto?.randomUUID?.() } = {}) {
  const latest = readAmbientJudgeView(await inferenceRequest(fetch, { path: '/ambient-judge' }))
  if (!latest) throw new InferenceRequestError('unavailable')
  if (expected !== undefined && !sameAmbientJudgePolicy(latest.policy, expected)) return { status: 'stale', warnings: [], policy: latest.policy }
  const owners = await inferenceRequest(fetch, { path: '/owners' })
  const owner = Array.isArray(owners) ? owners.find(entry => entry?.kind === 'host') : undefined
  if (!owner) throw new InferenceRequestError('forbidden', 403)
  const view = await inferenceRequest(fetch, { ownerId: owner.id })
  const policy = { ...latest.policy, ...(Array.isArray(latest.policy.fallbacks) ? { fallbacks: [...latest.policy.fallbacks] } : {}), mode }
  const prepared = await inferenceRequest(fetch, {
    ownerId: owner.id, path: '/plan',
    body: { plan: { version: 1, purposes: { ambient: policy } }, bindings: resourceBindings(view) },
  })
  if (prepared?.baseRevision !== view.revision) throw new InferenceRequestError('revision-conflict', 409)
  if (!mutationId) throw new InferenceRequestError('receipt-storage-unavailable')
  const result = await applyInferenceChange(fetch, { ownerId: owner.id, prepared: prepared.prepared, mutationId })
  return { ...result, warnings: Array.isArray(prepared.warnings) ? prepared.warnings : [] }
}

/** The judge mode in effect, read back after a write (`undefined` when it cannot be read). */
export async function readAmbientJudgeMode(fetch) {
  try {
    const judge = readAmbientJudgeView(await inferenceRequest(fetch, { path: '/ambient-judge' }))
    return judge ? (judge.policy.mode === 'shadow' ? 'shadow' : 'active') : undefined
  } catch {
    return undefined
  }
}

/**
 * A plan warning (ADR 0066 D5.6) in the interface language. The Host sends English text; the codes it
 * documents are translated, anything else is shown as sent.
 */
export function planWarningText(warning, locale = 'zh-CN') {
  if (!isRecord(warning)) return ''
  if (warning.code === 'deprecated-decisions-ambient')
    return translate(locale, '{0} 已废弃：已按旧写法换算成插话判断（purposes.ambient）。以后请直接写 purposes.ambient。', [String(warning.path ?? 'purposes.decisions.ambient')])
  return typeof warning.message === 'string' ? warning.message : String(warning.code ?? '')
}
