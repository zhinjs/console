import {
  getDemoBuildCredentials,
  isDemoMode,
} from '@console/utils/demo-mode'
import { setApiBase, setRuntimeToken } from '@console/utils/auth'

/**
 * demo.zhin.dev 构建：启动时写入预置 API Base + Demo Token，跳过登录页。
 *
 * Token 只写 `window.__ZHIN_API_TOKEN`（对齐 zhin deploy demo boot.js），
 * 不落 localStorage；@zhin.js/client ≥ 2.0.5 的 getToken 会读运行时 Token。
 */
export function runDemoBootstrap(): {
  authed: boolean
  loginApiBase: string | null
} | null {
  if (!isDemoMode()) return null

  const { apiBase, apiToken } = getDemoBuildCredentials()
  if (!apiBase || !apiToken) {
    console.error(
      '[demo] 缺少 VITE_API_BASE 或 VITE_API_TOKEN，无法预连 demo-api',
    )
    return { authed: false, loginApiBase: apiBase || null }
  }

  setApiBase(apiBase)
  setRuntimeToken(apiToken)
  return { authed: true, loginApiBase: null }
}
