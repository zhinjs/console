/** `@zhin.js/client` 对 canonical Endpoint SSE 事件公开的浏览器事件。 */
export const ENDPOINT_PUSH_EVENT = 'zhin-console-bot-push' as const
/** Public Client event emitted when bounded SSE history cannot resume exactly. */
export const CONSOLE_RECOVERY_GAP_EVENT = 'zhin-console-event-recovery-gap' as const

export type EndpointPushMessage = { type: string; data?: unknown; delivery?: 'live' | 'history' }

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

export function subscribeConsoleRecoveryGap(handler: () => void): () => void {
  window.addEventListener(CONSOLE_RECOVERY_GAP_EVENT, handler)
  return () => window.removeEventListener(CONSOLE_RECOVERY_GAP_EVENT, handler)
}
