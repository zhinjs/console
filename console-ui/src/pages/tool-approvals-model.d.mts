export interface ToolApprovalCard {
  readonly id: string
  readonly toolName: string
  readonly category: string | null
  readonly sessionKey: string
  readonly requesterId: string | null
  readonly args: unknown
  readonly createdAt: number
  readonly expiresAt: number
  readonly status: 'pending' | 'approved' | 'denied' | 'expired' | 'consumed'
  readonly decidedAt: number | null
  readonly decidedBy: string | null
  readonly channel: 'console' | 'im_dm' | 'im_approver_group' | null
}
export interface ToolApprovals { readonly available: boolean; readonly pending: readonly ToolApprovalCard[] }
export function readToolApprovalCard(value: unknown): ToolApprovalCard
export function readToolApprovals(value: unknown): ToolApprovals
export function isKnownApprovalRejection(error: unknown): boolean
