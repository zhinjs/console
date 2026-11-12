import type { ScopeLevel, ScopeRef } from './scope-tree.mjs'

export type ChatRole = 'owner' | 'admin' | 'trusted'
export type ChatRoleSource = 'grant'

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
