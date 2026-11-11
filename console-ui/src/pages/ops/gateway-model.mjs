/**
 * Pure helpers of the 运维 → 实例 page: the gateway RPC envelope (ADR 0054 §4 / §5), status and
 * log readers, and the package transaction progress reducer. Shapes follow the provisional
 * mirror in `contracts/gateway.ts`.
 */

export const GATEWAY_RPC = Object.freeze({
  PACKAGES_LIST: 'gateway.packages.list',
  PACKAGES_PLAN: 'gateway.packages.plan',
  PACKAGES_INSTALL: 'gateway.packages.install',
  PACKAGES_UNINSTALL: 'gateway.packages.uninstall',
  PACKAGES_UPDATE: 'gateway.packages.update',
  INSTANCE_STATUS: 'gateway.instance.status',
  INSTANCE_START: 'gateway.instance.start',
  INSTANCE_STOP: 'gateway.instance.stop',
  INSTANCE_RESTART: 'gateway.instance.restart',
  INSTANCE_LOGS: 'gateway.instance.logs',
})

export const GATEWAY_PACKAGES_PROGRESS = 'gateway.packages.progress'

export const INSTANCE_STATES = Object.freeze(['stopped', 'starting', 'running', 'stopping', 'backoff', 'crashed'])

export const PACKAGE_PHASES = Object.freeze([
  'snapshot', 'stop-instance', 'package-manager', 'start-instance', 'rollback', 'restore-files', 'reinstall', 'restart-instance', 'done',
])

/** Package specs one request may carry (gateway limit). */
export const MAX_PACKAGE_SPECS = 32
/** Log lines kept in the browser. */
export const MAX_LOG_LINES = 2000
/** Package manager output kept in the browser (characters). */
export const MAX_PROGRESS_OUTPUT = 64 * 1024

export class GatewayRequestError extends Error {
  constructor(message, { status = 0, code = 'failed', hostMessage = '' } = {}) {
    super(message)
    this.name = 'GatewayRequestError'
    this.status = status
    this.code = code
    this.hostMessage = hostMessage
  }
}

/** Body of `POST {base}/console/request` for a gateway RPC. */
export function gatewayRequestBody(type, data, requestId) {
  return { type, requestId, data: data ?? {} }
}

const UNKNOWN_RPC = /unknown rpc type|未登记权限/iu

/**
 * One reply as data, or a `GatewayRequestError` with localized text. Accepts the Console
 * envelope (`success`) and the gateway's own (`ok` / `error.{code,message,status}`).
 */
export function readGatewayReply(status, json, t) {
  const body = json && typeof json === 'object' ? json : {}
  const nested = body.error && typeof body.error === 'object' ? body.error : null
  const failed = body.success === false || body.ok === false || nested !== null
  if (status >= 200 && status < 300 && !failed) return body.data
  const hostMessage = nested ? String(nested.message ?? '') : typeof body.error === 'string' ? body.error : ''
  const code = nested && typeof nested.code === 'string' ? nested.code : typeof body.code === 'string' ? body.code : ''
  const effective = nested && typeof nested.status === 'number' && status < 400 ? nested.status : status
  if (code === 'unmapped' || UNKNOWN_RPC.test(hostMessage)) {
    throw new GatewayRequestError(t('需要新版网关：当前 Host 不支持实例与依赖管理（ADR 0054）。'), { status: effective, code: 'unsupported', hostMessage })
  }
  if (effective === 401) throw new GatewayRequestError(t('登录已失效，请重新登录。'), { status: effective, code: code || 'unauthorized', hostMessage })
  if (effective === 403 && !hostMessage) throw new GatewayRequestError(t('当前身份没有执行此操作的权限。'), { status: effective, code: 'forbidden', hostMessage })
  const message = hostMessage || t('请求失败（HTTP {0}）', [effective])
  throw new GatewayRequestError(message, { status: effective, code: code || (effective === 403 ? 'forbidden' : 'failed'), hostMessage })
}

