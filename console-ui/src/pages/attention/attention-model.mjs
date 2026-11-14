/**
 * 「需要你处理」(attention inbox): one model for the dashboard section, the /attention page and the
 * top bar badge. The Host gathers the items (`attention.list`, already localized and filtered by
 * the caller's permissions); a Host that predates it answers Unknown RPC / unmapped, and then the
 * Console derives the few items it can from the dashboard reads, as before. While the instance is
 * still starting the gateway refuses the RPC too (503 / 504, or unmapped); `/pub/health` tells the
 * two apart, and a starting instance is shown as such, not as an older Host or an error.
 *
 * Per-viewer choices stay in this browser: 「稍后提醒」 hides an item for 24 hours, 「忽略」 hides it
 * until its fingerprint (`revision`) changes. Storage may be missing or throw; nothing here depends
 * on it succeeding.
 */
import { translate } from '../../i18n/locale.mjs'
import { isUnsupportedRpcError } from '../../utils/console-auth-model.mjs'
import { CONSOLE_PATHS } from '../../console-routes.mjs'
import { statusFromError } from '../../components/status-state-model.mjs'
import { instanceStateLabel } from '../ops/gateway-model.mjs'

export const ATTENTION_RPC = 'attention.list'
export const ATTENTION_PATH = CONSOLE_PATHS.attention
export const ATTENTION_SEVERITIES = Object.freeze(['danger', 'warning', 'info'])
export const ATTENTION_SNOOZE_MS = 24 * 60 * 60 * 1000
export const ATTENTION_REFRESH_MS = 30_000
/** Re-read sooner while the instance is still starting (or restarting). */
export const ATTENTION_NOT_READY_REFRESH_MS = 5_000
export const ATTENTION_PUSH_DEBOUNCE_MS = 1_000
export const DASHBOARD_ATTENTION_LIMIT = 4
export const ATTENTION_STORAGE_PREFIX = 'zhin.console.attention:'
/** Bound on remembered choices, so storage never grows without limit. */
export const ATTENTION_PREFS_LIMIT = 200

const SEVERITY_RANK = Object.freeze({ danger: 0, warning: 1, info: 2 })
const isRecord = value => !!value && typeof value === 'object' && !Array.isArray(value)
const text = value => typeof value === 'string' ? value : ''

function parseTime(value) {
  const time = typeof value === 'number' ? value : Date.parse(text(value))
  return Number.isFinite(time) ? time : null
}

/** One item from the Host, or null when it lacks what the list needs (unknown kinds are kept). */
export function normalizeAttentionItem(raw) {
  if (!isRecord(raw)) return null
  const id = text(raw.id)
  const kind = text(raw.kind)
  const severity = ATTENTION_SEVERITIES.includes(raw.severity) ? raw.severity : null
  const title = text(raw.title)
  const action = isRecord(raw.action) ? raw.action : null
  const path = text(action?.path)
  // Deep links stay inside the Console: a path, never another origin.
  if (!id || !kind || !severity || !title || !path.startsWith('/') || path.startsWith('//')) return null
  const since = parseTime(raw.since)
  return Object.freeze({
    id,
    revision: text(raw.revision) || id,
    kind,
    severity,
    title,
    detail: text(raw.detail),
    ...(isRecord(raw.subject) ? { subject: Object.freeze({ ...raw.subject }) } : {}),
    since: since === null ? null : new Date(since).toISOString(),
    action: Object.freeze({ label: text(action.label), path }),
    source: text(raw.source),
  })
}

/** Danger, warning, info; within one severity the oldest first, then by id. */
export function compareAttention(a, b) {
  const rank = (SEVERITY_RANK[a.severity] ?? 3) - (SEVERITY_RANK[b.severity] ?? 3)
  if (rank) return rank
  const at = parseTime(a.since) ?? Infinity
  const bt = parseTime(b.since) ?? Infinity
  if (at !== bt) return at < bt ? -1 : 1
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0
}

export function sortAttention(items = []) {
  return [...items].sort(compareAttention)
}

