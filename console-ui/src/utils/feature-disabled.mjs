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
})

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
