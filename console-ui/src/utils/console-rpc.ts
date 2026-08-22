import { getWebSocketManager } from '@zhin.js/client'

export interface ConsoleRpcRequest {
  readonly type: string
  readonly [key: string]: unknown
}

/**
 * RPC 使用 REST transport，与 SSE 在线状态解耦。
 * SSE 只负责实时事件；短暂断流不得阻止用户读取或提交 RPC。
 */
export function requestConsole<T>(request: ConsoleRpcRequest): Promise<T> {
  return getWebSocketManager().sendRequest<T>(request)
}
