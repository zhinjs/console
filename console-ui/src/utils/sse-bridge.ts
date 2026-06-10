import { getWebSocketManager } from '@zhin.js/client'

let installed = false

/** 将 SDK SSE 广播中的 config:updated / data-update 转为 window 自定义事件 */
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
    }
  }
}
