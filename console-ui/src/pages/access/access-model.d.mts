type Translate = (message: string, values?: readonly unknown[]) => string

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
export declare const IAM_VIEW: 'iam.view'
export declare const IAM_MANAGE: 'iam.manage'

export type PermissionAreaId = 'status' | 'endpoint' | 'feature' | 'plugin' | 'agent' | 'ops' | 'iam' | 'external'
export declare const PERMISSION_AREAS: ReadonlyArray<{ readonly id: PermissionAreaId; readonly permissions: readonly string[] }>
export declare const CONSOLE_PERMISSION_LIST: readonly string[]
export declare const SCOPED_PERMISSIONS: readonly string[]
export declare const BUILTIN_ROLE_NAMES: readonly ['owner', 'admin', 'operator', 'viewer']
export declare const OWNER_ROLE: 'owner'
export declare const AUDIT_PAGE_SIZE: number

export type BindingScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'adapter'; readonly key: string }
  | { readonly kind: 'endpoint'; readonly key: string }
export type ScopeKind = BindingScope['kind']

export interface IamBinding { readonly id?: string; readonly roleId?: string; readonly role: string; readonly scope: BindingScope }
export interface IamUser {
  readonly id: string
  readonly username: string
  readonly displayName: string
  readonly disabled: boolean
  readonly createdAt: number | null
  readonly updatedAt: number | null
  readonly passwordChangedAt: number | null
  readonly bindings: readonly IamBinding[]
}
export interface IamRole {
  readonly id: string
  readonly name: string
  readonly description: string
  readonly builtin: boolean
  readonly permissions: readonly string[]
}
export interface IamToken {
  readonly id: string
  readonly userId: string
  readonly name: string
  readonly permissions: readonly string[] | null
  readonly expiresAt: number | null
  readonly lastUsedAt: number | null
  readonly createdAt: number | null
}
export interface IamAuditEntry {
  readonly id: string
  readonly at: number
  readonly actor: string
  readonly action: string
  readonly target: string | null
  readonly outcome: string
  readonly detail: unknown
  readonly ip: string | null
}
export interface PluginPermission { readonly permission: string; readonly plugin: string; readonly level?: string; readonly description: string }
export interface PermissionGroup {
  readonly kind: 'area' | 'plugin'
  readonly id: string
  readonly permissions: ReadonlyArray<{ readonly permission: string; readonly level?: string; readonly description?: string }>
}
export interface BindingInput { readonly role: string; readonly scopeKind: ScopeKind; readonly scopeKey?: string }
export interface AuditFilter { readonly actor?: string; readonly action?: string; readonly since?: string; readonly until?: string }

export function isConsolePermission(value: unknown): boolean
export function areaLabel(id: string, t: Translate): string
export function permissionLabel(permission: string, t: Translate): string
export function levelLabel(level: string, t: Translate): string
export function permissionPlugin(permission: string): string
export function readPluginPermissionCatalog(payload: unknown): PluginPermission[]
export function permissionGroups(pluginCatalog?: readonly PluginPermission[], extra?: readonly string[]): PermissionGroup[]
export function togglePermissions(selected: readonly string[], permissions: readonly string[], checked: boolean): string[]
export function groupCheckState(selected: readonly string[], permissions: readonly string[]): boolean | 'indeterminate'
export function readScope(value: unknown): BindingScope | null
export function scopeLabel(scope: BindingScope | null | undefined, t: Translate): string
export function scopeProblem(kind: ScopeKind, key: string | undefined, t: Translate): string | null
export function bindingInputs(bindings: readonly IamBinding[]): BindingInput[]
export function addBinding(bindings: readonly IamBinding[], binding: IamBinding): readonly IamBinding[]
export function removeBinding(bindings: readonly IamBinding[], index: number): readonly IamBinding[]
export function isGlobalOwner(user: IamUser | null | undefined): boolean
export function breaksLastOwner(users: readonly IamUser[], userId: string, change: { disable?: boolean; remove?: boolean; bindings?: readonly IamBinding[] }): boolean
export function readUser(value: unknown): IamUser | null
export function readUsers(payload: unknown): IamUser[]
export function readRole(value: unknown): IamRole | null
export function readRoles(payload: unknown): IamRole[]
export function builtinRoleLabel(name: string, t: Translate): string | null
export function readTokens(payload: unknown): IamToken[]
export function tokenExpired(token: IamToken, now?: number): boolean
export function readAuditPage(payload: unknown): { entries: IamAuditEntry[]; next: number | null }
export function actorLabel(actor: string, usersById: ReadonlyMap<string, IamUser>, t: Translate): string
export function outcomeVariant(outcome: string): 'success' | 'warning' | 'destructive' | 'outline'
export function localDateTimeToMs(value: string | undefined): number | undefined
export function auditQuery(filter?: AuditFilter, before?: number): Record<string, unknown>
export function usernameProblem(value: string, t: Translate): string | null
export function passwordProblem(value: string, confirm: string | undefined, t: Translate): string | null
export function roleNameProblem(value: string, roles: readonly IamRole[], t: Translate): string | null
export function copyRoleName(name: string, roles: readonly IamRole[]): string
