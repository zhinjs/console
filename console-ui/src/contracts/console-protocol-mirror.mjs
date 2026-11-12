/**
 * The ONE place the Console copies protocol constants by hand.
 *
 * Source of truth: `@zhin.js/console-protocol` (`packages/console/protocol/src` in zhinjs/zhin:
 * `permissions.ts`, `gateway.ts`, `feature.ts`, `chat-roles.ts`). The version that exports these
 * is not published yet; until it is, every page and model imports them from here, and
 * `scripts/check-protocol-mirror.mjs` (run by `tests/protocol-mirror.test.mjs` when a zhin checkout
 * is next to this repository) compares each value with the protocol source.
 *
 * Once the package is published: add `@zhin.js/console-protocol` to dependencies, replace the body
 * of this module with `export { … } from '@zhin.js/console-protocol'` (names are kept 1:1), keep
 * `PENDING_UPSTREAM` empty, and turn the check script into a plain import comparison.
 *
 * Plain JS (with `.d.mts`) so `node --test` models and the TypeScript pages share it.
 */

// ---------------------------------------------------------------- permissions.ts

export const CONSOLE_PERMISSIONS = Object.freeze({
  STATUS_VIEW: 'status.view',
  ENDPOINT_VIEW: 'endpoint.view',
  ENDPOINT_OPERATE: 'endpoint.operate',
  ENDPOINT_MANAGE: 'endpoint.manage',
  FEATURE_VIEW: 'feature.view',
  FEATURE_CONFIGURE: 'feature.configure',
  FEATURE_TOGGLE: 'feature.toggle',
  PLUGIN_MANAGE: 'plugin.manage',
  PLUGIN_PERMS_READ: 'plugin.perms.read',
  PLUGIN_PERMS_OPERATE: 'plugin.perms.operate',
  PLUGIN_PERMS_MANAGE: 'plugin.perms.manage',
  AGENT_VIEW: 'agent.view',
  AGENT_CONFIGURE: 'agent.configure',
  OPS_CONFIG_READ: 'ops.config.read',
  OPS_CONFIG_WRITE: 'ops.config.write',
  OPS_ENV_READ: 'ops.env.read',
  OPS_ENV_WRITE: 'ops.env.write',
  OPS_DATABASE_READ: 'ops.database.read',
  OPS_DATABASE_WRITE: 'ops.database.write',
  OPS_SCHEDULE_READ: 'ops.schedule.read',
  OPS_SCHEDULE_WRITE: 'ops.schedule.write',
  OPS_FILES_READ: 'ops.files.read',
  OPS_FILES_WRITE: 'ops.files.write',
  OPS_RESTART: 'ops.restart',
  OPS_TERMINAL: 'ops.terminal',
  IAM_VIEW: 'iam.view',
  IAM_MANAGE: 'iam.manage',
  MCP_ACCESS: 'mcp.access',
  A2A_ACCESS: 'a2a.access',
})

export const CONSOLE_PERMISSION_LIST = Object.freeze(Object.values(CONSOLE_PERMISSIONS))

/** `CONSOLE_SCOPED_PERMISSIONS` (a Set upstream): permissions an adapter / endpoint binding narrows. */
export const CONSOLE_SCOPED_PERMISSIONS = Object.freeze([
  'endpoint.view', 'endpoint.operate', 'endpoint.manage', 'feature.configure', 'feature.toggle', 'iam.manage',
])

export const CONSOLE_BUILTIN_ROLE_NAMES = Object.freeze(['owner', 'admin', 'operator', 'viewer'])

export const IAM_RPC = Object.freeze({
  USERS_LIST: 'iam.users.list',
  USERS_CREATE: 'iam.users.create',
  USERS_UPDATE: 'iam.users.update',
  USERS_DISABLE: 'iam.users.disable',
  USERS_DELETE: 'iam.users.delete',
  USERS_RESET_PASSWORD: 'iam.users.reset-password',
  ROLES_LIST: 'iam.roles.list',
  ROLES_CREATE: 'iam.roles.create',
  ROLES_UPDATE: 'iam.roles.update',
  ROLES_DELETE: 'iam.roles.delete',
  BINDINGS_SET: 'iam.bindings.set',
  TOKENS_LIST: 'iam.tokens.list',
  TOKENS_CREATE: 'iam.tokens.create',
  TOKENS_REVOKE: 'iam.tokens.revoke',
  AUDIT_LIST: 'iam.audit.list',
})

export const ONBOARDING_RPC = Object.freeze({ UPDATE: 'onboarding.update' })

/** `/auth/*` REST paths relative to the HTTP API base (`{apiBase}/api`). */
export const CONSOLE_AUTH_ROUTES = Object.freeze({
  LOGIN: '/auth/login',
  LOGOUT: '/auth/logout',
  ME: '/auth/me',
  PASSWORD: '/auth/password',
  TOKENS: '/auth/tokens',
  TOKENS_REVOKE: '/auth/tokens/revoke',
  SETUP: '/auth/setup',
  SETUP_DATABASE: '/auth/setup/database',
  SETUP_DATABASE_TEST: '/auth/setup/database/test',
})

