import { translate } from '../../i18n/locale.mjs'
import { statusFromError } from '../../components/status-state-model.mjs'

/**
 * Why the whole list failed, for the first failure in `causes` (the errors themselves, not their text).
 * A retry cannot fix an old Host or a missing permission, so those say what to do instead.
 */
const FAILED_LIST_COPY = Object.freeze({
  unsupported: '当前 Host 不支持读取会话列表，升级 Host 后再试。',
  forbidden: '当前身份没有读取会话列表的权限，重试不会成功。请联系管理员授予账号会话的查看权限。',
  'instance-unavailable': 'Zhin 实例暂时没有响应，会话列表读不到。实例恢复后点刷新。',
  disconnected: '与 Host 的连接已断开，恢复后点刷新重新读取会话列表。',
})

/** The adapter has no such list (e.g. sandbox has no channels): not a failure, the section is hidden. */
const LIST_UNSUPPORTED = /不支持(?:频道|好友|群|群组|私聊)?列表|does not support (?:channel|friend|group)s?(?: list)?|(?:channel|friend|group) list(?:s)? (?:is |are )?not supported/iu

export function listUnsupported(error) {
  const message = String(error instanceof Error ? error.message : error?.message ?? error ?? '')
  return LIST_UNSUPPORTED.test(message)
}

export function conversationListNotice({total, errors = [], causes = [], connected, historyOnly = false}, locale = 'zh-CN') {
  if (errors.length) {
    if (total > 0) return {text: translate(locale, "部分会话未能读取，当前显示已获取的会话。"), tone: 'warning', details: errors.join('；')}
    const kind = causes.length ? statusFromError(causes[0]).kind : undefined
    const copy = kind && FAILED_LIST_COPY[kind]
    return {text: translate(locale, copy || "会话列表读取失败，请重试。"), tone: 'error', details: errors.join('；'), ...(kind ? {kind} : {})}
  }
  if (total === 0) return {text: connected === false ? translate(locale, "渠道离线，暂未获取到会话。") : connected === true ? translate(locale, "暂无会话。") : translate(locale, "尚未获取到会话。"), tone: 'neutral'}
  if (historyOnly) return {text:translate(locale, "当前显示历史会话。"),tone:'neutral'}
  return null
}
