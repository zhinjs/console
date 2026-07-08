/** 适配器能力判断（与 Host endpoint:* RPC 行为对齐） */

export function isIcqqAdapter(adapter: string): boolean {
  return adapter === 'icqq' || adapter.endsWith('/icqq') || adapter.includes('adapter-icqq')
}

export function isQqAdapter(adapter: string): boolean {
  return adapter === 'qq' || adapter.endsWith('/qq') || adapter.includes('adapter-qq')
}

export function adapterListHint(adapter: string): string {
  if (isIcqqAdapter(adapter)) {
    return 'ICQQ 需已登录且在线；好友/群/频道列表在连接成功后由 Host 同步。'
  }
  if (isQqAdapter(adapter)) {
    return 'QQ 官方机器人通过 endpoint:channels 拉取子频道列表。'
  }
  if (adapter === 'napcat') {
    return 'NapCat 通过 OneBot 好友/群列表拉取会话；频道走 endpoint:channels。'
  }
  return `适配器「${adapter}」通过 endpoint:channels 拉取频道；若无数据将尝试从收件箱历史恢复。`
}

export function adapterSupportsPrivateGroups(adapter: string): boolean {
  return isIcqqAdapter(adapter) || adapter === 'napcat'
}

/** 所有适配器均已提供 endpoint:channels（无能力时 Host 返回空列表或明确错误） */
export function adapterSupportsChannels(_adapter: string): boolean {
  return true
}

export function sectionEmptyHint(
  adapter: string,
  section: 'private' | 'group' | 'channel',
): string {
  if (section === 'private') {
    if (adapterSupportsPrivateGroups(adapter)) return '暂无好友会话'
    return '此适配器无私聊列表'
  }
  if (section === 'group') {
    if (adapterSupportsPrivateGroups(adapter)) return '暂无群聊'
    return '此适配器无群聊列表'
  }
  if (isIcqqAdapter(adapter)) return '暂无 QQ 频道子频道'
  if (isQqAdapter(adapter)) return '暂无频道'
  return '暂无频道会话'
}
