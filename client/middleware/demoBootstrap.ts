import {
  getDemoBuildCredentials,
  isDemoMode,
} from '@console/utils/demo-mode'
import { setApiBase, setRuntimeToken } from '@console/utils/auth'

/**
 * demo.zhin.dev 构建：启动时写入预置 API Base + Demo Token，跳过登录页。
 *
 * Token 只写 `window.__ZHIN_API_TOKEN`（对齐 zhin deploy demo boot.js），
 * 不落 localStorage；@zhin.js/client 的 getToken 会读运行时 Token。
 */
export function runDemoBootstrap(): {
  authed: boolean
  loginApiBase: string | null
} | null {
  if (!isDemoMode()) return null

  // Build env overrides fall back to the public demo Host, so both values are always present.
  const { apiBase, apiToken } = getDemoBuildCredentials()
  setApiBase(apiBase)
  setRuntimeToken(apiToken)
  return { authed: true, loginApiBase: null }
}
