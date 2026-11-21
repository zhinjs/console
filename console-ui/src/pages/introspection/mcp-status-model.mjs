import { translate } from '../../i18n/locale.mjs'
import { parseRetryAfterSeconds } from '../../utils/retry-after.mjs'

/**
 * MCP 服务行的状态与「测试连接」结果（zhinjs/zhin #1250 第 28 批，契约见 `contracts/mcp.ts`）。
 *
 * - 行状态只来自 `GET /api/introspection/mcp` 的 `status` / `lastError`；`idle`（待连接）与
 *   `not_loaded`（未加载）是中性状态，只有 `failed` 标红。
 * - 测试结果是另一份数据，展示在详情里，不改行状态。
 */

export const MCP_SERVER_STATUSES = Object.freeze(['connected', 'failed', 'idle', 'not_loaded'])
export const MCP_FAILURE_CATEGORIES = Object.freeze(['auth', 'network', 'timeout', 'config', 'process_exit', 'sdk_missing', 'unknown'])

/** 配置入口：「配置文件 › AI › 外部服务」，即 `ai.mcpServers` 所在的分组。 */
export const MCP_CONFIG_HREF = '/ops/config?section=ai%3Aservices'

/** Failure category labels, translated through `t` (pages/introspection is fully localized). */
const failureLabels = t => ({
  auth: t('认证失败'),
  network: t('网络不可达'),
  timeout: t('连接超时'),
  config: t('配置有误'),
  process_exit: t('进程已退出'),
  sdk_missing: t('缺少 MCP SDK'),
  unknown: t('未知原因'),
})

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/** 一条 `ConsoleMcpFailure`；格式不对时返回 null。 */
export function readMcpFailure(value) {
  if (!isRecord(value)) return null
  const category = MCP_FAILURE_CATEGORIES.includes(value.category) ? value.category : 'unknown'
  const message = typeof value.message === 'string' ? value.message.trim() : ''
  const failure = { category, message }
  if (Number.isInteger(value.exitCode)) failure.exitCode = value.exitCode
  if (typeof value.at === 'number' && Number.isFinite(value.at)) failure.at = value.at
  return failure
}

/** 失败的一行说明：分类（+ 退出码）+ 原因。 */
export function mcpFailureText(failure, locale = 'zh-CN') {
  if (!failure) return translate(locale, '连接失败，原因未报告')
  const labels = failureLabels(message => translate(locale, message))
  const category = labels[failure.category] ?? labels.unknown
  const head = typeof failure.exitCode === 'number' ? translate(locale, '{0}（退出码 {1}）', [category, failure.exitCode]) : category
  return failure.message ? translate(locale, '{0}：{1}', [head, failure.message]) : head
}

export function mcpFailureCategoryLabel(category, locale = 'zh-CN') {
  const labels = failureLabels(message => translate(locale, message))
  return labels[category] ?? labels.unknown
}

/**
 * 一行 MCP 服务的展示状态。`status` 缺失（旧实例）时退回 `connected` 布尔值，
 * 此时分不清待连接与失败，沿用原来的「未连接」。
 *
 * `tone` 对应 Badge 变体；`dot` 对应 `console-runtime-status-dot` 的修饰类。
 * 信号色按 console#125：已连接是中性 outline，未连接 warning，失败 destructive，待连接 secondary。
 */
export function mcpRowState(row, locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  const data = isRecord(row) ? row : {}
  const toolCount = typeof data.toolCount === 'number' && Number.isFinite(data.toolCount) ? data.toolCount : 0
  const status = MCP_SERVER_STATUSES.includes(data.status) ? data.status : null
  if (status === 'connected' || (status === null && data.connected === true)) {
    return { status: 'connected', tone: 'outline', dot: 'is-online', label: t('已连接'), detail: t('{0} 个可用工具', [toolCount]), failure: null }
  }
  if (status === 'failed') {
    const failure = readMcpFailure(data.lastError)
    return { status, tone: 'destructive', dot: 'is-failed', label: t('连接失败'), detail: mcpFailureText(failure, locale), failure }
  }
  if (status === 'idle') {
    return { status, tone: 'secondary', dot: 'is-idle', label: t('待连接'), detail: t('Agent 已加载，尚未建立连接'), failure: null }
  }
  if (status === 'not_loaded') {
    return { status, tone: 'outline', dot: 'is-idle', label: t('未加载'), detail: t('已配置，运行中的 Agent 尚未加载（Agent 未运行或还没重载）'), failure: null }
  }
  // Older instance: no status, only `connected` (and possibly a plain `error`).
  const error = typeof data.error === 'string' && data.error.trim() ? data.error.trim() : ''
  return { status: 'disconnected', tone: 'warning', dot: 'is-offline', label: t('未连接'), detail: error || t('连接不可用'), failure: null }
}

