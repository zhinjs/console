import { translate } from '../i18n/locale.mjs'
/**
 * 技能助手页（zhinjs/zhin#970）的纯逻辑：校验 Host 状态，把统计翻成大白话。
 * 页面面向普通用户，不输出决策模型、判官、置信度、原因代码等内部细节。
 */

export const SKILLS_STATUS_PERMISSION = 'skills:read'

const TASK_MODES = ['off', 'shadow', 'active']
const TASK_OUTCOMES = ['selected', 'abstained', 'failed', 'shadow']

/** 只读统计中的已知事项；模式和模型在统一模型用途页管理。 */
export const ASSISTANT_TASKS = Object.freeze([
  Object.freeze({ task: 'skills', label: '帮机器人挑技能', hint: '根据聊天内容，推荐这次该用哪个技能。' }),
  Object.freeze({ task: 'tools', label: '帮机器人挑工具', hint: '推荐这次该用哪些工具。' }),
  Object.freeze({ task: 'memory', label: '挑出相关的记忆', hint: '从机器人记住的内容里挑出和这次对话有关的。' }),
  Object.freeze({ task: 'agents', label: '决定交给哪个助手', hint: '有多个助手时，推荐由谁来处理。' }),
  Object.freeze({ task: 'approval', label: '自动通过审批', hint: '需要审批的操作，由它判断能不能直接通过。风险较高，建议先「只观察」。' }),
  Object.freeze({ task: 'ambient', label: '判断群里要不要接话', hint: '配合「群聊插话」使用，由它来判断要不要开口。' }),
])

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

/** 调用者没有 skills:read 或未登录时，Host 返回 401/403。 */
export function isPermissionDenied(error) {
  return Boolean(error) && (error.status === 401 || error.status === 403)
}
