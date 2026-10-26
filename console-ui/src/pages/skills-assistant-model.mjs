import { translate } from '../i18n/locale.mjs'
/**
 * 技能助手页（zhinjs/zhin#970）的纯逻辑：校验 Host 状态、把设置翻成大白话、生成 config:patch。
 * 页面面向普通用户，不输出决策模型、判官、置信度、原因代码等内部细节。
 */

export const SKILLS_STATUS_PERMISSION = 'skills:read'
export const SKILLS_ASSISTANT_PACKAGE = '@zhin.js/service-typesafe'
export const DECISIONS_CONFIG_PATH = Object.freeze(['ai', 'decisions'])

const TASK_MODES = ['off', 'shadow', 'active']
const TASK_OUTCOMES = ['selected', 'abstained', 'failed', 'shadow']

/** 页面能改的事项，顺序即显示顺序；ambient 的开关也在「群聊插话」页的范围里，这里只管要不要由技能助手来判断。 */
export const ASSISTANT_TASKS = Object.freeze([
  Object.freeze({ task: 'skills', label: '帮机器人挑技能', hint: '根据聊天内容，推荐这次该用哪个技能。' }),
  Object.freeze({ task: 'tools', label: '帮机器人挑工具', hint: '推荐这次该用哪些工具。' }),
  Object.freeze({ task: 'memory', label: '挑出相关的记忆', hint: '从机器人记住的内容里挑出和这次对话有关的。' }),
  Object.freeze({ task: 'agents', label: '决定交给哪个助手', hint: '有多个助手时，推荐由谁来处理。' }),
  Object.freeze({ task: 'approval', label: '自动通过审批', hint: '需要审批的操作，由它判断能不能直接通过。风险较高，建议先「只观察」。' }),
  Object.freeze({ task: 'ambient', label: '判断群里要不要接话', hint: '配合「群聊插话」使用，由它来判断要不要开口。' }),
])

export const MODE_CHOICES = Object.freeze([
  Object.freeze({ value: 'off', label: '关闭' }),
  Object.freeze({ value: 'shadow', label: '只观察' }),
  Object.freeze({ value: 'active', label: '正式使用' }),
])

export const MODE_EXPLANATION = '「只观察」会记下它的建议，但不改变机器人的行为，适合先试一试；「正式使用」才会真正按它的建议做。'

const MODE_LABELS = Object.freeze({ off: '关闭', shadow: '只观察', active: '正式使用' })

