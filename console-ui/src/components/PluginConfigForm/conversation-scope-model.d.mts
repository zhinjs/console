import type { SchemaField } from './types.js'
export type ConversationKind = 'private' | 'group' | 'channel'
export const CONVERSATION_KINDS: readonly ConversationKind[]
export const CONVERSATION_KIND_LABELS: Record<ConversationKind, string>
export function isConversationScopeField(field: SchemaField): boolean
export function scopeAllowedKinds(field: SchemaField): ConversationKind[]
export function endpointKey(endpoint: unknown): string
export function targetDraft(value: unknown): { endpoint: {id?: string; adapter?: string}; kind: string; id: string; parentKind: string; parentId: string; threadId: string }
export function updateTargetField(value: unknown, field: string, child: unknown): unknown
export function updateTargetParent(value: unknown, field: string, child: unknown): unknown
export function targetDraftIssue(value: unknown, allowedKinds?: readonly ConversationKind[]): string | null
export function createScopeReadGate(readScope: () => string | undefined): { begin(): {scope: string | undefined; current(): boolean}; cancel(): void }
