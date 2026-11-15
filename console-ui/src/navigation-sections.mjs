import { hasAnyConsolePermission, hasConsolePermission, UNRESTRICTED_ACCESS } from './utils/console-access.mjs'

/**
 * The six Console sections (ADR 0052). `icon` names a lucide icon (components/sidebarMenuIcons.ts). The first four are day-to-day work, the last two
 * administration. `permissions` is the any-of set that makes a section's pages visible
 * when a page declares nothing more specific (ADR 0049 permission names).
 */
export const NAV_TIERS = Object.freeze([
  Object.freeze({ id: 'daily', label: '日常' }),
  Object.freeze({ id: 'admin', label: '管理' }),
])

export const NAV_SECTIONS = Object.freeze([
  Object.freeze({ id: 'overview', icon: 'LayoutDashboard', label: '概览', tier: 'daily', permissions: Object.freeze(['status.view']) }),
  Object.freeze({ id: 'sessions', icon: 'MessagesSquare', label: '会话', tier: 'daily', permissions: Object.freeze(['endpoint.view', 'endpoint.operate']) }),
  Object.freeze({ id: 'features', icon: 'Sparkles', label: '功能', tier: 'daily', permissions: Object.freeze(['feature.view', 'feature.configure', 'feature.toggle', 'agent.view', 'agent.configure']) }),
  Object.freeze({ id: 'plugins', icon: 'Puzzle', label: '插件', tier: 'daily', permissions: Object.freeze(['plugin.manage']) }),
  Object.freeze({ id: 'ops', icon: 'Wrench', label: '运维', tier: 'admin', permissions: Object.freeze([
    'ops.config.read', 'ops.config.write', 'ops.env.read', 'ops.env.write', 'ops.database.read', 'ops.database.write',
    'ops.schedule.read', 'ops.schedule.write', 'ops.files.read', 'ops.files.write', 'ops.restart', 'ops.terminal',
  ]) }),
  Object.freeze({ id: 'access', icon: 'Shield', label: '访问控制', tier: 'admin', permissions: Object.freeze(['iam.view', 'iam.manage']) }),
])

/** Section a page lands in when it declares none (ADR 0052: plugin pages default to 功能). */
export const DEFAULT_SECTION_ID = 'features'

const byId = new Map(NAV_SECTIONS.map(section => [section.id, section]))
const byLabel = new Map(NAV_SECTIONS.map(section => [section.label, section]))

/** Accepts a section id (`ops`) or its label (`运维`). */
export function resolveSectionId(value) {
  if (typeof value !== 'string') return null
  const key = value.trim()
  return byId.get(key)?.id ?? byLabel.get(key)?.id ?? null
}

export function sectionById(id) {
  return byId.get(id) ?? null
}

/** `meta.section` first, then a group that names a section, else 功能. */
export function routeSectionId(route) {
  const meta = route?.meta ?? {}
  return resolveSectionId(meta.section) ?? resolveSectionId(route?.section) ?? resolveSectionId(meta.group) ?? DEFAULT_SECTION_ID
}

/**
 * Builtin pages that need a narrower permission than their section (any-of).
 * Pages not listed use their section's set; plugin pages additionally keep their own
 * `requiredPermissions`, which must all be granted.
 */
