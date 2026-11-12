import { getConsoleTransport } from './console-client'
import { reportRequestFailure, reportRequestSuccess } from './instance-availability.mjs'
import { requestWithCapture } from './rpc-reply-capture.mjs'

export interface ConsoleRpcRequest {
  readonly type: string
  readonly [key: string]: unknown
}

/**
 * RPC 使用 REST transport，与 SSE 在线状态解耦。
 * SSE 只负责实时事件；短暂断流不得阻止用户读取或提交 RPC。
 */
export function requestConsole<T>(request: ConsoleRpcRequest): Promise<T> {
  // Every reply also tells the shell whether the Zhin instance is answering (实例不可用横幅). A failure
  // carries the Host's code, requestOutcome, lockedBy and Retry-After (`details`), which the published
  // SDK drops, so 结果未知 and 未执行 are told apart (`rpc-reply-capture.mjs`).
  const transport = getConsoleTransport()
  return requestWithCapture(() => transport.sendRequest<T>(request)).then(
    value => { reportRequestSuccess(request.type); return value },
    (error: unknown) => { reportRequestFailure(request.type, error); throw error },
  )
}