/**
 * The slice of `CONSOLE_RPC_PERMISSIONS` the Console gates gateway-owned pages with: `iam.*`,
 * `terminal.open`, `onboarding.update`. (Gateway and feature RPC permissions are below.)
 */
export const CONSOLE_GATEWAY_OWNED_RPC_PERMISSIONS = Object.freeze({
  'iam.users.list': 'iam.view',
  'iam.roles.list': 'iam.view',
  'iam.tokens.list': 'iam.view',
  'iam.audit.list': 'iam.view',
  'iam.users.create': 'iam.manage',
  'iam.users.update': 'iam.manage',
  'iam.users.disable': 'iam.manage',
  'iam.users.delete': 'iam.manage',
  'iam.users.reset-password': 'iam.manage',
  'iam.roles.create': 'iam.manage',
  'iam.roles.update': 'iam.manage',
  'iam.roles.delete': 'iam.manage',
  'iam.bindings.set': 'iam.manage',
  'iam.tokens.create': 'iam.manage',
  'iam.tokens.revoke': 'iam.manage',
  'terminal.open': 'ops.terminal',
  'onboarding.update': 'plugin.manage',
})

/**
 * `CONSOLE_HTTP_PERMISSIONS` rules of the gateway-owned routes the Console calls (method, path
 * relative to the API base, permission). `public` / `bootstrap` / `authenticated` as upstream.
 */
export const CONSOLE_GATEWAY_HTTP_RULES = Object.freeze([
  Object.freeze({ method: 'POST', path: '/auth/login', permission: 'public' }),
  Object.freeze({ method: 'GET', path: '/auth/me', permission: 'public' }),
  Object.freeze({ method: 'POST', path: '/auth/logout', permission: 'authenticated' }),
  Object.freeze({ method: 'POST', path: '/auth/password', permission: 'authenticated' }),
  Object.freeze({ method: 'GET', path: '/auth/tokens', permission: 'authenticated' }),
  Object.freeze({ method: 'POST', path: '/auth/tokens', permission: 'authenticated' }),
  Object.freeze({ method: 'POST', path: '/auth/tokens/revoke', permission: 'authenticated' }),
  Object.freeze({ method: 'GET', path: '/auth/setup', permission: 'bootstrap' }),
  Object.freeze({ method: 'POST', path: '/auth/setup', permission: 'bootstrap' }),
  Object.freeze({ method: 'GET', path: '/auth/setup/database', permission: 'bootstrap' }),
  Object.freeze({ method: 'POST', path: '/auth/setup/database', permission: 'bootstrap' }),
  Object.freeze({ method: 'POST', path: '/auth/setup/database/test', permission: 'bootstrap' }),
  Object.freeze({ method: 'GET', path: '/console/terminal/targets', permission: 'ops.terminal' }),
  Object.freeze({ method: 'POST', path: '/console/terminal/tickets', permission: 'ops.terminal' }),
  Object.freeze({ method: 'GET', path: '/gateway/packages/progress', permission: 'plugin.manage' }),
])

// ---------------------------------------------------------------- gateway.ts

export const GATEWAY_PACKAGES_RPC = Object.freeze({
  LIST: 'gateway.packages.list',
  PLAN: 'gateway.packages.plan',
  INSTALL: 'gateway.packages.install',
  UNINSTALL: 'gateway.packages.uninstall',
  UPDATE: 'gateway.packages.update',
})

export const GATEWAY_INSTANCE_RPC = Object.freeze({
  STATUS: 'gateway.instance.status',
  START: 'gateway.instance.start',
  STOP: 'gateway.instance.stop',
  RESTART: 'gateway.instance.restart',
  LOGS: 'gateway.instance.logs',
})

export const GATEWAY_PLUGINS_RPC = Object.freeze({ DECLARE: 'gateway.plugins.declare' })

export const GATEWAY_RPC = Object.freeze({ ...GATEWAY_PACKAGES_RPC, ...GATEWAY_INSTANCE_RPC, ...GATEWAY_PLUGINS_RPC })

export const GATEWAY_RPC_PERMISSIONS = Object.freeze({
  'gateway.packages.list': 'feature.view',
  'gateway.packages.plan': 'plugin.manage',
  'gateway.packages.install': 'plugin.manage',
  'gateway.packages.uninstall': 'plugin.manage',
  'gateway.packages.update': 'plugin.manage',
  'gateway.instance.status': 'status.view',
  'gateway.instance.logs': 'status.view',
  'gateway.instance.start': 'ops.restart',
  'gateway.instance.stop': 'ops.restart',
  'gateway.instance.restart': 'ops.restart',
  'gateway.plugins.declare': 'plugin.manage',
})

