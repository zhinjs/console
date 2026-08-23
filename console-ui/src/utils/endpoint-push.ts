import {
  getWebSocketManager,
  SIDE_EVENT_PUSH,
  type KnownConsoleEventEnvelope,
} from '@zhin.js/client'

type EndpointPushType =
  | typeof SIDE_EVENT_PUSH.MESSAGE_RECEIVE
  | typeof SIDE_EVENT_PUSH.NOTICE_RECEIVE
  | typeof SIDE_EVENT_PUSH.REQUEST_RECEIVE

export type EndpointPushMessage = Extract<
  KnownConsoleEventEnvelope,
  { type: EndpointPushType }
>

export function subscribeEndpointPush(
  handler: (message: EndpointPushMessage) => void,
): () => void {
  const manager = getWebSocketManager()
  const unsubscribers = [
    manager.onConsoleEvent(SIDE_EVENT_PUSH.MESSAGE_RECEIVE, handler),
    manager.onConsoleEvent(SIDE_EVENT_PUSH.NOTICE_RECEIVE, handler),
    manager.onConsoleEvent(SIDE_EVENT_PUSH.REQUEST_RECEIVE, handler),
  ]
  return () => {
    for (const unsubscribe of unsubscribers) unsubscribe()
  }
}

export function subscribeConsoleRecoveryGap(handler: () => void): () => void {
  return getWebSocketManager().onConsoleEventRecoveryGap(handler)
}