/** stdio 服务的测试会另起一个进程。 */
export function isStdioMcp(row) {
  return isRecord(row) && typeof row.transport === 'string' && row.transport.trim().toLowerCase() === 'stdio'
}

/** `Retry-After`（秒或 HTTP 日期，严格解析，见 `utils/retry-after.mjs`）→ 秒数；读不到或格式不对时 null。 */
export function retryAfterSecondsFrom(header, now = Date.now()) {
  const seconds = parseRetryAfterSeconds(header, now)
  return seconds === undefined ? null : Math.max(1, seconds)
}

/** 200 的 `data`：一份 `ConsoleMcpConnectTestResult`；格式不对时 null。 */
export function readMcpTestResult(data) {
  if (!isRecord(data) || typeof data.ok !== 'boolean') return null
  const name = typeof data.name === 'string' ? data.name : ''
  const durationMs = typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) && data.durationMs >= 0 ? data.durationMs : null
  if (data.ok) {
    const toolCount = typeof data.toolCount === 'number' && Number.isFinite(data.toolCount) ? data.toolCount : 0
    return { ok: true, name, toolCount, durationMs }
  }
  return { ok: false, name, failure: readMcpFailure(data.failure), durationMs }
}

const ERROR_KINDS = Object.freeze({ 403: 'forbidden', 404: 'not_found', 409: 'busy', 429: 'rate_limited', 503: 'agent_unavailable' })

/**
 * `POST /api/introspection/mcp/test` 的回复 → `{ kind: 'result', result }` 或
 * `{ kind: 'error', reason, status, retryAfterSec, message }`。
 */
export function readMcpTestResponse({ status, body, retryAfter, now } = {}) {
  const envelope = isRecord(body) ? body : {}
  if (status >= 200 && status < 300 && envelope.success !== false) {
    const result = readMcpTestResult(envelope.data)
    if (result) return { kind: 'result', result }
  }
  const reason = ERROR_KINDS[status] ?? 'error'
  const message = typeof envelope.error === 'string' && envelope.error.trim() ? envelope.error.trim() : ''
  return { kind: 'error', reason, status: typeof status === 'number' ? status : 0, retryAfterSec: reason === 'rate_limited' ? retryAfterSecondsFrom(retryAfter, now) : null, message }
}

/** 请求本身没发出去或没有回复（网络错误、超时）。 */
export function mcpTestRequestError(message) {
  return { kind: 'error', reason: 'network', status: 0, retryAfterSec: null, message: typeof message === 'string' ? message : '' }
}

const CJK = /[\u3400-\u9fff]/u

/**
 * The Host's own explanation, when the reader can read it: the Host writes expected failures in
 * Chinese (`ConsoleApiErrorBody.error`), so an English Console shows its own translated advice
 * instead of a Chinese sentence (console#124). Text without Chinese (a network error, an English
 * Host message) is kept in every language.
 */
export function hostTextFor(message, locale = 'zh-CN') {
  const text = typeof message === 'string' ? message.trim() : ''
  if (!text) return ''
  return locale === 'zh-CN' || !CJK.test(text) ? text : ''
}

/** 测试结果的展示：`tone` 对应 Alert 变体，`role` 用于读屏播报。 */
export function mcpTestPresentation(outcome, locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  if (outcome?.kind === 'result') {
    const { result } = outcome
    const duration = typeof result.durationMs === 'number' ? t('用时 {0} ms', [Math.round(result.durationMs)]) : ''
    if (result.ok) {
      return { tone: 'success', role: 'status', label: t('测试连接成功'), detail: [t('列出 {0} 个工具', [result.toolCount]), duration].filter(Boolean).join(' · ') }
    }
    return { tone: 'destructive', role: 'alert', label: t('测试连接失败'), detail: [mcpFailureText(result.failure, locale), duration].filter(Boolean).join(' · ') }
  }
  const reason = outcome?.reason ?? 'error'
  const server = hostTextFor(outcome?.message, locale)
  switch (reason) {
    case 'not_found':
      return { tone: 'warning', role: 'alert', label: t('配置里没有这个服务'), detail: t('ai.mcpServers 中找不到它；可能刚被删除或改名，刷新列表后再试。') }
    case 'busy':
      return { tone: 'warning', role: 'status', label: t('正在测试'), detail: t('这个服务的另一次测试还没结束，请等它完成。') }
    case 'rate_limited':
      return { tone: 'warning', role: 'status', label: t('请稍后再试'), detail: outcome?.retryAfterSec
        ? t('测试太频繁或同时进行的测试已达上限，请 {0} 秒后再试。', [outcome.retryAfterSec])
        : t('测试太频繁或同时进行的测试已达上限，请稍后再试。') }
    case 'agent_unavailable':
      return { tone: 'warning', role: 'alert', label: t('Agent 未运行'), detail: t('Agent 运行后才能测试 MCP 连接。') }
    case 'forbidden':
      return { tone: 'warning', role: 'alert', label: t('不能测试连接'), detail: server || t('当前实例只读（如演示实例），或你没有这项权限。') }
    case 'network':
      return { tone: 'destructive', role: 'alert', label: t('测试请求失败'), detail: server || t('没有收到 Host 的回复，检查网络后重试。') }
    default:
      return { tone: 'destructive', role: 'alert', label: t('测试请求失败'), detail: server || t('Host 返回 HTTP {0}。', [outcome?.status ?? 0]) }
  }
}