/** `attention.list` reply → { items, generatedAt, unavailable }. */
export function normalizeAttentionList(raw) {
  const data = isRecord(raw) ? raw : {}
  const items = Array.isArray(data.items) ? data.items.map(normalizeAttentionItem).filter(Boolean) : []
  const seen = new Set()
  const unique = items.filter(item => !seen.has(item.id) && seen.add(item.id))
  const generated = parseTime(data.generatedAt)
  return {
    items: sortAttention(unique),
    generatedAt: generated === null ? null : new Date(generated).toISOString(),
    unavailable: Array.isArray(data.unavailable) ? data.unavailable.filter(name => typeof name === 'string') : [],
  }
}

/** The Host has no `attention.list` (older Host): Unknown RPC, or not in its permission map. */
export function isAttentionUnsupported(error) {
  const code = error?.details?.serverCode ?? error?.code
  return code === 'unmapped' || code === 'unsupported' || isUnsupportedRpcError(error)
}

// ---------------------------------------------------------------- older Hosts

function fallbackItem(kind, severity, title, detail, path, label, state) {
  const id = `fallback.${kind}`
  return Object.freeze({ id, revision: JSON.stringify(state ?? null), kind, severity, title, detail, since: null,
    action: Object.freeze({ label, path }), source: 'console' })
}

/**
 * What the Console can tell without `attention.list`, from the dashboard reads: `stats`
 * (`/api/stats`, null when unreadable), `hostError`, log counts (`errorLogs` / `warningLogs`, null
 * when unreadable, with `logReadError`) and MCP totals.
 */
export function deriveFallbackAttention(input = {}, locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  const { stats = null, hostError = null, errorLogs = null, warningLogs = null, logReadError = null, mcpServices = null, connectedMcp = null } = input
  if (!stats && hostError) {
    return [fallbackItem('host.unreachable', 'danger', t('Host 暂时不可达'), t('控制面仍可继续使用；恢复连接后会自动刷新运行状态。'), '/ops/instance', t('查看实例'), null)]
  }
  const items = []
  const total = stats?.endpoints?.total ?? 0
  const offline = Math.max(0, total - (stats?.endpoints?.online ?? 0))
  if (stats && total === 0) {
    items.push(fallbackItem('endpoints.none', 'info', t('还没有聊天账号'), t('先用 Sandbox 验证，再接入真实平台。'), '/scope', t('去处理'), null))
  } else if (offline > 0) {
    items.push(fallbackItem('endpoints.offline', 'warning', t('{0} 个聊天账号离线', [offline]), t('检查凭据、网络和适配器日志。'), '/scope', t('去处理'), { offline }))
  }
  const disconnected = Math.max(0, (mcpServices ?? 0) - (connectedMcp ?? 0))
  if (disconnected > 0) {
    items.push(fallbackItem('mcp.disconnected', 'warning', t('{0} 个 MCP 服务未连接', [disconnected]), t('Agent 暂时无法调用这些服务提供的工具。'), '/introspection?tab=mcp', t('去处理'), { disconnected }))
  }
  if ((errorLogs ?? 0) > 0) {
    items.push(fallbackItem('logs.errors', 'info', t('历史错误 {0} 条', [errorLogs]), t('打开错误日志'), '/logs?level=error', t('去处理'), { errorLogs }))
  }
  if ((warningLogs ?? 0) > 0) {
    items.push(fallbackItem('logs.warnings', 'info', t('历史警告 {0} 条', [warningLogs]), t('打开警告日志'), '/logs?level=warn', t('去处理'), { warningLogs }))
  }
  if (stats && errorLogs === null) {
    items.push(fallbackItem('logs.unreadable', 'warning', t('日志状态暂时不可读'), logReadError || t('尚无法确认是否有运行错误，请打开日志页检查读取详情。'), '/logs', t('去处理'), null))
  }
  return sortAttention(items)
}

/**
 * The gateway answered for an instance that is not up (yet): 503 `instance_unavailable` or 504
 * `instance_timeout`, as while the instance is still starting.
 */
export function isAttentionInstanceUnavailable(error) {
  const reading = statusFromError(error)
  return reading.kind === 'instance-unavailable' && (reading.instance === 'unavailable' || reading.instance === 'timeout')
}

/** `/pub/health` `instance` → `{ state, ready }`, or null when it says nothing usable. */
export function normalizeInstanceHealth(raw) {
  if (!isRecord(raw) || typeof raw.state !== 'string' || !raw.state) return null
  return Object.freeze({ state: raw.state, ready: raw.ready === true })
}

