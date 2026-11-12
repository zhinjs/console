import type { DiagnosticConversation } from './endpoint-detail/types'
export interface PermissionCommand { id: string; owner: string; name: string; description: string; adapter?: string; permits: string[] }
export interface PermissionCatalog { generation: number; page: number; pageSize: number; total: number; commands: PermissionCommand[] }
export type PermissionOutcome = 'match' | 'mismatch' | 'unknown' | 'not_evaluated'
export interface PermissionResult { outcome: PermissionOutcome; reason: string }
export type HypotheticalChatRole = '' | 'none' | 'owner' | 'admin' | 'trusted'
export type HypotheticalStanding = '' | 'owner' | 'admin' | 'member' | 'guest'
export interface PermissionSender { id: string; chatRole?: 'owner' | 'admin' | 'trusted' | null; platform?: { standing: Exclude<HypotheticalStanding, ''>; roles?: string[]; permissions?: string[] } }
export const HYPOTHETICAL_CHAT_ROLES: readonly HypotheticalChatRole[]
export const HYPOTHETICAL_STANDINGS: readonly HypotheticalStanding[]
export interface PermissionRequest { generation: number; commandId: string; target?: DiagnosticConversation; sender?: PermissionSender }
export interface PermissionExplanation {
  generation: number; simulation: true; command: PermissionCommand; target?: DiagnosticConversation; sender?: PermissionRequest['sender'];
  permissionHost: 'present' | 'missing' | 'unverified'; adapter: PermissionResult;
  rules: (PermissionResult & { index: number; rule: string; kind: string; values?: string[] })[];
  summary: PermissionResult; unconstrained: string[]; assumptions: string[];
}
export function readPermissionCatalog(body: unknown, locale?: 'zh-CN' | 'en'): PermissionCatalog
export function permissionRequest(generation: number, selected: PermissionCommand, input?: { target?: unknown; requireTarget?: boolean; senderId?: string; chatRole?: HypotheticalChatRole; standing?: HypotheticalStanding; platformRoles?: string }, locale?: 'zh-CN' | 'en'): PermissionRequest
export function readPermissionExplanation(body: unknown, requested: PermissionRequest, locale?: 'zh-CN' | 'en'): PermissionExplanation
export function permitRuleMeaning(rule: { kind: string; values?: readonly string[] }, locale?: 'zh-CN' | 'en'): string | null
export function permissionOutcomeLabel(outcome: string, locale?: 'zh-CN' | 'en'): string
export function permissionHttpError(status: number, locale?: 'zh-CN' | 'en'): string