/**
 * 「需要你处理」兜底（Host 没有 `attention.list`）里算作问题的 MCP 服务数：行里报告了 `status`
 * 时只数 `failed`（待连接、未加载不是问题）；都没有 `status`（旧实例）时返回 null，沿用「未连接」口径。
 */
export function countFailedMcp(rows) {
  const list = Array.isArray(rows) ? rows.filter(isRecord) : []
  if (!list.some(row => MCP_SERVER_STATUSES.includes(row.status))) return null
  return list.filter(row => row.status === 'failed').length
}

/**
 * 仪表盘与机器人状态页的 MCP 汇总。行报告 `status` 时只有 `failed` 算问题，`idle`（待连接）与
 * `not_loaded`（未加载）单独计数；都没有 `status`（旧 Host）时沿用「总数 − 已连接」。
 * `total` 是列表接口的总数（可能多于本页行数），缺省为行数。
 */
export function summarizeMcp(rows, total) {
  const list = Array.isArray(rows) ? rows.filter(isRecord) : []
  const count = typeof total === 'number' && Number.isFinite(total) && total >= 0 ? total : list.length
  const states = list.map(row => mcpRowState(row).status)
  const connected = states.filter(status => status === 'connected').length
  const statusAware = list.some(row => MCP_SERVER_STATUSES.includes(row.status))
  if (!statusAware) {
    return { total: count, connected, statusAware, failed: null, idle: 0, notLoaded: 0, problems: Math.max(0, count - connected) }
  }
  const failed = states.filter(status => status === 'failed').length
  return {
    total: count, connected, statusAware, failed,
    idle: states.filter(status => status === 'idle').length,
    notLoaded: states.filter(status => status === 'not_loaded').length,
    problems: failed,
  }
}

const listSeparator = locale => locale === 'en' ? ', ' : '，'

function neutralParts(summary, t) {
  return [
    summary.idle > 0 ? t('{0} 个待连接', [summary.idle]) : '',
    summary.notLoaded > 0 ? t('{0} 个未加载', [summary.notLoaded]) : '',
  ].filter(Boolean)
}

/** 仪表盘「MCP 服务」卡片的一行说明。 */
export function mcpDashboardDetail(summary, locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  if (summary.problems > 0) {
    return [summary.statusAware ? t('{0} 个连接失败', [summary.problems]) : t('{0} 个未连接', [summary.problems]), ...neutralParts(summary, t)].join(listSeparator(locale))
  }
  const neutral = neutralParts(summary, t)
  if (neutral.length) return [t('{0} 个已连接', [summary.connected]), ...neutral].join(listSeparator(locale))
  return t('{0} 个连接正常', [summary.connected])
}

/** 机器人状态页：就绪清单的说明、标题里的提醒、缺项列表里的一条（没有问题时为 null）。 */
export function mcpWorkbenchCopy(summary, locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  const failed = summary.statusAware && summary.problems > 0 ? [t('{0} 个连接失败', [summary.problems])] : []
  return {
    detail: summary.total
      ? [t('{0} / {1} 个服务已连接', [summary.connected, summary.total]), ...failed, ...neutralParts(summary, t)].join(listSeparator(locale))
      : t('未配置 MCP 服务'),
    headline: summary.problems > 0
      ? summary.statusAware ? t('可以对话，但有 MCP 服务连接失败') : t('可以对话，但有服务未连接')
      : null,
    missing: summary.problems > 0
      ? summary.statusAware
        ? t('{0} 个 MCP 服务连接失败，检查服务地址与凭据 →', [summary.problems])
        : t('{0} 个 MCP 服务未连接，检查服务地址与凭据 →', [summary.problems])
      : null,
  }
}
