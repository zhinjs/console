import { translate } from '../i18n/locale.mjs'
import { diagnosticConversationKey } from './endpoint-detail/message-diagnostics.mjs'

const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' && value.length > 0
const number = value => Number.isFinite(value) && value >= 0
const usageFields = { input: 'prompt_tokens', output: 'completion_tokens', totalTokens: 'total_tokens', cacheRead: 'cache_read_tokens', cacheWrite: 'cache_write_tokens', reasoning: 'reasoning_tokens' }

export const contextLabels = {
  system: '系统提示', tool_schemas: '工具定义', output_schema: '输出格式', tool_index: '工具目录',
  skill_catalog: '技能目录', agent_catalog: 'Agent 目录', active_skills: '已加载技能', memory: '记忆',
  bootstrap: '工作区指引', history: '历史消息', user: '当前输入',
}

export function traceQuery(kind, sessionKey, turnId, requestId, conversation) {
  const query = new URLSearchParams({ sessionKey })
  if (conversation) query.set('conversation', JSON.stringify(conversation))
  if (turnId) query.set('turnId', turnId)
  if (requestId) query.set('requestId', requestId)
  return `/api/agent/trace-archive/${kind}?${query}`
}

function invalid(locale) { throw new Error(translate(locale, '轨迹响应与当前会话不匹配，或格式无效。')) }
function validCall(call) {
  return object(call) && Object.values(usageFields).every(field => call[field] === undefined || number(call[field]))
    && (call.reported === undefined || object(call.reported) && Object.values(call.reported).every(value => typeof value === 'boolean'))
}
function validBudget(budget) {
  return budget === undefined || object(budget) && number(budget.total_tokens) && object(budget.segments)
    && Object.values(budget.segments).every(number)
}
function validOrigin(origin) {
  return origin === undefined || object(origin) && (origin.conversation === undefined || diagnosticConversationKey(origin.conversation) !== undefined)
    && (origin.messageId === undefined || text(origin.messageId))
}

export function readTraceTurns(body, sessionKey, locale = 'zh-CN', conversation) {
  if (body?.success !== true || !Array.isArray(body.data)) invalid(locale)
  const seen = new Set()
  return body.data.map(row => {
    if (!object(row) || row.session_key !== sessionKey || !text(row.turn_id) || seen.has(row.turn_id)
      || !number(row.started_at) || !Number.isFinite(new Date(row.started_at).getTime()) || !text(row.termination?.status) || !validOrigin(row.origin)
      || conversation && diagnosticConversationKey(row.origin?.conversation) !== diagnosticConversationKey(conversation)
      || row.usage_calls !== undefined && (!Array.isArray(row.usage_calls) || !row.usage_calls.every(validCall))
      || !validBudget(row.context_budget)) invalid(locale)
    seen.add(row.turn_id)
    return row
  })
}

export function readTraceDetail(body, sessionKey, turnId, locale = 'zh-CN', conversation) {
  const trace = body?.data
  if (body?.success !== true || !object(trace) || trace.session_key !== sessionKey || trace.turn_id !== turnId
    || conversation && diagnosticConversationKey(trace.origin?.conversation) !== diagnosticConversationKey(conversation)
    || !Array.isArray(trace.model_calls) || !trace.model_calls.every(validCall)
    || !Array.isArray(trace.tool_calls) || !Array.isArray(trace.subagents) || !validBudget(trace.context_budget)
    || trace.requests !== undefined && (!Array.isArray(trace.requests) || !trace.requests.every(validRequest))) invalid(locale)
  return trace
}

function validRequest(request) {
  return object(request) && text(request.request_id) && number(request.index) && text(request.status)
    && text(request.body_status) && number(request.started_at)
}

export function readTraceRequest(body, sessionKey, turnId, requestId, locale = 'zh-CN') {
  const envelope = body?.data
  const data = envelope?.request
  if (body?.success !== true || envelope?.session_key !== sessionKey || envelope?.turn_id !== turnId
    || data?.request_id !== requestId || !validRequest(data)) invalid(locale)
  const requestBody = data.body
  if (requestBody !== undefined && (!object(requestBody) || !Array.isArray(requestBody.messages)
    || !Array.isArray(requestBody.tools) || requestBody.messages.some(message => !object(message) || !text(message.role)))) invalid(locale)
  if (envelope.usage !== undefined && (!validCall(envelope.usage) || envelope.usage.request_id !== requestId)) invalid(locale)
  return { ...data, ...(envelope.usage ? { usage: envelope.usage } : {}) }
}

/** The list's usage_calls already includes subagents; never add the nested tree a second time. */
export function traceUsage(turns) {
  return Object.fromEntries(Object.entries(usageFields).map(([key, field]) => {
    const samples = turns.flatMap(turn => turn.usage_calls === undefined ? [key === 'totalTokens' && number(turn.total_tokens) && turn.total_tokens > 0 ? turn.total_tokens : undefined] : turn.usage_calls.map(call => {
      const value = call[field]
      if (!number(value)) return undefined
      const reported = call.reported?.[key] ?? (['cacheRead', 'cacheWrite', 'reasoning'].includes(key) || value > 0)
      return reported ? value : undefined
    }))
    const known = samples.filter(value => value !== undefined)
    return [key, { value: known.length || !samples.length ? known.reduce((sum, value) => sum + value, 0) : null, partial: known.length !== samples.length }]
  }))
}

export function formatTraceMetric(metric, locale = 'zh-CN') {
  return metric.value === null ? '—' : `${metric.partial ? '≥ ' : ''}${new Intl.NumberFormat(locale).format(metric.value)}`
}

/** Correlate only an exact canonical origin; timestamps and display aliases are not identity. */
export function turnsForMessage(turns, ref) {
  const key = diagnosticConversationKey(ref?.conversation)
  return key && text(ref?.id) ? turns.filter(turn => turn.origin?.messageId === ref.id
    && diagnosticConversationKey(turn.origin.conversation) === key) : []
}

export function traceFailure(status, locale = 'zh-CN') {
  return translate(locale, status === 403 ? '当前身份无权读取轨迹。'
    : status === 404 ? '记录已不可用，或 Host 尚不支持此功能。'
      : status === 503 ? '轨迹暂不可用，请稍后重试。' : '轨迹读取失败，请重试。')
}

const statusLabels = { completed: '已完成', running: '进行中', failed: '失败', cancelled: '已取消', budget_exceeded: '达到用量上限', unknown: '状态未知', ok: '成功', denied: '已拒绝' }
export function traceStatus(status, locale = 'zh-CN') { return translate(locale, statusLabels[status] ?? '状态未知') }

const bodyLabels = { disabled: '未开启正文记录', unsupported: '此请求未记录正文', too_large: '正文超过记录容量', capture_failed: '正文记录失败', expired: '正文已过期' }
export function traceBodyStatus(status, locale = 'zh-CN') { return translate(locale, bodyLabels[status] ?? '此请求未记录正文') }

/** Keep text verbatim; non-text projected parts remain readable without loading remote assets. */
export function promptContent(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.map(part => object(part) && part.type === 'text' && typeof part.text === 'string'
    ? part.text : JSON.stringify(part, null, 2)).join('\n\n')
  return content === undefined ? '' : JSON.stringify(content, null, 2)
}
