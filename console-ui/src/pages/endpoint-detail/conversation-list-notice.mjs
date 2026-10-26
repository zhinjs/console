import { translate } from '../../i18n/locale.mjs'
export function conversationListNotice({total, errors = [], connected, historyOnly = false}, locale = 'zh-CN') {
  if (errors.length) return {text: total > 0 ? translate(locale, "部分会话未能读取，当前显示已获取的会话。") : translate(locale, "会话列表读取失败，请重试。"), tone: total > 0 ? 'warning' : 'error', details: errors.join('；')}
  if (total === 0) return {text: connected === false ? translate(locale, "渠道离线，暂未获取到会话。") : connected === true ? translate(locale, "暂无会话。") : translate(locale, "尚未获取到会话。"), tone: 'neutral'}
  if (historyOnly) return {text:translate(locale, "当前显示历史会话。"),tone:'neutral'}
  return null
}
