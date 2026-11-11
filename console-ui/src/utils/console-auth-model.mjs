// Pure sign-in / setup / onboarding logic (zhinjs/zhin ADR 0049 §5/§7, ADR 0053). No DOM, no fetch.

/** REST paths under `{apiBase}/api` (mirrors `CONSOLE_AUTH_ROUTES` of `@zhin.js/console-protocol`). */
export const CONSOLE_AUTH_ROUTES = Object.freeze({
  LOGIN: '/auth/login',
  LOGOUT: '/auth/logout',
  ME: '/auth/me',
  PASSWORD: '/auth/password',
  TOKENS: '/auth/tokens',
  TOKENS_REVOKE: '/auth/tokens/revoke',
  SETUP: '/auth/setup',
  SETUP_DATABASE: '/auth/setup/database',
  SETUP_DATABASE_TEST: '/auth/setup/database/test',
})

/** ADR 0053 §4: marks onboarding steps 3–5 done or skipped (`plugin.manage`). */
export const ONBOARDING_RPC = Object.freeze({ UPDATE: 'onboarding.update' })

export const API_PREFIX = '/api'

/** `{apiBase}/api{route}`; `apiBase` has no trailing slash. */
export function authUrl(apiBase, route) {
  return `${String(apiBase ?? '').replace(/\/+$/, '')}${API_PREFIX}${route}`
}

const CODE_BY_STATUS = Object.freeze({
  400: 'invalid_input', 401: 'unauthorized', 403: 'forbidden', 404: 'not_found', 409: 'conflict',
  413: 'invalid_input', 429: 'rate_limited', 503: 'unavailable',
})

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** Seconds from a `Retry-After` header (seconds or HTTP date) or a body hint; `null` when unknown. */
export function retryAfterSeconds(header, body, now = Date.now()) {
  const raw = typeof header === 'string' ? header.trim() : ''
  if (/^\d+$/.test(raw)) return Math.max(1, Number(raw))
  if (raw) {
    const at = Date.parse(raw)
    if (Number.isFinite(at)) return Math.max(1, Math.ceil((at - now) / 1000))
  }
  if (isRecord(body)) {
    if (typeof body.retryAfterMs === 'number' && body.retryAfterMs > 0) return Math.max(1, Math.ceil(body.retryAfterMs / 1000))
    if (typeof body.retryAfter === 'number' && body.retryAfter > 0) return Math.max(1, Math.ceil(body.retryAfter))
  }
  return null
}

/**
 * Normalizes one `/auth/*` response. `body` is the parsed JSON (or undefined).
 * A 404/405 without the Host's envelope means the Host predates `/auth/*` (`unsupported`).
 */
export function readAuthResponse({ status, body, retryAfter, now }) {
  const envelope = isRecord(body) && typeof body.success === 'boolean'
  if (status >= 200 && status < 300 && (!envelope || body.success)) {
    return { ok: true, status, data: envelope ? body.data : body }
  }
  if ((status === 404 || status === 405) && !envelope) {
    return { ok: false, status, code: 'unsupported', message: '' }
  }
  const code = envelope && typeof body.code === 'string' && body.code ? body.code : CODE_BY_STATUS[status] ?? 'failed'
  const message = envelope && typeof body.error === 'string' ? body.error.slice(0, 500) : ''
  return {
    ok: false, status, code, message,
    ...(status === 429 ? { retryAfterSec: retryAfterSeconds(retryAfter, body, now) } : {}),
  }
}

/** A network failure (fetch rejected): the Host could not be reached. */
export function unreachableResult() {
  return { ok: false, status: 0, code: 'unreachable', message: '' }
}

/**
 * Localized text for a failed `/auth/*` call. `context` picks the wording of 401/409.
 * The Host's own message is shown for 400/503 (it explains the invalid field or missing database).
 */
export function authErrorMessage(error, t, context = 'generic') {
  if (!error || error.ok) return ''
  switch (error.code) {
    case 'unreachable': return t('无法连接 Host，请确认地址正确、服务已启动，且 CORS 已包含当前 Console 来源')
    case 'unsupported': return context === 'login'
      ? t('此 Host 不支持账号登录（版本较旧），请改用访问令牌连接。')
      : t('此 Host 版本较旧，不支持这项操作。')
    case 'not_initialized': return t('此 Host 尚未初始化：请改用访问令牌，填写初始化令牌（启动日志中的链接，或 .env 里的 HTTP_TOKEN）来创建第一个所有者。')
    case 'rate_limited': return typeof error.retryAfterSec === 'number'
      ? t('尝试次数过多，请在 {0} 秒后重试。', [error.retryAfterSec])
      : t('尝试次数过多，请稍后再试。')
    case 'unauthorized':
      if (context === 'login') return t('用户名或密码错误。')
      if (context === 'password') return t('当前密码错误。')
      return t('登录已失效，请重新登录。')
    case 'conflict':
      if (context === 'setup') return t('此 Host 已完成初始化，初始化令牌已失效。请用账号登录。')
      return error.message || t('操作与当前状态冲突，请刷新后重试。')
    case 'last_owner': return t('不能移除最后一个所有者。')
    case 'setup_required': return t('初始化令牌只能用于创建第一个所有者。')
    case 'forbidden': return context === 'setup'
      ? t('需要初始化令牌：请使用启动日志中的初始化链接，或 .env 里的 HTTP_TOKEN。')
      : t('当前身份没有执行此操作的权限。')
    case 'not_found': return error.message || t('请求的对象不存在。')
    case 'invalid_input': return error.message || t('填写的内容无效，请检查后重试。')
    case 'unavailable': return error.message || t('当前数据库不能存储账号，或尚未就绪。')
    default: return error.message || t('操作失败 (HTTP {0})', [error.status])
  }
}

