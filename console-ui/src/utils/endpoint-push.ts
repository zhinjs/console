/** `@zhin.js/client` 对 canonical Endpoint SSE 事件公开的浏览器事件。 */
export const ENDPOINT_PUSH_EVENT = 'zhin-console-bot-push' as const

export type EndpointPushMessage = { type: string; data?: unknown }

export function subscribeEndpointPush(
  handler: (message: EndpointPushMessage) => void,
): () => void {
  const listener = (event: Event) => {
    handler((event as CustomEvent<EndpointPushMessage>).detail)
  }
  window.addEventListener(ENDPOINT_PUSH_EVENT, listener)
  return () => {
    window.removeEventListener(ENDPOINT_PUSH_EVENT, listener)
  }
}
