import { translate } from '../i18n/locale.mjs'
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
  return data
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

/** 从已解析的配置文件里读出页面表单的初始值。 */
export function readAmbientSettings(configDocument) {
  const ambient = readStoredAmbient(configDocument)
  const conversations = readConversationList(ambient)
  const coversEveryGroup = conversations.includes('*')
  const specificGroups = conversations.filter((conversation) => conversation !== '*')
  let behavior = 'join'
  if (conversations.length === 0) behavior = 'off'
  else if (ambient.mode === 'shadow') behavior = 'watch'
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
 */
export function buildAmbientPatches(settings) {
  if (settings.behavior === 'off') {
    return [{ op: 'set', path: ambientPath('conversations'), value: [] }]
  }
  const conversations = settings.groupScope === 'all' ? ['*'] : [...settings.groups]
  const mode = settings.behavior === 'watch' ? 'shadow' : 'active'
  return [
    { op: 'set', path: ambientPath('conversations'), value: conversations },
    { op: 'set', path: ambientPath('mode'), value: mode },
    { op: 'set', path: ambientPath('maxPerHour'), value: settings.maxPerHour },
  ]
}

const RESTART_REQUIRED_TEXT = '已保存。需要重启机器人才会生效。'
const NO_RESTART_TEXT = '已保存，马上生效，不用重启。'

/** 把 config:patch 的结果翻成提示；保存成功时一定说明要不要重启。 */
export function describeSaveResult(result, locale = 'zh-CN') {
  if (!isPlainObject(result)) return { kind: 'error', text: translate(locale, "保存结果格式不正确，请刷新后再看一下设置是否已保存。") }
  if (result.status === 'saved') {
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

/** 调用者没有 ambient:read 或未登录时，Host 返回 401/403。 */
export function isPermissionDenied(error) {
  return Boolean(error) && (error.status === 401 || error.status === 403)
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
