import { getConsoleTransport } from './console-client'
import { reportRequestFailure, reportRequestSuccess } from './instance-availability.mjs'

export interface ConsoleRpcRequest {
  readonly type: string
  readonly [key: string]: unknown
}

/**
 * RPC 使用 REST transport，与 SSE 在线状态解耦。
 * SSE 只负责实时事件；短暂断流不得阻止用户读取或提交 RPC。
 */
export function requestConsole<T>(request: ConsoleRpcRequest): Promise<T> {
  // Every reply also tells the shell whether the Zhin instance is answering (实例不可用横幅).
  return getConsoleTransport().sendRequest<T>(request).then(
    value => { reportRequestSuccess(request.type); return value },
    (error: unknown) => { reportRequestFailure(request.type, error); throw error },
  )
}
