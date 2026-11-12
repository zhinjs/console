export interface ReplyCapture {
  taken: boolean
  status: number | undefined
  retryAfter: string | null
  reply: Response | null
}
export function beginReplyCapture(): ReplyCapture
export function endReplyCapture(capture: ReplyCapture): void
export function capturingFetch(base: typeof fetch): typeof fetch
export function enrichRpcError<E>(error: E, capture: ReplyCapture | null | undefined): Promise<E>
export function requestWithCapture<T>(send: () => Promise<T>): Promise<T>
