/**
 * Task-oriented navigation vocabulary shared by route registration and shell surfaces.
 *
 * Builtin pages follow the user's work: conversations, tasks, accounts and plugins.
 * Settings and operations live in the sidebar footer. Legacy group values remain
 * available to plugins that declare their own navigation metadata.
 */
export const NAV_GROUPS = {
  WORK: '会话',
  TASKS: '任务',
  ACCOUNTS: '聊天账号',
  PLUGINS: '插件',
  SETTINGS: '设置',
  OPERATIONS: '运行维护',
  // Keep published plugin group names unchanged.
  DAILY: '常用',
  BOT: '机器人',
  FEATURES: '功能',
  ADVANCED: '高级',
  OTHER: '其他',
} as const

export const PRIMARY_NAV_GROUP_ORDER = [
  NAV_GROUPS.WORK,
  NAV_GROUPS.TASKS,
  NAV_GROUPS.ACCOUNTS,
  NAV_GROUPS.PLUGINS,
] as const

export const FOOTER_NAV_GROUP_ORDER = [NAV_GROUPS.SETTINGS, NAV_GROUPS.OPERATIONS] as const

export const NAV_GROUP_ORDER = [...PRIMARY_NAV_GROUP_ORDER, ...FOOTER_NAV_GROUP_ORDER] as const

/** Preserve folding for plugin pages that explicitly use the legacy advanced group. */
export const COLLAPSED_BY_DEFAULT_NAV_GROUPS: readonly string[] = [NAV_GROUPS.ADVANCED]

/**
 * The Sandbox is the conversation entry. Other ungrouped plugin pages belong to
 * plugins; explicit provider groups and display metadata are preserved.
 */
export const PLUGIN_PAGE_PLACEMENT: Readonly<Record<string, { group: string; order: number }>> = {
  '/sandbox': { group: NAV_GROUPS.WORK, order: 0 },
}

export function placePluginRoute<T extends { path?: string; meta?: Record<string, unknown> }>(route: T): T {
  if (route.meta?.group || !route.path) return route
  const placement: { group: string; order?: number } = PLUGIN_PAGE_PLACEMENT[route.path] ?? { group: NAV_GROUPS.PLUGINS }
  return { ...route, meta: { ...route.meta, group: placement.group, order: route.meta?.order ?? placement.order } }
}

export const COMMAND_GROUP_ORDER = [
  '快捷动作',
  ...NAV_GROUP_ORDER,
] as const
