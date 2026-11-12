import { translate } from '../i18n/locale.mjs'
const TOKEN_KEY = 'zhin_api_token'
const API_BASE_KEY = 'zhin_api_base'
const SAVED_LOGINS_KEY = 'zhin_saved_logins'
const MAX_SAVED_LOGINS = 20

type ZhinWindow = Window & { __ZHIN_API_TOKEN?: string }

export interface SavedLogin {
  apiBase: string
  token: string
  savedAt: number
  lastUsedAt: number
}

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

/** 页面注入的运行时 Token（如 Host 同源部署的 boot 脚本）：优先于 localStorage（对齐 @zhin.js/client remoteApi） */
function getRuntimeToken(): string | null {
  if (typeof window === 'undefined') return null
  const token = (window as ZhinWindow).__ZHIN_API_TOKEN
  return token?.trim() || null
}

export function getApiBase(): string {
  const stored = localStorage.getItem(API_BASE_KEY)?.trim()
  if (stored) return trimTrailingSlash(stored)
  if (typeof window !== 'undefined') return window.location.origin
  return ''
}

export function setApiBase(base: string): void {
  localStorage.setItem(API_BASE_KEY, trimTrailingSlash(base))
}

export function getToken(): string | null {
  return getRuntimeToken() ?? localStorage.getItem(TOKEN_KEY) ?? sessionStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string, persistent = true): void {
  localStorage.removeItem(TOKEN_KEY)
  sessionStorage.removeItem(TOKEN_KEY)
  const storage = persistent ? localStorage : sessionStorage
  storage.setItem(TOKEN_KEY, token)
}

/** Whether the stored credential survives the browser session ("记住此连接"). */
export function isTokenPersistent(): boolean {
  try {
    return localStorage.getItem(TOKEN_KEY) !== null
  } catch {
    return false
  }
}

/** 写入运行时 Token（不落盘） */
export function setRuntimeToken(token: string): void {
  if (typeof window === 'undefined') return
  ;(window as ZhinWindow).__ZHIN_API_TOKEN = token.trim()
}

export function clearRuntimeToken(): void {
  if (typeof window === 'undefined') return
  delete (window as ZhinWindow).__ZHIN_API_TOKEN
}

export function clearToken(): void {
  try {
    sessionStorage.removeItem(TOKEN_KEY)
  } catch {
    /* ignore */
  }
  localStorage.removeItem(TOKEN_KEY)
}

export function clearApiBase(): void {
  localStorage.removeItem(API_BASE_KEY)
}

export function hasToken(): boolean {
  return !!getToken()
}

export function normalizeApiBase(base: string): string {
  return trimTrailingSlash(base.trim())
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
  // 预置的 runtime token 过期后同样要失效，否则 getToken() 永远优先命中它，造成 401 死循环；
  // 重新登录（verifyAndStoreCredentials 成功）会再次写入新的 token。
  clearRuntimeToken()
  clearToken()
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('zhin:auth-required'))
  }
}

/**
 * 登录链接由 `pages/login-model.mjs` 读取并在启动时立即从地址栏移除。
 * token 只能放在 # 片段中（`#token=`，片段不会发给服务器）；`?token=` 会被移除且不会被使用。
 */
export const QUERY_API_BASE_URL = "apiBaseUrl";

export function stripApiBaseUrlFromQuery(): void {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has(QUERY_API_BASE_URL)) return;
  url.searchParams.delete(QUERY_API_BASE_URL);
  const next = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, "", next);
}

/** Instance state reported by the gateway's `GET /pub/health` (absent on older Hosts). */
export interface HostInstanceHealth {
  readonly state: string
  readonly ready: boolean
}

export type VerifyCredentialsResult =
  /**
   * `bootstrap`: the token is the first-run setup token (ADR 0049 §1); it only opens the setup wizard.
   * `instance`: what `/pub/health` said about the Zhin instance; sign-in does not depend on it.
   */
  | { ok: true; kind?: 'bootstrap'; instance?: HostInstanceHealth }
  | { ok: false; message: string; status?: number; code?: string; retryAfterSec?: number }

export type ProbeHealthResult =
  | { ok: true; instance?: HostInstanceHealth }
  | { ok: false; message: string }

function readInstanceHealth(body: unknown): HostInstanceHealth | undefined {
  const instance = body && typeof body === 'object' ? (body as { instance?: unknown }).instance : undefined
  if (!instance || typeof instance !== 'object') return undefined
  const { state, ready } = instance as { state?: unknown; ready?: unknown }
  return typeof state === 'string' ? { state, ready: ready === true } : undefined
}

