import { hasAnyConsolePermission, hasConsolePermission, UNRESTRICTED_ACCESS } from './utils/console-access.mjs'

/**
 * The six Console sections (ADR 0052). The first four are day-to-day work, the last two
 * administration. `permissions` is the any-of set that makes a section's pages visible
 * when a page declares nothing more specific (ADR 0049 permission names).
 */
export const NAV_TIERS = Object.freeze([
  Object.freeze({ id: 'daily', label: '日常' }),
  Object.freeze({ id: 'admin', label: '管理' }),
])

export const NAV_SECTIONS = Object.freeze([
  Object.freeze({ id: 'overview', label: '概览', tier: 'daily', permissions: Object.freeze(['status.view']) }),
  Object.freeze({ id: 'sessions', label: '会话', tier: 'daily', permissions: Object.freeze(['endpoint.view', 'endpoint.operate']) }),
  Object.freeze({ id: 'features', label: '功能', tier: 'daily', permissions: Object.freeze(['feature.view', 'feature.configure', 'feature.toggle', 'agent.view', 'agent.configure']) }),
  Object.freeze({ id: 'plugins', label: '插件', tier: 'daily', permissions: Object.freeze(['plugin.manage']) }),
  Object.freeze({ id: 'ops', label: '运维', tier: 'admin', permissions: Object.freeze([
    'ops.config.read', 'ops.config.write', 'ops.env.read', 'ops.env.write', 'ops.database.read', 'ops.database.write',
    'ops.schedule.read', 'ops.schedule.write', 'ops.files.read', 'ops.files.write', 'ops.restart', 'ops.terminal',
  ]) }),
  Object.freeze({ id: 'access', label: '访问控制', tier: 'admin', permissions: Object.freeze(['iam.view', 'iam.manage']) }),
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
  '/logs': ['status.view'],
  '/agent/workbench': ['status.view', 'agent.view'],
  '/agent/replay': ['status.view', 'agent.view'],
  '/agent/usage': ['status.view'],
  '/sandbox': ['endpoint.view', 'endpoint.operate'],
  '/endpoints': ['endpoint.view'],
  '/endpoints/:adapter/:endpointId': ['endpoint.view'],
  '/agent/sessions': ['endpoint.view'],
  '/features': ['feature.view'],
  '/features/global/:plugin': ['feature.view'],
  '/features/adapters': ['feature.view', 'endpoint.manage'],
  '/features/adapters/:adapter': ['feature.view', 'endpoint.manage'],
  '/features/adapters/:adapter/endpoints/:endpoint': ['feature.view', 'endpoint.manage'],
  '/features/adapters/:adapter/endpoints/:endpoint/conversations/:conversation': ['feature.view'],
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
  '/onboarding': ['plugin.manage'],
  // Every signed-in principal has personal settings.
  '/account': [],
  '/access/users': ['iam.view'],
  '/access/roles': ['iam.view'],
  '/access/tokens': ['iam.view'],
  '/access/audit': ['iam.view'],
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
 * Sidebar model: tiers -> non-empty sections -> visible menu routes in order.
 * A section with no visible page is omitted, and so is a tier with no section.
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
      .map(section => ({ ...section, routes: [...grouped.get(section.id)].sort((a, b) => order(a) - order(b)) })),
  })).filter(tier => tier.sections.length)
}
