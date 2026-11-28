/**
 * 聊天记录页的页面说明（#64 `sessions-description-permission-mismatch`）。两种能力分开说：
 * `canChat` 能回到会话里接着聊（endpoint.operate），`canBranch` 能从其他消息继续（POST
 * /agent/sessions/<key>/leaf，按协议表查）。两样都没有时才说「只读」。返回中文原文，由页面翻译。
 */
export function sessionsPageDescription({ canChat, canBranch }) {
  if (canChat && canBranch) return '按聊天账号和会话查看机器人和大家聊过什么，可以接着聊，也可以从其他消息继续。'
  if (canChat) return '按聊天账号和会话查看机器人和大家聊过什么，也可以接着聊。'
  if (canBranch) return '按聊天账号和会话查看机器人和大家聊过什么，也可以从其他消息继续。'
  return '按聊天账号和会话查看机器人和大家聊过什么（只读）。'
}
