const TOKEN_KEY = 'zhin_api_token'
const API_BASE_KEY = 'zhin_api_base'
const SAVED_LOGINS_KEY = 'zhin_saved_logins'
const MAX_SAVED_LOGINS = 20

export interface SavedLogin {
  apiBase: string
  token: string
  savedAt: number
  lastUsedAt: number
}

export function getApiBase(): string {
  const stored = localStorage.getItem(API_BASE_KEY)?.trim()
  if (stored) return stored.replace(/\/$/, '')
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

export function setApiBase(base: string): void {
  localStorage.setItem(API_BASE_KEY, base.replace(/\/$/, ''))
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

export function clearApiBase(): void {
  localStorage.removeItem(API_BASE_KEY)
}

export function hasToken(): boolean {
  return !!localStorage.getItem(TOKEN_KEY)
}

export function normalizeApiBase(base: string): string {
  return base.trim().replace(/\/$/, '')
}

/** 仅读 localStorage 中的 Host，不含 Pages 站点 origin 回退 */
export function getStoredApiBase(): string | null {
  const stored = localStorage.getItem(API_BASE_KEY)?.trim()
  return stored ? normalizeApiBase(stored) : null
}

export function clearSession(): void {
  clearToken()
  clearApiBase()
}

export function listSavedLogins(): SavedLogin[] {
  try {
    const raw = localStorage.getItem(SAVED_LOGINS_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SavedLogin[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((x) => x?.apiBase && x?.token)
      .sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0))
  } catch {
    return []
  }
}

export function getSavedLogin(apiBase: string): SavedLogin | null {
  const base = normalizeApiBase(apiBase)
  return listSavedLogins().find((x) => normalizeApiBase(x.apiBase) === base) ?? null
}

export function upsertSavedLogin(apiBase: string, token: string): void {
  const base = normalizeApiBase(apiBase)
  const trimmed = token.trim().replace(/^Bearer\s+/i, '')
  if (!base || !trimmed) return

  const now = Date.now()
  const rest = listSavedLogins().filter((x) => normalizeApiBase(x.apiBase) !== base)
  const existing = listSavedLogins().find((x) => normalizeApiBase(x.apiBase) === base)
  rest.unshift({
    apiBase: base,
    token: trimmed,
    savedAt: existing?.savedAt ?? now,
    lastUsedAt: now,
  })
  localStorage.setItem(SAVED_LOGINS_KEY, JSON.stringify(rest.slice(0, MAX_SAVED_LOGINS)))
}

export function removeSavedLogin(apiBase: string): void {
  const base = normalizeApiBase(apiBase)
  const rest = listSavedLogins().filter((x) => normalizeApiBase(x.apiBase) !== base)
  localStorage.setItem(SAVED_LOGINS_KEY, JSON.stringify(rest))
}

export function touchSavedLogin(apiBase: string): void {
  const base = normalizeApiBase(apiBase)
  const list = listSavedLogins()
  const idx = list.findIndex((x) => normalizeApiBase(x.apiBase) === base)
  if (idx < 0) return
  list[idx] = { ...list[idx], lastUsedAt: Date.now() }
  localStorage.setItem(SAVED_LOGINS_KEY, JSON.stringify(list))
}

/**
 * token 与 apiBase 成对缓存：URL 预填的 Host 与缓存不一致时清除登录态。
 */
export function reconcileAuthWithApiBase(incomingApiBase: string | null): {
  authed: boolean
  loginApiBase: string | null
} {
  const token = getToken()
  const stored = getStoredApiBase()
  const incoming = incomingApiBase ? normalizeApiBase(incomingApiBase) : null

  if (incoming) {
    if (token && stored !== incoming) {
      clearSession()
      return { authed: false, loginApiBase: incoming }
    }
    if (token && stored === incoming) {
      return { authed: true, loginApiBase: incoming }
    }
    return { authed: false, loginApiBase: incoming }
  }

  if (token && stored) {
    return { authed: true, loginApiBase: null }
  }

  if (token) {
    clearSession()
  }
  return { authed: false, loginApiBase: stored }
}

export function notifyAuthRequired(): void {
  clearToken()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('zhin:auth-required'))
  }
}