export function isInstanceReady(instance) {
  return instance?.state === 'running' && instance.ready === true
}

/**
 * Reads the attention list: `attention.list` first. When it is refused as unmapped / unsupported or
 * the gateway says the instance is not answering, the gateway's `/pub/health` (`readInstanceHealth`)
 * tells which: an instance that is not running and ready yet gives `mode: 'instance-not-ready'`
 * (no items, not an error); a running, ready instance that still lacks the RPC is an older Host and
 * gets the Console's own derivation (`mode: 'fallback'`). When health cannot be read the behaviour
 * is as before (fallback for unsupported, rejection otherwise). Other failures reject (StatusState).
 */
export async function loadAttention({ request, loadFallback, readInstanceHealth, locale = 'zh-CN', now = Date.now }) {
  let unsupported = false
  try {
    const reply = await request({ type: ATTENTION_RPC, data: { locale } })
    return { mode: 'host', ...normalizeAttentionList(reply) }
  } catch (error) {
    unsupported = isAttentionUnsupported(error)
    if (!unsupported && !isAttentionInstanceUnavailable(error)) throw error
    let instance = null
    if (readInstanceHealth) {
      try { instance = normalizeInstanceHealth(await readInstanceHealth()) } catch { instance = null }
    }
    if (instance && !isInstanceReady(instance)) {
      return { mode: 'instance-not-ready', instance, items: [], generatedAt: new Date(now()).toISOString(), unavailable: [] }
    }
    if (!unsupported) throw error
  }
  const input = await loadFallback()
  return { mode: 'fallback', items: deriveFallbackAttention(input, locale), generatedAt: new Date(now()).toISOString(), unavailable: [] }
}

/**
 * What the page says while the instance is not ready: 「实例启动中…」 for `starting` (and a running
 * instance that is not ready yet), else the instance state in the 运维 → 实例 wording.
 * `{ title, detail, starting }`.
 */
export function attentionInstanceNotice(instance, locale = 'zh-CN') {
  const t = (message, values) => translate(locale, message, values)
  const state = instance?.state ?? 'starting'
  const starting = state === 'starting' || state === 'running'
  const title = starting ? t('实例启动中…') : t('实例{0}', [instanceStateLabel(state, t)])
  let detail
  switch (state) {
    case 'backoff': detail = t('实例异常退出，网关稍后会自动重启；重启完成后这里会自动刷新。'); break
    case 'crashed': detail = t('实例已崩溃，需要处理的事项暂时读不到。到「实例」页查看日志并重新启动。'); break
    case 'stopped': detail = t('实例未运行，需要处理的事项暂时读不到。到「实例」页启动实例。'); break
    case 'stopping': detail = t('实例正在停止，需要处理的事项暂时读不到。'); break
    default: detail = t('实例就绪后会自动读取需要处理的事项，无需手动刷新。')
  }
  return { title, detail, starting }
}

// ---------------------------------------------------------------- per-viewer choices

export function emptyAttentionPrefs() {
  return { snoozed: {}, ignored: {} }
}

export function attentionStorageKey(apiBase, userId) {
  return `${ATTENTION_STORAGE_PREFIX}${String(apiBase ?? '').replace(/\/+$/, '')}:${userId ? String(userId) : 'anonymous'}`
}

function normalizePrefs(raw) {
  const prefs = emptyAttentionPrefs()
  if (!isRecord(raw)) return prefs
  if (isRecord(raw.snoozed)) for (const [id, until] of Object.entries(raw.snoozed)) if (Number.isFinite(until)) prefs.snoozed[id] = until
  if (isRecord(raw.ignored)) for (const [id, revision] of Object.entries(raw.ignored)) if (typeof revision === 'string') prefs.ignored[id] = revision
  return prefs
}

/** Remembered choices; empty when storage is unavailable, blocked or holds something else. */
export function readAttentionPrefs(storage, key) {
  try {
    const raw = storage?.getItem(key)
    return raw ? normalizePrefs(JSON.parse(raw)) : emptyAttentionPrefs()
  } catch {
    return emptyAttentionPrefs()
  }
}

/** Saves choices; false when storage refused (the choice then lasts for this page only). */
export function writeAttentionPrefs(storage, key, prefs) {
  try {
    if (!storage) return false
    storage.setItem(key, JSON.stringify(prefs))
    return true
  } catch {
    return false
  }
}

