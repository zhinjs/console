import type { DiagnosticConversation } from './endpoint-detail/types'
export interface PermissionCommand { id: string; owner: string; name: string; description: string; adapter?: string; permits: string[] }
export interface PermissionCatalog { generation: number; page: number; pageSize: number; total: number; commands: PermissionCommand[] }
export type PermissionOutcome = 'match' | 'mismatch' | 'unknown' | 'not_evaluated'
export interface PermissionResult { outcome: PermissionOutcome; reason: string }
export interface PermissionRequest { generation: number; commandId: string; target?: DiagnosticConversation; sender?: { id: string; roles?: string[] } }
export interface PermissionExplanation {
  generation: number; simulation: true; command: PermissionCommand; target?: DiagnosticConversation; sender?: PermissionRequest['sender'];
  permissionHost: 'present' | 'missing' | 'unverified'; adapter: PermissionResult;
  rules: (PermissionResult & { index: number; rule: string; kind: string; values?: string[] })[];
  summary: PermissionResult; unconstrained: string[]; assumptions: string[];
}
export function readPermissionCatalog(body: unknown): PermissionCatalog
export function permissionRequest(generation: number, selected: PermissionCommand, input?: { target?: unknown; requireTarget?: boolean; senderId?: string; roles?: string }): PermissionRequest
export function readPermissionExplanation(body: unknown, requested: PermissionRequest): PermissionExplanation
export function permissionOutcomeLabel(outcome: string): string
export function permissionHttpError(status: number): string
