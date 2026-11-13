/**
 * One reading of every "why is there nothing to show / why did that fail" situation, so pages stop
 * inventing their own (Console 重构规范 §空态与错误态). Pure: tests and components share it.
 *
 * Kinds:
 * - `loading`             读取中；超过 {@link SLOW_LOADING_MS} 变成「仍在加载…」并说明可能的原因（网关、
 *                         实时事件 / WebSocket 被拦截、反向代理路径），给出重试与连接自检
 * - `unknown`             结果未知：请求已发出但没有可信答复（超时、断流），写操作不得自动重放
 * - `forbidden`           无权限（403 / `forbidden` / Host 的「没有 … 权限」）
 * - `not-installed`       未安装：所需插件或适配器不存在
 * - `unsupported`         Host 版本不支持该 RPC（Unknown RPC type）
 * - `empty`               无数据
 * - `locked`              已锁定：上级层级禁用了功能（409 `locked` + `lockedBy`）
 * - `conflict`            修订冲突：别人先改了（409 `conflict` / 写结果 `status: 'conflict'`），需重新读取
 * - `instance-unavailable` 实例不可用：网关在但 Zhin 实例没在答（503 `instance_unavailable`、
 *                         504 `instance_timeout`、502 `instance_error`，带 Retry-After）；`instance` 区分三种
 * - `database-busy`       数据库忙（503 `database_busy`，带 Retry-After）
 * - `needs-configuration` 需要配置（安装结果带 `needsConfiguration`）
 * - `disconnected`        与 Host 断开
 * - `error`               其他失败
 */
export const STATUS_KINDS = Object.freeze([
  'loading', 'unknown', 'forbidden', 'not-installed', 'unsupported', 'empty', 'locked', 'conflict', 'database-busy', 'instance-unavailable',
  'needs-configuration', 'disconnected', 'error',
])

/** Default wait when the gateway's Retry-After did not reach the Console (older SDKs keep only the text). */
export const DEFAULT_INSTANCE_RETRY_SECONDS = 5

/**
 * The gateway's instance bridge errors (ADR 0054). `not-dispatched`: the request never reached the
 * instance and can be sent again; the other two may have run.
 */
const INSTANCE_CODES = Object.freeze({
  instance_unavailable: 'unavailable',
  instance_timeout: 'timeout',
  instance_error: 'error',
})

/**
 * The gateway's fixed English texts of the same replies, for SDKs that keep only `json.error`.
 * Only these exact texts and the codes count: an upstream 「HTTP 502 Bad Gateway」 (a platform the
 * instance called) is the instance answering, not the instance being unavailable.
 */
const INSTANCE_TEXTS = Object.freeze([
  [/The Zhin instance is not running/u, 'unavailable', 'not-dispatched'],
  [/The instance did not answer in time/u, 'timeout', 'unknown'],
  [/The instance is overloaded/u, 'error', 'not-dispatched'],
  [/The instance failed to answer/u, 'error', 'unknown'],
])

function instanceFailureOf(serverCode, message) {
  if (serverCode && Object.hasOwn(INSTANCE_CODES, serverCode)) return { instance: INSTANCE_CODES[serverCode] }
  if (serverCode) return undefined
  for (const [pattern, instance, outcome] of INSTANCE_TEXTS) if (pattern.test(message)) return { instance, outcome }
  if (/\binstance_unavailable\b/u.test(message)) return { instance: 'unavailable' }
  if (/\binstance_timeout\b/u.test(message)) return { instance: 'timeout' }
  if (/\binstance_error\b/u.test(message)) return { instance: 'error' }
  return undefined
}

/**
 * How a request that got no trustworthy answer failed (`details.transport`, set by
 * `utils/rpc-reply-capture.mjs`; else read from the published SDK's `MessageError`, code
 * `MESSAGE_ERROR`, whose `originalError` is the fetch failure).
 */
function transportFailureOf(error, transport, details) {
  if (typeof details.transport === 'string') return details.transport
  if (transport !== 'MESSAGE_ERROR') return undefined
  const original = isRecord(error) ? error.originalError : undefined
  const name = isRecord(original) || original instanceof Error ? String(original.name ?? '') : ''
  if (name === 'TimeoutError' || name === 'AbortError') return 'timeout'
  if (name === 'TypeError') return 'network'
  return 'no-answer'
}

const LOCK_LEVELS = ['global', 'adapter', 'endpoint']

