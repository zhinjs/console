import type { ScopeTab } from './scope/scope-tree.mjs'
import type { ConversationKind } from './pages/features/feature-model.mjs'

export const CONSOLE_PATHS: Readonly<{
  dashboard: '/dashboard'; attention: '/attention'; logs: '/logs'; agentWorkbench: '/agent/workbench'; agentReplay: '/agent/replay'; agentUsage: '/agent/usage'
  sandbox: '/sandbox'; scope: '/scope'; scopeAdapter: '/scope/:adapter'; scopeEndpoint: '/scope/:adapter/:endpoint'
  scopeConversation: '/scope/:adapter/:endpoint/:conversation'; agentSessions: '/agent/sessions'
  features: '/features'; featureGlobal: '/features/global/:plugin'; ai: '/features/ai'; aiSkills: '/features/ai/skills'
  aiAmbient: '/features/ai/ambient'; aiWorkrooms: '/features/ai/workrooms'; aiWorkroomCatalog: '/features/ai/workrooms/catalog'
  introspection: '/introspection'; permissions: '/permissions'; scenarioLab: '/scenario-lab'; groupWelcome: '/use-cases/group-welcome'
  plugins: '/plugins'; pluginDetail: '/plugins/:name'; marketplace: '/marketplace'
  opsDatabase: '/ops/database'; opsConfig: '/ops/config'; opsEnv: '/ops/env'; opsSchedules: '/ops/schedules'; opsFiles: '/ops/files'
  opsInstance: '/ops/instance'; opsTerminal: '/ops/terminal'; opsSelfCheck: '/ops/self-check'
  onboarding: '/onboarding'; account: '/account'
  accessUsers: '/access/users'; accessRoles: '/access/roles'; accessTokens: '/access/tokens'; accessAudit: '/access/audit'
}>
export function featureGlobalHref(plugin: string, params?: URLSearchParams | Record<string, string>): string
export function adapterHref(adapter: string, tab?: ScopeTab | null): string
export function endpointHref(adapter: string, endpoint: string, tab?: ScopeTab | null, params?: URLSearchParams | Record<string, string>): string
export function conversationHref(adapter: string, endpoint: string, kind: ConversationKind, id: string, tab?: ScopeTab | null): string
export function matchLegacyPattern(pattern: string, pathname: string): Record<string, string> | null
export const LEGACY_ROUTE_REDIRECTS: Readonly<Record<string, Readonly<{ to: string; tab?: string }>>>
export function resolveLegacyRedirect(pathname: string, search?: string): string | null
