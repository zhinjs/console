/**
 * `iam.*` replies keep their Host error code (`last_owner`, `forbidden`, …), which the shared
 * transport drops, so the access pages read the RPC envelope themselves.
 */

export class IamRequestError extends Error {
  constructor(message, { status = 0, code = 'failed', hostMessage = '' } = {}) {
    super(message)
    this.name = 'IamRequestError'
    this.status = status
    this.code = code
    this.hostMessage = hostMessage
  }
}

const UNKNOWN_RPC = /unknown rpc type/iu

/** Error kind the pages branch on. */
export function iamErrorKind(error) {
  if (!(error instanceof IamRequestError)) return 'failed'
  if (error.code === 'unsupported') return 'unsupported'
  if (error.code === 'last_owner') return 'last_owner'
  if (error.status === 403 || error.code === 'forbidden') return 'forbidden'
  if (error.status === 503 || error.code === 'unavailable') return 'unavailable'
  return 'failed'
}

/**
 * Turns one `/api/console/request` response into data or an `IamRequestError` with a
 * localized message. `json` may be null when the body was not JSON.
 */
export function readIamReply(status, json, t) {
  const body = json && typeof json === 'object' ? json : {}
  if (status >= 200 && status < 300 && body.success !== false) return body.data
  const hostMessage = typeof body.error === 'string' ? body.error : ''
  const code = typeof body.code === 'string' ? body.code : ''
  if (UNKNOWN_RPC.test(hostMessage)) {
    throw new IamRequestError(t('当前 Host 不支持访问控制（需要支持 ADR 0049 的 Zhin 版本）。'), { status, code: 'unsupported', hostMessage })
  }
  if (code === 'last_owner') {
    throw new IamRequestError(t('不能移除最后一个所有者：系统里必须至少保留一个启用的全局所有者。'), { status, code, hostMessage })
  }
  if (status === 401) throw new IamRequestError(t('登录已失效，请重新登录。'), { status, code: code || 'unauthorized', hostMessage })
  if (status === 403 && !code) throw new IamRequestError(t('当前身份没有执行此操作的权限。'), { status, code: 'forbidden', hostMessage })
  const message = hostMessage || t('请求失败（HTTP {0}）', [status])
  throw new IamRequestError(message, { status, code: code || 'failed', hostMessage })
}