export function gatewayErrorKind(error) {
  if (!(error instanceof GatewayRequestError)) return 'failed'
  if (error.code === 'unsupported') return 'unsupported'
  if (error.status === 403 || error.code === 'forbidden') return 'forbidden'
  if (error.status === 409 || error.code === 'conflict') return 'conflict'
  if (error.status === 503 || error.code === 'unavailable') return 'unavailable'
  return 'failed'
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const numberOr = (value, fallback) => (typeof value === 'number' && Number.isFinite(value) ? value : fallback)
const stringList = value => (Array.isArray(value) ? value.filter(item => typeof item === 'string') : [])

export function readInstanceStatus(value) {
  if (!isRecord(value) || !INSTANCE_STATES.includes(value.state)) return null
  const failure = isRecord(value.lastFailure) ? {
    reason: String(value.lastFailure.reason ?? ''),
    message: String(value.lastFailure.message ?? ''),
    at: numberOr(value.lastFailure.at, 0),
    exitCode: numberOr(value.lastFailure.exitCode, null),
    signal: typeof value.lastFailure.signal === 'string' ? value.lastFailure.signal : null,
    logTail: stringList(value.lastFailure.logTail),
  } : undefined
  return {
    instanceId: typeof value.instanceId === 'string' ? value.instanceId : 'default',
    state: value.state,
    ...(typeof value.pid === 'number' ? { pid: value.pid } : {}),
    ...(typeof value.startedAt === 'number' ? { startedAt: value.startedAt } : {}),
    ...(typeof value.generation === 'number' ? { generation: value.generation } : {}),
    ...(typeof value.protocolVersion === 'number' ? { protocolVersion: value.protocolVersion } : {}),
    lastExitCode: numberOr(value.lastExitCode, null),
    lastExitSignal: typeof value.lastExitSignal === 'string' ? value.lastExitSignal : null,
    ...(failure ? { lastFailure: failure } : {}),
    recentRestarts: numberOr(value.recentRestarts, 0),
  }
}

export function instanceStateLabel(state, t) {
  switch (state) {
    case 'stopped': return t('已停止')
    case 'starting': return t('启动中')
    case 'running': return t('运行中')
    case 'stopping': return t('停止中')
    case 'backoff': return t('等待重启')
    case 'crashed': return t('已崩溃')
    default: return String(state)
  }
}

/** Badge variant for a state. */
export function instanceStateTone(state) {
  if (state === 'running') return 'success'
  if (state === 'crashed') return 'destructive'
  if (state === 'backoff' || state === 'starting' || state === 'stopping') return 'warning'
  return 'secondary'
}

/** Which lifecycle buttons make sense in `state`. The gateway decides in the end. */
export function instanceActions(state) {
  const busy = state === 'starting' || state === 'stopping'
  return {
    start: state === 'stopped' || state === 'crashed' || state === 'backoff',
    stop: !busy && state !== 'stopped',
    restart: state === 'running' || state === 'crashed' || state === 'backoff',
  }
}

/** Compact duration (`3 天 4 小时`, `5 分 2 秒`). */
export function formatDuration(ms, t) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days) return t('{0} 天 {1} 小时', [days, hours])
  if (hours) return t('{0} 小时 {1} 分', [hours, minutes])
  if (minutes) return t('{0} 分 {1} 秒', [minutes, seconds])
  return t('{0} 秒', [seconds])
}

export function uptimeMs(status, now) {
  return status?.state === 'running' && typeof status.startedAt === 'number' ? Math.max(0, now - status.startedAt) : null
}

export function failureReasonLabel(reason, t) {
  switch (reason) {
    case 'exit': return t('进程退出')
    case 'spawn-error': return t('无法启动进程')
    case 'ready-timeout': return t('启动超时')
    case 'protocol-mismatch': return t('网关与实例版本不匹配')
    case 'restart-storm': return t('重启过于频繁')
    default: return reason || t('未知原因')
  }
}

export function readLogLines(value) {
  const lines = isRecord(value) && Array.isArray(value.lines) ? value.lines : Array.isArray(value) ? value : []
  return lines.filter(line => isRecord(line) && typeof line.seq === 'number' && typeof line.line === 'string').map(line => ({
    seq: line.seq,
    time: numberOr(line.time, 0),
    stream: line.stream === 'stderr' ? 'stderr' : 'stdout',
    line: line.line,
  }))
}

/**
 * Appends the lines not seen yet (by `seq`), oldest first, keeping at most `cap`. A tail whose
 * newest `seq` is below what we hold means the gateway restarted its collector: start over.
 */
export function mergeLogLines(existing, incoming, cap = MAX_LOG_LINES) {
  if (!incoming.length) return existing
  const last = existing.length ? existing[existing.length - 1].seq : -Infinity
  const newest = Math.max(...incoming.map(line => line.seq))
  const sorted = [...incoming].sort((a, b) => a.seq - b.seq)
  const merged = newest < last ? sorted : [...existing, ...sorted.filter(line => line.seq > last)]
  if (merged.length === existing.length && newest >= last) return existing
  return merged.length > cap ? merged.slice(merged.length - cap) : merged
}

export function readPackageList(value) {
  if (!isRecord(value)) return { packageManager: '', packages: [] }
  const packages = (Array.isArray(value.packages) ? value.packages : []).filter(item => isRecord(item) && typeof item.name === 'string').map(item => ({
    name: item.name,
    range: typeof item.range === 'string' ? item.range : '',
    dependencyType: ['dependencies', 'optionalDependencies', 'devDependencies'].includes(item.dependencyType) ? item.dependencyType : 'dependencies',
    installedVersion: typeof item.installedVersion === 'string' ? item.installedVersion : null,
    ...(typeof item.catalog === 'string' ? { catalog: item.catalog } : {}),
  })).sort((a, b) => a.name.localeCompare(b.name))
  return { packageManager: typeof value.packageManager === 'string' ? value.packageManager : '', packages }
}

const PACKAGE_SPEC = /^(?:@[a-z0-9][a-z0-9._~-]*\/)?[a-z0-9][a-z0-9._~-]*(?:@[^\s@]+)?$/u

