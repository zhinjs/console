import { useMemo } from 'react'
import { Button } from '@zhin.js/console-ui'
import { useI18n } from '../../i18n'
import { ActionReceipt, useActionReceipt } from '../../components/ActionReceipt'
import { receiptBlocksActions } from '../../components/action-receipt-model.mjs'
import { SIDE_EVENT_RPC } from '../../contracts/zhin-console'
import { requestConsole } from '../../utils/console-rpc'
import {
  noticeActionHandlers, noticeReceiptKey, requestActionHandlers, requestActionPayload, requestReceiptKey,
  type RequestAction, type RequestActionPayload,
} from './side-event-action-model.mjs'

interface PendingRequestRef {
  readonly platformRequestId: string
  readonly id?: number
  readonly canAct?: boolean
  readonly sender: { readonly id: string; readonly name?: string }
}

/**
 * 同意 / 拒绝 / 标记已处理 of one pending request, through its own receipt (#64 side-event-approve-guard):
 * one click sends once; while it is in flight, and after an unknown outcome, the three buttons stay
 * disabled and the receipt offers only 「刷新待处理列表」. Errors read through statusFromError.
 */
export function PendingRequestActions({ adapter, endpointKey, request, reload, onDone }: {
  adapter: string
  endpointKey: string
  request: PendingRequestRef
  /** Re-reads the pending list; rejects when the read failed (the outcome then stays unknown). */
  reload: () => Promise<readonly { platformRequestId?: string; id?: number }[] | null>
  /** The action settled (sent and answered, or a check found the request gone). */
  onDone: (payload: RequestActionPayload) => void
}) {
  const i18n = useI18n()
  const handlers = useMemo(() => requestActionHandlers({ send: body => requestConsole(body), reload, rpc: SIDE_EVENT_RPC, t: text => i18n.t(text) }), [reload, i18n])
  const receipt = useActionReceipt({
    persistKey: requestReceiptKey(adapter, endpointKey, request),
    submit: handlers.submit,
    verify: handlers.verify,
    onSettled: state => { if (state.plan?.payload) onDone(state.plan.payload as RequestActionPayload) },
  })
  const blocked = receiptBlocksActions(receipt.state)
  const who = request.sender.name || request.sender.id
  const act = (action: RequestAction) => {
    if (blocked) return
    const title = action === 'approve' ? i18n.t('同意 {0} 的请求', [who]) : action === 'reject' ? i18n.t('拒绝 {0} 的请求', [who]) : i18n.t('把 {0} 的请求标记为已处理', [who])
    receipt.prepare({ payload: requestActionPayload(action, adapter, endpointKey, request), title })
    // One click is the confirmation: the plan goes straight to 提交中, and the receipt shows the answer.
    receipt.confirm()
  }
  return (
    <div className="space-y-2" data-request-actions={request.platformRequestId}>
      <div className="flex flex-wrap gap-2">
        {request.canAct === true ? <>
          <Button size="sm" disabled={blocked} onClick={() => act('approve')}>{i18n.t('同意')}</Button>
          <Button size="sm" variant="secondary" disabled={blocked} onClick={() => act('reject')}>{i18n.t('拒绝')}</Button>
        </> : null}
        <Button size="sm" variant="ghost" disabled={blocked || request.id === undefined} onClick={() => act('consume')}>{i18n.t('标记已处理')}</Button>
      </div>
      <ActionReceipt controller={receipt} verifyLabel={i18n.t('刷新待处理列表')} />
    </div>
  )
}

/** 已读 (标记已处理) of one unread notice, through its own receipt; an unknown outcome offers only 「刷新通知列表」. */
export function NoticeReadAction({ adapter, endpointKey, id, reload, onDone }: {
  adapter: string
  endpointKey: string
  id: number
  reload: () => Promise<readonly { id: number }[] | null>
  onDone: (id: number) => void
}) {
  const i18n = useI18n()
  const handlers = useMemo(() => noticeActionHandlers({ send: body => requestConsole(body), reload, rpc: SIDE_EVENT_RPC, t: text => i18n.t(text) }), [reload, i18n])
  const receipt = useActionReceipt({
    persistKey: noticeReceiptKey(adapter, endpointKey, id),
    submit: handlers.submit,
    verify: handlers.verify,
    onSettled: () => onDone(id),
  })
  const blocked = receiptBlocksActions(receipt.state)
  const read = () => {
    if (blocked) return
    receipt.prepare({ payload: { id }, title: i18n.t('把这条通知标记为已读') })
    receipt.confirm()
  }
  return (
    <div className="flex shrink-0 flex-col items-end gap-2" data-notice-actions={id}>
      <Button size="sm" variant="secondary" disabled={blocked} onClick={read}>{i18n.t('已读')}</Button>
      <ActionReceipt controller={receipt} verifyLabel={i18n.t('刷新通知列表')} />
    </div>
  )
}
