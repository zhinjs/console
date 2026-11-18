/**
 * Writes of the account chat page's 系统 → 请求 / 通知 (#64 side-event-approve-guard): 同意 / 拒绝 a pending
 * request and 标记已处理 a request or notice. Each item has its own receipt (`persistKey`), so a click
 * while one is in flight, or after an unknown outcome, sends nothing. Approving a friend / group request
 * cannot be replayed safely: an unknown outcome is settled only by re-reading the pending list
 * (「刷新待处理列表」), never by sending the approval again.
 */
import { pendingRequestKey } from './pending-request-model.mjs'

export const REQUEST_ACTIONS = Object.freeze(['approve', 'reject', 'consume'])

/** Receipt key of one pending request (by platform id, else inbox row id). */
export function requestReceiptKey(adapter, endpointKey, request) {
  return `side-event:request:${adapter}:${endpointKey}:${pendingRequestKey(request)}`
}

/** Receipt key of one unread notice. */
export function noticeReceiptKey(adapter, endpointKey, id) {
  return `side-event:notice:${adapter}:${endpointKey}:${id}`
}

/** What the receipt carries: everything submit / verify need, so a remounted card reads it from the plan. */
export function requestActionPayload(action, adapter, endpointKey, request) {
  if (!REQUEST_ACTIONS.includes(action)) throw new TypeError(`unknown request action ${action}`)
  return { action, adapter, endpointKey, platformRequestId: request.platformRequestId, ...(request.id !== undefined ? { id: request.id } : {}) }
}

/** The RPC body of a request action. `rpc` is SIDE_EVENT_RPC. */
export function requestActionBody(payload, rpc) {
  if (payload.action === 'consume') {
    if (!Number.isSafeInteger(payload.id)) throw new TypeError('this request has no inbox row to mark')
    return { type: rpc.REQUEST_CONSUMED, rowIds: [payload.id] }
  }
  return { type: payload.action === 'approve' ? rpc.REQUEST_APPROVE : rpc.REQUEST_REJECT, adapter: payload.adapter, endpointKey: payload.endpointKey, platformRequestId: payload.platformRequestId }
}

const sameRequest = (row, payload) => (payload.platformRequestId && row.platformRequestId === payload.platformRequestId) || (payload.id !== undefined && row.id === payload.id)

/**
 * submit: sends the action once. verify: re-reads the pending list (`reload` resolves with the rows, or
 * null when it could not tell) — the request is gone → applied; still listed → not applied.
 */
export function requestActionHandlers({ send, reload, rpc, t = text => text }) {
  return {
    submit: plan => send(requestActionBody(plan.payload, rpc)),
    verify: async plan => {
      const rows = await reload()
      if (!Array.isArray(rows)) return { applied: undefined }
      return rows.some(row => sameRequest(row, plan.payload))
        ? { applied: false, message: t('刷新后这条请求仍在待处理列表里，这次操作没有生效。可以放弃后重新操作。') }
        : { applied: true, message: t('刷新后这条请求已不在待处理列表里。') }
    },
  }
}

/** 标记已处理 of an unread notice: submit once; verify re-reads the unread list. */
export function noticeActionHandlers({ send, reload, rpc, t = text => text }) {
  return {
    submit: plan => send({ type: rpc.NOTICE_CONSUMED, rowIds: [plan.payload.id] }),
    verify: async plan => {
      const rows = await reload()
      if (!Array.isArray(rows)) return { applied: undefined }
      return rows.some(row => row.id === plan.payload.id)
        ? { applied: false, message: t('刷新后这条通知仍是未读，这次操作没有生效。可以放弃后重新操作。') }
        : { applied: true, message: t('刷新后这条通知已不在未读列表里。') }
    },
  }
}
