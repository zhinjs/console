/** 适配器能力判断（与 Host endpoint:* RPC 行为对齐） */

export function isIcqqAdapter(adapter: string): boolean {
  return adapter === 'icqq' || adapter.endsWith('/icqq') || adapter.includes('adapter-icqq')
}

export function adapterListHint(adapter: string): string {
  if (isIcqqAdapter(adapter)) {
    return 'ICQQ 需已登录且在线；好友/群列表在连接成功后由 Host 同步。'
  }
  if (adapter === 'qq') {
    return 'QQ 官方机器人通过频道列表展示会话。'
  }
  if (adapter === 'napcat') {
    return 'NapCat 通过 OneBot 好友/群列表拉取会话。'
  }
  return `适配器「${adapter}」可能不支持好友列表，将尝试从收件箱历史恢复最近会话。`
}
