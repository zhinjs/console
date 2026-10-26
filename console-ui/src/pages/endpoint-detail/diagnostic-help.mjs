import { translate } from '../../i18n/locale.mjs'
// Fixed public documentation links. No conversation, token, body or exception is
// interpolated into a URL, and selecting help never replays an operation.
const base = 'https://zhin.js.org/troubleshooting/messages'
const topics = Object.freeze({
  overview: ['如何阅读消息诊断', ''],
  prefix: ['确认当前账号的命令前缀', 'command-prefix'],
  input: ['按命令帮助修正输入', 'command-input'],
  permission: ['核对权限规则与真实身份', 'permission-denied'],
  plugin: ['定位中间件或消息处理器问题', 'plugin-errors'],
  agent: ['查看 Agent 后续运行', 'agent-running'],
  delivery: ['检查实际目标与消息能力', 'delivery-failed'],
  unknown: ['投递不确定时如何核实', 'delivery-unknown'],
  rendering: ['检查图片和文字降级', 'message-rendering'],
})

export function diagnosticHelpLinks(record, locale = 'zh-CN') {
  const selected = new Set(['overview'])
  const incomplete = (stage, start) => record.steps.some(step => step.stage === stage && step.status === start)
    && !record.steps.some(step => step.stage === stage && step.status === 'completed')
  if (record.steps.some(step => step.stage === 'prefix' && step.status === 'mismatch')) selected.add('prefix')
  if (record.dispatchStatus === 'invalid') selected.add('input')
  if (record.dispatchStatus === 'denied') selected.add('permission')
  if (record.steps.some(step => ['middleware', 'handlers'].includes(step.stage) && step.status === 'failed')
    || record.status === 'failed' && (incomplete('middleware', 'entered') || incomplete('handlers', 'started'))
    || record.deliveries.some(item => item.failureCode === 'outbound_middleware_failed')) selected.add('plugin')
  if (record.route === 'agent') selected.add('agent')
  if (record.deliveries.some(item => item.deliveryUnknown || item.status === 'unknown')) selected.add('unknown')
  if (record.deliveries.some(item => item.status !== 'sent' && !item.deliveryUnknown && item.status !== 'unknown')) selected.add('delivery')
  if (record.deliveries.some(item => item.rendering?.fallbacks?.length)) selected.add('rendering')
  return [...selected].map(key => ({ id: key, label: translate(locale, topics[key][0]), href: base + (topics[key][1] ? `#${topics[key][1]}` : '') }))
}