/** Splits a whitespace / comma separated list of `name` or `name@range`. */
export function parsePackageSpecs(text, t) {
  const specs = [...new Set(String(text ?? '').split(/[\s,]+/u).map(item => item.trim()).filter(Boolean))]
  if (!specs.length) return { specs, problem: t('请输入至少一个包名。') }
  if (specs.length > MAX_PACKAGE_SPECS) return { specs, problem: t('一次最多 {0} 个包。', [MAX_PACKAGE_SPECS]) }
  const invalid = specs.find(spec => !PACKAGE_SPEC.test(spec))
  if (invalid) return { specs, problem: t('「{0}」不是有效的 npm 包名。', [invalid]) }
  return { specs, problem: null }
}

const readAuthorized = value => (Array.isArray(value) ? value : []).filter(item => isRecord(item) && typeof item.name === 'string').map(item => ({
  name: item.name,
  ...(typeof item.version === 'string' ? { version: item.version } : {}),
  spec: typeof item.spec === 'string' ? item.spec : item.name,
  source: typeof item.source === 'string' ? item.source : 'npm',
}))

export function readPackagePlan(value) {
  if (!isRecord(value) || !['install', 'uninstall', 'update'].includes(value.operation)) return null
  return {
    operation: value.operation,
    packages: readAuthorized(value.packages),
    all: value.all === true,
    packageManager: typeof value.packageManager === 'string' ? value.packageManager : '',
    instanceState: typeof value.instanceState === 'string' ? value.instanceState : 'unmanaged',
    restartsInstance: value.restartsInstance === true,
  }
}

export function readTransactionResult(value) {
  if (!isRecord(value) || !['succeeded', 'rolledBack', 'rollbackFailed'].includes(value.status)) return null
  const instance = isRecord(value.instance) ? value.instance : {}
  return {
    id: typeof value.id === 'string' ? value.id : '',
    operation: value.operation,
    packages: readAuthorized(value.packages),
    ok: value.ok === true,
    status: value.status,
    ...(typeof value.failedPhase === 'string' ? { failedPhase: value.failedPhase } : {}),
    ...(typeof value.error === 'string' ? { error: value.error } : {}),
    ...(typeof value.rollbackError === 'string' ? { rollbackError: value.rollbackError } : {}),
    logTail: stringList(value.logTail),
    instance: { before: String(instance.before ?? 'unmanaged'), after: String(instance.after ?? 'unmanaged') },
    startedAt: numberOr(value.startedAt, 0),
    finishedAt: numberOr(value.finishedAt, 0),
  }
}

export function phaseLabel(phase, t) {
  switch (phase) {
    case 'snapshot': return t('备份 package.json、锁文件与配置')
    case 'stop-instance': return t('停止实例')
    case 'package-manager': return t('运行包管理器')
    case 'start-instance': return t('启动实例并等待就绪')
    case 'rollback': return t('回滚')
    case 'restore-files': return t('恢复备份文件')
    case 'reinstall': return t('重新安装旧依赖')
    case 'restart-instance': return t('启动旧版本实例')
    case 'done': return t('完成')
    default: return String(phase)
  }
}

export function operationLabel(operation, t) {
  if (operation === 'install') return t('安装')
  if (operation === 'uninstall') return t('卸载')
  if (operation === 'update') return t('更新')
  return String(operation)
}

export const EMPTY_PROGRESS = Object.freeze({ id: null, operation: null, packages: [], phases: [], output: '', result: null })

/**
 * Folds one `gateway.packages.progress` event into the panel state. The first `start` (or any
 * event while no id is held) adopts the transaction; events of other transactions are ignored.
 */
export function reducePackageProgress(state, event) {
  if (!isRecord(event) || typeof event.id !== 'string') return state
  if (state.id !== null && event.id !== state.id) return state
  const base = state.id === null ? { ...state, id: event.id } : state
  switch (event.type) {
    case 'start':
      return { ...base, operation: event.operation ?? null, packages: readAuthorized(event.packages) }
    case 'phase':
      return typeof event.phase === 'string' && base.phases[base.phases.length - 1] !== event.phase
        ? { ...base, phases: [...base.phases, event.phase] }
        : base
    case 'output': {
      if (typeof event.chunk !== 'string') return base
      const output = base.output + event.chunk
      return { ...base, output: output.length > MAX_PROGRESS_OUTPUT ? output.slice(output.length - MAX_PROGRESS_OUTPUT) : output }
    }
    case 'result': {
      const result = readTransactionResult(event.result)
      return result ? { ...base, result } : base
    }
    default:
      return base
  }
}

/** Headline of a finished transaction. */
export function transactionSummary(result, t) {
  if (result.status === 'succeeded') return { tone: 'success', title: t('{0}成功', [operationLabel(result.operation, t)]) }
  if (result.status === 'rolledBack') {
    return { tone: 'warning', title: t('{0}失败，已回滚到原来的依赖', [operationLabel(result.operation, t)]) }
  }
  return { tone: 'destructive', title: t('{0}失败，回滚也未完成，需要人工处理', [operationLabel(result.operation, t)]) }
}