export function clearSessionAndNotify(): void {
  clearSession()
  notifyAuthRequired()
}

export const QUERY_API_BASE_URL = "apiBaseUrl";

/** 仅允许 URL 预填 Host 地址；token 不得出现在 URL 中 */
export function readApiBaseUrlFromQuery(
  search = typeof window !== "undefined" ? window.location.search : "",
): string | null {
  const apiBaseUrl = new URLSearchParams(search).get(QUERY_API_BASE_URL)?.trim();
  return apiBaseUrl || null;
}

export function stripApiBaseUrlFromQuery(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(QUERY_API_BASE_URL)) return;
  url.searchParams.delete(QUERY_API_BASE_URL);
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, "", next);
}

export type VerifyCredentialsResult =
  | { ok: true }
  | { ok: false; message: string; status?: number }

export type ProbeHealthResult =
  | { ok: true }
  | { ok: false; message: string }

/** 登录前探测 Host 连通性（无需 Token） */
export async function probeHealth(apiBase: string): Promise<ProbeHealthResult> {
  const base = apiBase.trim().replace(/\/$/, '')
  if (!base) {
    return { ok: false, message: '请填写 API Base URL' }
  }
  try {
    const res = await fetch(`${base}/pub/health`)
    if (res.ok) return { ok: true }
    return { ok: false, message: `Host 健康检查失败 (HTTP ${res.status})` }
  } catch {
    return {
      ok: false,
      message: '无法连接 Host，请确认地址正确、服务已启动，且 CORS 已包含当前 Console 来源',
    }
  }
}

/** 校验 Host API Base + Token，成功则写入 localStorage */
export async function verifyAndStoreCredentials(
  apiBase: string,
  token: string,
): Promise<VerifyCredentialsResult> {
  const base = apiBase.trim().replace(/\/$/, '')
  const trimmed = token.trim().replace(/^Bearer\s+/i, '')
  if (!base) {
    return { ok: false, message: '请填写 API Base URL（如 http://localhost:8086）' }
  }
  if (!trimmed) {
    return { ok: false, message: '请输入 Token' }
  }

  try {
    const health = await probeHealth(base)
    if (!health.ok) {
      return { ok: false, message: health.message }
    }

    const res = await fetch(`${base}/api/system/status`, {
      headers: { Authorization: `Bearer ${trimmed}` },
    })
    if (res.ok) {
      setApiBase(base)
      setToken(trimmed)
      stripApiBaseUrlFromQuery()
      return { ok: true }
    }
    if (res.status === 401) {
      return { ok: false, status: 401, message: 'Token 无效，请检查后重试' }
    }
    return { ok: false, status: res.status, message: `验证失败 (HTTP ${res.status})` }
  } catch {
    return { ok: false, message: '无法连接到 API，请检查 Base URL 与网络' }
  }
}

export function resolveApiUrl(path: string): string {
  const base = getApiBase()
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

/** WebSocket 应连用户 Host（如 ws://127.0.0.1:8086/server），而非 Pages 静态域 */
export function resolveWebSocketUrl(path = '/server'): string {
  const httpUrl = resolveApiUrl(path)
  const url = new URL(httpUrl)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

/** fetch with Bearer token; relative paths resolve against {@link getApiBase}. */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
): Promise<Response> {
  const token = getToken()
  const headers = new Headers(init?.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const url =
    typeof input === 'string' && input.startsWith('/')
      ? resolveApiUrl(input)
      : input

  const res = await fetch(url, { ...init, headers })
  if (res.status === 401) {
    notifyAuthRequired()
  }
  return res
}
