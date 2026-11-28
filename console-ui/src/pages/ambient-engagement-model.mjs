import { translate } from '../i18n/locale.mjs'
import { configurationRuntimeStatus } from '../components/PluginConfigForm/config-live-status.mjs'
import { outcomeFromConfigSave, readBackMismatch } from '../components/apply-outcome-model.mjs'
import { statusFromError } from '../components/status-state-model.mjs'
/**
 * 群聊插话页（zhinjs/zhin#970）的纯逻辑：校验 Host 状态、把设置翻成大白话、生成 config:patch。
 * 页面面向普通用户，这里不输出判官、决策模型、置信度等内部细节。
 */

export const AMBIENT_STATUS_PERMISSION = 'ambient:read'
export const AMBIENT_CONFIG_PATH = Object.freeze(['ai', 'trigger', 'ambient'])
export const DEFAULT_MAX_PER_HOUR = 3
export const MAX_PER_HOUR_LIMIT = 60

const AMBIENT_MODES = ['off', 'shadow', 'active']
const AMBIENT_OUTCOMES = ['spoke', 'watched', 'stayed_quiet', 'skipped']
const GROUP_ID_PATTERN = /^[^:\s]+:[^\s]+$/

export const BEHAVIOR_CHOICES = Object.freeze([
  Object.freeze({ value: 'off', label: '关闭', hint: '机器人只在被 @ 或叫到时说话。' }),
  Object.freeze({ value: 'watch', label: '只观察', hint: '机器人会判断要不要接话并记下来，但不会真的在群里开口。适合先试一试。' }),
  Object.freeze({ value: 'join', label: '主动参与', hint: '没人叫它时，机器人觉得合适就会自己接话。' }),
])

const OUTCOME_LABELS = Object.freeze({
  spoke: '接了话',
  watched: '想接话（只观察，没开口）',
  stayed_quiet: '决定不接话',
  skipped: '这次没有判断',
})

