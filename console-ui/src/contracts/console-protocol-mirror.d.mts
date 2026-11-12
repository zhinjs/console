export declare const CONSOLE_PERMISSIONS: Readonly<{
  STATUS_VIEW: 'status.view'
  ENDPOINT_VIEW: 'endpoint.view'
  ENDPOINT_OPERATE: 'endpoint.operate'
  ENDPOINT_MANAGE: 'endpoint.manage'
  FEATURE_VIEW: 'feature.view'
  FEATURE_CONFIGURE: 'feature.configure'
  FEATURE_TOGGLE: 'feature.toggle'
  PLUGIN_MANAGE: 'plugin.manage'
  PLUGIN_PERMS_READ: 'plugin.perms.read'
  PLUGIN_PERMS_OPERATE: 'plugin.perms.operate'
  PLUGIN_PERMS_MANAGE: 'plugin.perms.manage'
  AGENT_VIEW: 'agent.view'
  AGENT_CONFIGURE: 'agent.configure'
  OPS_CONFIG_READ: 'ops.config.read'
  OPS_CONFIG_WRITE: 'ops.config.write'
  OPS_ENV_READ: 'ops.env.read'
  OPS_ENV_WRITE: 'ops.env.write'
  OPS_DATABASE_READ: 'ops.database.read'
  OPS_DATABASE_WRITE: 'ops.database.write'
  OPS_SCHEDULE_READ: 'ops.schedule.read'
  OPS_SCHEDULE_WRITE: 'ops.schedule.write'
  OPS_FILES_READ: 'ops.files.read'
  OPS_FILES_WRITE: 'ops.files.write'
  OPS_RESTART: 'ops.restart'
  OPS_TERMINAL: 'ops.terminal'
  IAM_VIEW: 'iam.view'
  IAM_MANAGE: 'iam.manage'
  MCP_ACCESS: 'mcp.access'
  A2A_ACCESS: 'a2a.access'
}>
export type ConsolePermission = (typeof CONSOLE_PERMISSIONS)[keyof typeof CONSOLE_PERMISSIONS]
export declare const CONSOLE_PERMISSION_LIST: readonly ConsolePermission[]
export declare const CONSOLE_SCOPED_PERMISSIONS: readonly ConsolePermission[]
export declare const CONSOLE_BUILTIN_ROLE_NAMES: readonly ['owner', 'admin', 'operator', 'viewer']

export declare const IAM_RPC: Readonly<{
  USERS_LIST: 'iam.users.list'
  USERS_CREATE: 'iam.users.create'
  USERS_UPDATE: 'iam.users.update'
  USERS_DISABLE: 'iam.users.disable'
  USERS_DELETE: 'iam.users.delete'
  USERS_RESET_PASSWORD: 'iam.users.reset-password'
  ROLES_LIST: 'iam.roles.list'
  ROLES_CREATE: 'iam.roles.create'
  ROLES_UPDATE: 'iam.roles.update'
  ROLES_DELETE: 'iam.roles.delete'
  BINDINGS_SET: 'iam.bindings.set'
  TOKENS_LIST: 'iam.tokens.list'
  TOKENS_CREATE: 'iam.tokens.create'
  TOKENS_REVOKE: 'iam.tokens.revoke'
  AUDIT_LIST: 'iam.audit.list'
}>
export declare const ONBOARDING_RPC: Readonly<{ UPDATE: 'onboarding.update' }>
export declare const CONSOLE_AUTH_ROUTES: Readonly<{
  LOGIN: '/auth/login'
  LOGOUT: '/auth/logout'
  ME: '/auth/me'
  PASSWORD: '/auth/password'
  TOKENS: '/auth/tokens'
  TOKENS_REVOKE: '/auth/tokens/revoke'
  SETUP: '/auth/setup'
  SETUP_DATABASE: '/auth/setup/database'
  SETUP_DATABASE_TEST: '/auth/setup/database/test'
}>
export declare const CONSOLE_GATEWAY_OWNED_RPC_PERMISSIONS: Readonly<Record<string, ConsolePermission>>
export interface ConsoleHttpRuleMirror {
  readonly method: string
  readonly path: string
  readonly permission: ConsolePermission | 'public' | 'bootstrap' | 'authenticated' | 'rpc'
}
export declare const CONSOLE_GATEWAY_HTTP_RULES: readonly ConsoleHttpRuleMirror[]

export declare const GATEWAY_PACKAGES_RPC: Readonly<{
  LIST: 'gateway.packages.list'
  PLAN: 'gateway.packages.plan'
  INSTALL: 'gateway.packages.install'
  UNINSTALL: 'gateway.packages.uninstall'
  UPDATE: 'gateway.packages.update'
}>
export declare const GATEWAY_INSTANCE_RPC: Readonly<{
  STATUS: 'gateway.instance.status'
  START: 'gateway.instance.start'
  STOP: 'gateway.instance.stop'
  RESTART: 'gateway.instance.restart'
  LOGS: 'gateway.instance.logs'
}>
export declare const GATEWAY_PLUGINS_RPC: Readonly<{ DECLARE: 'gateway.plugins.declare' }>
export declare const GATEWAY_RPC: typeof GATEWAY_PACKAGES_RPC & typeof GATEWAY_INSTANCE_RPC & typeof GATEWAY_PLUGINS_RPC
export type GatewayRpcType = (typeof GATEWAY_RPC)[keyof typeof GATEWAY_RPC]
export declare const GATEWAY_RPC_PERMISSIONS: Readonly<Record<GatewayRpcType, ConsolePermission>>
export declare const GATEWAY_PACKAGES_PROGRESS: 'gateway.packages.progress'
export declare const GATEWAY_PACKAGES_PROGRESS_PATH: '/gateway/packages/progress'
export declare const GATEWAY_INSTANCE_ERROR: Readonly<{
  UNAVAILABLE: 'instance_unavailable'
  TIMEOUT: 'instance_timeout'
  ERROR: 'instance_error'
}>
export type GatewayInstanceErrorCode = (typeof GATEWAY_INSTANCE_ERROR)[keyof typeof GATEWAY_INSTANCE_ERROR]
export declare const GATEWAY_HEALTH_PATH: '/pub/health'

export declare const FEATURE_RPC: Readonly<{
  LIST: 'feature.list'
  MATRIX: 'feature.matrix'
  GET: 'feature.get'
  SET_OVERRIDE: 'feature.set-override'
  REMOVE_OVERRIDE: 'feature.remove-override'
  SET_ENABLED: 'feature.set-enabled'
  CONVERSATIONS: 'feature.conversations'
}>
export declare const FEATURE_RPC_PERMISSIONS: Readonly<Record<string, 'feature.view' | 'feature.configure' | 'feature.toggle'>>
export declare const CONSOLE_FEATURE_CONVERSATION_KINDS: readonly ['group', 'private', 'channel']
export declare const FEATURE_CONVERSATION_ID_MAX_LENGTH: 256

export declare const CHAT_ROLES_RPC: Readonly<{
  LIST: 'chat-roles.list'
  GRANT: 'chat-roles.grant'
  REVOKE: 'chat-roles.revoke'
}>
export declare const CHAT_ROLES_RPC_PERMISSIONS: Readonly<Record<string, 'iam.manage'>>
export declare const CONSOLE_CHAT_ROLES: readonly ['owner', 'admin', 'trusted']

export declare const PENDING_UPSTREAM: readonly string[]
export declare const MIRROR_COMPARISON: Readonly<Record<string, 'equal' | 'set' | { compare: 'subset' | 'http-rules'; upstream: string }>>
