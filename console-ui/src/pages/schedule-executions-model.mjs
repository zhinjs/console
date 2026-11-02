import { translate } from '../i18n/locale.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0
const timestamp = value => Number.isFinite(value) && value >= 0 && Number.isFinite(new Date(value).getTime())
const optional = (value, check) => value === undefined || check(value)
const statuses = ['queued', 'running', 'succeeded', 'failed', 'cancelled', 'interrupted', 'unsettled', 'budget_partial']
const deliveries = ['not_requested', 'not_sent', 'delivered', 'partial', 'failed', 'unknown']

function invalid(locale) { throw new Error(translate(locale, '执行记录响应与当前任务不匹配，或格式无效。')) }
function summary(row, jobId) {
  return object(row) && text(row.runId) && text(row.jobId) && (jobId === undefined || row.jobId === jobId) && optional(row.label, value => typeof value === 'string')
    && ['scheduled', 'manual', 'event', 'preview'].includes(row.source) && timestamp(row.queuedAt)
    && optional(row.startedAt, timestamp) && optional(row.finishedAt, timestamp) && statuses.includes(row.status)
    && Number.isSafeInteger(row.attemptCount) && row.attemptCount >= 0 && optional(row.deliveryStatus, value => deliveries.includes(value))
    && optional(row.recordingIssue, value => typeof value === 'boolean')
}
function result(value) {
  return object(value) && typeof value.success === 'boolean' && typeof value.output === 'string'
    && optional(value.status, status => ['succeeded', 'failed', 'cancelled', 'budget_partial'].includes(status))
    && optional(value.error, error => typeof error === 'string') && Number.isFinite(value.durationMs) && value.durationMs >= 0
    && object(value.tokenUsage) && ['input', 'output'].every(key => Number.isFinite(value.tokenUsage[key]) && value.tokenUsage[key] >= 0)
    && optional(value.replay, replay => object(replay) && ['safe', 'committed', 'unknown'].includes(replay.disposition)
      && Array.isArray(replay.operations) && replay.operations.every(operation => object(operation) && text(operation.id) && text(operation.status) && optional(operation.toolName, text)))
    && optional(value.delivery, delivery => object(delivery) && deliveries.includes(delivery.status) && text(delivery.channel)
      && optional(delivery.message, value => typeof value === 'string') && optional(delivery.deliveryUnknown, value => value === true))
}

/** Strict identity checks prevent an old/mismatched Host response from becoming another task's history. */
export function readExecutionPage(body, jobId, locale = 'zh-CN') {
  const data = body?.data
  const health = data?.recordingHealth
  if (body?.success !== true || !object(data) || !Array.isArray(data.runs)
    || !data.runs.every(row => summary(row, jobId)) || !(data.nextCursor === null || text(data.nextCursor))
    || new Set(data.runs.map(row => row.runId)).size !== data.runs.length
    || !object(health) || !['activeWriteFailures', 'incompleteCompletedRuns'].every(key => Number.isSafeInteger(health[key]) && health[key] >= 0)
    || !optional(health.lastFailureAt, timestamp) || !optional(health.lastRun, value => object(value) && text(value.runId) && text(value.jobId))) invalid(locale)
  return data
}

