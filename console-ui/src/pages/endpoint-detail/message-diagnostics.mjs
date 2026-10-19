import { readRendering } from './rendering-diagnostics.mjs'

const kinds = new Set(['private', 'group', 'channel'])
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 2048
export const DIAGNOSTIC_RETENTION = '仅保留最近 15 分钟、最多 500 条进程内记录；重启后清空。未找到不代表消息没有问题。'
export function validDiagnosticConversation(value) {
  return !!value && text(value.endpoint?.id) && text(value.endpoint?.adapter) && kinds.has(value.kind) && text(value.id)
    && (value.parent === undefined || !!value.parent && kinds.has(value.parent.kind) && text(value.parent.id))
    && (value.threadId === undefined || text(value.threadId))
}
export function diagnosticConversationKey(value) {
  if (!validDiagnosticConversation(value)) return undefined
  return JSON.stringify([value.endpoint.adapter, value.endpoint.id, value.kind, value.id, value.parent?.kind ?? null, value.parent?.id ?? null, value.threadId ?? null])
}
export function diagnosticTarget(message) {
  if (message?.outgoing !== false || message?.directionUnknown || message?.local) return { reason: '仅支持方向明确的入站消息；历史方向未知时无法查询。' }
  if (!validDiagnosticConversation(message.conversation)) return { reason: '该消息没有 Host 提供的完整会话身份，无法精确查询。请等待新的入站消息。' }
  if (!text(message.messageId)) return { reason: '该消息缺少平台消息 ID，无法精确查询；不会使用正文或本地记录 ID 猜测。' }
  return { conversation: message.conversation, messageId: message.messageId }
}
export function conversationDiagnosticTarget(endpoint, selection) {
  if (selection?.type !== 'channel' || !['private', 'group', 'channel'].includes(selection.channelType)) return { reason: '请选择明确的会话。' }
  if (selection.parent && !['group', 'guild'].includes(selection.parent.type)) return { reason: '父容器身份无效，无法精确查询。' }
  const conversation = { endpoint, kind: selection.channelType, id: selection.id,
    ...(selection.parent ? { parent: { kind: selection.parent.type === 'guild' ? 'channel' : 'group', id: selection.parent.id } } : {}),
    ...(selection.threadId !== undefined ? { threadId: selection.threadId } : {}) }
  if (!validDiagnosticConversation(conversation)) return { reason: '尚未获得 Host 提供的完整 Endpoint 和会话身份，无法查询。' }
  return { conversation }
}
export function diagnosticQuery(target) {
  if (!validDiagnosticConversation(target?.conversation) || target.messageId !== undefined && !text(target.messageId)) throw new Error('缺少精确消息身份')
  return new URLSearchParams({ conversation: JSON.stringify(target.conversation), ...(target.messageId !== undefined ? { messageId: target.messageId } : {}), limit: target.messageId !== undefined ? '10' : '50' }).toString()
}
const stages = new Set(['received', 'origin', 'prefix', 'middleware', 'handlers', 'dispatch', 'delivery'])
const stepStatuses = new Set(['accepted', 'human', 'member', 'peer_bot', 'self', 'unclassified', 'matched', 'mismatch', 'empty_input', 'commands_unavailable', 'started', 'entered', 'stopped', 'replaced', 'completed', 'unmatched', 'invalid', 'denied', 'executed', 'interaction', 'middleware', 'command', 'agent', 'self_echo', 'duplicate', 'bot_origin', 'dedup_error', 'sent', 'failed', 'unsupported', 'rejected', 'suppressed', 'unknown'])
const routes = new Set(['interaction', 'middleware', 'command', 'agent', 'unmatched', 'self_echo', 'duplicate', 'bot_origin', 'dedup_error'])
const deliveryStatuses = new Set(['sent', 'failed', 'unsupported', 'rejected', 'suppressed'])
export function readMessageDiagnostics(body, target) {
  if (!validDiagnosticConversation(target?.conversation) || body?.success !== true || !Array.isArray(body.data) || body.data.length > (target.messageId !== undefined ? 10 : 50)) throw new Error('消息诊断响应格式无效，请刷新或更新 Host。')
  return body.data.map(item => {
    if (!item || !text(item.id) || !Number.isSafeInteger(item.generation) || item.generation < 0
      || diagnosticConversationKey(item.conversation) !== diagnosticConversationKey(target.conversation)
      || item.messageId !== undefined && !text(item.messageId) || target.messageId !== undefined && item.messageId !== target.messageId
      || !Number.isFinite(item.startedAt) || item.endedAt !== undefined && !Number.isFinite(item.endedAt)
      || !['processing', 'completed', 'failed'].includes(item.status) || item.route !== undefined && !routes.has(item.route)
      || typeof item.truncated !== 'boolean'
      || item.dispatchStatus !== undefined && !['unmatched', 'invalid', 'denied', 'executed'].includes(item.dispatchStatus)
      || !Array.isArray(item.steps) || item.steps.length > 32 || !Array.isArray(item.deliveries) || item.deliveries.length > 32
      || item.command !== undefined && (typeof item.command !== 'string' || item.command.length > 200)) throw new Error('消息诊断身份或字段无效，未展示可能属于其他会话的记录。')
    const steps = item.steps.map(step => {
      if (!step || !stages.has(step.stage) || !stepStatuses.has(step.status) || !Number.isFinite(step.at)) throw new Error('诊断步骤格式无效。')
      return { stage: step.stage, status: step.status, at: step.at }
    })
    const deliveries = item.deliveries.map(delivery => {
      if (!delivery || !validDiagnosticConversation(delivery.conversation) || !deliveryStatuses.has(delivery.status)
        || delivery.deliveryUnknown !== undefined && typeof delivery.deliveryUnknown !== 'boolean'
        || delivery.failureCode !== undefined && (typeof delivery.failureCode !== 'string' || !/^[a-z0-9_]{1,96}$/u.test(delivery.failureCode))) throw new Error('投递诊断格式无效。')
      const rendering = readRendering(delivery.rendering)
      return { conversation: delivery.conversation, status: delivery.status,
        ...(delivery.failureCode !== undefined ? { failureCode: delivery.failureCode } : {}),
        ...(delivery.deliveryUnknown !== undefined ? { deliveryUnknown: delivery.deliveryUnknown } : {}),
        ...(rendering !== undefined ? { rendering } : {}) }
    })
    return { id: item.id, generation: item.generation, conversation: item.conversation,
      ...(item.messageId !== undefined ? { messageId: item.messageId } : {}), startedAt: item.startedAt,
      ...(item.endedAt !== undefined ? { endedAt: item.endedAt } : {}), status: item.status, truncated: item.truncated,
      ...(item.route !== undefined ? { route: item.route } : {}), ...(item.command !== undefined ? { command: item.command } : {}),
      ...(item.dispatchStatus !== undefined ? { dispatchStatus: item.dispatchStatus } : {}), steps, deliveries }
  })
}
const labels = {
  received: '接收消息', origin: '来源判断', prefix: '指令前缀', middleware: '中间件', handlers: '消息事件处理器', dispatch: '分派', delivery: '投递',
  accepted: '已接收', human: '人类消息', member: '协作成员 Bot', peer_bot: '其他 Bot', self: '自身', unclassified: '来源未分类',
  matched: '已匹配', mismatch: '前缀不匹配', empty_input: '输入为空', commands_unavailable: '指令能力不可用', started: '已开始',
  entered: '已进入', stopped: '链路已停止', replaced: '返回内容已替换', completed: '本阶段已结束', unmatched: '未匹配指令',
  invalid: '参数或格式无效', denied: '权限未通过', executed: '指令已执行', interaction: '交互回调', command: '指令', agent: '已交给 Agent',
  self_echo: '自身消息回声', duplicate: '重复消息', bot_origin: 'Bot 来源被拦截', dedup_error: '去重检查失败',
  sent: '平台已受理', failed: '失败', unsupported: '不支持', rejected: '已拒绝', suppressed: '已拦截', unknown: '投递结果不确定', processing: '入站处理中',
}
export function diagnosticLabel(value) { return labels[value] ?? '未识别的状态' }
export function diagnosticAdvice(record) {
  const advice = []
  if (record.route === 'agent') advice.push('消息已交给 Agent；请在 Agent 运行记录查看后续工具、审批和回复。这里不代表 Agent 已完成。')
  if (record.status === 'processing') advice.push('入站处理仍在进行，可稍后手动刷新；不会重放消息。')
  if (record.dispatchStatus === 'denied') advice.push('请检查该指令的权限规则与发送者在目标会话中的真实角色。')
  if (record.dispatchStatus === 'invalid') advice.push('请查看该指令的帮助，核对参数和输入格式。')
  if (record.steps.some(step => step.stage === 'prefix' && step.status === 'mismatch')) advice.push('请核对本账号的指令前缀；前缀未匹配也可能继续走普通聊天链路。')
  if (record.steps.some(step => step.stage === 'middleware' && step.status === 'failed')) advice.push('入站中间件执行失败，请检查对应插件与 Host 日志；诊断不记录消息正文和原始异常。')
  if (record.status === 'failed' && record.steps.some(step => step.stage === 'middleware' && step.status === 'entered')
    && !record.steps.some(step => step.stage === 'middleware' && step.status === 'completed')) advice.push('中间件链尚未结束，异常也可能来自下游处理；请结合此时刻的 Host 日志定位对应插件。')
  if (record.status === 'failed' && record.steps.some(step => step.stage === 'handlers' && step.status === 'started')
    && !record.steps.some(step => step.stage === 'handlers' && step.status === 'completed')) advice.push('消息事件处理器尚未结束，请检查相应 handler 插件和 Host 日志。')
  if (record.deliveries.some(delivery => delivery.failureCode === 'outbound_middleware_failed')) advice.push('出站中间件执行失败，请检查审核或改写插件的日志与配置。')
  if (record.deliveries.some(delivery => delivery.deliveryUnknown)) advice.push('投递结果不确定，请先到实际目标会话核实，避免重复发送。本面板不会自动重试。')
  if (record.deliveries.some(delivery => delivery.status !== 'sent' && !delivery.deliveryUnknown)) advice.push('有投递未被平台受理，请检查实际目标、Endpoint 连接与目标支持的消息能力。')
  if (record.status === 'failed' && !advice.length) advice.push('入站处理失败，请结合此时刻的 Host 日志检查插件；不要直接重发可能产生副作用的操作。')
  if (!record.deliveries.length) advice.push('此记录没有关联投递；链路可能未产生回复，或后续工作在独立任务中继续。')
  return advice
}
/** Cancellation and supersession invalidate responses even if fetch ignores AbortSignal. */
export function createDiagnosticRequestGate(readScope = () => undefined) {
  let active
  return {
    begin() {
      active?.abort()
      const controller = new AbortController(), scope = readScope(); active = controller
      return { signal: controller.signal, current: () => active === controller && !controller.signal.aborted && readScope() === scope }
    },
    cancel() { active?.abort(); active = undefined },
  }
}
