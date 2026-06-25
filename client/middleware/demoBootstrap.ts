import {
  getDemoBuildCredentials,
  isDemoMode,
} from '@console/utils/demo-mode'
import { setApiBase, setToken } from '@console/utils/auth'

/**
 * demo.zhin.dev 构建：启动时写入预置 API Base + Demo Token，跳过登录页。
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
  setToken(apiToken)
  return { authed: true, loginApiBase: null }
}