/** 登录前探测 Host 连通性（无需 Token）。网关的 `/pub/health` 同时报告实例状态。 */
export async function probeHealth(apiBase: string, locale: 'zh-CN' | 'en' = 'zh-CN'): Promise<ProbeHealthResult> {
  const base = normalizeApiBase(apiBase)
  if (!base) {
    return { ok: false, message: translate(locale, "请填写 API Base URL") }
  }
  try {
    const res = await fetch(`${base}/pub/health`, { signal: AbortSignal.timeout(8_000) })
    if (!res.ok) return { ok: false, message: translate(locale, "Host 健康检查失败 (HTTP {0})", [res.status]) }
    let body: unknown
    try { body = typeof res.json === 'function' ? await res.json() : undefined } catch { body = undefined }
    const instance = readInstanceHealth(body)
    return instance ? { ok: true, instance } : { ok: true }
  } catch {
    return {
      ok: false,
      message: translate(locale, "无法连接 Host，请确认地址正确、服务已启动，且 CORS 已包含当前 Console 来源"),
    }
  }
}

function storeVerified(base: string, token: string, persistent: boolean): void {
  clearRuntimeToken()
  setApiBase(base)
  setToken(token, persistent)
  stripApiBaseUrlFromQuery()
}

/**
 * 校验 Host API Base + Token，成功则写入 localStorage。
 *
 * The credential is checked with the gateway's own `GET /api/auth/me` (ADR 0049 §5 / ADR 0054 §3),
 * which answers while the Zhin instance is stopped, so an API token or the bootstrap token signs in
 * (and reaches the setup wizard, the instance page and the logs) even when the instance is down.
 * Only Hosts that predate `/auth/*` fall back to `GET /api/system/status`.
 */
export async function verifyAndStoreCredentials(
  apiBase: string,
  token: string, locale: 'zh-CN' | 'en' = 'zh-CN', persistent = true
): Promise<VerifyCredentialsResult> {
  const base = normalizeApiBase(apiBase)
  const trimmed = token.trim().replace(/^Bearer\s+/i, '')
  if (!base) {
    return { ok: false, message: translate(locale, "请填写 API Base URL（如 http://localhost:8086）") }
  }
  if (!trimmed) {
    return { ok: false, message: translate(locale, "请输入 Token") }
  }

  try {
    const health = await probeHealth(base, locale)
    if (!health.ok) {
      return { ok: false, message: health.message }
    }
    const instance = health.instance ? { instance: health.instance } : {}

    const principal = await readPrincipal(base, trimmed)
    if (principal.kind === 'legacy') return verifyLegacy(base, trimmed, locale, persistent)
    if (principal.kind === 'failed') {
      if (principal.code === 'database_busy') {
        return {
          ok: false, status: principal.status, code: principal.code, ...(principal.retryAfterSec ? { retryAfterSec: principal.retryAfterSec } : {}),
          message: principal.retryAfterSec
            ? translate(locale, "网关的数据库正忙，暂时无法验证令牌。请在 {0} 秒后重试。", [principal.retryAfterSec])
            : translate(locale, "网关的数据库正忙，暂时无法验证令牌。请稍后重试。"),
        }
      }
      if (principal.code === 'instance_unavailable' || principal.code === 'instance_timeout' || principal.code === 'instance_error') {
        return { ok: false, status: principal.status, code: principal.code,
          message: translate(locale, "此 Host 在实例未运行时无法验证令牌（网关版本较旧）。请先在服务器上运行 zhin start 启动实例，或升级网关。") }
      }
      return { ok: false, status: principal.status, message: translate(locale, "验证失败 (HTTP {0})", [principal.status]) }
    }
    const me = principal.me
    if (me.kind === 'user' || me.kind === 'api-token' || (me.kind === 'bootstrap' && me.open)) {
      storeVerified(base, trimmed, persistent)
      return { ok: true, ...instance }
    }
    if (me.kind === 'bootstrap' && me.setupRequired) {
      // Valid only until the owner exists: never kept beyond this browser session.
      storeVerified(base, trimmed, false)
      return { ok: true, kind: 'bootstrap', ...instance }
    }
    // `anonymous`: the gateway did not accept the token (wrong, revoked, expired, or a bootstrap
    // token after the first owner exists).
    return {
      ok: false, status: 401,
      message: me.setupRequired
        ? translate(locale, "令牌无效。初始化时请使用启动日志中的初始化链接，或 .env 里的 HTTP_TOKEN。")
        : translate(locale, "令牌无效或已失效。初始化令牌在创建所有者后失效：请改用账号登录，或在个人设置里签发 API 令牌。"),
    }
  } catch {
    return { ok: false, message: translate(locale, "无法连接到 API，请检查 Base URL 与网络") }
  }
}

type PrincipalRead =
  | { kind: 'me'; me: { kind: string; open: boolean; setupRequired: boolean } }
  | { kind: 'legacy' }
  | { kind: 'failed'; status: number; code?: string; retryAfterSec?: number }

