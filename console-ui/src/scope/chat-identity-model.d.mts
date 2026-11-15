import type {
  ConsoleChatBindCodeResult, ConsoleChatConsoleLink, ConsoleChatIdentity, ConsoleChatIdentityLinkMethod,
  ConsoleChatPrincipal, ConsoleChatRoleEntry,
} from '@zhin.js/console-protocol'
import type { ScopeRef } from './scope-tree.mjs'

export { CHAT_PRINCIPALS_RPC } from '@zhin.js/console-protocol'
export const CHAT_IDENTITY_SELF_PERMISSION: 'self.chat-identity'

/** How an identity came to its person (the protocol's `ConsoleChatIdentityLinkMethod`). */
export type ChatIdentityLinkMethod = ConsoleChatIdentityLinkMethod

/** A validated `ConsoleChatIdentity` (`chat-identities.recent` rows also carry `principalId`). */
export interface ChatIdentityView extends ConsoleChatIdentity {
  readonly principalId?: string
}

/** A validated `ConsoleChatRoleEntry` (`source` is implied: zhin chat roles come only from grants). */
export type ChatPrincipalRole = Readonly<Pick<ConsoleChatRoleEntry, 'level' | 'key' | 'role' | 'redacted' | 'adapter' | 'userId' | 'grantedBy' | 'grantedByName'>>

/** A validated `ConsoleChatPrincipal`, plus whether it is a stored person. */
export interface ChatPrincipalView extends Omit<ConsoleChatPrincipal, 'identities' | 'roles' | 'consoleLink' | 'createdBy' | 'createdAt'> {
  /** A stored person (`cp_…`); false for an identity without one (`implicit:…`). */
  readonly stored: boolean
  readonly identities: readonly ChatIdentityView[]
  readonly roles: readonly ChatPrincipalRole[]
  /** `linkedVia` is kept as sent (a newer Host may add ways to link). */
  readonly consoleLink?: Readonly<Pick<ConsoleChatConsoleLink, 'consoleUserId' | 'consoleDisplayName'> & { linkedVia?: string }>
}

/** `ConsoleChatIdentityMeResult`, with the open code's expiry (`pendingCode.expiresAt`) flattened. */
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
export declare function readBindCode(payload: unknown): ConsoleChatBindCodeResult
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