/**
 * The global plugin switch is a management gateway transaction (stop the instance → write
 * `disable_plugins` → start it, restoring both on failure; ADR 0054 §4). Its refusals:
 * 500 `transaction_failed` (rolled back: nothing changed), 500 `rollback_failed` (the rollback did
 * not finish: the instance may be stopped) and, under `zhin start --standalone`, 409
 * `gateway-required`. `transaction` (`failedPhase`, `logTail`, …) rides along when the gateway sent it.
 */
const TRANSACTION_CODES = Object.freeze({
  transaction_failed: 'rolled-back',
  rollback_failed: 'rollback-failed',
  'gateway-required': 'gateway-required',
})

/** `plugin:set-enabled` under `--standalone` answers 400 with this advice only (no code). */
const GATEWAY_REQUIRED_TEXT = /zhin enable\s*\/\s*zhin disable/u

function transactionOf(error, serverCode, message, details) {
  const raw = isRecord(details.transaction) ? details.transaction : isRecord(error) && isRecord(error.transaction) ? error.transaction : undefined
  let outcome = serverCode && Object.hasOwn(TRANSACTION_CODES, serverCode) ? TRANSACTION_CODES[serverCode] : undefined
  if (!outcome && raw && raw.ok === false) outcome = raw.status === 'rollbackFailed' ? 'rollback-failed' : 'rolled-back'
  if (!outcome && !serverCode && GATEWAY_REQUIRED_TEXT.test(message)) outcome = 'gateway-required'
  if (!outcome) return undefined
  const logTail = Array.isArray(raw?.logTail) ? raw.logTail.filter(line => typeof line === 'string') : []
  return {
    outcome,
    ...(typeof raw?.failedPhase === 'string' && raw.failedPhase ? { failedPhase: raw.failedPhase } : {}),
    ...(typeof raw?.error === 'string' && raw.error ? { cause: raw.error } : {}),
    ...(typeof raw?.rollbackError === 'string' && raw.rollbackError ? { rollbackError: raw.rollbackError } : {}),
    ...(logTail.length ? { logTail } : {}),
  }
}

const isRecord = value => value !== null && typeof value === 'object'

function readLock(value) {
  return LOCK_LEVELS.includes(value) ? value : undefined
}

/** `error.details.serverCode` (ConsoleTransportError of newer SDKs), else a plain `code` that is not a transport code. */
export function serverCodeOf(error) {
  if (!isRecord(error)) return undefined
  const details = isRecord(error.details) ? error.details : undefined
  if (typeof details?.serverCode === 'string' && details.serverCode) return details.serverCode
  // Transport codes describe the transport, not the Host's answer.
  if (typeof error.code === 'string' && !/^[A-Z_]+$/u.test(error.code)) return error.code
  if (typeof error.serverCode === 'string' && error.serverCode) return error.serverCode
  return undefined
}

function messageOf(error) {
  if (error instanceof Error) return error.message
  if (isRecord(error) && typeof error.message === 'string') return error.message
  if (isRecord(error) && typeof error.error === 'string') return error.error
  return typeof error === 'string' ? error : String(error ?? '')
}

