/** Task-oriented navigation vocabulary shared by route registration and shell surfaces. */
export const NAV_GROUPS = {
  OVERVIEW: '总览',
  CONVERSATIONS: '对话与渠道',
  AGENTS: 'Agent 与 Workroom',
  AUTOMATION: '自动化与扩展',
  SYSTEM: '系统',
  OTHER: '其他',
} as const

export const NAV_GROUP_ORDER = [
  NAV_GROUPS.OVERVIEW,
  NAV_GROUPS.CONVERSATIONS,
  NAV_GROUPS.AGENTS,
  NAV_GROUPS.AUTOMATION,
  NAV_GROUPS.SYSTEM,
  NAV_GROUPS.OTHER,
] as const

export const COMMAND_GROUP_ORDER = [
  '快捷动作',
  NAV_GROUPS.CONVERSATIONS,
  NAV_GROUPS.AGENTS,
  NAV_GROUPS.AUTOMATION,
  NAV_GROUPS.SYSTEM,
  NAV_GROUPS.OVERVIEW,
  NAV_GROUPS.OTHER,
] as const
