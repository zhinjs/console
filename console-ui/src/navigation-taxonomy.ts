import { NAV_SECTIONS, resolveSectionId, sectionById } from './navigation-sections.mjs'
import { CONSOLE_PATHS } from './console-routes.mjs'
import { adapterPageHref, normalizePageKeywords, pluginPageIdentity, pluginPagePath, type PluginPageDescriptor, type PluginTabMeta } from './plugin-pages.mjs'

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
 * The Sandbox is the conversation entry and the only plugin page with a place in the top bar
 * (ADR 0063 D12). Every other plugin page is a tab of its plugin's detail page (`planPluginRoute`).
 */
export const PLUGIN_PAGE_PLACEMENT: Readonly<Record<string, { group: string; order: number }>> = {
  '/sandbox': { group: NAV_GROUPS.WORK, order: 0 },
}

/**
 * Menu placement for the plugin pages that keep one: the Sandbox, and pages the project declares
 * itself (no owning plugin, so no detail page to hang them on). A declared section wins, then an
 * explicit group, then PLUGIN_PAGE_PLACEMENT, else 功能.
 */
export function placePluginRoute<T extends { path?: string; meta?: Record<string, unknown> }>(route: T, declaredSection?: unknown): T {
  if (!route.path) return route
  const section = resolveSectionId(declaredSection) ?? resolveSectionId(route.meta?.section)
  if (section) return { ...route, meta: { ...route.meta, group: sectionById(section)!.label } }
  if (route.meta?.group) return route
  const placement: { group: string; order?: number } = PLUGIN_PAGE_PLACEMENT[route.path] ?? { group: NAV_GROUPS.FEATURES }
  return { ...route, meta: { ...route.meta, group: placement.group, order: route.meta?.order ?? placement.order } }
}

/** Marks a route registered from `/entries` as a plugin page (the 功能 menu lists it under 插件页面). Never mutates the input. */
export function markPluginRoute<T extends { path?: string; meta?: Record<string, unknown> }>(route: T): T {
  if (!route.path) return route
  return { ...route, meta: { ...route.meta, pluginPage: true } }
}

type PluginRouteInput = { path?: string; name?: string; parent?: string | null; icon?: unknown; requiredPermissions?: string[]; requiredRoles?: string[]; meta?: Record<string, unknown> }

/** Hidden route at an adapter page's old top-level path; its element is a redirect. */
export interface PluginRedirectRoute {
  path: string
  name: string
  parent: string
  icon?: unknown
  requiredPermissions?: string[]
  requiredRoles?: string[]
  meta: Record<string, unknown>
}

export interface PluginRoutePlan<T> {
  /** The route that renders the page: in its menu place (Sandbox, project pages) or as a plugin detail tab. */
  page?: T
  /** An adapter page's old top-level path, redirecting to its adapter object page (`redirectTo`). */
  redirect?: PluginRedirectRoute
  redirectTo?: string
  /** A `metadata.section` the page still declares; ignored for plugin detail tabs (warn once). */
  sectionIgnored?: string
}

/**
 * Where a page registered from `/entries` goes (ADR 0063 决策 3, revising ADR 0052's placement rule):
 * - the Sandbox keeps its 会话 entry, and the project's own pages keep their menu placement;
 * - an adapter's connection page is not mounted again: its old path redirects to the adapter object
 *   page, which embeds the same management (`pages/scope/adapter-page.tsx`);
 * - every other page becomes `/plugins/<plugin>/<page>`, a tab of the plugin detail page, out of the
 *   menu. Its old top-level path no longer redirects (removed in ADR 0063 P4).
 * An adapter page's old path stays: that hidden route is the page's only registration (command
 * palette entry, permissions), and it opens the adapter object page.
 * `meta.pluginTab` carries what the detail page and the command palette need. Never mutates the input.
 */
export function planPluginRoute<T extends PluginRouteInput>(route: T, page?: PluginPageDescriptor | null, options: { adapterKey?: string } = {}): PluginRoutePlan<T> {
  if (!route.path) return { page: route }
  if (Object.hasOwn(PLUGIN_PAGE_PLACEMENT, route.path)) return { page: markPluginRoute(placePluginRoute(route, page?.section)) }
  const identity = page ? (page.plugin && page.page ? { plugin: page.plugin, page: page.page } : null) : pluginPageIdentity(route.path)
  if (!identity) return { page: markPluginRoute(placePluginRoute(route, page?.section)) }
  const { group: _group, section: declared, order, hideInMenu, fullWidth: _fullWidth, keywords, ...meta } = route.meta ?? {}
  const sectionIgnored = page?.section ?? (typeof declared === 'string' && declared ? declared : undefined)
  const name = route.name ?? identity.page
  const base = {
    plugin: identity.plugin,
    page: identity.page,
    legacyPath: route.path,
    keywords: normalizePageKeywords(page?.keywords, keywords),
    ...(page?.description ? { description: page.description } : {}),
    ...(page?.packageName ? { packageName: page.packageName } : {}),
    ...(page?.pluginDescription ? { pluginDescription: page.pluginDescription } : {}),
  }
  const access = {
    ...(route.requiredPermissions !== undefined ? { requiredPermissions: route.requiredPermissions } : {}),
    ...(route.requiredRoles !== undefined ? { requiredRoles: route.requiredRoles } : {}),
  }
  const adapterKey = options.adapterKey ?? page?.adapterKey
  if (adapterKey) {
    const href = adapterPageHref(adapterKey)
    const pluginTab: PluginTabMeta = { ...base, kind: 'adapter', href, adapterKey }
    return {
      redirect: {
        path: route.path, name, parent: CONSOLE_PATHS.scope, ...(route.icon != null ? { icon: route.icon } : {}), ...access,
        meta: { ...meta, group: NAV_GROUPS.WORK, section: 'sessions', hideInMenu: true, pluginPage: true, adapterPage: true, pluginTab },
      },
      redirectTo: href,
      ...(sectionIgnored ? { sectionIgnored } : {}),
    }
  }
  const path = pluginPagePath(identity.plugin, identity.page)
  const pluginTab: PluginTabMeta = { ...base, kind: 'tab', href: path, ...(hideInMenu === true ? { hidden: true } : {}) }
  return {
    page: { ...route, path, parent: CONSOLE_PATHS.plugins, meta: { ...meta, ...(order !== undefined ? { order } : {}), group: NAV_GROUPS.PLUGINS, hideInMenu: true, pluginPage: true, pluginTab } },
    ...(sectionIgnored ? { sectionIgnored } : {}),
  }
}

export const COMMAND_GROUP_ORDER = [
  '快捷动作',
  ...NAV_GROUP_ORDER,
] as const
