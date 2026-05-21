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