const OUTCOME_LABELS = Object.freeze({
  selected: '给出了建议',
  abstained: '没有合适的建议',
  shadow: '只观察，记下了建议',
  failed: '这次没成功',
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

function taskLabel(task, locale = 'zh-CN') {
  const known = ASSISTANT_TASKS.find((entry) => entry.task === task)
  return known ? translate(locale, known.label) : task
}

/** 校验 plugin.root.skills 的返回；格式不对时抛错，不能被当成「没有数据」。 */
export function validateSkillsStatus(data, locale = 'zh-CN') {
  if (!isPlainObject(data)) throw new Error(translate(locale, '技能助手状态格式不正确。'))
  if (!Array.isArray(data.tasks)) throw new Error(translate(locale, '技能助手状态格式不正确。'))
  for (const row of data.tasks) {
    if (!isPlainObject(row)) throw new Error(translate(locale, '技能助手状态格式不正确。'))
    if (typeof row.task !== 'string') throw new Error(translate(locale, '技能助手状态格式不正确。'))
    if (!TASK_MODES.includes(row.mode)) throw new Error(translate(locale, '技能助手状态格式不正确。'))
    for (const key of ['calls', 'selected', 'abstained', 'shadow', 'failed', 'averageMs']) {
      if (!isCount(row[key])) throw new Error(translate(locale, '技能助手状态格式不正确。'))
    }
  }
  if (!isPlainObject(data.totals)) throw new Error(translate(locale, '技能助手状态格式不正确。'))
  if (!isCount(data.totals.calls)) throw new Error(translate(locale, '技能助手状态格式不正确。'))
  if (!Array.isArray(data.recent)) throw new Error(translate(locale, '技能助手状态格式不正确。'))
  for (const entry of data.recent) {
    if (!isPlainObject(entry)) throw new Error(translate(locale, '技能助手记录格式不正确。'))
    if (!isTimestamp(entry.at)) throw new Error(translate(locale, '技能助手记录格式不正确。'))
    if (typeof entry.task !== 'string') throw new Error(translate(locale, '技能助手记录格式不正确。'))
    if (!TASK_OUTCOMES.includes(entry.outcome)) throw new Error(translate(locale, '技能助手记录格式不正确。'))
    if (!isCount(entry.durationMs)) throw new Error(translate(locale, '技能助手记录格式不正确。'))
  }
  const updatedAtValid = data.updatedAt === null || isTimestamp(data.updatedAt)
  if (!updatedAtValid) throw new Error(translate(locale, '技能助手状态格式不正确。'))
  return data
}

function formatDuration(milliseconds, locale = 'zh-CN') {
  if (milliseconds < 1000) return translate(locale, '{0} 毫秒', [Math.round(milliseconds)])
  return translate(locale, '{0} 秒', [(milliseconds / 1000).toFixed(1)])
}

function describeTaskRow(row, locale = 'zh-CN') {
  return {
    task: row.task,
    label: taskLabel(row.task, locale),
    mode: translate(locale, MODE_LABELS[row.mode], [], 'state'), modeVariant: row.mode === 'active' ? 'success' : row.mode === 'shadow' ? 'info' : 'secondary',
    calls: row.calls,
    helped: row.selected + row.shadow,
    noSuggestion: row.abstained,
    failed: row.failed,
    averageTime: formatDuration(row.averageMs, locale),
  }
}

function describeRecentEntry(entry, locale = 'zh-CN') {
  return {
    at: entry.at,
    label: taskLabel(entry.task, locale),
    outcome: entry.outcome,
    text: translate(locale, OUTCOME_LABELS[entry.outcome]),
    duration: formatDuration(entry.durationMs, locale),
  }
}

/** 把 Host 状态翻成页面直接显示的大白话；不带模型、原因代码和 token 数。 */
export function describeSkillsStatus(status, locale = 'zh-CN') {
  const failedCalls = status.tasks.reduce((sum, row) => sum + row.failed, 0)
  return {
    totalCalls: status.totals.calls,
    failedCalls,
    tasks: status.tasks.map(row => describeTaskRow(row, locale)),
    recent: status.recent.map(entry => describeRecentEntry(entry, locale)),
    hasActivity: status.recent.length > 0,
    updatedAt: status.updatedAt,
  }
}

function packageNameOf(pluginEntry) {
  if (typeof pluginEntry === 'string') return pluginEntry
  if (isPlainObject(pluginEntry) && typeof pluginEntry.package === 'string') return pluginEntry.package
  return undefined
}

function readDecisions(configDocument) {
  if (!isPlainObject(configDocument)) return {}
  const ai = configDocument.ai
  if (!isPlainObject(ai)) return {}
  const decisions = ai.decisions
  if (!isPlainObject(decisions)) return {}
  return decisions
}

/**
 * 找到技能助手服务（@zhin.js/service-typesafe）在 plugins 里的实例名。
 * ai.decisions.provider 已经指向某个实例时优先用它，避免改到别的实例。
 */
export function findAssistantInstanceKey(configDocument) {
  if (!isPlainObject(configDocument)) return undefined
  const plugins = configDocument.plugins
  if (!isPlainObject(plugins)) return undefined
  const installedKeys = Object.keys(plugins).filter((key) => packageNameOf(plugins[key]) === SKILLS_ASSISTANT_PACKAGE)
  if (installedKeys.length === 0) return undefined
  const provider = readDecisions(configDocument).provider
  if (typeof provider === 'string' && provider.startsWith('root/')) {
    const boundKey = provider.slice('root/'.length)
    if (installedKeys.includes(boundKey)) return boundKey
  }
  return installedKeys[0]
}

function readTaskMode(decisions, task) {
  const taskConfig = decisions[task]
  if (!isPlainObject(taskConfig)) return 'off'
  if (!TASK_MODES.includes(taskConfig.mode)) return 'off'
  return taskConfig.mode
}

/** 从已解析的配置文件里读出页面表单的初始值；没装服务时 instanceKey 为 undefined。 */
export function readSkillsSettings(configDocument) {
  const decisions = readDecisions(configDocument)
  const instanceKey = findAssistantInstanceKey(configDocument)
  const modes = {}
  for (const { task } of ASSISTANT_TASKS) {
    modes[task] = readTaskMode(decisions, task)
  }
  const provider = typeof decisions.provider === 'string' ? decisions.provider : undefined
  const usesOtherService = provider !== undefined && provider !== `root/${instanceKey}`
  return { instanceKey, provider, usesOtherService, modes }
}

function decisionsPath(...keys) {
  return [...DECISIONS_CONFIG_PATH, ...keys]
}

/**
 * 生成 config:patch 的操作：只改用户动过的事项的 mode，阈值等其他键原样保留。
 * 还没绑定服务时，顺带把 ai.decisions.provider 指向这个实例；已经绑定别的服务时页面不允许保存，不会改它。
 */
export function buildSkillsPatches(initial, modes) {
  const patches = []
  if (initial.provider === undefined) {
    patches.push({ op: 'set', path: decisionsPath('provider'), value: `root/${initial.instanceKey}` })
  }
  for (const { task } of ASSISTANT_TASKS) {
    const nextMode = modes[task]
    if (nextMode === initial.modes[task]) continue
    patches.push({ op: 'set', path: decisionsPath(task, 'mode'), value: nextMode })
  }
  return patches
}

/** 有改动才允许保存。 */
export function hasSkillsChanges(initial, modes) {
  return ASSISTANT_TASKS.some(({ task }) => modes[task] !== initial.modes[task])
}

const RESTART_REQUIRED_TEXT = '已保存。需要重启机器人才会生效。'
const NO_RESTART_TEXT = '已保存，马上生效，不用重启。'

/** 把 config:patch 的结果翻成提示；保存成功时一定说明要不要重启。 */
export function describeSaveResult(result, locale = 'zh-CN') {
  if (!isPlainObject(result)) return { kind: 'error', text: translate(locale, '保存结果格式不正确，请刷新后再看一下设置是否已保存。') }
  if (result.status === 'saved') {
    const restartRequired = result.restartRequired !== false
    return { kind: 'saved', restartRequired, text: translate(locale, restartRequired ? RESTART_REQUIRED_TEXT : NO_RESTART_TEXT) }
  }
  if (result.status === 'conflict') {
    return { kind: 'conflict', text: translate(locale, '设置刚刚在别处被改过。已经载入最新的设置，请确认后再保存一次。') }
  }
  if (result.status === 'invalid') {
    return { kind: 'invalid', text: translate(locale, '这些设置没有通过检查，没有保存。请检查后再试。') }
  }
  return { kind: 'error', text: translate(locale, '保存失败，请稍后再试。') }
}

/** 调用者没有 skills:read 或未登录时，Host 返回 401/403。 */
export function isPermissionDenied(error) {
  return Boolean(error) && (error.status === 401 || error.status === 403)
}