export const ROUTE_PERMISSIONS = Object.freeze({
  '/dashboard': ['status.view'],
  '/attention': ['status.view'],
  '/logs': ['status.view'],
  '/agent/workbench': ['status.view', 'agent.view'],
  '/agent/replay': ['status.view', 'agent.view'],
  '/agent/usage': ['status.view'],
  '/sandbox': ['endpoint.view', 'endpoint.operate'],
  // 对象树：任一层级的「概览」可读即可进入；各页签再按 SCOPE_TAB_PERMISSIONS 说明缺少的权限。
  '/scope': ['endpoint.view', 'feature.view'],
  '/scope/:adapter': ['endpoint.view', 'feature.view', 'endpoint.manage'],
  '/scope/:adapter/:endpoint': ['endpoint.view', 'feature.view', 'endpoint.manage'],
  '/scope/:adapter/:endpoint/:conversation': ['endpoint.view', 'feature.view'],
  '/agent/sessions': ['endpoint.view'],
  '/features': ['feature.view'],
  '/features/global/:plugin': ['feature.view'],
  '/features/ai': ['agent.view'],
  '/features/ai/skills': ['agent.view'],
  '/features/ai/ambient': ['agent.view'],
  '/features/ai/workrooms': ['agent.view'],
  '/features/ai/workrooms/catalog': ['agent.view'],
  '/introspection': ['status.view'],
  '/permissions': ['status.view'],
  '/scenario-lab': ['feature.view'],
  '/use-cases/group-welcome': ['feature.configure'],
  '/plugins': ['plugin.manage'],
  '/plugins/:name': ['plugin.manage'],
  '/marketplace': ['plugin.manage'],
  '/ops/database': ['ops.database.read', 'ops.database.write'],
  '/ops/config': ['ops.config.read', 'ops.config.write'],
  '/ops/env': ['ops.env.read', 'ops.env.write'],
  '/ops/schedules': ['ops.schedule.read', 'ops.schedule.write'],
  '/ops/files': ['ops.files.read', 'ops.files.write'],
  // Instance status / logs need status.view, lifecycle ops.restart, dependencies plugin.manage (ADR 0054 §4–§5).
  '/ops/instance': ['status.view', 'ops.restart', 'plugin.manage'],
  '/ops/terminal': ['ops.terminal'],
  // Browser-side checks of existing public routes only: needs no permission.
  '/ops/self-check': [],
  '/onboarding': ['plugin.manage'],
  // Every signed-in principal has personal settings.
  '/account': [],
  '/access/users': ['iam.view'],
  '/access/roles': ['iam.view'],
  '/access/tokens': ['iam.view'],
  '/access/audit': ['iam.view'],
  // 「我的聊天身份」 needs self.chat-identity (every built-in role has it); the member list iam.manage,
  // filtered by the Host. Without either the page has nothing to show.
  '/chat-members': ['self.chat-identity', 'iam.manage'],
})

export function routePermissions(route) {
  return ROUTE_PERMISSIONS[route?.path] ?? sectionById(routeSectionId(route))?.permissions ?? []
}

export function canSeeRoute(route, access = UNRESTRICTED_ACCESS) {
  if (access.unrestricted) return true
  const required = Array.isArray(route?.requiredPermissions) ? route.requiredPermissions : []
  return hasAnyConsolePermission(routePermissions(route), access) && required.every(name => hasConsolePermission(name, access))
}

const order = route => route?.meta?.order ?? 999

/**
 * Menu groups inside the 功能 section (zhinjs/zhin#1250 `console-nav-ia`): the Console's own pages
 * first (核心), then pages contributed by plugins (插件页面, routes marked `meta.pluginPage`).
 */
export const NAV_MENU_GROUPS = Object.freeze([
  Object.freeze({ id: 'core', label: '核心' }),
  Object.freeze({ id: 'plugin', label: '插件页面' }),
])

/** Only the section where plugin pages land by default is split; elsewhere a plugin page reads like any other. */
const GROUPED_SECTION_IDS = new Set([DEFAULT_SECTION_ID])

export function isPluginPageRoute(route) {
  return route?.meta?.pluginPage === true
}

function menuGroups(sectionId, routes) {
  if (!GROUPED_SECTION_IDS.has(sectionId)) return [{ ...NAV_MENU_GROUPS[0], routes }]
  const core = routes.filter(route => !isPluginPageRoute(route))
  const plugin = routes.filter(isPluginPageRoute)
  if (!core.length || !plugin.length) return [{ ...NAV_MENU_GROUPS[core.length ? 0 : 1], routes }]
  return [{ ...NAV_MENU_GROUPS[0], routes: core }, { ...NAV_MENU_GROUPS[1], routes: plugin }]
}

/**
 * Sidebar model: tiers -> non-empty sections -> visible menu routes in order.
 * A section with no visible page is omitted, and so is a tier with no section.
 * `routes` keeps the flat order (核心 before 插件页面); `groups` splits the 功能 section into
 * those two groups when it has both, and is a single group everywhere else.
 */
export function buildNavigation(routes, access = UNRESTRICTED_ACCESS) {
  const grouped = new Map(NAV_SECTIONS.map(section => [section.id, []]))
  for (const route of routes) {
    if (!route?.path || route.meta?.hideInMenu || !canSeeRoute(route, access)) continue
    grouped.get(routeSectionId(route)).push(route)
  }
  return NAV_TIERS.map(tier => ({
    ...tier,
    sections: NAV_SECTIONS.filter(section => section.tier === tier.id && grouped.get(section.id).length)
      .map(section => {
        const groups = menuGroups(section.id, [...grouped.get(section.id)].sort((a, b) => order(a) - order(b)))
        return { ...section, routes: groups.flatMap(group => group.routes), groups }
      }),
  })).filter(tier => tier.sections.length)
}
