import { translate } from '../i18n/locale.mjs'
/**
 * 「机器人状态 → 决策回放」（zhinjs/zhin ADR 0036 切片 C）的纯逻辑：
 * 校验 Host 的 plugin.root.decisions / decision-turn / decisions-export 返回，把 kind / outcome / reason_code
 * 翻成大白话，拼导出文件。格式不对时抛错，不当成「没有记录」。
 */

export const REPLAY_PERMISSION = 'decisions:read'
export const REPLAY_LIST_METHOD = 'decisions'
export const REPLAY_TURN_METHOD = 'decision-turn'
export const REPLAY_EXPORT_METHOD = 'decisions-export'
export const REPLAY_PAGE_SIZE = 50
/** 导出最多翻多少页，防止 Host 返回异常游标时死循环。 */
export const REPLAY_EXPORT_MAX_PAGES = 200
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export const REPLAY_KINDS = Object.freeze([
  'inbound_wake', 'speak_gate', 'control_gate', 'ambient_decision', 'model_skip', 'model_run',
  'tool_call', 'tool_hard_gate', 'tool_approval', 'outbound', 'config_change', 'control_change',
])
export const REPLAY_OUTCOMES = Object.freeze(['allow', 'deny', 'skip', 'defer', 'error'])

const KIND_LABELS = Object.freeze({
  inbound_wake: '收到消息 / 事件',
  speak_gate: '能不能在这里说话',
  control_gate: '被开关拦下',
  ambient_decision: '要不要自己接话',
  model_skip: '没有调用模型',
  model_run: '调用了模型',
  tool_call: '调用工具',
  tool_hard_gate: '危险工具被拦下',
  tool_approval: '危险工具审批',
  outbound: '发出消息',
  config_change: '配置变更',
  control_change: '开关变更',
})

const OUTCOME_LABELS = Object.freeze({
  allow: '放行',
  deny: '拒绝',
  skip: '跳过',
  defer: '稍后',
  error: '出错',
})

