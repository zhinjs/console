/**
 * A feature of the instance that is off (zhinjs/zhin#1250 `disabled-feature-as-read-failure`): the
 * Host answers the read with 200 and `data: { status: 'disabled', reason, message }` (an empty
 * payload beside it) instead of failing. Callers show 「未启用」 with the reason, not a read failure.
 * Older Hosts never send it, so their replies keep their previous meaning. Pure.
 */
import { isConsoleFeatureDisabled } from '@zhin.js/console-protocol'
import { translate } from '../i18n/locale.mjs'

const REASONS = Object.freeze({
  'agent-not-installed': '没有安装 AI 智能体（@zhin.js/agent）。运行 zhin setup --ai，或在 Console 引导中启用 AI 后可用。',
  'agent-disabled': 'AI 智能体没有启用。在 Console 引导或配置中启用 AI 后可用。',
  'assistant-disabled': '助手没有启用。在配置中设置 assistant.enabled: true 后可用。',
  'agent-unavailable': '这里需要 AI 智能体（@zhin.js/agent），当前实例没有安装或没有启用它。运行 zhin setup --ai，或到「AI 与模型」接入 AI 后可用。',
})

/**
 * The Host's fixed texts for a read that needs the Agent while the instance has none (503): the
 * Agent console routes and RPCs answer 「Agent Runtime 尚未就绪」, the trace archive
 * 「未安装 @zhin.js/agent，无法读取 trace」, the bindings summary 「Agent runtime 未装配」. Only these
 * texts count: a gateway 503 (`instance_unavailable`), a 403 or a network failure stay failures.
 */
const AGENT_UNAVAILABLE_TEXTS = Object.freeze([
  /Agent Runtime 尚未就绪/iu,
  /Agent runtime 未装配/iu,
  /未安装 @zhin\.js\/agent/u,
  /\bAgent runtime is not (?:ready|available|installed)\b/iu,
  /@zhin\.js\/agent is not installed/iu,
])

const isRecord = value => value !== null && typeof value === 'object'

function replyText(reply) {
  if (typeof reply === 'string') return reply
  if (reply instanceof Error) return reply.message
  if (!isRecord(reply)) return ''
  const body = isRecord(reply.body) ? reply.body : reply
  for (const value of [body.error, body.message, reply.error, reply.message]) if (typeof value === 'string' && value) return value
  return ''
}

/**
 * `{ reason, description }` when `data` is a disabled-feature state, else null. `description` is
 * the localized explanation with the next step; an unknown reason keeps the Host's own message.
 */
export function featureDisabledState(data, locale = 'zh-CN') {
  if (!isConsoleFeatureDisabled(data)) return null
  const known = Object.hasOwn(REASONS, data.reason)
  const description = known ? translate(locale, REASONS[data.reason])
    : typeof data.message === 'string' && data.message.trim() ? data.message.trim() : translate(locale, '此功能没有启用。')
  return { reason: data.reason, description }
}

/**
 * 「功能未启用」 for a failed read whose feature is off (zhinjs/zhin#1250 `disabled-feature-as-read-failure`):
 * a reply carrying the disabled state above, or a 503 / error text saying the instance has no
 * Agent (the Workroom SDK hook keeps only the text; `apiFetch` callers pass `{ status, body }`).
 * Anything else — another status, an unrelated text, a network or permission failure — is null:
 * the caller keeps its 「读取失败」.
 */
export function featureUnavailableState(reply, locale = 'zh-CN') {
  const status = isRecord(reply) && !(reply instanceof Error) ? reply.status : undefined
  const body = isRecord(reply) && isRecord(reply.body) ? reply.body : undefined
  const disabled = body ? featureDisabledState(body.data, locale) ?? featureDisabledState(body, locale) : null
  if (disabled) return disabled
  if (status !== undefined && status !== 503) return null
  const text = replyText(reply)
  if (!AGENT_UNAVAILABLE_TEXTS.some(pattern => pattern.test(text))) return null
  return { reason: 'agent-unavailable', description: translate(locale, REASONS['agent-unavailable']) }
}
