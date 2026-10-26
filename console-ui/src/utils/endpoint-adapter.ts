import { translate } from '../i18n/locale.mjs'
/** 适配器能力判断（与 Host Endpoint management port 行为对齐） */

export function isIcqqAdapter(adapter: string): boolean {
  return adapter === 'icqq' || adapter.endsWith('/icqq') || adapter.includes('adapter-icqq')
}

export function isQqAdapter(adapter: string): boolean {
  return adapter === 'qq' || adapter.endsWith('/qq') || adapter.includes('adapter-qq')
}

export function adapterListHint(adapter: string, locale: 'zh-CN' | 'en' = 'zh-CN'): string {
  if (isIcqqAdapter(adapter)) {
    return translate(locale, "ICQQ 需已登录且在线；好友/群/频道列表在连接成功后由 Host 同步。")
  }
  if (isQqAdapter(adapter)) {
    return translate(locale, "QQ 官方机器人通过 Endpoint 频道目录拉取子频道。")
  }
  if (adapter === 'napcat') {
    return translate(locale, "NapCat 通过 OneBot 好友/群列表拉取会话；频道走 Endpoint 频道目录。")
  }
  return translate(locale, "适配器「{0}」通过 Endpoint 频道目录拉取频道；若无数据将尝试从收件箱历史恢复。", [adapter])
}

export function adapterSupportsPrivateGroups(adapter: string): boolean {
  return isIcqqAdapter(adapter) || adapter === 'napcat'
}

/** 所有适配器均通过统一 Endpoint 频道目录暴露能力。 */
export function adapterSupportsChannels(_adapter: string): boolean {
  return true
}

export function sectionEmptyHint(
  adapter: string,
  section: 'private' | 'group' | 'channel', locale: 'zh-CN' | 'en' = 'zh-CN'
): string {
  if (section === 'private') {
    if (adapterSupportsPrivateGroups(adapter)) return translate(locale, "暂无好友会话")
    return translate(locale, "此适配器无私聊列表")
  }
  if (section === 'group') {
    if (adapterSupportsPrivateGroups(adapter)) return translate(locale, "暂无群聊")
    return translate(locale, "此适配器无群聊列表")
  }
  if (isIcqqAdapter(adapter)) return translate(locale, "暂无 QQ 频道子频道")
  if (isQqAdapter(adapter)) return translate(locale, "暂无频道")
  return translate(locale, "暂无频道会话")
}
