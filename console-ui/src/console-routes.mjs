/**
 * Console route tree (ADR 0052) and the redirects that keep old links working.
 * Pure data and string helpers so tests and pages share one source of truth.
 */
export const CONSOLE_PATHS = Object.freeze({
  // 概览
  dashboard: '/dashboard',
  logs: '/logs',
  agentWorkbench: '/agent/workbench',
  agentReplay: '/agent/replay',
  agentUsage: '/agent/usage',
  // 会话
  sandbox: '/sandbox',
  endpoints: '/endpoints',
  endpointWorkspace: '/endpoints/:adapter/:endpointId',
  agentSessions: '/agent/sessions',
  // 功能
  features: '/features',
  featureGlobal: '/features/global/:plugin',
  adapters: '/features/adapters',
  adapter: '/features/adapters/:adapter',
  adapterEndpoint: '/features/adapters/:adapter/endpoints/:endpoint',
  ai: '/features/ai',
  aiSkills: '/features/ai/skills',
  aiAmbient: '/features/ai/ambient',
  aiWorkrooms: '/features/ai/workrooms',
  aiWorkroomCatalog: '/features/ai/workrooms/catalog',
  introspection: '/introspection',
  permissions: '/permissions',
  scenarioLab: '/scenario-lab',
  groupWelcome: '/use-cases/group-welcome',
  // 插件
  plugins: '/plugins',
  pluginDetail: '/plugins/:name',
  marketplace: '/marketplace',
  // 运维
  opsDatabase: '/ops/database',
  opsConfig: '/ops/config',
  opsEnv: '/ops/env',
  opsSchedules: '/ops/schedules',
  opsFiles: '/ops/files',
  // 访问控制
  accessUsers: '/access/users',
  accessRoles: '/access/roles',
  accessTokens: '/access/tokens',
  accessAudit: '/access/audit',
})

const segment = value => encodeURIComponent(String(value))

function withSearch(path, params) {
  const search = params ? new URLSearchParams(params).toString() : ''
  return search ? `${path}?${search}` : path
}

/** `/features/global/<plugin>`; extra query parameters (e.g. `useCase`) travel along. */
export function featureGlobalHref(plugin, params) {
  return withSearch(`/features/global/${segment(plugin)}`, params)
}

export function adapterHref(adapter) {
  return `/features/adapters/${segment(adapter)}`
}

export function adapterEndpointHref(adapter, endpoint) {
  return `/features/adapters/${segment(adapter)}/endpoints/${segment(endpoint)}`
}

export function endpointWorkspaceHref(adapter, endpoint) {
  return `/endpoints/${segment(adapter)}/${segment(endpoint)}`
}

/**
 * Old path -> new path. `tab` selects a hub tab on the target; the original query string is kept.
 * Kept for at least one minor release (ADR 0052 迁移).
 */
export const LEGACY_ROUTE_REDIRECTS = Object.freeze({
  '/config': Object.freeze({ to: CONSOLE_PATHS.opsConfig }),
  '/env': Object.freeze({ to: CONSOLE_PATHS.opsEnv }),
  '/files': Object.freeze({ to: CONSOLE_PATHS.opsFiles }),
  '/database': Object.freeze({ to: CONSOLE_PATHS.opsDatabase }),
  '/tasks': Object.freeze({ to: CONSOLE_PATHS.opsSchedules }),
  '/cron': Object.freeze({ to: CONSOLE_PATHS.opsSchedules, tab: 'schedule' }),
  '/assistant/jobs': Object.freeze({ to: CONSOLE_PATHS.opsSchedules, tab: 'assistant' }),
  '/agent/models': Object.freeze({ to: CONSOLE_PATHS.ai }),
  '/agent/skills': Object.freeze({ to: CONSOLE_PATHS.aiSkills }),
  '/agent/ambient': Object.freeze({ to: CONSOLE_PATHS.aiAmbient }),
  '/agent/workrooms': Object.freeze({ to: CONSOLE_PATHS.aiWorkrooms }),
  '/agent/workrooms/catalog': Object.freeze({ to: CONSOLE_PATHS.aiWorkroomCatalog }),
  '/features/global': Object.freeze({ to: CONSOLE_PATHS.features }),
  '/features/ai/models': Object.freeze({ to: CONSOLE_PATHS.ai }),
})

/** The new location for an old URL, or null when the path is not a legacy route. */
export function resolveLegacyRedirect(pathname, search = '') {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (!Object.hasOwn(LEGACY_ROUTE_REDIRECTS, path)) return null
  const rule = LEGACY_ROUTE_REDIRECTS[path]
  const params = new URLSearchParams(search)
  // A plugin's settings moved from the settings page to its global feature configuration.
  if (path === '/config') {
    const plugin = params.get('plugin')?.trim()
    if (plugin) {
      params.delete('plugin')
      return featureGlobalHref(plugin, params)
    }
  }
  if (rule.tab) {
    params.delete('tab')
    const next = new URLSearchParams({ tab: rule.tab })
    for (const [key, value] of params) next.append(key, value)
    return withSearch(rule.to, next)
  }
  return withSearch(rule.to, params)
}