/** Host rule: lowercase, 2–64 characters, letters, digits, `.`, `_`, `-`; starts with a letter or digit. */
export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,63}$/u
export const MIN_PASSWORD_LENGTH = 10

export function normalizeUsername(value) {
  return String(value ?? '').trim().toLowerCase()
}

/** `null` when valid, else the reason: `empty` | `format`. */
export function usernameProblem(value) {
  const name = normalizeUsername(value)
  if (!name) return 'empty'
  return USERNAME_PATTERN.test(name) ? null : 'format'
}

/** `null` when valid, else `empty` | `short` | `mismatch`. */
export function newPasswordProblem(password, confirm) {
  const value = typeof password === 'string' ? password : ''
  if (!value) return 'empty'
  if ([...value].length < MIN_PASSWORD_LENGTH) return 'short'
  if (confirm !== undefined && confirm !== value) return 'mismatch'
  return null
}

// ---------------------------------------------------------------- session / principal

/**
 * What the Console shows for a principal:
 * - `setup`: the bootstrap token before the first owner (wizard only; it can reach nothing else).
 * - `shell`: a user, an API token, or an open local Host.
 * - `signed-out`: the credential was not accepted.
 */
export function sessionView(me) {
  if (!me || me.kind === 'anonymous') return 'signed-out'
  if (me.kind === 'bootstrap') return me.open ? 'shell' : me.setupRequired ? 'setup' : 'signed-out'
  return 'shell'
}

/** Report for `setConsoleAccess`: `null` (unrestricted) for an open Host, the global permissions otherwise. */
export function meAccessReport(me) {
  if (!me || me.kind === 'anonymous') return { permissions: [] }
  if (me.kind === 'bootstrap') return me.open ? null : { permissions: [] }
  return { permissions: Array.isArray(me.permissions) ? me.permissions : [] }
}

/** Parses `GET /auth/me` data; `null` when it is not a principal report. */
export function readMe(data) {
  if (!isRecord(data) || !['anonymous', 'bootstrap', 'user', 'api-token'].includes(data.kind)) return null
  const user = isRecord(data.user) && typeof data.user.id === 'string'
    ? { id: data.user.id, username: String(data.user.username ?? ''), displayName: String(data.user.displayName ?? data.user.username ?? '') }
    : undefined
  return {
    kind: data.kind,
    ...(data.kind === 'bootstrap' ? { open: data.open === true } : {}),
    ...(user ? { user } : {}),
    permissions: Array.isArray(data.permissions) ? data.permissions.filter(item => typeof item === 'string') : [],
    bindings: Array.isArray(data.bindings) ? data.bindings.filter(isRecord) : [],
    setupRequired: data.setupRequired === true,
    ...(normalizeOnboarding(data.onboarding) ? { onboarding: normalizeOnboarding(data.onboarding) } : {}),
  }
}

/** Display name of the signed-in principal. */
export function principalLabel(me, t) {
  if (!me) return ''
  if (me.user) return me.user.displayName || me.user.username
  if (me.kind === 'bootstrap') return me.open ? t('本地开放模式') : t('初始化令牌')
  return ''
}

// ---------------------------------------------------------------- database setup

/** Field values a driver form starts with: defaults as strings, nothing for secrets. */
export function initialConnectionValues(driver) {
  const values = {}
  for (const field of driver?.fields ?? []) {
    values[field.name] = !field.secret && field.default !== undefined ? String(field.default) : ''
  }
  return values
}

/** Request body for test/save: trimmed, empty optional fields dropped, integers as numbers. */
export function connectionPayload(driver, values) {
  const connection = {}
  for (const field of driver?.fields ?? []) {
    const raw = values?.[field.name]
    if (raw === undefined || raw === null) continue
    const text = field.secret ? String(raw) : String(raw).trim()
    if (!text) continue
    connection[field.name] = field.type === 'integer' && /^-?\d+$/.test(text) ? Number(text) : text
  }
  return { dialect: driver?.dialect ?? '', connection }
}

/** Required fields left empty (their names). */
export function missingConnectionFields(driver, values) {
  return (driver?.fields ?? []).filter(field => {
    if (!field.required) return false
    const raw = values?.[field.name]
    const text = raw === undefined || raw === null ? '' : String(raw).trim()
    return !text && field.default === undefined
  }).map(field => field.name)
}