function lockedByOf(error, message) {
  const details = isRecord(error) && isRecord(error.details) ? error.details : {}
  const direct = readLock(isRecord(error) ? error.lockedBy : undefined) ?? readLock(details.lockedBy)
  if (direct) return direct
  const named = /lockedBy["'\s:=]+["']?(global|adapter|endpoint)/iu.exec(message)?.[1]
    ?? /\b(?:locked|disabled) (?:by|at) (?:the )?(global|adapter|endpoint)\b/iu.exec(message)?.[1]
  if (named) return named.toLowerCase()
  const zh = /已(?:在|被)\s*(?:(全局)|(适配器)|(账号))/u.exec(message)
  return zh ? LOCK_LEVELS[zh.slice(1).findIndex(Boolean)] : undefined
}

function retryAfterOf(error, message) {
  const details = isRecord(error) && isRecord(error.details) ? error.details : {}
  for (const value of [isRecord(error) ? error.retryAfter : undefined, details.retryAfter, details.retryAfterSeconds]) {
    const seconds = Number(value)
    if (Number.isFinite(seconds) && seconds > 0) return Math.ceil(seconds)
  }
  const text = /请\s*(\d+)\s*秒后重试|retry after (\d+)/iu.exec(message)
  return text ? Number(text[1] ?? text[2]) : undefined
}

function needsOf(error) {
  const details = isRecord(error) && isRecord(error.details) ? error.details : {}
  const raw = (isRecord(error) ? error.needsConfiguration : undefined) ?? details.needsConfiguration
  const list = Array.isArray(raw) ? raw : isRecord(raw) ? [raw] : []
  return list.filter(isRecord)
}

/**
 * Classifies a failed request (a `ConsoleTransportError`, an `Error`, a Host error body or text).
 * Returns `{ kind, message, serverCode?, lockedBy?, retryAfterSeconds?, needsConfiguration?, missingEnv?, transaction? }`;
 * `transaction` marks a refused global plugin switch (kind `error`, see {@link TRANSACTION_CODES}).
 */
export function statusFromError(error) {
  const message = messageOf(error)
  const serverCode = serverCodeOf(error)
  const transport = isRecord(error) && typeof error.code === 'string' ? error.code : undefined
  const details = isRecord(error) && isRecord(error.details) ? error.details : {}
  const base = { message, ...(serverCode ? { serverCode } : {}) }
  const missingEnv = Array.isArray(details.missingEnv) ? details.missingEnv.filter(item => typeof item === 'string') : []

  const httpStatus = Number(details.httpStatus)
  // No trustworthy answer (timeout, network failure, unreadable reply): the write may have run.
  const failure = serverCode ? undefined : transportFailureOf(error, transport, details)
  if (failure === 'network') return { ...base, kind: 'disconnected' }
  if (failure === 'timeout' || failure === 'invalid-response' || failure === 'no-answer') return { ...base, kind: 'unknown' }
  if (failure === 'refused' && (httpStatus === 401 || httpStatus === 403)) return { ...base, kind: 'forbidden' }
  if (failure === 'refused') return { ...base, kind: 'error' }

  if (serverCode === 'locked' || (!serverCode && /\blocked\b|lockedBy|已在\s*(?:全局|适配器|账号)\S*\s*禁用|已被\S*层停用/iu.test(message))) {
    const lockedBy = lockedByOf(error, message)
    return { ...base, kind: 'locked', ...(lockedBy ? { lockedBy } : {}) }
  }
  if (serverCode === 'conflict' || serverCode === 'revision_conflict' || (!serverCode && /revision conflict|\bconflict\b.*revision|修订冲突|版本冲突|已被其他(?:人|地方)修改|已被修改[，,]\s*请刷新|请重新读取后再/iu.test(message))) {
    return { ...base, kind: 'conflict' }
  }
  const instanceFailure = instanceFailureOf(serverCode, message)
  if (instanceFailure) {
    const { instance } = instanceFailure
    const retryAfterSeconds = retryAfterOf(error, message) ?? DEFAULT_INSTANCE_RETRY_SECONDS
    const said = details.requestOutcome === 'not-dispatched' || details.requestOutcome === 'unknown' ? details.requestOutcome : instanceFailure.outcome
    const outcome = said ?? (instance === 'unavailable' ? 'not-dispatched' : 'unknown')
    return { ...base, kind: 'instance-unavailable', instance, outcome, retryAfterSeconds }
  }
  if (serverCode === 'database_busy' || /数据库正忙|database (?:is )?busy/iu.test(message)) {
    const retryAfterSeconds = retryAfterOf(error, message)
    return { ...base, kind: 'database-busy', ...(retryAfterSeconds ? { retryAfterSeconds } : {}) }
  }
  // Before 需要配置 / 无权限: a failed switch transaction may carry `missingEnv`, and its advice text is not a refusal.
  const transaction = transactionOf(error, serverCode, message, details)
  if (transaction) return { ...base, kind: 'error', transaction }
  const needs = needsOf(error)
  if (needs.length || serverCode === 'needs_configuration' || serverCode === 'configuration_required') {
    return { ...base, kind: 'needs-configuration', ...(needs.length ? { needsConfiguration: needs } : {}), ...(missingEnv.length ? { missingEnv } : {}) }
  }
  if (serverCode === 'forbidden' || serverCode === 'permission_denied' || httpStatus === 401 || httpStatus === 403 || /\bHTTP 40[13]\b|\bforbidden\b|permission denied|not allowed|scope does not allow|没有\s*\S+\s*权限|无权|权限不足/iu.test(message)) {
    return { ...base, kind: 'forbidden' }
  }
  if (serverCode === 'not_installed' || serverCode === 'plugin_not_found' || /plugin (?:is )?not installed|未安装/iu.test(message)) {
    return { ...base, kind: 'not-installed' }
  }
  if (serverCode === 'unsupported' || /unknown rpc type|unknown request type|not supported|unsupported rpc/iu.test(message)) {
    return { ...base, kind: 'unsupported' }
  }
  if (transport === 'TIMEOUT' || transport === 'TIMEOUT_ERROR' || /\btimed? ?out\b|超时/iu.test(message)) return { ...base, kind: 'unknown' }
  if (transport === 'CONNECTION_ERROR' || /failed to fetch|network ?error|networkerror|load failed|disconnected|ECONNREFUSED|连接已断开|未连接/iu.test(message)) {
    return { ...base, kind: 'disconnected' }
  }
  return { ...base, kind: 'error' }
}

/** Whether a write that failed this way may have been applied anyway (do not replay it). */
export function outcomeUnknown(status) {
  if (status?.kind === 'instance-unavailable') return status.outcome !== 'not-dispatched'
  return status?.kind === 'unknown' || status?.kind === 'disconnected'
}

/** Authored title / description per kind (displayed through i18n; `{0}` is the level or the seconds). */
export const STATUS_COPY = Object.freeze({
  loading: Object.freeze({ title: '正在读取…', description: '正在从 Host 读取数据。' }),
  unknown: Object.freeze({ title: '结果未知', description: '请求已发出，但没有收到可信的答复。请先核对当前状态，不要直接重试。' }),
  forbidden: Object.freeze({ title: '无权限', description: '当前身份没有查看或修改这里的权限。选择范围不会授予权限。' }),
  'not-installed': Object.freeze({ title: '未安装', description: '所需的插件或适配器尚未安装。' }),
  unsupported: Object.freeze({ title: '需要新版 Host', description: '当前 Host 还不支持这项功能。升级 Host 后再试。' }),
  empty: Object.freeze({ title: '暂无数据', description: '这里还没有内容。' }),
  locked: Object.freeze({ title: '已锁定', description: '上级已禁用此功能，这一层不能修改。' }),
  conflict: Object.freeze({ title: '内容已被修改', description: '读取之后别人改过这里。请重新读取最新内容，再决定是否修改。' }),
  'instance-unavailable': Object.freeze({ title: '实例不可用', description: 'Zhin 实例暂时没有响应。管理网关仍可用，可以去「实例」页查看。' }),
  'database-busy': Object.freeze({ title: '数据库忙', description: '数据库正忙，请稍后重试。' }),
  'needs-configuration': Object.freeze({ title: '需要配置', description: '还缺少必填配置，完成后才能使用。' }),
  disconnected: Object.freeze({ title: '已断开连接', description: '与 Host 的连接已断开，恢复后会自动重新读取。' }),
  error: Object.freeze({ title: '读取失败', description: '请求没有成功。请检查错误详情后重试。' }),
})

/** Authored level names for `locked` (`lockedBy`). */
export const LOCK_LEVEL_LABELS = Object.freeze({ global: '全局', adapter: '适配器', endpoint: '账号' })

/** Tone of the status surface. */
export function statusTone(kind) {
  if (kind === 'error' || kind === 'unknown') return 'destructive'
  if (kind === 'database-busy' || kind === 'instance-unavailable' || kind === 'conflict' || kind === 'disconnected' || kind === 'needs-configuration' || kind === 'locked') return 'warning'
  return 'muted'
}

/** How long a read may load before it is reported as slow (「仍在加载…」). */
export const SLOW_LOADING_MS = 8_000

/** Authored copy of a slow load; `{0}` is the seconds waited. */
export const SLOW_LOADING_COPY = Object.freeze({
  title: '仍在加载…',
  description: '已经等了 {0} 秒还没有答复。常见原因：',
  causes: Object.freeze([
    '网关没有响应：Host 进程没有在运行，或 API 地址填错了。',
    'WebSocket / 实时事件流被拦截：反向代理或防火墙没有放行长连接与 Upgrade 请求。',
    '反向代理的路径前缀与 API 地址不一致，请求被转给了别的服务。',
  ]),
})

/** Whether a load that started at `startedAt` is slow at `now`. */
export function loadingIsSlow(startedAt, now = Date.now(), threshold = SLOW_LOADING_MS) {
  return typeof startedAt === 'number' && Number.isFinite(startedAt) && now - startedAt >= threshold
}

/** Whole seconds a load has been waiting. */
export function loadingSeconds(startedAt, now = Date.now()) {
  return typeof startedAt === 'number' && Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
}
