/** 判断 RPC 错误是否表示 Host 未实现该方法（可安全 fallback 到旧接口） */
export function isRpcMethodUnavailable(err: unknown): boolean {
  if (!(err instanceof Error)) return false
  const msg = err.message.toLowerCase()
  return (
    msg.includes('unknown') ||
    msg.includes('not found') ||
    msg.includes('not implemented') ||
    msg.includes('unsupported') ||
    msg.includes('no handler') ||
    msg.includes('unrecognized')
  )
}
