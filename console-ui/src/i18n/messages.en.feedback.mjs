/** English copy for the deployment feedback round (zhinjs/zhin#1250): navigation, logs, models, tasks, usage. */
export const feedbackMessages = Object.freeze({
  // Navigation
  "核心": "Core",
  "插件页面": "Plugin pages",
  "Console 角色": "Console roles",
  "Console 角色是一组 Console 权限，决定谁能在 Console 里看和改什么。内置角色只读，可以复制后修改；自定义角色删除时，绑定到它的用户会失去这些权限。机器人在聊天里的权限是「聊天角色」，在账号与会话里设置。":
    "A Console role is a set of Console permissions: who can see and change what in the Console. Built-in roles are read-only; copy one to change it. Deleting a custom role removes its permissions from every user bound to it. What people can do in chat is set by chat roles, under Accounts & conversations.",
  // Instance logs
  "采集于 {0}": "Collected at {0}",
  // Searchable select
  "搜索…": "Search…",
  "没有匹配的选项": "No matching options",
  // AI & models
  "当前聊天模型": "Current chat model",
  "正在使用": "In use",
  "还没有用途引用任何模型；在「用途」页签选择聊天等用途使用的模型。": "No purpose uses a model yet; choose the models for chat and other purposes on the Purposes tab.",
  "未被用途引用的模型（{0}）": "Models no purpose uses ({0})",
  // Scheduled tasks
  "插件内部任务": "Plugin internal tasks",
  "插件自己的轮询、清理与刷盘，通常每隔几秒到几分钟运行一次；不需要你处理，出错时会列在上面。": "A plugin's own polling, cleanup and flushing, usually every few seconds to minutes. Nothing to do here; a failing one is listed above.",
  "插件自己的轮询、清理与刷盘，不需要配置。": "A plugin's own polling, cleanup and flushing; nothing to configure.",
  "最近一次：": "Last run: ",
  "{0} 个已暂停 · 另有 {1} 个插件内部任务": "{0} paused · plus {1} plugin internal tasks",
  // Token usage
  "按本机时区 {0} 显示（实例时区 {1}）": "Shown in this device's time zone {0} (instance: {1})",
  "按本机时区 {0} 显示": "Shown in this device's time zone {0}",
  "每次模型调用的实际输入之和，工具循环里的多次调用都计入": "Actual input of every model call added up, including each call of a tool loop",
  "按模型堆叠；鼠标停在柱子上看具体数值。": "Stacked by model; hover a bar for the numbers.",
  "历史对话、固定提示词、用户输入各占多少。按每个回合的上下文预算估算（每回合一次），所以合计小于上方「总输入」。": "How much is history, fixed prompt and user input. Estimated from each turn's context budget (once per turn), so the sum is below the total input above.",
  // Agent workbench
  "按「AI 与模型 → 用途」实际生效的绑定": "The binding in force under AI & models → Purposes",
  "（跟随「AI 与模型 → 用途」）": "(follows AI & models → Purposes)",
  "最近 7 天还没有 Agent 对话": "No Agent conversations in the last 7 days",
})
