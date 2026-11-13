/**
 * Console route tree (ADR 0052) and the redirects that keep old links working.
 * Pure data and string helpers so tests and pages share one source of truth.
 */
import { scopeHref } from './scope/scope-tree.mjs'

export const CONSOLE_PATHS = Object.freeze({
  // 概览
  dashboard: '/dashboard',
  attention: '/attention',
  logs: '/logs',
  agentWorkbench: '/agent/workbench',
  agentReplay: '/agent/replay',
  agentUsage: '/agent/usage',
  // 会话：四级对象树 全局 ─ 适配器 ─ 账号 ─ 会话（每级一个对象页，`?tab=` 记住页签）
  sandbox: '/sandbox',
  scope: '/scope',
  scopeAdapter: '/scope/:adapter',
  scopeEndpoint: '/scope/:adapter/:endpoint',
  scopeConversation: '/scope/:adapter/:endpoint/:conversation',
  agentSessions: '/agent/sessions',
  // 功能
  features: '/features',
  featureGlobal: '/features/global/:plugin',
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
  opsInstance: '/ops/instance',
  opsTerminal: '/ops/terminal',
  // 个人（不在菜单里，从顶栏进入）
  onboarding: '/onboarding',
  account: '/account',
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

/** An adapter's object page (`tab` opens one of its tabs, e.g. `features`). */
export function adapterHref(adapter, tab) {
  return scopeHref({ adapter }, tab)
}

/** An account's object page; `chat` is the account workspace, `features` its feature settings. */
export function endpointHref(adapter, endpoint, tab, params) {
  return scopeHref({ adapter, endpoint }, tab, params)
}

/**
 * One conversation's object page. The segment is `<kind>:<id>` URI-encoded as a whole, so ids with
 * `/`, `:`, `?` or `#` stay in one path segment.
 */
export function conversationHref(adapter, endpoint, kind, id, tab) {
  return scopeHref({ adapter, endpoint, kind, id }, tab)
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
  // 聊天账号与「适配器 → 账号功能配置」合并为对象树（Console 重构第一阶段）。
  '/endpoints': Object.freeze({ to: CONSOLE_PATHS.scope }),
  '/endpoints/:adapter/:endpointId': Object.freeze({ to: CONSOLE_PATHS.scopeEndpoint, tab: 'chat' }),
  '/features/adapters': Object.freeze({ to: CONSOLE_PATHS.scope }),
  '/features/adapters/:adapter': Object.freeze({ to: CONSOLE_PATHS.scopeAdapter }),
  '/features/adapters/:adapter/endpoints/:endpoint': Object.freeze({ to: CONSOLE_PATHS.scopeEndpoint, tab: 'features' }),
  '/features/adapters/:adapter/endpoints/:endpoint/conversations/:conversation': Object.freeze({ to: CONSOLE_PATHS.scopeConversation, tab: 'features' }),
})

/**
 * Values of a pattern's `:name` segments in a raw (encoded) pathname, decoded once; null when the
 * path does not match. Matching the raw path keeps ids with `/` or `%` exact.
 */
export function matchLegacyPattern(pattern, pathname) {
  const want = pattern.split('/')
  const have = pathname.split('/')
  if (want.length !== have.length) return null
  const params = {}
  for (let index = 0; index < want.length; index += 1) {
    const part = want[index]
    if (part.startsWith(':')) {
      if (!have[index]) return null
      try {
        params[part.slice(1)] = decodeURIComponent(have[index])
      } catch {
        return null
      }
    } else if (part !== have[index]) return null
  }
  return params
}

function legacyRule(path) {
  if (Object.hasOwn(LEGACY_ROUTE_REDIRECTS, path)) return { pattern: path, rule: LEGACY_ROUTE_REDIRECTS[path], params: {} }
  for (const [pattern, rule] of Object.entries(LEGACY_ROUTE_REDIRECTS)) {
    if (!pattern.includes(':')) continue
    const params = matchLegacyPattern(pattern, path)
    if (params) return { pattern, rule, params }
  }
  return null
}

const CHANNEL_KINDS = new Set(['group', 'private', 'channel'])

/** `?tab=<tab>` first, then the rest of the original query (an old `tab` is dropped). */
function withTab(to, tab, params) {
  params.delete('tab')
  if (!tab) return withSearch(to, params)
  const next = new URLSearchParams({ tab })
  for (const [key, value] of params) next.append(key, value)
  return withSearch(to, next)
}

/** The new location for an old URL, or null when the path is not a legacy route. */
export function resolveLegacyRedirect(pathname, search = '') {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  const match = legacyRule(path)
  if (!match) return null
  const { pattern, rule, params: values } = match
  const params = new URLSearchParams(search)
  // A plugin's settings moved from the settings page to its global feature configuration.
  if (pattern === '/config') {
    const plugin = params.get('plugin')?.trim()
    if (plugin) {
      params.delete('plugin')
      return featureGlobalHref(plugin, params)
    }
  }
  if (pattern === '/endpoints/:adapter/:endpointId') {
    // The account workspace: a selected conversation opens that conversation's 聊天 tab.
    const kind = params.get('channelType')
    const id = params.get('channelId')?.trim()
    if (kind && CHANNEL_KINDS.has(kind) && id) {
      params.delete('channelType')
      params.delete('channelId')
      return withTab(scopeHref({ adapter: values.adapter, endpoint: values.endpointId, kind, id }), 'chat', params)
    }
    return withTab(scopeHref({ adapter: values.adapter, endpoint: values.endpointId }), 'chat', params)
  }
  if (pattern === '/features/adapters/:adapter/endpoints/:endpoint') {
    // The old 「会话」 tab listed the account's conversations; the account 概览 lists them now.
    const tab = params.get('tab') === 'conversations' ? null : 'features'
    return withTab(scopeHref({ adapter: values.adapter, endpoint: values.endpoint }), tab, params)
  }
  if (pattern === '/features/adapters/:adapter/endpoints/:endpoint/conversations/:conversation') {
    const colon = values.conversation.indexOf(':')
    const kind = values.conversation.slice(0, colon)
    const id = values.conversation.slice(colon + 1)
    // An unreadable conversation segment still lands on the account it belongs to.
    const scope = colon > 0 && CHANNEL_KINDS.has(kind) && id ? { adapter: values.adapter, endpoint: values.endpoint, kind, id } : { adapter: values.adapter, endpoint: values.endpoint }
    return withTab(scopeHref(scope), rule.tab, params)
  }
  if (pattern === '/features/adapters/:adapter') return withTab(scopeHref({ adapter: values.adapter }), null, params)
  if (rule.tab) return withTab(rule.to, rule.tab, params)
  return withSearch(rule.to, params)
}