/** Stable identity of a test input: saving is offered only for the exact values that passed the test. */
export function connectionKey(payload) {
  const entries = Object.entries(payload?.connection ?? {}).sort(([a], [b]) => a.localeCompare(b))
  return JSON.stringify([payload?.dialect ?? '', entries])
}

/** Start with the current database (ADR 0049 §8: "保持当前数据库" may skip this step). */
export const KEEP_DATABASE = 'keep'

export function defaultDatabaseChoice() {
  return KEEP_DATABASE
}

/** Short `key: value` facts of the current database for display. */
export function databaseSummaryText(summary) {
  if (!isRecord(summary)) return ''
  return Object.entries(summary).map(([key, value]) => `${key}: ${value}`).join(' · ')
}

/**
 * Polls until the Host answers again after a restart. `probe` resolves true once it does.
 * Resolves `true` when it came back, `false` on timeout or when `signal` aborts.
 */
export async function waitForHost({ probe, intervalMs = 2000, timeoutMs = 120_000, initialDelayMs = 1500, sleep, now = Date.now, signal }) {
  const wait = sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  const deadline = now() + timeoutMs
  await wait(initialDelayMs)
  while (now() <= deadline) {
    if (signal?.aborted) return false
    try { if (await probe()) return true } catch { /* not up yet */ }
    if (signal?.aborted) return false
    await wait(intervalMs)
  }
  return false
}

// ---------------------------------------------------------------- onboarding (ADR 0053 §2, §4)

/** Steps the `/onboarding` page walks through after the owner exists. */
export const ONBOARDING_FLOW_STEPS = Object.freeze(['ai', 'adapters', 'finish'])
const STEP_STATUSES = new Set(['pending', 'done', 'skipped'])
const STATE_STEPS = ['database', 'owner', 'ai', 'adapters']

/** Normalized `{ version: 1, steps, completedAt? }`, or `null` when absent or malformed. */
export function normalizeOnboarding(raw) {
  if (!isRecord(raw) || !isRecord(raw.steps)) return null
  const steps = {}
  for (const step of STATE_STEPS) {
    const status = raw.steps[step]
    if (STEP_STATUSES.has(status)) steps[step] = status
  }
  const completedAt = typeof raw.completedAt === 'number' || (typeof raw.completedAt === 'string' && raw.completedAt) ? raw.completedAt : undefined
  return { version: 1, steps, ...(completedAt !== undefined ? { completedAt } : {}) }
}

/** State a new owner starts with when the Host does not report onboarding (local fallback). */
export function freshOnboarding() {
  return { version: 1, steps: { database: 'done', owner: 'done', ai: 'pending', adapters: 'pending' } }
}

export function onboardingComplete(state) {
  return Boolean(state && state.completedAt !== undefined)
}

/** Whether the entry banner should show: a known state that is not complete. */
export function onboardingIncomplete(state) {
  return Boolean(state) && !onboardingComplete(state)
}

/** First flow step still pending; `finish` once AI and adapters are done or skipped. */
export function nextOnboardingStep(state) {
  for (const step of ['ai', 'adapters']) {
    if ((state?.steps?.[step] ?? 'pending') === 'pending') return step
  }
  return 'finish'
}

/** New state after marking `step` (`ai` | `adapters` | `finish`) with `status`. */
export function markOnboardingStep(state, step, status, now = Date.now()) {
  const base = normalizeOnboarding(state) ?? freshOnboarding()
  if (step === 'finish') return { ...base, completedAt: now }
  if (!['ai', 'adapters'].includes(step) || !STEP_STATUSES.has(status)) return base
  return { ...base, steps: { ...base.steps, [step]: status } }
}

/** Host state first; the browser's copy only when the Host reports none. */
export function resolveOnboarding(hostState, localState) {
  return normalizeOnboarding(hostState) ?? normalizeOnboarding(localState)
}

/** An RPC failure meaning the Host has no `onboarding.update` yet (keep the state locally). */
export function isUnsupportedRpcError(error) {
  const text = error instanceof Error ? error.message : String(error ?? '')
  return /unknown rpc type|未登记权限|not registered|unmapped/i.test(text)
}

export const ONBOARDING_STORAGE_PREFIX = 'zhin.console.onboarding:'

export function onboardingStorageKey(apiBase) {
  return `${ONBOARDING_STORAGE_PREFIX}${String(apiBase ?? '').replace(/\/+$/, '')}`
}

// ---------------------------------------------------------------- personal API tokens

/** Expiry presets for a new token; `0` days means never. */
export const TOKEN_EXPIRY_DAYS = Object.freeze([30, 90, 365, 0])

export function tokenExpiresAt(days, now = Date.now()) {
  return days > 0 ? now + days * 24 * 60 * 60 * 1000 : null
}

/** `active` | `expired` for a listed token. */
export function tokenState(token, now = Date.now()) {
  return typeof token?.expiresAt === 'number' && token.expiresAt <= now ? 'expired' : 'active'
}

export function tokenNameProblem(name) {
  const value = String(name ?? '').trim()
  if (!value) return 'empty'
  return value.length > 128 ? 'long' : null
}
