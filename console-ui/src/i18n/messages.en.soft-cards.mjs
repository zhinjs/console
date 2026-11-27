/**
 * English copy added with the soft-card redesign (@zhin.js/console-ui 1.3.0, ADR 0063 D34–D41):
 * the top-bar shell, the section sub-navigation, the reworked first-level pages and the copy the
 * Console hands to the component library (ConsoleUiLocale).
 */
export const softCardMessages = Object.freeze({
  // ConsoleUiLocale: Stepper and Toast
  "减少": "Decrease",
  "增加": "Increase",
  "toast\u0004撤销": "Undo",
  // Shell: top bar, section Chips, phone tab bar
  "{0}的页面": "{0} pages",
  "更多": "More",
  // Onboarding banners
  "还没有所有者": "No owner yet",
  "没有访问令牌也没有所有者，任何能访问的人都有全部权限": "no access token and no owner, so anyone who can reach it has full access",
  "机器人还没上线": "Bot not live yet",
  // Overview (Main design)
  "待登录": "Sign-in needed",
  "页面导航、配置入口和能力目录保持可用。重新连接后，聊天账号、Agent 与运行状态会在这里恢复。": "Navigation, configuration and the capability catalog stay available. Chat accounts, Agent and runtime status return here after reconnecting.",
  "实例运行正常": "Instance is healthy",
  "连接需要恢复": "Reconnect needed",
  "需留意": "Needs a look",
  "{0} 在线": "{0} online",
  "个": "",
  "已启用插件": "Plugins on",
  "条": "",
  "24 小时消息": "Messages, 24 h",
  "看日志": "View logs",
  "需处理": "To do",
  "没有要处理的": "Nothing to do",
  "正在读取聊天账号": "Loading chat accounts",
  "最近会话": "Recent chats",
  // 账号与会话 (Accounts design)
  "{0} 需要{1}": "{0} needs {1}",
  "还有 {0} 个": "{0} more",
  "去登录": "Sign in",
  // AI 与模型 (Models design)
  "默认聊天模型": "Default chat model",
  "失败时依次换到 {0} 个备用模型": { "one": "Falls back to {0} backup model", "other": "Falls back to {0} backup models in turn" },
  "没有备用模型": "No backup model",
  "换模型": "Change",
  // 插件 (Plugins design)
  "安装插件": "Install",
  "{0} 个插件需处理": { "one": "{0} plugin needs a look", "other": "{0} plugins need a look" },
  // 运维 · 实例 (Ops design): the unit after a count shown on its own (pass the count as {0}).
  "次": { "one": "time", "other": "times" },
  // Appearance
  "浅色": "Light",
  "深色": "Dark",
})
