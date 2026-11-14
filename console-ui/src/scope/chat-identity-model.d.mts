import type { ScopeRef } from './scope-tree.mjs'

export declare const CHAT_IDENTITY_RPC: Readonly<{
  PRINCIPALS_LIST: 'chat-principals.list'
  MERGE: 'chat-principals.merge'
  SPLIT: 'chat-principals.split'
  RENAME: 'chat-principals.rename'
  RECENT: 'chat-identities.recent'
  BIND_CODE_CREATE: 'chat-identities.bind-code.create'
  ME: 'chat-identities.me'
  SIMULATED_ENSURE: 'chat-identities.simulated.ensure'
}>

export type ChatIdentityLinkMethod = 'implicit' | 'code' | 'manual' | 'import' | 'console'

export interface ChatIdentityView {
  readonly adapter: string
  readonly userId: string
  readonly linkMethod?: ChatIdentityLinkMethod
  readonly linkedAt?: number
  readonly lastSeenAt?: number
  readonly lastDisplayName?: string
  readonly principalId?: string
}

export interface ChatPrincipalRole {
  readonly level: 'global' | 'adapter' | 'endpoint' | 'conversation'
  readonly key: string
  readonly role: 'owner' | 'admin' | 'trusted'
  readonly redacted?: true
  readonly adapter?: string
  readonly userId?: string
  readonly grantedBy?: string
  readonly grantedByName?: string
}

export interface ChatPrincipalView {
  readonly id: string
  /** A stored person (`cp_…`); false for an identity without one (`implicit:…`). */
  readonly stored: boolean
  readonly displayName?: string
  readonly identities: readonly ChatIdentityView[]
  readonly roles: readonly ChatPrincipalRole[]
  readonly hiddenIdentities?: number
  readonly consoleLink?: Readonly<{ consoleUserId: string; consoleDisplayName?: string; linkedVia?: string }>
  readonly unverified?: true
}

export interface ChatIdentityMe {
  readonly principal?: ChatPrincipalView
  readonly pendingCodeExpiresAt?: number
  readonly suggestGlobalOwner: boolean
}

export interface ChatGrantCandidate {
  readonly key: string
  readonly adapter: string
  readonly userId: string
  readonly source: 'recent' | 'person'
  readonly label: string
  readonly personName?: string
  readonly principalId?: string
  readonly lastSeenAt?: number
}

export declare function isMissingIdentityRpc(error: unknown): boolean
export declare function readPrincipal(item: unknown): ChatPrincipalView | null
export declare function readPrincipals(payload: unknown): ChatPrincipalView[]
export declare function readRecentIdentities(payload: unknown): ChatIdentityView[]
export declare function readIdentityMe(payload: unknown): ChatIdentityMe
export declare function readBindCode(payload: unknown): Readonly<{ code: string; expiresAt: number }>
export declare function bindInstruction(code: string, locale?: 'zh-CN' | 'en'): string
export declare function bindCountdown(expiresAt: number, now?: number): string
export declare function principalName(principal: ChatPrincipalView): string
export declare function lastSeen(principal: ChatPrincipalView): number | undefined
export declare function holdsGlobalRole(principal: ChatPrincipalView): boolean
export declare function principalActions(principal: ChatPrincipalView, access: { manage: boolean; globalManage: boolean }): Readonly<{ rename: boolean; merge: boolean; split: boolean; needsGlobal: boolean }>
export declare function filterPrincipals(principals: readonly ChatPrincipalView[], query: string): readonly ChatPrincipalView[]
export declare function grantorLabel(entry: { grantedBy?: string; grantedByName?: string } | undefined): string | undefined
export declare function grantCandidates(input: { recent?: readonly ChatIdentityView[]; principals?: readonly ChatPrincipalView[]; alias?: string | null; query?: string }): ChatGrantCandidate[]
export declare function principalsListRequest(scope?: ScopeRef): { type: string; level?: string; key?: string }
export declare function recentIdentitiesRequest(scope?: ScopeRef, limit?: number): { type: string; level: string; key?: string; limit: number }
export declare function mergeRequest(intoId: string, fromId: string): { type: string; into: { principalId: string }; from: { principalId: string } }
export declare function splitRequest(identity: { adapter: string; userId: string }): { type: string; adapter: string; userId: string }
export declare function renameRequest(principalId: string, displayName: string): { type: string; principalId: string; displayName: string }
export declare function promoteGlobalOwnerRequest(principal: ChatPrincipalView | undefined): { type: 'chat-roles.grant'; level: 'global'; adapter: string; userId: string; role: 'owner' }
export declare function adapterAliases(rows: unknown): string[]
export declare const LINK_METHOD_LABELS: Readonly<Record<ChatIdentityLinkMethod, string>>
