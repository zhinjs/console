/**
 * Task-oriented navigation vocabulary shared by route registration and shell surfaces.
 *
 * Console 面向普通用户（zhinjs/zhin#970）：常用页面放前面并用大白话命名；
 * 配置、自省、文件、数据库等进「高级」，默认折叠。「机器人」分组名是对外约定，
 * 后续「群聊插话」「技能助手」页会挂在它下面，不要改名。
 */
export const NAV_GROUPS = {
  DAILY: '常用',
  BOT: '机器人',
  FEATURES: '功能',
  ADVANCED: '高级',
  OTHER: '其他',
} as const

export const NAV_GROUP_ORDER = [
  NAV_GROUPS.DAILY,
  NAV_GROUPS.BOT,
  NAV_GROUPS.FEATURES,
  NAV_GROUPS.OTHER,
  NAV_GROUPS.ADVANCED,
] as const

/** Groups folded by default in the sidebar; they expand when the current page lives inside. */
export const COLLAPSED_BY_DEFAULT_NAV_GROUPS: readonly string[] = [NAV_GROUPS.ADVANCED]

/**
 * Convention pages from plugins carry no group in their metadata. Known ordinary-user
 * plugin pages are placed here by route; unknown ones stay in「其他」.
 */
export const PLUGIN_PAGE_PLACEMENT: Readonly<Record<string, { group: string; order: number }>> = {
  '/sandbox': { group: NAV_GROUPS.BOT, order: 1 },
}

export function placePluginRoute<T extends { path?: string; meta?: Record<string, unknown> }>(route: T): T {
  if (route.meta?.group || !route.path) return route
  const placement = PLUGIN_PAGE_PLACEMENT[route.path]
  if (!placement) return route
  return { ...route, meta: { ...route.meta, group: placement.group, order: route.meta?.order ?? placement.order } }
}

export const COMMAND_GROUP_ORDER = [
  '快捷动作',
  ...NAV_GROUP_ORDER,
] as const