/** `GET /api/auth/me` with `token`. A 404/405 without the Host envelope: the Host predates `/auth/*`. */
async function readPrincipal(base: string, token: string): Promise<PrincipalRead> {
  const res = await fetch(`${base}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  })
  let body: { success?: unknown; code?: unknown; data?: { kind?: unknown; open?: unknown; setupRequired?: unknown } } | undefined
  try { body = typeof res.json === 'function' ? await res.json() : undefined } catch { body = undefined }
  const envelope = body !== undefined && body !== null && typeof body === 'object' && typeof body.success === 'boolean'
  if (res.ok && typeof body?.data?.kind === 'string') {
    return { kind: 'me', me: { kind: body.data.kind, open: body.data.open === true, setupRequired: body.data.setupRequired === true } }
  }
  if ((res.status === 404 || res.status === 405) && !envelope) return { kind: 'legacy' }
  if (res.ok) return { kind: 'legacy' }
  const header = typeof res.headers?.get === 'function' ? res.headers.get('retry-after') : null
  const retryAfterSec = header && /^\d+$/u.test(header.trim()) ? Math.max(1, Number(header.trim())) : undefined
  return { kind: 'failed', status: res.status, ...(typeof body?.code === 'string' ? { code: body.code } : {}), ...(retryAfterSec ? { retryAfterSec } : {}) }
}

/** Hosts without `/auth/*`: the token is checked against the instance's status route. */
async function verifyLegacy(base: string, token: string, locale: 'zh-CN' | 'en', persistent: boolean): Promise<VerifyCredentialsResult> {
  const res = await fetch(`${base}/api/system/status`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8_000),
  })
  if (res.ok) {
    storeVerified(base, token, persistent)
    return { ok: true }
  }
  if (res.status === 401) {
    return { ok: false, status: 401, message: translate(locale, "Token 无效，请检查后重试") }
  }
  if (res.status === 403) {
    return { ok: false, status: 403, message: translate(locale, "此令牌没有查看系统状态的权限 (HTTP 403)") }
  }
  return { ok: false, status: res.status, message: translate(locale, "验证失败 (HTTP {0})", [res.status]) }
}

export function resolveApiUrl(path: string): string {
  const base = getApiBase()
  const p = path.startsWith('/') ? path : `/${path}`
  return `${base}${p}`
}

/** One Host/credential snapshot for a group of requests owned by the same view. */
export interface ApiRequestContext {
  readonly apiBase: string
  readonly token: string | null
}

/** Kept inside a request owner's closure, never persisted or exposed as UI state. */
export function captureApiRequestContext(): ApiRequestContext {
  return Object.freeze({ apiBase: getApiBase(), token: getToken() })
}

/** Fetch with Bearer auth; an explicit context pins relative paths and credentials to their owner. */
export async function apiFetch(
  input: RequestInfo | URL,
  init?: RequestInit,
  context?: ApiRequestContext,
): Promise<Response> {
  const { apiBase, token } = context ?? captureApiRequestContext()
  const headers = new Headers(init?.headers)
  const url =
    typeof input === 'string' && input.startsWith('/')
      ? `${apiBase}${input}`
      : input
  const belongsToHost = requestBelongsToHost(url, apiBase)
  if (token && belongsToHost) headers.set('Authorization', `Bearer ${token}`)

  const res = await fetch(url, { ...init, headers })
  // An old connection's response must not invalidate a newer Host or credential.
  if (res.status === 401 && belongsToHost && token && getApiBase() === apiBase && getToken() === token) {
    notifyAuthRequired()
  }
  // The gateway answers for a stopped or stuck instance with 502 / 503 / 504 `instance_*` (ADR 0054).
  if (belongsToHost && hostReplyListeners.size && (res.status === 502 || res.status === 503 || res.status === 504)) {
    const retryAfter = res.headers.get('retry-after')
    void res.clone().json().then(body => {
      for (const listener of [...hostReplyListeners]) listener({ status: res.status, body, retryAfter })
    }, () => {})
  }
  return res
}

export interface HostGatewayReply { readonly status: number; readonly body: unknown; readonly retryAfter: string | null }
const hostReplyListeners = new Set<(reply: HostGatewayReply) => void>()

/** Observes the Host's 502 / 503 / 504 replies (the shell's 实例不可用 banner); returns an unsubscribe. */
export function onHostGatewayReply(listener: (reply: HostGatewayReply) => void): () => void {
  hostReplyListeners.add(listener)
  return () => { hostReplyListeners.delete(listener) }
}

function requestBelongsToHost(input: RequestInfo | URL, apiBase: string): boolean {
  try {
    const base = new URL(`${apiBase}/`)
    const target = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, base)
    return target.origin === base.origin && target.pathname.startsWith(base.pathname)
  } catch { return false }
}
