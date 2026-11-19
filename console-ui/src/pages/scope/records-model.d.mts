import type { Scope } from '../../scope/scope-tree.mjs'

export type RecordSourceId = 'sessions' | 'replay' | 'logs' | 'audit'
export type RecordAssociation = 'exact' | 'partial' | 'text' | 'all'
export interface RecordSource {
  readonly id: RecordSourceId
  readonly href: string
  readonly filter: string
  readonly association: RecordAssociation
  readonly note: string
}
export declare const RECORD_SOURCES: readonly RecordSourceId[]
export declare const RECORD_SOURCE_COPY: Readonly<Record<RecordSourceId, { title: string; description: string }>>
export declare const ASSOCIATION_LABELS: Readonly<Record<RecordAssociation, string>>
export declare function conversationSessionKey(scope: Scope): string
export declare function auditTargetOf(scope: Scope): string
export declare function sessionsHref(scope: Scope): string
export declare function recordSources(scope: Scope): RecordSource[]
export declare function sessionKeyInScope(sessionKey: string, scope: Scope): boolean
export declare function sessionConversationScope(sessionKey: string): (Scope & { level: 'conversation' }) | null
export declare function auditEntriesForTarget<T extends { target?: string | null }>(entries: readonly T[], target: string | null | undefined): readonly T[]

export type SessionRowOrigin =
  | { readonly im: false }
  | { readonly im: true; readonly adapter: string; readonly endpoint?: string; readonly kind?: 'private' | 'group' | 'channel'; readonly id?: string; readonly name?: string }
export declare function sessionRowOrigin(row: unknown): SessionRowOrigin | null
export declare function sessionRowInScope(row: unknown, scope: Scope): 'in' | 'out' | 'unknown'
export interface ScopeSessionRow {
  readonly sessionKey: string
  readonly turns: number
  readonly lastAt: number
  readonly lastStatus: string
  readonly origin: Extract<SessionRowOrigin, { im: true }> | null
  readonly conversation: (Scope & { level: 'conversation' }) | null
}
export interface ScopeSessionRecords {
  readonly state: 'matched' | 'unattributed' | 'empty'
  readonly rows: readonly ScopeSessionRow[]
  readonly total: number
  readonly unattributed: number
}
export declare function scopeSessionRecords(body: unknown, scope: Scope, limit?: number): ScopeSessionRecords
