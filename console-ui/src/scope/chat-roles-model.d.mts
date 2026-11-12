import type { ScopeLevel, ScopeRef } from './scope-tree.mjs'

export type ChatRole = 'owner' | 'admin' | 'trusted'
export type ChatRoleSource = 'grant' | 'config' | 'mapping'

export interface ChatRoleEntry {
  readonly level: ScopeLevel
  readonly key: string
  readonly adapter: string
  readonly userId: string
  readonly role: ChatRole
  readonly source: ChatRoleSource
  readonly grantedBy?: string
  readonly grantedAt?: number
  readonly detail?: string
}
export interface ChatRoleRow extends ChatRoleEntry {
  readonly relation: 'direct' | 'inherited' | 'below'
  readonly revocable: boolean
  readonly id: string
}

export const CHAT_ROLES_RPC: Readonly<{ LIST: 'chat-roles.list'; GRANT: 'chat-roles.grant'; REVOKE: 'chat-roles.revoke' }>
export const CHAT_ROLES_PERMISSION: 'iam.manage'
export const CHAT_ROLES: readonly ChatRole[]
export const CHAT_ROLE_SOURCES: readonly ChatRoleSource[]
export const CHAT_ROLE_LABELS: Readonly<Record<ChatRole, string>>
export const CHAT_ROLE_SOURCE_LABELS: Readonly<Record<ChatRoleSource, string>>

export function chatRolesListRequest(scope: ScopeRef, options?: { descendants?: boolean }): { type: 'chat-roles.list'; level: ScopeLevel; key?: string; descendants?: true }
export function readChatRoles(payload: unknown): ChatRoleEntry[]
export function chatRoleRows(entries: readonly ChatRoleEntry[], scope: ScopeRef): ChatRoleRow[]
export function effectiveChatRole(entries: readonly ChatRoleEntry[], scope: ScopeRef, adapter: string, userId: string): ChatRole | null
export function chatRoleGrantRequest(scope: ScopeRef, input: { adapter?: string; userId: string; role: ChatRole }): { type: 'chat-roles.grant'; level: ScopeLevel; key?: string; adapter: string; userId: string; role: ChatRole }
export function chatRoleRevokeRequest(scope: ScopeRef, input: { adapter: string; userId: string }): { type: 'chat-roles.revoke'; level: ScopeLevel; key?: string; adapter: string; userId: string }
export function readChatRoleChange(payload: unknown): { status: 'saved' | 'unchanged' }
export function chatRoleApplied(entries: readonly ChatRoleEntry[], scope: ScopeRef, target: { adapter: string; userId: string; role?: ChatRole }, action: 'grant' | 'revoke'): boolean

export type ChatRoleMappingLevel = 'default' | 'adapter' | 'endpoint' | 'conversation'
export type PlatformStanding = 'owner' | 'admin' | 'member' | 'guest'
export interface ChatRoleMappingMatch { readonly standing: readonly string[]; readonly role: readonly string[]; readonly permission: readonly string[] }
export interface ChatRoleMappingRule { readonly match: ChatRoleMappingMatch; readonly grant: ChatRole | 'none'; readonly level?: ChatRoleMappingLevel }
export interface ChatRoleMappingLayer {
  readonly level: ChatRoleMappingLevel
  readonly rules: readonly ChatRoleMappingRule[]
  readonly inherit: boolean
  readonly revision?: number
  readonly updatedAt?: number
  readonly updatedBy?: string
}
export interface ChatRoleMappings { readonly layers: readonly ChatRoleMappingLayer[]; readonly effective: readonly (ChatRoleMappingRule & { level: ChatRoleMappingLevel })[] }
export const CHAT_ROLE_MAPPINGS_RPC: Readonly<{ LIST: 'chat-roles.mappings' }>
export const CHAT_ROLE_MAPPING_LEVELS: readonly ChatRoleMappingLevel[]
export const CHAT_ROLE_MAPPING_LEVEL_LABELS: Readonly<Record<ChatRoleMappingLevel, string>>
export const PLATFORM_STANDING_LABELS: Readonly<Record<PlatformStanding, string>>
export const CHAT_ROLE_MAPPINGS_HIDDEN_KEY: string
export function chatRoleMappingsRequest(scope: ScopeRef): { type: 'chat-roles.mappings'; level: 'adapter' | 'endpoint' | 'conversation'; key: string } | null
export function readChatRoleMappings(payload: unknown): ChatRoleMappings
export function mappingMatchParts(match: Partial<ChatRoleMappingMatch> | undefined): ChatRoleMappingMatch
