export type SelfChangeStatus = 'draft' | 'trialing' | 'ready' | 'pending' | 'approved' | 'applying' | 'verifying' | 'applied'
  | 'trial_failed' | 'rejected' | 'expired' | 'rolled_back' | 'failed'
export interface SelfChangeCard {
  readonly id: string
  readonly status: SelfChangeStatus
  readonly contentHash: string
  readonly files: unknown
  readonly configPaths: readonly string[]
  readonly preview: unknown
  readonly trial: unknown
  readonly origin: unknown
  readonly approvalId: string | null
  readonly approvedBy: string | null
  readonly error: string | null
  readonly bytes: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly submittedAt: number | null
  readonly terminalAt: number | null
  readonly resolvedAt: number | null
  readonly slimmed: boolean
}
export interface SelfChanges {
  readonly available: boolean
  readonly pending: readonly SelfChangeCard[]
  readonly recent: readonly SelfChangeCard[]
  readonly usageBytes: number
}
export interface SelfChangeDetailFile {
  readonly path: string
  readonly kind: 'create' | 'modify' | 'delete'
  readonly diff: string | null
  readonly truncated: boolean
  readonly unavailableReason: string | null
}
export interface SelfChangeDetailConfigOperation {
  readonly op: 'set' | 'remove'
  readonly path: readonly string[]
  readonly value?: unknown
}
export interface SelfChangeTrialCheck {
  readonly check?: string
  readonly path?: string
  readonly status?: string
  readonly message?: string
}
export interface SelfChangeDetail {
  readonly change: SelfChangeCard
  readonly bodiesAvailable: boolean
  readonly baseline: 'disk' | 'snapshot'
  readonly files: readonly SelfChangeDetailFile[]
  readonly diffBytes: number
  readonly maxDiffBytes: number
  readonly diffTruncated: boolean
  readonly configPatch: { readonly expectedRevision: string; readonly operations: readonly SelfChangeDetailConfigOperation[] } | null
  readonly trial: {
    readonly passed: boolean | null
    readonly checks: readonly SelfChangeTrialCheck[]
    readonly pendingStages: readonly string[]
    readonly skippedChecks: readonly string[]
  } | null
  readonly usageBytes: number
}
export interface SelfChangeFileSummary { readonly path: string; readonly kind: string; readonly added: number; readonly removed: number }
export function readSelfChangeCard(value: unknown): SelfChangeCard
export function readSelfChanges(value: unknown): SelfChanges
export function readSelfChangeDetail(value: unknown): SelfChangeDetail
export function selfChangeSummary(change: SelfChangeCard): string
export function selfChangeFiles(change: SelfChangeCard): readonly SelfChangeFileSummary[]
export function skippedCheckNames(trial: unknown): readonly string[]
export function needsHandling(change: SelfChangeCard): boolean
export function formatBytes(bytes: number): string
export function diffLineTone(line: string): 'header' | 'hunk' | 'added' | 'removed' | 'context'
