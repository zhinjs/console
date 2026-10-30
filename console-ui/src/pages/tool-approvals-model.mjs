/** G6 Console cards describe the triggering session, never an inferred IM delivery target. */
export function readToolApprovalCard(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || typeof value.id !== 'string' || !value.id || typeof value.toolName !== 'string'
    || typeof value.sessionKey !== 'string' || (value.requesterId !== null && typeof value.requesterId !== 'string')
    || !Number.isFinite(value.createdAt) || !Number.isFinite(value.expiresAt)
    || !['pending', 'approved', 'denied', 'expired', 'consumed'].includes(value.status)
    || !Object.hasOwn(value, 'args')) throw new Error('Host 未返回完整的工具审批卡片')
  return value
}

export function readToolApprovals(value) {
  if (!value || typeof value !== 'object' || typeof value.available !== 'boolean' || !Array.isArray(value.pending)) {
    throw new Error('Host 未返回有效的工具审批目录')
  }
  return { available: value.available, pending: value.pending.map(readToolApprovalCard).filter(card => card.status === 'pending') }
}

/** Explicit RPC denials are settled failures; transport/timeouts cannot prove whether a decision committed. */
export function isKnownApprovalRejection(error) {
  return ['forbidden', 'invalid_input', 'conflict', 'not_found', 'unsupported', 'unavailable'].includes(error?.code)
}
