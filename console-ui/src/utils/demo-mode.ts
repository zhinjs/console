type DemoBuildEnv = {
  VITE_DEMO_MODE?: string
  VITE_API_BASE?: string
  VITE_API_TOKEN?: string
}

function readBuildEnv(): DemoBuildEnv {
  return (import.meta as unknown as { env?: DemoBuildEnv }).env ?? {}
}

/** 构建时注入：VITE_DEMO_MODE=1（demo.zhin.dev 专用，非 console.zhin.dev） */
export function isDemoMode(): boolean {
  return readBuildEnv().VITE_DEMO_MODE === '1'
}

export function getDemoBuildCredentials(): { apiBase: string; apiToken: string } {
  const env = readBuildEnv()
  return {
    apiBase: (env.VITE_API_BASE ?? '').trim().replace(/\/$/, ''),
    apiToken: (env.VITE_API_TOKEN ?? '').trim(),
  }
}

/** Demo 构建下默认 landing：Sandbox 插件路由 */
export const DEMO_DEFAULT_PATH = '/sandbox'

/** Demo 模式下不注册的管理页（写配置 / 文件 / cron / env） */
export const DEMO_HIDDEN_BUILTIN_PATHS = new Set([
  '/config',
  '/env',
  '/files',
  '/database',
  '/cron',
])
