const TOKEN_KEY = 'zhin_api_token'
const API_BASE_KEY = 'zhin_api_base'

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
    localStorage.removeItem(TOKEN_KEY)
    window.dispatchEvent(new CustomEvent('zhin:auth-required'))
  }
  return res
}