function bounded(record) {
  const entries = Object.entries(record)
  return entries.length > ATTENTION_PREFS_LIMIT ? Object.fromEntries(entries.slice(-ATTENTION_PREFS_LIMIT)) : record
}

export function snoozeAttention(prefs, item, now = Date.now()) {
  const snoozed = { ...prefs.snoozed }
  delete snoozed[item.id]
  snoozed[item.id] = now + ATTENTION_SNOOZE_MS
  return { snoozed: bounded(snoozed), ignored: { ...prefs.ignored } }
}

export function ignoreAttention(prefs, item) {
  const ignored = { ...prefs.ignored }
  delete ignored[item.id]
  ignored[item.id] = item.revision
  const snoozed = { ...prefs.snoozed }
  delete snoozed[item.id]
  return { snoozed, ignored: bounded(ignored) }
}

/** Shows an item again (undoes 「稍后提醒」 and 「忽略」). */
export function restoreAttention(prefs, id) {
  const snoozed = { ...prefs.snoozed }
  const ignored = { ...prefs.ignored }
  delete snoozed[id]
  delete ignored[id]
  return { snoozed, ignored }
}

/**
 * Drops expired snoozes and ignores whose item changed (its revision differs). Ignores of items
 * absent from this read are kept: a source may just be unreadable for a moment.
 */
export function pruneAttentionPrefs(prefs, items = [], now = Date.now()) {
  const byId = new Map(items.map(item => [item.id, item]))
  const snoozed = Object.fromEntries(Object.entries(prefs.snoozed).filter(([, until]) => until > now))
  const ignored = Object.fromEntries(Object.entries(prefs.ignored).filter(([id, revision]) => !byId.has(id) || byId.get(id).revision === revision))
  return { snoozed, ignored }
}

export function samePrefs(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

/** Items split by the viewer's choices: shown (`active`), snoozed for now, ignored at this revision. */
export function partitionAttention(items = [], prefs = emptyAttentionPrefs(), now = Date.now()) {
  const active = []
  const snoozed = []
  const ignored = []
  for (const item of items) {
    if (prefs.ignored[item.id] === item.revision) ignored.push(item)
    else if ((prefs.snoozed[item.id] ?? 0) > now) snoozed.push(item)
    else active.push(item)
  }
  return { active, snoozed, ignored }
}

/** Top bar badge: danger + warning items still shown. */
export function attentionBadgeCount(active = []) {
  return active.filter(item => item.severity === 'danger' || item.severity === 'warning').length
}

/** Non-empty groups in severity order. */
export function groupAttention(items = []) {
  return ATTENTION_SEVERITIES
    .map(severity => ({ severity, items: items.filter(item => item.severity === severity) }))
    .filter(group => group.items.length > 0)
}

/** Group heading of a severity, in the viewer language. */
export function attentionSeverityLabel(severity, locale = 'zh-CN') {
  if (severity === 'danger') return translate(locale, '需要立即处理')
  if (severity === 'warning') return translate(locale, '需要处理')
  return translate(locale, '留意')
}

/** 「刚刚」 / 「5 分钟前」 …, or null when the item has no time. */
export function formatAttentionSince(since, now = Date.now(), locale = 'zh-CN') {
  const time = parseTime(since)
  if (time === null) return null
  const seconds = Math.max(0, Math.round((now - time) / 1000))
  if (seconds < 60) return translate(locale, '刚刚')
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return translate(locale, '{0} 分钟前', [minutes])
  const hours = Math.round(minutes / 60)
  if (hours < 48) return translate(locale, '{0} 小时前', [hours])
  return translate(locale, '{0} 天前', [Math.round(hours / 24)])
}

/**
 * Coalesces bursts (push events, focus) into one call after `ms` of quiet. `timers` exists for
 * tests.
 */
export function createDebouncer(fn, ms, timers = globalThis) {
  let handle = null
  return {
    trigger() {
      if (handle !== null) timers.clearTimeout(handle)
      handle = timers.setTimeout(() => { handle = null; fn() }, ms)
    },
    cancel() {
      if (handle !== null) timers.clearTimeout(handle)
      handle = null
    },
    get pending() { return handle !== null },
  }
}