export function readExecutionDetail(body, jobId, runId, locale = 'zh-CN') {
  const data = body?.data
  if (body?.success !== true || !summary(data, jobId) || data.runId !== runId || data.version !== 1
    || !object(data.job) || data.job.id !== jobId || !Array.isArray(data.attempts) || data.attempts.length !== data.attemptCount
    || !optional(data.result, result) || !optional(data.scheduledAt, timestamp)
    || !optional(data.job.createdBy, value => object(value) && text(value.userId) && optional(value.name, value => typeof value === 'string'))
    || !optional(data.job.notify, value => object(value) && text(value.channel)
      && (value.channel !== 'im' || object(value.target) && object(value.target.scene)
        && ['platform', 'endpointKey', 'sceneId', 'kind'].every(key => text(value.target.scene[key]))
        && optional(value.target.scene.parent, parent => object(parent) && text(parent.kind) && text(parent.sceneId))
        && optional(value.target.threadId, text)))) invalid(locale)
  const ids = new Set(), numbers = new Set()
  for (const attempt of data.attempts) {
    if (!object(attempt) || attempt.runId !== runId || attempt.jobId !== jobId || !text(attempt.attemptId)
      || ids.has(attempt.attemptId) || !Number.isSafeInteger(attempt.number) || attempt.number < 1 || numbers.has(attempt.number)
      || !timestamp(attempt.startedAt) || !optional(attempt.finishedAt, timestamp) || !optional(attempt.result, result)
      || !optional(attempt.retry, retry => object(retry) && ['retry', 'stop'].includes(retry.decision)
        && ['cancelled', 'timeout', 'attempt_budget_exhausted', 'committed', 'unknown', 'not_retryable', 'read_only', 'not_submitted'].includes(retry.reason))
      || !Array.isArray(attempt.progress) || !attempt.progress.every(event => object(event) && event.type === 'attempt_progress'
        && event.runId === runId && event.jobId === jobId && event.attemptId === attempt.attemptId && timestamp(event.at)
        && ['model', 'tool', 'approval', 'delivery'].includes(event.phase) && text(event.status)
        && optional(event.toolName, text) && optional(event.code, text))) invalid(locale)
    ids.add(attempt.attemptId); numbers.add(attempt.number)
  }
  return data
}

export function readExecutionCleanup(body, locale = 'zh-CN') {
  const data = body?.data
  if (body?.success !== true || !object(data) || !Number.isSafeInteger(data.deleted) || data.deleted < 0 || !timestamp(data.cutoff)) invalid(locale)
  return data
}

export function executionQuery(jobId, cursor) {
  const query = new URLSearchParams({ limit: '50' })
  if (jobId !== undefined) query.set('jobId', jobId)
  if (cursor) query.set('cursor', cursor)
  return `/api/assistant/executions?${query}`
}
export function executionDetailQuery(jobId, runId) {
  return `/api/assistant/execution?${new URLSearchParams({ jobId, runId })}`
}
export function executionFailure(status, locale = 'zh-CN') {
  return translate(locale, status === 403 ? '需要当前 Host 的 full 权限才能查看执行记录。'
    : status === 404 ? '执行记录不存在、已过期，或当前 Host 尚不支持执行记录。'
      : status === 503 ? '执行记录存储暂不可用，请稍后重新读取。' : '执行记录读取失败，请检查连接后重试。')
}
export function executionStatus(status, locale = 'zh-CN') {
  return translate(locale, ({ queued: '等待执行', running: '执行中', succeeded: '已完成', failed: '执行失败', cancelled: '已取消', interrupted: '执行已中断，结果未确认', unsettled: '状态待核对', budget_partial: '部分完成（预算耗尽）' })[status] ?? '状态未识别')
}
export function deliveryStatus(status, locale = 'zh-CN', unknown = false) {
  const label = translate(locale, ({ not_requested: '无需投递', not_sent: '未投递', delivered: '投递完成', partial: '部分投递', failed: '投递失败', unknown: '投递结果未知' })[status] ?? '未记录投递结果')
  return unknown && status !== 'unknown' ? `${label} · ${translate(locale, '其余投递结果未知')}` : label
}
export function progressLabel(event, locale = 'zh-CN') {
  const phase = ({ model: '模型', tool: '工具', approval: '审批', delivery: '投递' })[event.phase] ?? '执行'
  const state = ({ started: '开始', finished: '完成', completed: '完成', succeeded: '完成', failed: '失败', error: '失败', pending: '等待中', approved: '已允许', denied: '已拒绝', unknown: '结果未知', not_sent: '未提交', committed: '已提交', turn_start: '开始执行', iteration_start: '开始模型回合', tool_call: '发起调用', tool_result: '已返回', tool_failed: '调用失败', tool_cancelled: '调用已取消', tool_denied: '调用被拒绝', delivered: '投递完成', partial: '部分投递', not_requested: '无需投递' })[event.status]
  return `${translate(locale, phase)}${event.toolName ? ` · ${event.toolName}` : ''} · ${state ? translate(locale, state) : event.status}`
}
