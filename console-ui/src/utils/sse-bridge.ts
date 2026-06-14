import { getWebSocketManager } from '@zhin.js/client'

let installed = false

const ENDPOINT_PUSH_TYPES = new Set([
  'endpoint:request',
  'endpoint:notice',
  'endpoint:message',
])

/** 将 SDK SSE 广播中的 config:updated / data-update / endpoint:* 推送转为 window 自定义事件 */
export function setupConsoleSseBridge(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const mgr = getWebSocketManager() as {
    callbacks: { onMessage?: (message: { type: string; data?: unknown }) => void }
  }

  const prev = mgr.callbacks.onMessage
  mgr.callbacks.onMessage = (message) => {
    prev?.(message)
    const t = message.type
    if (t === 'config:updated') {
      window.dispatchEvent(new CustomEvent('zhin-console-config-updated', { detail: message }))
    } else if (t === 'data-update') {
      window.dispatchEvent(new CustomEvent('zhin-console-data-update', { detail: message }))
    } else if (ENDPOINT_PUSH_TYPES.has(t)) {
      window.dispatchEvent(new CustomEvent('zhin-console-endpoint-push', { detail: message }))
    }
  }
}
