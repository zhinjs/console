import { NAV_SECTIONS, resolveSectionId, sectionById } from './navigation-sections.mjs'

/**
 * Navigation vocabulary shared by route registration and shell surfaces.
 *
 * The navigation has six sections (ADR 0052): 概览 / 会话 / 功能 / 插件 are day-to-day work,
 * 运维 / 访问控制 are administration. A route's `meta.group` names its section; legacy
 * group values below stay valid for published plugins and land in 功能 unless they name a
 * section.
 */
export const NAV_GROUPS = {
  OVERVIEW: '概览',
  OPS: '运维',
  ACCESS: '访问控制',
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

/** Section labels in navigation order. */
export const NAV_GROUP_ORDER: readonly string[] = NAV_SECTIONS.map(section => section.label)

/**
 * The Sandbox is the conversation entry. Other plugin pages go to the section they
 * declare (`metadata.section`), else 功能; explicit provider groups are preserved.
 */
export const PLUGIN_PAGE_PLACEMENT: Readonly<Record<string, { group: string; order: number }>> = {
  '/sandbox': { group: NAV_GROUPS.WORK, order: 0 },
}

export function placePluginRoute<T extends { path?: string; meta?: Record<string, unknown> }>(route: T, declaredSection?: unknown): T {
  if (!route.path) return route
  const section = resolveSectionId(declaredSection) ?? resolveSectionId(route.meta?.section)
  if (section) return { ...route, meta: { ...route.meta, group: sectionById(section)!.label } }
  if (route.meta?.group) return route
  const placement: { group: string; order?: number } = PLUGIN_PAGE_PLACEMENT[route.path] ?? { group: NAV_GROUPS.FEATURES }
  return { ...route, meta: { ...route.meta, group: placement.group, order: route.meta?.order ?? placement.order } }
}

export const COMMAND_GROUP_ORDER = [
  '快捷动作',
  ...NAV_GROUP_ORDER,
] as const
