/**
 * Host `/auth/*` calls (zhinjs/zhin ADR 0049 §5/§7) and the `onboarding.update` RPC (ADR 0053 §4).
 * Every call resolves to an `AuthResult`; nothing here throws on HTTP errors.
 */
import {
  captureApiRequestContext, clearRuntimeToken, getApiBase, getToken, isTokenPersistent, normalizeApiBase, notifyAuthRequired,
  probeHealth, setApiBase, setToken, stripApiBaseUrlFromQuery, type ApiRequestContext,
} from './auth'
import {
  CONSOLE_AUTH_ROUTES as R, ONBOARDING_RPC, authUrl, readAuthResponse, readMe, unreachableResult,
  type AuthFailure, type AuthResult,
} from './console-auth-model.mjs'
import { setConsoleMe, setLegacySession } from './console-session.mjs'
import { requestConsole } from './console-rpc'
import type {
  ConsoleApiTokenCreated, ConsoleApiTokenView, ConsoleMe, ConsoleOnboardingState, ConsolePasswordChanged,
  ConsoleSessionIssued, OnboardingStepStatus, SetupDatabaseChoices, SetupDatabaseInput, SetupDatabaseProbe,
  SetupDatabaseSaved, SetupStatus,
} from '../contracts/console-auth'

const TIMEOUT_MS = 15_000

interface CallOptions {
  readonly method?: 'GET' | 'POST'
  readonly body?: unknown
  /** Bearer to send; omitted = none. */
  readonly token?: string | null
  /**
   * Sign out when a session call answers 401 (the session expired). Off for calls whose 401 means
   * something else: wrong current password, wrong login.
   */
  readonly expireOn401?: boolean
  readonly timeoutMs?: number
}

async function call<T>(apiBase: string, route: string, options: CallOptions = {}): Promise<AuthResult<T>> {
  const headers = new Headers({ accept: 'application/json' })
  if (options.body !== undefined) headers.set('content-type', 'application/json')
  if (options.token) headers.set('authorization', `Bearer ${options.token}`)
  let response: Response
  try {
    response = await fetch(authUrl(apiBase, route), {
      method: options.method ?? 'GET',
      headers,
      ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
      signal: AbortSignal.timeout(options.timeoutMs ?? TIMEOUT_MS),
    })
  } catch {
    return unreachableResult()
  }
  let body: unknown
  try { body = await response.json() } catch { body = undefined }
  const result = readAuthResponse<T>({ status: response.status, body, retryAfter: response.headers.get('retry-after') })
  // Only the credential that made the request may be expired by its answer.
  if (!result.ok && result.status === 401 && options.expireOn401 && options.token
    && getApiBase() === normalizeApiBase(apiBase) && getToken() === options.token) {
    notifyAuthRequired()
  }
  return result
}

/** A call with the current Host and credential. */
function sessionCall<T>(route: string, options: Omit<CallOptions, 'token'> = {}, context: ApiRequestContext = captureApiRequestContext()) {
  return call<T>(context.apiBase, route, { expireOn401: true, ...options, token: context.token })
}

export async function fetchMe(apiBase: string, token?: string | null): Promise<AuthResult<ConsoleMe>> {
  const result = await call<unknown>(apiBase, R.ME, { token: token ?? null, timeoutMs: 8_000 })
  if (!result.ok) return result
  const me = readMe(result.data)
  return me ? { ok: true, status: result.status, data: me } : { ok: false, status: result.status, code: 'unsupported', message: '' }
}

export type SessionLoad =
  | { readonly kind: 'me'; readonly me: ConsoleMe }
  | { readonly kind: 'legacy' }
  | { readonly kind: 'error'; readonly error: AuthFailure }

/** Reads `/auth/me` for the stored credential and publishes it (permissions → navigation). */
export async function loadConsoleSession(): Promise<SessionLoad> {
  const { apiBase, token } = captureApiRequestContext()
  const result = await fetchMe(apiBase, token)
  if (result.ok) {
    setConsoleMe(result.data)
    return { kind: 'me', me: result.data }
  }
  if (result.code === 'unsupported') {
    setLegacySession()
    return { kind: 'legacy' }
  }
  return { kind: 'error', error: result }
}

export type PasswordSignIn = AuthResult<ConsoleMe>

/**
 * `POST /auth/login`, then stores the session token like any other credential. A 401 on a Host
 * that has no owner yet is reported as `not_initialized` so the page can point to the bootstrap token.
 */
export async function signInWithPassword(
  rawBase: string, username: string, password: string, persistent: boolean,
): Promise<PasswordSignIn> {
  const apiBase = normalizeApiBase(rawBase)
  const health = await probeHealth(apiBase)
  if (!health.ok) return unreachableResult()
  const login = await call<ConsoleSessionIssued>(apiBase, R.LOGIN, {
    method: 'POST', body: { username: username.trim().toLowerCase(), password },
  })
  if (!login.ok) {
    if (login.code === 'unauthorized') {
      const anonymous = await fetchMe(apiBase)
      if (anonymous.ok && anonymous.data.setupRequired) return { ...login, code: 'not_initialized' }
    }
    return login
  }
  const issued = login.data
  if (!issued || typeof issued.token !== 'string' || !issued.token) return { ok: false, status: login.status, code: 'failed', message: '' }
  clearRuntimeToken()
  setApiBase(apiBase)
  setToken(issued.token, persistent)
  stripApiBaseUrlFromQuery()
  return publishIssuedSession(apiBase, issued, login.status)
}

