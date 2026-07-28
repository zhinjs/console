import { getWebSocketManager } from '@zhin.js/client'
import { dispatchEndpointPush, type EndpointPushMessage } from './endpoint-push'

let installed = false
let wrappedMgr: { callbacks: { onMessage?: (message: EndpointPushMessage) => void } } | null = null
let prevOnMessage: ((message: EndpointPushMessage) => void) | undefined

// Host 广播与 SDK 归一化后均为 canonical 事件名（见 @zhin.js/console-protocol 别名表）
const ENDPOINT_PUSH_TYPES = new Set([
  'message.receive',
  'request.receive',
  'notice.receive',
])

/** 将 SDK SSE 广播中的 config:updated / data-update / endpoint 推送转为 window 自定义事件 */
export function setupConsoleSseBridge(): void {
  if (installed || typeof window === 'undefined') return
  installed = true

  const mgr = getWebSocketManager() as {
    callbacks: { onMessage?: (message: EndpointPushMessage) => void }
  }

  prevOnMessage = mgr.callbacks.onMessage
  wrappedMgr = mgr
  mgr.callbacks.onMessage = (message) => {
    prevOnMessage?.(message)
    const t = message.type
    if (t === 'config:updated') {
      window.dispatchEvent(new CustomEvent('zhin-console-config-updated', { detail: message }))
    } else if (t === 'data-update') {
      window.dispatchEvent(new CustomEvent('zhin-console-data-update', { detail: message }))
    } else if (ENDPOINT_PUSH_TYPES.has(t)) {
      dispatchEndpointPush(message)
    }
  }
}

export function resetConsoleSseBridge(): void {
  // 还原 setup 前的 onMessage，避免登出再登录后回调被包两层、事件重复派发
  if (wrappedMgr) {
    wrappedMgr.callbacks.onMessage = prevOnMessage
  }
  wrappedMgr = null
  prevOnMessage = undefined
  installed = false
}
