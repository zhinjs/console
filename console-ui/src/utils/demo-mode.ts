type DemoBuildEnv = {
  VITE_DEMO_MODE?: string
  VITE_API_BASE?: string
  VITE_API_TOKEN?: string
}

/** demo.zhin.dev 固定 Host（可被构建环境变量覆盖） */
export const DEMO_API_BASE = 'https://zhinjs-demo.hf.space'
export const DEMO_API_TOKEN = 'zhin-demo'

function readBuildEnv(): DemoBuildEnv {
  return (import.meta as unknown as { env?: DemoBuildEnv }).env ?? {}
}

/** 构建时注入：VITE_DEMO_MODE=1（demo.zhin.dev 专用，非 console.zhin.dev） */
export function isDemoMode(): boolean {
  return readBuildEnv().VITE_DEMO_MODE === '1'
}

export function getDemoBuildCredentials(): { apiBase: string; apiToken: string } {
  const env = readBuildEnv()
  const apiBase = (env.VITE_API_BASE ?? DEMO_API_BASE).trim() || DEMO_API_BASE
  const apiToken = (env.VITE_API_TOKEN ?? DEMO_API_TOKEN).trim() || DEMO_API_TOKEN
  return {
    apiBase: apiBase.endsWith('/') ? apiBase.slice(0, -1) : apiBase,
    apiToken,
  }
}

/** Demo 构建下默认 landing：Sandbox 插件路由 */
export const DEMO_DEFAULT_PATH = '/sandbox'
