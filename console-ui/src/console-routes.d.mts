export const CONSOLE_PATHS: Readonly<{
  dashboard: '/dashboard'; logs: '/logs'; agentWorkbench: '/agent/workbench'; agentReplay: '/agent/replay'; agentUsage: '/agent/usage'
  sandbox: '/sandbox'; endpoints: '/endpoints'; endpointWorkspace: '/endpoints/:adapter/:endpointId'; agentSessions: '/agent/sessions'
  features: '/features'; featureGlobal: '/features/global/:plugin'; adapters: '/features/adapters'; adapter: '/features/adapters/:adapter'
  adapterEndpoint: '/features/adapters/:adapter/endpoints/:endpoint'; ai: '/features/ai'; aiSkills: '/features/ai/skills'
  aiAmbient: '/features/ai/ambient'; aiWorkrooms: '/features/ai/workrooms'; aiWorkroomCatalog: '/features/ai/workrooms/catalog'
  introspection: '/introspection'; permissions: '/permissions'; scenarioLab: '/scenario-lab'; groupWelcome: '/use-cases/group-welcome'
  plugins: '/plugins'; pluginDetail: '/plugins/:name'; marketplace: '/marketplace'
  opsDatabase: '/ops/database'; opsConfig: '/ops/config'; opsEnv: '/ops/env'; opsSchedules: '/ops/schedules'; opsFiles: '/ops/files'
  accessUsers: '/access/users'; accessRoles: '/access/roles'; accessTokens: '/access/tokens'; accessAudit: '/access/audit'
}>
export function featureGlobalHref(plugin: string, params?: URLSearchParams | Record<string, string>): string
export function adapterHref(adapter: string): string
export function adapterEndpointHref(adapter: string, endpoint: string): string
export function endpointWorkspaceHref(adapter: string, endpoint: string): string
export const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, Readonly<{ to: string; tab?: string }>>>
export function resolveLegacyRedirect(pathname: string, search?: string): string | null
