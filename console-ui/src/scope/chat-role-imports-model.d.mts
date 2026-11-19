import type { ConsoleAccess } from '../utils/console-access.mjs'
import type { ChatRole } from './chat-roles-model.mjs'

type Translate = (message: string, values?: readonly unknown[]) => string

export const CHAT_ROLE_IMPORTS_RPC: Readonly<{ LIST: 'chat-roles.imports.list'; RESOLVE: 'chat-roles.imports.resolve' }>
export const CHAT_ROLE_IMPORTS_PERMISSION: 'iam.manage'
export const CHAT_ROLE_IMPORTS_ANCHOR: 'chat-role-imports'
export function chatRoleImportsHref(): string
export function canResolveChatRoleImports(access?: ConsoleAccess): boolean

export type ChatRoleImportDecision = 'import' | 'ignore'
export function chatRoleImportsListRequest(): { type: 'chat-roles.imports.list' }
export function chatRoleImportResolveRequest(decision: ChatRoleImportDecision, id: string): { type: 'chat-roles.imports.resolve'; decision: ChatRoleImportDecision; id: string }

export interface ChatRoleImportRoleRow {
  readonly kind: 'role'
  readonly id: string
  readonly adapter: string
  readonly endpoint?: string
  readonly userId: string
  readonly level: 'global' | 'adapter' | 'endpoint'
  readonly key: string
  readonly role: Extract<ChatRole, 'owner' | 'trusted'>
  readonly source?: string
  readonly seenAt?: number
}
export interface ChatRoleImportPersonalRow {
  readonly kind: 'personal'
  readonly id: string
  readonly consoleUserId: string
  readonly adapter: string
  readonly endpoint?: undefined
  readonly userId: string
  readonly source: string
  readonly seenAt?: number
}
export type ChatRoleImportRow = ChatRoleImportRoleRow | ChatRoleImportPersonalRow

export function readChatRoleImports(payload: unknown): { rows: ChatRoleImportRow[]; hasGlobalOwner: boolean }
export function chatRoleImportIdentity(row: Pick<ChatRoleImportRow, 'adapter' | 'userId'> & { endpoint?: string }): string
export function consoleUserLabel(consoleUserId: string, users?: readonly { id: string; username?: string; displayName?: string }[]): string
export function chatRoleImportSummary(row: ChatRoleImportRow, t: Translate, users?: readonly { id: string; username?: string; displayName?: string }[]): string
export function chatRoleImportEffect(row: ChatRoleImportRow, t: Translate): string

export type ChatRoleImportResult = 'written' | 'upgraded' | 'kept' | 'memory' | 'skipped'
export type ChatRoleImportSkipReason = 'simulated' | 'unknown-adapter' | 'owned-elsewhere'
export interface ChatRoleImportResolveReply {
  readonly status: 'imported' | 'ignored' | 'acknowledged' | 'unchanged'
  readonly result?: ChatRoleImportResult
  readonly reason?: ChatRoleImportSkipReason
}
export function readChatRoleImportResolve(payload: unknown): ChatRoleImportResolveReply

export type ChatRoleImportOutcomeKey = 'written' | 'linked' | 'upgraded' | 'kept' | 'memory' | 'skipped' | ChatRoleImportSkipReason | 'ignored' | 'unchanged'
export const CHAT_ROLE_IMPORT_COPY: Readonly<Record<ChatRoleImportOutcomeKey, string>>
export function chatRoleImportOutcomeCopy(reply: ChatRoleImportResolveReply, kind: ChatRoleImportRow['kind']): ChatRoleImportOutcomeKey
export function chatRoleImportGranted(reply: ChatRoleImportResolveReply, kind: ChatRoleImportRow['kind']): boolean
export function chatRoleImportResolved(rows: readonly ChatRoleImportRow[], id: string): boolean
export function chatRoleImportsUnsupported(error: unknown): boolean