const REASON_LABELS = Object.freeze({
  unknown: '未知原因',
  cannot_speak_muted: '机器人在这里被禁言',
  cannot_speak_muted_all: '全员禁言中',
  cannot_speak_restricted: '这里限制了机器人发言',
  control_emergency_stop: '紧急停止已打开',
  control_muted_instance: '机器人整体静音',
  control_muted_session: '这个会话静音',
  control_read_only: '只读模式',
  control_mention_only: '只在被 @ 时回复',
  ambient_not_engaged: '判断不需要接话',
  ambient_engaged: '判断应该接话',
  scene_event_nothing_new: '群里没有新动静',
  scene_event_high_priority: '群里有需要处理的动静',
  scene_event_rate_limited: '动静太频繁，先缓一缓',
  scene_event_wake_failed: '处理群动静失败',
  inbound_addressed: '有人叫了机器人',
  model_completed: '模型正常完成',
  model_failed: '模型调用失败',
  model_cancelled: '模型调用被取消',
  model_superseded: '有更新的消息，这次作废',
  outbound_sent: '已发送',
  outbound_suppressed: '决定不发送',
  outbound_failed: '发送失败',
  tool_dangerous_no_approval: '危险工具没有审批',
  tool_approval_timeout: '审批超时',
  tool_approval_denied: '审批被拒绝',
})

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function isTimestamp(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function isText(value) {
  return typeof value === 'string'
}
function isOptionalText(value) {
  return value === null || typeof value === 'string'
}

function formatError(locale) {
  return new Error(translate(locale, "决策记录格式不正确。"))
}

function validateRow(row, locale) {
  if (!isPlainObject(row)) throw formatError(locale)
  for (const key of ['id', 'turn_id', 'instance_id', 'platform', 'scene_id', 'kind', 'outcome', 'reason_code', 'actor']) {
    if (!isText(row[key])) throw formatError(locale)
  }
  if (!isTimestamp(row.ts)) throw formatError(locale)
  for (const key of ['user_id', 'reason_detail', 'actor_id']) if (!isOptionalText(row[key])) throw formatError(locale)
  if (!isPlainObject(row.payload)) throw formatError(locale)
  return row
}

function validateRows(rows, locale) {
  if (!Array.isArray(rows)) throw formatError(locale)
  for (const row of rows) validateRow(row, locale)
  return rows
}

/** plugin.root.decisions → { persistent, items, nextBefore } */
export function validateReplayList(data, locale = 'zh-CN') {
  if (!isPlainObject(data) || typeof data.persistent !== 'boolean') throw formatError(locale)
  validateRows(data.items, locale)
  if (!(data.nextBefore === null || isTimestamp(data.nextBefore))) throw formatError(locale)
  return data
}

/** plugin.root.decision-turn → { turnId, startedAt, endedAt, truncated, events } */
export function validateReplayTurn(data, locale = 'zh-CN') {
  if (!isPlainObject(data) || !isText(data.turnId) || !isTimestamp(data.startedAt) || !isTimestamp(data.endedAt)) throw formatError(locale)
  if (typeof data.truncated !== 'boolean') throw formatError(locale)
  validateRows(data.events, locale)
  return data
}

/** plugin.root.decisions-export 的一页 → { window, count, nextSince, events } */
export function validateReplayExportPage(data, locale = 'zh-CN') {
  if (!isPlainObject(data) || data.table !== 'ai_decision_events') throw formatError(locale)
  if (!isPlainObject(data.window) || !isTimestamp(data.window.since) || !isTimestamp(data.window.until)) throw formatError(locale)
  if (!(data.nextSince === null || isTimestamp(data.nextSince))) throw formatError(locale)
  validateRows(data.events, locale)
  return data
}

export function kindLabel(kind, locale = 'zh-CN') {
  return Object.hasOwn(KIND_LABELS, kind) ? translate(locale, KIND_LABELS[kind]) : kind
}
export function outcomeLabel(outcome, locale = 'zh-CN') {
  return Object.hasOwn(OUTCOME_LABELS, outcome) ? translate(locale, OUTCOME_LABELS[outcome]) : outcome
}
export function reasonLabel(code, locale = 'zh-CN') {
  return Object.hasOwn(REASON_LABELS, code) ? translate(locale, REASON_LABELS[code]) : code
}

/** 一行 → 页面显示：一句话原因 + 原始机器码（排障时对得上日志）。 */
export function describeReplayRow(row, locale = 'zh-CN') {
  return {
    id: row.id,
    at: row.ts,
    turnId: row.turn_id,
    where: `${row.platform} · ${row.scene_id}`,
    kind: kindLabel(row.kind, locale),
    outcome: outcomeLabel(row.outcome, locale),
    outcomeCode: row.outcome,
    reason: reasonLabel(row.reason_code, locale),
    code: `${row.kind} / ${row.outcome} / ${row.reason_code}`,
    detail: row.reason_detail,
  }
}

/** 页面筛选 → RPC 参数；空值不发。 */
export function buildReplayFilter(filter) {
  const out = {}
  if (!isPlainObject(filter)) return out
  for (const key of ['platform', 'sceneId']) {
    const value = typeof filter[key] === 'string' ? filter[key].trim() : ''
    if (value) out[key] = value
  }
  if (REPLAY_KINDS.includes(filter.kind)) out.kind = filter.kind
  if (REPLAY_OUTCOMES.includes(filter.outcome)) out.outcome = filter.outcome
  return out
}

export const EXPORT_WINDOWS = Object.freeze([
  Object.freeze({ value: '1h', label: '最近 1 小时', ms: HOUR }),
  Object.freeze({ value: '24h', label: '最近 24 小时', ms: DAY }),
  Object.freeze({ value: '7d', label: '最近 7 天', ms: 7 * DAY }),
  Object.freeze({ value: '14d', label: '最近 14 天', ms: 14 * DAY }),
])

export function exportWindow(value, now = Date.now()) {
  const choice = EXPORT_WINDOWS.find(item => item.value === value) ?? EXPORT_WINDOWS[0]
  return { since: Math.max(0, now - choice.ms), until: now }
}

/**
 * 按 nextSince 逐页调用 Host，拼成一份导出：{ table, exportedAt, window, filters, count, events }。
 * `call(input)` 返回一页；游标不前进或页数过多时报错，不会死循环。
 */
export async function collectReplayExport(call, window, filter = {}, locale = 'zh-CN') {
  const events = []
  let since = window.since
  let first = null
  for (let page = 0; page < REPLAY_EXPORT_MAX_PAGES; page += 1) {
    const data = validateReplayExportPage(await call({ ...filter, since, until: window.until }), locale)
    first ??= data
    events.push(...data.events)
    if (data.nextSince === null) {
      return {
        table: 'ai_decision_events',
        exportedAt: first.exportedAt,
        window: { since: window.since, until: window.until },
        filters: first.filters ?? {},
        count: events.length,
        events,
      }
    }
    if (data.nextSince <= since) throw new Error(translate(locale, "导出翻页没有前进，已停止。"))
    since = data.nextSince
  }
  throw new Error(translate(locale, "导出的记录太多，请缩小时间范围或加筛选。"))
}

export function exportFileName(window) {
  const stamp = (ms) => new Date(ms).toISOString().replace(/[:.]/g, '-')
  return `ai_decision_events_${stamp(window.since)}_${stamp(window.until)}.json`
}

export function isPermissionDenied(error) {
  return Boolean(error) && (error.status === 401 || error.status === 403)
}
