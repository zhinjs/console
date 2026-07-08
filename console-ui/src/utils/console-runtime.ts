import { destroyWebSocketManager } from '@zhin.js/client'
import { resetConsoleEntries } from '../bootstrap/loadConsoleEntries'
import { resetOptionalConsoleRoutes } from '../registerOptionalRoutes'
import { resetConsoleSseBridge } from './sse-bridge'

/** 登出 / 401 / 换 Host 时统一清理传输层与插件加载缓存 */
export function resetConsoleRuntime(): void {
  destroyWebSocketManager()
  resetConsoleEntries()
  resetOptionalConsoleRoutes()
  resetConsoleSseBridge()
}
