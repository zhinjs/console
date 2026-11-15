/**
 * Console batch 3: fallback models for every language purpose (#1250), adapter-scoped chat member
 * lists, and the `/features/ai?account=` deep link. Kept apart so parallel page work does not collide.
 */
export const batch3Messages = Object.freeze({
  // Purpose fallbacks
  "聊天模型的优先级：子 Agent 的绑定高于适配器、账号和会话场景的聊天覆盖，这些覆盖又高于默认聊天模型。": "Chat model priority: a sub-agent's binding wins over the chat overrides of adapters, accounts and conversations, and those win over the default chat model.",
  "主模型额度用完、余额不足或密钥被拒时，按顺序换用这一层配置的备用模型。": "When the main model runs out of quota or credit, or its key is rejected, the fallback models set on the same level are tried in order.",
  "{0}备用模型 {1}": "{0} fallback model {1}",
  "调整{0}备用模型 {1}": "Adjust {0} fallback model {1}",
  "添加{0}备用模型": "Add {0} fallback model",
  "上移": "Move up",
  "下移": "Move down",
  "密钥被拒": "Key rejected",
  "连续超时": "Repeated timeouts",
  "上下文超长": "Context too long",
  "暂时不可用": "Temporarily unavailable",
  "暂时跳过：{0}，{1} 恢复": "Skipped for now: {0}; back at {1}",
  "{0}（备选）": "{0} (fallback)",
  "最近的备用模型切换": "Recent switches to a fallback model",
  "{0}：{1} → {2}（{3}）": "{0}: {1} → {2} ({3})",
  "主模型已被跳过": "main model was being skipped",
  // Chat members
  "有全局 iam.manage 时列出全部成员；只在部分适配器上有 iam.manage 时，只列出这些适配器上的身份，同一个人在其他适配器上的身份只显示数量。": "With global iam.manage every member is listed. With iam.manage on some adapters only, identities on those adapters are listed, and a person's identities elsewhere are only counted.",
  "无法读取这些适配器上的成员：{0}。其他适配器的成员照常列出。": "Could not read the members on these adapters: {0}. Members on the other adapters are listed as usual.",
  // Model accounts deep link
  "链接指向的账号不在这里：它可能已被删除，或属于另一个模型管理身份。": "The account in this link is not here: it may have been deleted, or it belongs to another model owner.",
})