/**
 * Publishes the principal of a freshly issued session. When `/auth/me` cannot be read right now,
 * a user without permissions stands in (navigation stays minimal; the Host still decides).
 */
async function publishIssuedSession(apiBase: string, issued: ConsoleSessionIssued, status: number): Promise<AuthResult<ConsoleMe>> {
  const me = await fetchMe(apiBase, issued.token)
  const data: ConsoleMe = me.ok ? me.data : { kind: 'user', user: issued.user, permissions: [], bindings: [], setupRequired: false }
  setConsoleMe(data)
  return { ok: true, status: me.ok ? me.status : status, data }
}

/** Revokes the current session on the Host (best effort), then signs out locally. */
export async function signOut(me: ConsoleMe | null): Promise<void> {
  if (me?.kind === 'user') {
    await sessionCall<unknown>(R.LOGOUT, { method: 'POST', body: {}, expireOn401: false, timeoutMs: 4_000 })
  }
  notifyAuthRequired()
}

/** `POST /auth/password`. A session caller gets a new session token, which replaces the old one. */
export async function changeOwnPassword(currentPassword: string, newPassword: string): Promise<AuthResult<ConsolePasswordChanged>> {
  const context = captureApiRequestContext()
  const result = await sessionCall<ConsolePasswordChanged>(R.PASSWORD, {
    method: 'POST', body: { currentPassword, newPassword }, expireOn401: false,
  }, context)
  if (result.ok && typeof result.data?.token === 'string' && result.data.token
    && getApiBase() === context.apiBase && getToken() === context.token) {
    // Keep the storage the person chose at sign-in (persistent vs. this browser session).
    setToken(result.data.token, isTokenPersistent())
  }
  return result
}

export async function listOwnTokens(): Promise<AuthResult<readonly ConsoleApiTokenView[]>> {
  const result = await sessionCall<{ tokens?: ConsoleApiTokenView[] }>(R.TOKENS)
  return result.ok ? { ...result, data: Array.isArray(result.data?.tokens) ? result.data.tokens : [] } : result
}

export function createOwnToken(input: { name: string; expiresAt: number | null }): Promise<AuthResult<ConsoleApiTokenCreated>> {
  return sessionCall<ConsoleApiTokenCreated>(R.TOKENS, {
    method: 'POST', body: { name: input.name, ...(input.expiresAt ? { expiresAt: input.expiresAt } : {}) },
  })
}

export function revokeOwnToken(id: string): Promise<AuthResult<{ revoked: true }>> {
  return sessionCall<{ revoked: true }>(R.TOKENS_REVOKE, { method: 'POST', body: { id } })
}

// ---------------------------------------------------------------- setup (bootstrap token)

export function getSetupStatus(): Promise<AuthResult<SetupStatus>> {
  return sessionCall<SetupStatus>(R.SETUP)
}

export function getSetupDatabase(): Promise<AuthResult<SetupDatabaseChoices>> {
  return sessionCall<SetupDatabaseChoices>(R.SETUP_DATABASE)
}

export function testSetupDatabase(input: SetupDatabaseInput): Promise<AuthResult<SetupDatabaseProbe>> {
  return sessionCall<SetupDatabaseProbe>(R.SETUP_DATABASE_TEST, { method: 'POST', body: input, timeoutMs: 30_000 })
}

export function saveSetupDatabase(input: SetupDatabaseInput): Promise<AuthResult<SetupDatabaseSaved>> {
  return sessionCall<SetupDatabaseSaved>(R.SETUP_DATABASE, { method: 'POST', body: input, timeoutMs: 30_000 })
}

/**
 * `POST /auth/setup`: creates the first owner and returns a session, which replaces the bootstrap
 * token (it stops working now) in the same storage.
 */
export async function createFirstOwner(input: { username: string; password: string; displayName?: string }): Promise<AuthResult<ConsoleMe>> {
  const context = captureApiRequestContext()
  const result = await sessionCall<ConsoleSessionIssued>(R.SETUP, {
    method: 'POST',
    body: { username: input.username, password: input.password, ...(input.displayName ? { displayName: input.displayName } : {}) },
  }, context)
  if (!result.ok) return result
  if (!result.data?.token) return { ok: false, status: result.status, code: 'failed', message: '' }
  const persistent = isTokenPersistent()
  clearRuntimeToken()
  setToken(result.data.token, persistent)
  return publishIssuedSession(context.apiBase, result.data, result.status)
}

/** True once the Host answers `/auth/me` again (after a restart). */
export async function hostAnswers(): Promise<boolean> {
  const { apiBase, token } = captureApiRequestContext()
  const result = await fetchMe(apiBase, token)
  return result.ok
}

// ---------------------------------------------------------------- onboarding

/** `onboarding.update` (ADR 0053 §4). Throws on RPC failure, including Hosts that lack it. */
export function updateOnboarding(step: 'ai' | 'adapters' | 'finish', status: OnboardingStepStatus): Promise<ConsoleOnboardingState | undefined> {
  return requestConsole<ConsoleOnboardingState | undefined>({ type: ONBOARDING_RPC.UPDATE, step, status })
}