export const GATEWAY_PACKAGES_PROGRESS = 'gateway.packages.progress'
export const GATEWAY_PACKAGES_PROGRESS_PATH = '/gateway/packages/progress'

/** Error codes of `{base}/…` requests the gateway could not forward to the instance (ADR 0054 §3). */
export const GATEWAY_INSTANCE_ERROR = Object.freeze({
  UNAVAILABLE: 'instance_unavailable',
  TIMEOUT: 'instance_timeout',
  ERROR: 'instance_error',
})

/** `GET /pub/health`: unauthenticated gateway liveness plus `instance: { state, ready }`. */
export const GATEWAY_HEALTH_PATH = '/pub/health'

// ---------------------------------------------------------------- feature.ts

export const FEATURE_RPC = Object.freeze({
  LIST: 'feature.list',
  MATRIX: 'feature.matrix',
  GET: 'feature.get',
  SET_OVERRIDE: 'feature.set-override',
  REMOVE_OVERRIDE: 'feature.remove-override',
  SET_ENABLED: 'feature.set-enabled',
  CONVERSATIONS: 'feature.conversations',
})

export const FEATURE_RPC_PERMISSIONS = Object.freeze({
  'feature.list': 'feature.view',
  'feature.matrix': 'feature.view',
  'feature.get': 'feature.view',
  'feature.set-override': 'feature.configure',
  'feature.remove-override': 'feature.configure',
  'feature.set-enabled': 'feature.toggle',
  'feature.conversations': 'feature.view',
})

export const CONSOLE_FEATURE_CONVERSATION_KINDS = Object.freeze(['group', 'private', 'channel'])
export const FEATURE_CONVERSATION_ID_MAX_LENGTH = 256

// ---------------------------------------------------------------- chat-roles.ts

export const CHAT_ROLES_RPC = Object.freeze({
  LIST: 'chat-roles.list',
  GRANT: 'chat-roles.grant',
  REVOKE: 'chat-roles.revoke',
})

export const CHAT_ROLES_RPC_PERMISSIONS = Object.freeze({
  'chat-roles.list': 'iam.manage',
  'chat-roles.grant': 'iam.manage',
  'chat-roles.revoke': 'iam.manage',
})

export const CONSOLE_CHAT_ROLES = Object.freeze(['owner', 'admin', 'trusted'])

// ---------------------------------------------------------------- bookkeeping

/**
 * Names mirrored ahead of the protocol source the check runs against: the gateway work that adds
 * them is not merged there yet. The check reports them as pending instead of failing; once the
 * source has them, they are compared like everything else (and should be removed from here).
 */
export const PENDING_UPSTREAM = Object.freeze(['GATEWAY_INSTANCE_ERROR', 'GATEWAY_HEALTH_PATH'])

/**
 * How each mirrored name compares with the protocol export of the same name:
 * `equal` deep-equal; `set` same members in any order (upstream Set or array); `subset` every
 * mirrored entry exists upstream with the same value (the Console only copies what it uses).
 */
export const MIRROR_COMPARISON = Object.freeze({
  CONSOLE_PERMISSIONS: 'equal',
  CONSOLE_PERMISSION_LIST: 'equal',
  CONSOLE_SCOPED_PERMISSIONS: 'set',
  CONSOLE_BUILTIN_ROLE_NAMES: 'equal',
  IAM_RPC: 'equal',
  ONBOARDING_RPC: 'equal',
  CONSOLE_AUTH_ROUTES: 'equal',
  CONSOLE_GATEWAY_OWNED_RPC_PERMISSIONS: { compare: 'subset', upstream: 'CONSOLE_RPC_PERMISSIONS' },
  CONSOLE_GATEWAY_HTTP_RULES: { compare: 'http-rules', upstream: 'CONSOLE_HTTP_PERMISSIONS' },
  GATEWAY_PACKAGES_RPC: 'equal',
  GATEWAY_INSTANCE_RPC: 'equal',
  GATEWAY_PLUGINS_RPC: 'equal',
  GATEWAY_RPC: 'equal',
  GATEWAY_RPC_PERMISSIONS: 'equal',
  GATEWAY_PACKAGES_PROGRESS: 'equal',
  GATEWAY_PACKAGES_PROGRESS_PATH: 'equal',
  GATEWAY_INSTANCE_ERROR: 'equal',
  GATEWAY_HEALTH_PATH: 'equal',
  FEATURE_RPC: 'equal',
  FEATURE_RPC_PERMISSIONS: 'equal',
  CONSOLE_FEATURE_CONVERSATION_KINDS: 'equal',
  FEATURE_CONVERSATION_ID_MAX_LENGTH: 'equal',
  CHAT_ROLES_RPC: 'equal',
  CHAT_ROLES_RPC_PERMISSIONS: 'equal',
  CONSOLE_CHAT_ROLES: 'equal',
})
