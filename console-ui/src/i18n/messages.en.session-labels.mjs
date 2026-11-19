/** Session names on 聊天记录 / 机器人状态 / 工具审批 (hashed session keys, zhin 1.9). */
export const sessionLabelMessages = Object.freeze({
  "其他 {0} 个": "{0} other",
  "这里不显示个人会话的对话": "Personal session conversations aren't shown here",
  "为保护隐私，个人会话的对话内容不在这里显示，Console 也还不能把它对应到原来的聊天。对话本身仍在原来的聊天里：请到它所在的平台或沙盒查看；每一轮的处理过程可在「轨迹」页签查看。":
    "To protect privacy, the conversation of a personal session isn't shown here, and the Console can't link it to its chat yet. The conversation itself is still in the original chat: open it on its platform or in the Sandbox. Open the \"Trace\" tab to see how each turn was handled.",
  "在本浏览器打开过": "Opened in this browser",
  "这里不显示定时任务的对话": "Scheduled task conversations aren't shown here",
  "这里还不显示这个会话的对话": "This session's conversation isn't shown here yet",
  "定时任务按计划运行，Console 这里不显示它的对话内容；每一轮的处理过程可在「轨迹」页签查看，任务本身在「定时任务」页。":
    "Scheduled tasks run on their schedule, and the Console doesn't show their conversation here. Open the \"Trace\" tab to see how each turn was handled; the task itself is on the \"Scheduled tasks\" page.",
  "Console 还不能把这个会话对应到原来的聊天，所以这里暂不显示对话内容。对话本身仍在原来的聊天里，请到它所在的平台查看；每一轮的处理过程可在「轨迹」页签查看。":
    "The Console can't link this session to its chat yet, so its conversation isn't shown here. The conversation itself is still in the original chat: open it on its platform. Open the \"Trace\" tab to see how each turn was handled.",
})
