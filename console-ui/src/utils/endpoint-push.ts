/** 上游 SDK 历史命名；Console bridge 过渡期同时派发两个事件名 */
export const ENDPOINT_PUSH_EVENT_NAMES = [
  'zhin-console-bot-push',
  'zhin-console-endpoint-push',
] as const

export type EndpointPushMessage = { type: string; data?: unknown }

export function dispatchEndpointPush(detail: EndpointPushMessage): void {
  if (typeof window === 'undefined') return
  for (const name of ENDPOINT_PUSH_EVENT_NAMES) {
    window.dispatchEvent(new CustomEvent(name, { detail }))
  }
}

export function subscribeEndpointPush(
  handler: (message: EndpointPushMessage) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<EndpointPushMessage>).detail)
  }
  for (const name of ENDPOINT_PUSH_EVENT_NAMES) {
    window.addEventListener(name, listener)
  }
  return () => {
    for (const name of ENDPOINT_PUSH_EVENT_NAMES) {
      window.removeEventListener(name, listener)
    }
  }
}