const SKIP_REASON_LABELS = Object.freeze({
  cooldown: '刚插过话，先歇一会儿',
  hourly_cap: '这个小时插话次数已用完',
  judge_interval: '离上次判断太近',
  no_context: '群里消息太少',
  judge_failed: '这次判断没成功',
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** 校验 plugin.root.ambient 的返回；格式不对时抛错，不能被当成「没有数据」。 */
export function validateAmbientStatus(data, locale = 'zh-CN') {
  if (!isPlainObject(data)) throw new Error(translate(locale, "群聊插话状态格式不正确。"))
  if (typeof data.enabled !== 'boolean') throw new Error(translate(locale, "群聊插话状态格式不正确。"))
  if (!AMBIENT_MODES.includes(data.mode)) throw new Error(translate(locale, "群聊插话状态格式不正确。"))
  const groupsValid = data.groups === 'all' || isCount(data.groups)
  if (!groupsValid) throw new Error(translate(locale, "群聊插话状态格式不正确。"))
  const last24h = data.last24h
  if (!isPlainObject(last24h)) throw new Error(translate(locale, "群聊插话状态格式不正确。"))
  for (const outcome of AMBIENT_OUTCOMES) {
    if (!isCount(last24h[outcome])) throw new Error(translate(locale, "群聊插话状态格式不正确。"))
  }
  if (!Array.isArray(data.recent)) throw new Error(translate(locale, "群聊插话状态格式不正确。"))
  for (const entry of data.recent) {
    if (!isPlainObject(entry)) throw new Error(translate(locale, "群聊插话记录格式不正确。"))
    if (!isTimestamp(entry.at)) throw new Error(translate(locale, "群聊插话记录格式不正确。"))
    if (typeof entry.group !== 'string') throw new Error(translate(locale, "群聊插话记录格式不正确。"))
    if (!AMBIENT_OUTCOMES.includes(entry.outcome)) throw new Error(translate(locale, "群聊插话记录格式不正确。"))
  }
  const updatedAtValid = data.updatedAt === null || isTimestamp(data.updatedAt)
  if (!updatedAtValid) throw new Error(translate(locale, "群聊插话状态格式不正确。"))
  // Fields of newer instances (ADR 0066, #1250 batch 47): optional, but checked when present.
  if (!optionalAmbientFieldsValid(data)) throw new Error(translate(locale, "群聊插话状态格式不正确。"))
  return data
}

const JUDGE_KINDS = ['language', 'decision']
const JUDGE_ROLES = ['primary', 'fallback', 'compare']
const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/
const isText = value => typeof value === 'string'
/** `YYYY-MM-DD` naming a real calendar day (not 2026-02-30, not a two-digit year that Date.UTC maps to 19xx). */
function isRealDay(value) {
  if (!isText(value) || !DAY_PATTERN.test(value)) return false
  const [year, month, date] = value.split('-').map(Number)
  const parsed = new Date(Date.UTC(year, month - 1, date))
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

function compareCountsValid(value) {
  return isPlainObject(value) && ['agreed', 'primaryOnly', 'comparedOnly', 'failed'].every(key => isCount(value[key]))
}

function judgeMemberValid(member) {
  return isPlainObject(member) && isText(member.profile) && isText(member.label) && JUDGE_ROLES.includes(member.role)
    && (member.kind === undefined || JUDGE_KINDS.includes(member.kind))
    && (member.skippedUntil === undefined || isTimestamp(member.skippedUntil))
    && (member.skipReason === undefined || isText(member.skipReason))
}

function judgeDayValid(day) {
  return isPlainObject(day) && isRealDay(day.day)
    && ['calls', 'failed', 'fallbacks', 'averageMs', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'unreportedCalls'].every(key => isCount(day[key]))
    && isPlainObject(day.byKind) && isCount(day.byKind.language) && isCount(day.byKind.decision)
}

/**
 * `judges`, `decisionShadow` (older instances), and ADR 0066 / batch 47's `judgeChain`,
 * `minConfidence`, `compare`, `judgeDaily`, `judgeTimeZone`, and batch 48's `judgeToday`: each may be
 * absent, never malformed.
 */
function optionalAmbientFieldsValid(data) {
  if (data.judges !== undefined && !(Array.isArray(data.judges) && data.judges.every(isText))) return false
  if (data.decisionShadow !== undefined && !(isPlainObject(data.decisionShadow) && isCount(data.decisionShadow.agreed) && isCount(data.decisionShadow.disagreed))) return false
  if (data.judgeChain !== undefined && !(Array.isArray(data.judgeChain) && data.judgeChain.every(judgeMemberValid))) return false
  if (data.minConfidence !== undefined && !(typeof data.minConfidence === 'number' && data.minConfidence >= 0 && data.minConfidence <= 1)) return false
  if (data.compare !== undefined) {
    const compare = data.compare
    if (!compareCountsValid(compare) || !isCount(compare.windowMs)) return false
    if (!Array.isArray(compare.byMember) || !compare.byMember.every(row => compareCountsValid(row) && Number.isInteger(row.member) && row.member >= 0 && (row.profile === undefined || isText(row.profile)))) return false
    if (!Array.isArray(compare.comparedProfiles) || !compare.comparedProfiles.every(isText)) return false
  }
  if (data.judgeDaily !== undefined && !(Array.isArray(data.judgeDaily) && data.judgeDaily.every(judgeDayValid))) return false
  if (data.judgeTimeZone !== undefined && !isText(data.judgeTimeZone)) return false
  // zhin batch 48: today on the instance clock in `judgeTimeZone`, the end of the usage window.
  if (data.judgeToday !== undefined && !isRealDay(data.judgeToday)) return false
  return true
}

/** Whether the instance has the merged interjection judge (ADR 0066): it reports the chain as data. */
export function hasMergedJudge(status) {
  return Array.isArray(status?.judgeChain)
}

function describeCurrentBehavior(status, locale = 'zh-CN') {
  if (!status.enabled) return translate(locale, "关闭", undefined, "state")
  if (status.mode === 'shadow') return translate(locale, "只观察")
  if (status.mode === 'active') return translate(locale, "主动参与")
  return translate(locale, "关闭", undefined, "state")
}

function describeGroupScope(groups, locale = 'zh-CN') {
  if (groups === 'all') return translate(locale, "所有群")
  if (groups === 0) return translate(locale, "还没有选群")
  return translate(locale, "{0} 个群", [groups])
}

function describeRecentEntry(entry, locale = 'zh-CN') {
  const outcomeLabel = translate(locale, OUTCOME_LABELS[entry.outcome])
  const skipReasonLabel = entry.outcome === 'skipped' && entry.skipReason ? translate(locale, SKIP_REASON_LABELS[entry.skipReason]) : undefined
  return {
    at: entry.at,
    group: entry.group,
    outcome: entry.outcome,
    text: skipReasonLabel ? `${outcomeLabel}：${skipReasonLabel}` : outcomeLabel,
  }
}

/** 把 Host 状态翻成页面直接显示的大白话；不带判官、模型、置信度。 */
export function describeAmbientStatus(status, locale = 'zh-CN') {
  return {
    behavior: describeCurrentBehavior(status, locale),
    groupScope: describeGroupScope(status.groups, locale),
    counts: [
      { key: 'spoke', label: translate(locale, "接了话"), value: status.last24h.spoke },
      { key: 'watched', label: translate(locale, "想接话但没开口"), value: status.last24h.watched },
      { key: 'stayed_quiet', label: translate(locale, "决定不接话"), value: status.last24h.stayed_quiet },
      { key: 'skipped', label: translate(locale, "没有判断"), value: status.last24h.skipped },
    ],
    recent: status.recent.map(entry => describeRecentEntry(entry, locale)),
    hasActivity: status.recent.length > 0,
    updatedAt: status.updatedAt,
  }
}

function readStoredAmbient(configDocument) {
  if (!isPlainObject(configDocument)) return {}
  const ai = configDocument.ai
  if (!isPlainObject(ai)) return {}
  const trigger = ai.trigger
  if (!isPlainObject(trigger)) return {}
  const ambient = trigger.ambient
  if (!isPlainObject(ambient)) return {}
  return ambient
}

function readConversationList(ambient) {
  if (!Array.isArray(ambient.conversations)) return []
  return ambient.conversations.filter((conversation) => typeof conversation === 'string' && conversation.trim() !== '')
}

/**
 * 从已解析的配置文件里读出页面表单的初始值。`judgeMode`（ADR 0066 的实例）是插话判断的模式
 * `purposes.ambient.mode`：有它时「只观察 / 主动参与」读它，不再读已废弃的 `ai.trigger.ambient.mode`。
 */
export function readAmbientSettings(configDocument, { judgeMode } = {}) {
  const ambient = readStoredAmbient(configDocument)
  const conversations = readConversationList(ambient)
  const coversEveryGroup = conversations.includes('*')
  const specificGroups = conversations.filter((conversation) => conversation !== '*')
  let behavior = 'join'
  const mode = judgeMode === 'shadow' || judgeMode === 'active' ? judgeMode : ambient.mode
  if (conversations.length === 0) behavior = 'off'
  else if (mode === 'shadow') behavior = 'watch'
  const storedMaxPerHour = ambient.maxPerHour
  const maxPerHour = isCount(storedMaxPerHour) ? storedMaxPerHour : DEFAULT_MAX_PER_HOUR
  return {
    behavior,
    groupScope: coversEveryGroup ? 'all' : 'some',
    groups: specificGroups,
    maxPerHour,
  }
}

/** 把多行文本拆成群列表（每行一个，去掉空行和重复）。 */
export function parseGroupList(text) {
  const lines = String(text).split(/[\n,，]/)
  const groups = []
  for (const line of lines) {
    const group = line.trim()
    if (group === '') continue
    if (groups.includes(group)) continue
    groups.push(group)
  }
  return groups
}

/** 返回给用户看的问题列表；为空表示可以保存。 */
export function validateAmbientSettings(settings, locale = 'zh-CN') {
  const problems = []
  if (settings.behavior === 'off') return problems
  if (settings.groupScope === 'some') {
    if (settings.groups.length === 0) problems.push(translate(locale, "请至少填一个群，或者选择「所有群」。"))
    const malformedGroups = settings.groups.filter((group) => !GROUP_ID_PATTERN.test(group))
    if (malformedGroups.length > 0) problems.push(translate(locale, "群的写法是「平台:群号」，例如 qq:123456。这些需要改一下：{0}", [malformedGroups.join('、')]))
  }
  const maxPerHourValid = Number.isInteger(settings.maxPerHour) && settings.maxPerHour >= 1 && settings.maxPerHour <= MAX_PER_HOUR_LIMIT
  if (!maxPerHourValid) problems.push(translate(locale, "每小时最多插话次数要在 1 到 {0} 之间。", [MAX_PER_HOUR_LIMIT]))
  return problems
}

function ambientPath(key) {
  return [...AMBIENT_CONFIG_PATH, key]
}

/**
 * 生成 config:patch 的操作，只写 ai.trigger.ambient 下的几个键，其余调优项原样保留。
 * 「关闭」就是不给任何群开放：清空群列表。
 * `mergedJudge`（ADR 0066 的实例）：「只观察」是插话判断的 `purposes.ambient.mode`，由
 * {@link ambientJudgeModeChange} 另外写入，这里不再写已废弃的 `ai.trigger.ambient.mode`。
 */
export function buildAmbientPatches(settings, { mergedJudge = false } = {}) {
  if (settings.behavior === 'off') {
    return [{ op: 'set', path: ambientPath('conversations'), value: [] }]
  }
  const conversations = settings.groupScope === 'all' ? ['*'] : [...settings.groups]
  const mode = settings.behavior === 'watch' ? 'shadow' : 'active'
  return [
    { op: 'set', path: ambientPath('conversations'), value: conversations },
    ...(mergedJudge ? [] : [{ op: 'set', path: ambientPath('mode'), value: mode }]),
    { op: 'set', path: ambientPath('maxPerHour'), value: settings.maxPerHour },
  ]
}

/**
 * Whether the instance has the merged judge, decided only on evidence (ADR 0066 review H1):
 * `legacy` needs both a missing judge route and a status that was read and has no `judgeChain`;
 * `merged` needs the judge or a status with `judgeChain`; anything else (a timeout, a 503, a status
 * that could not be read) is `unknown`, and then the mode is neither shown as known nor written.
 * `judge` is the checked judge view or null, `judgeMissing` whether its route is missing, `status`
 * the checked status or null.
 */
export function ambientJudgeState({ judge = null, judgeMissing = false, status = null } = {}) {
  if (judge) return { state: 'merged', policy: judge.policy, source: judge.source, mode: judge.policy.mode === 'shadow' ? 'shadow' : 'active' }
  if (status && hasMergedJudge(status)) return { state: 'merged', ...(status.enabled ? { mode: status.mode === 'shadow' ? 'shadow' : 'active' } : {}) }
  if (judgeMissing && status && !hasMergedJudge(status)) return { state: 'legacy' }
  return { state: 'unknown' }
}

/**
 * What a save of the interjection settings may write about 「只观察 / 主动参与」:
 * - `legacy`: the old `ai.trigger.ambient.mode` (`writeYmlMode`).
 * - `merged` with the policy read: `judgeMode` when the mode changes (written to `purposes.ambient`).
 * - `merged` without the policy: only a behaviour whose mode is already known to be in effect;
 *   anything else is `blocked` (`no-policy-shadow` when the target is 只观察, else `no-policy`).
 * - `unknown`: nothing about the mode; turning interjection on or switching the mode is `blocked`
 *   (`unknown`), and so is widening where or how often it may speak (`unknown-expand`, review N1):
 *   the mode shown may be the yml value while another mode runs, so a new group could get replies
 *   the person believes are only observed. Narrowing (removing groups, 所有群 → 只在这些群, fewer
 *   per hour) stays allowed.
 * 关闭 only clears the groups and is never blocked.
 *
 * `initial` is the settings read from the Host (a bare behaviour is accepted for older callers).
 */
export function ambientModePlan(settings, initial, judge = { state: 'legacy' }) {
  const before = typeof initial === 'string' ? { behavior: initial } : initial ?? {}
  const none = { writeYmlMode: false, judgeMode: null, blocked: null }
  if (judge.state === 'legacy') return { ...none, writeYmlMode: true }
  if (settings.behavior === 'off') return none
  const wanted = settings.behavior === 'watch' ? 'shadow' : 'active'
  if (judge.state !== 'merged') {
    if (before.behavior !== settings.behavior) return { ...none, blocked: 'unknown' }
    return ambientScopeWidened(settings, before) ? { ...none, blocked: 'unknown-expand' } : none
  }
  if (judge.policy) return { ...none, judgeMode: wanted === judge.mode ? null : wanted }
  if (judge.mode !== undefined && wanted === judge.mode) return none
  return { ...none, blocked: wanted === 'shadow' ? 'no-policy-shadow' : 'no-policy' }
}

/**
 * Whether a draft lets interjection reach more than what was read: 所有群 where it was a list, a group
 * that was not in the list, or a higher hourly cap. Without the read groups (an older caller) any
 * change of scope counts as widening.
 */
export function ambientScopeWidened(settings, initial) {
  if (!initial || !Array.isArray(initial.groups) || !initial.groupScope) return true
  if (settings.groupScope === 'all') return initial.groupScope !== 'all'
  if (initial.groupScope !== 'all' && settings.groups.some(group => !initial.groups.includes(group))) return true
  return typeof initial.maxPerHour === 'number' && settings.maxPerHour > initial.maxPerHour
}

/** The keys a save writes (`ai.trigger.ambient.*` → value), for comparing a read-back with the draft. */
export function ambientWrittenValues(settings, options) {
  return Object.fromEntries(buildAmbientPatches(settings, options).map(patch => [patch.path.join('.'), patch.value]))
}

/**
 * What a saved `config:patch` did: the outcome the Host reported (apply-outcome-model) and whether
 * the settings read back after the save are the ones submitted. `reread` null = the read failed.
 */
export function ambientSaveOutcome(result, submitted, reread, options) {
  return {
    outcome: outcomeFromConfigSave(result, result?.revision),
    mismatch: reread ? readBackMismatch(ambientWrittenValues(submitted, options), ambientWrittenValues(reread.settings, options)) : null,
    unverified: !reread,
  }
}

/** After a restart: the application status the re-read settings carry (null = nothing to say). */
export function ambientRestartOutcome(reread) {
  return reread?.application ? outcomeFromConfigSave(reread.application, reread.revision) : null
}

const RESTART_REQUIRED_TEXT = '已保存。需要重启机器人才会生效。'
const NO_RESTART_TEXT = '已保存，马上生效，不用重启。'

/** 把 config:patch 的结果翻成提示；保存成功时一定说明要不要重启。 */
export function describeSaveResult(result, locale = 'zh-CN') {
  if (!isPlainObject(result)) return { kind: 'error', text: translate(locale, "保存结果格式不正确，请刷新后再看一下设置是否已保存。") }
  if (result.status === 'saved') {
    if (Object.hasOwn(result, 'application') || result.applicationError !== undefined) {
      const state = configurationRuntimeStatus(result, result.revision, locale)
      return { kind: 'saved', restartRequired: result.restartRequired === true, applicationKind: state.kind,
        text: `${translate(locale, '配置已保存。')} ${state.summary}` }
    }
    const restartRequired = result.restartRequired !== false
    return { kind: 'saved', restartRequired, text: translate(locale, restartRequired ? RESTART_REQUIRED_TEXT : NO_RESTART_TEXT) }
  }
  if (result.status === 'conflict') {
    return { kind: 'conflict', text: translate(locale, "设置刚刚在别处被改过。已经载入最新的设置，请确认后再保存一次。") }
  }
  if (result.status === 'invalid') {
    return { kind: 'invalid', text: translate(locale, "这些设置没有通过检查，没有保存。请检查后再试。") }
  }
  return { kind: 'error', text: translate(locale, "保存失败，请稍后再试。") }
}

/**
 * Host 用 401/403 表示没登录或没权限（例如调用者没有 ambient:read）。
 * Console RPC 的传输层只留下错误文字，所以也认 Host 401/403 响应的固定文字；
 * 其他失败（超时、Host 500、适配器不支持、格式不对……）都不是权限问题。
 */
const PERMISSION_DENIED_TEXT = /\bHTTP 40[13]\b|Token scope does not allow this route|Invalid or missing token|^Demo scope: RPC .* is forbidden$/i

export function isPermissionDenied(error) {
  if (!error) return false
  if (typeof error === 'object' && typeof error.status === 'number') return error.status === 401 || error.status === 403
  const text = typeof error === 'string' ? error : error instanceof Error ? error.message : ''
  return PERMISSION_DENIED_TEXT.test(text.trim())
}

/**
 * 群聊插话页的「无权限」判断（#64 `ambient-read-error-raw`）：旧 Host 的拒绝文字（`isPermissionDenied`），
 * 或 `statusFromError` 认出的无权限（Host 的 `forbidden` 码、401/403）。状态、设置和群列表都用它。
 */
export function isReadDenied(error) {
  return isPermissionDenied(error) || statusFromError(error).kind === 'forbidden'
}

/**
 * 读取失败时给用户看的提示（#64 `ambient-read-error-raw`）：无权限按 `statusFromError` 判断（Host 的
 * `forbidden` 码、401/403、拒绝文字），与页面上 StatusState 的判断一致；其余只说哪一部分没读到，
 * 不把 Host 原文拼进来——原因由 `StatusState error=` 按类型说明，原文只在 `detail`（技术详情）里。
 */
export function describeReadFailure(error, resource, locale = 'zh-CN') {
  const reason = (typeof error === 'string' ? error : error instanceof Error ? error.message : String(error ?? '')).trim()
  if (isReadDenied(error)) return { denied: true, text: translate(locale, "当前账号没有读取{0}的权限，请联系管理员开通。", [resource]), detail: reason }
  return { denied: false, text: translate(locale, "{0}读取失败，请稍后重试。", [resource]), detail: reason }
}

const SHORT_OUTCOME_LABELS = Object.freeze({ spoke: '接了话', watched: '想接话', stayed_quiet: '不接话', skipped: '未判断' })

/** One row per group, newest activity first, so repeated identical decisions read as a count instead of a wall of rows. */
export function summarizeRecentByGroup(recent, locale = 'zh-CN') {
  const groups = new Map()
  for (const entry of recent) {
    const row = groups.get(entry.group) ?? { group: entry.group, count: 0, lastAt: 0, lastText: '', outcomes: new Map() }
    row.count += 1
    if (entry.at >= row.lastAt) { row.lastAt = entry.at; row.lastText = entry.text }
    row.outcomes.set(entry.outcome, (row.outcomes.get(entry.outcome) ?? 0) + 1)
    groups.set(entry.group, row)
  }
  return [...groups.values()]
    .sort((a, b) => b.lastAt - a.lastAt)
    .map(row => ({
      group: row.group, count: row.count, lastAt: row.lastAt, lastText: row.lastText,
      outcomes: AMBIENT_OUTCOMES.filter(outcome => row.outcomes.has(outcome)).map(outcome => ({ outcome, label: translate(locale, SHORT_OUTCOME_LABELS[outcome]), count: row.outcomes.get(outcome) })),
    }))
}

/** `platform:groupId` → display name using the account group lists; unknown groups keep their id. */
export function ambientGroupLabel(group, names) {
  const name = names?.get(group)
  return name ? { name, id: group } : { name: group, id: null }
}
