import { translate } from '../i18n/locale.mjs'
/**
 * 「机器人 → Token 用量」的纯逻辑：校验 Host 的 plugin.root.usage-stats 返回，
 * 把筛选翻成 RPC 参数，做数字格式化、按模型稳定配色、会话 key 拆分和排序。
 * 格式不对时抛错，不当成「没有用量」。
 */

export const USAGE_METHOD = 'usage-stats'
const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR
/** 自动粒度：范围超过 3 天用「天」，否则用「小时」。 */
export const AUTO_HOURLY_MAX_MS = 3 * DAY
/** 小时粒度最多画多少根柱子，超出强制改为天。 */
export const MAX_HOURLY_BUCKETS = 24 * 7

export const USAGE_RANGES = Object.freeze([
  Object.freeze({ value: 'today', label: '今天' }),
  Object.freeze({ value: '7d', label: '近 7 天' }),
  Object.freeze({ value: '30d', label: '近 30 天' }),
  Object.freeze({ value: 'custom', label: '自定义' }),
])
export const USAGE_BUCKETS = Object.freeze([
  Object.freeze({ value: 'auto', label: '自动' }),
  Object.freeze({ value: 'hour', label: '小时' }),
  Object.freeze({ value: 'day', label: '天' }),
])

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function isCount(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}
function formatError(locale) {
  return new Error(translate(locale, "用量数据格式不正确。"))
}

const TOKEN_KEYS = ['calls', 'inputTokens', 'outputTokens', 'cacheReadTokens']
/** 新 Host 才有的可选字段：出现时必须是合法数字，缺失不报错。 */
const OPTIONAL_COUNT_KEYS = ['cacheShare', 'cacheWriteTokens']

function validateTokens(row, locale, extra = []) {
  if (!isPlainObject(row)) throw formatError(locale)
  for (const key of [...TOKEN_KEYS, ...extra]) if (!isCount(row[key])) throw formatError(locale)
  for (const key of OPTIONAL_COUNT_KEYS) if (row[key] !== undefined && !isCount(row[key])) throw formatError(locale)
  return row
}

/** plugin.root.usage-stats → 原样返回（格式不对抛错）。 */
export function validateUsageStats(data, locale = 'zh-CN') {
  if (!isPlainObject(data)) throw formatError(locale)
  const { range, totals, segments } = data
  if (!isPlainObject(range) || !isCount(range.since) || !isCount(range.until)) throw formatError(locale)
  if (range.bucket !== 'hour' && range.bucket !== 'day') throw formatError(locale)
  if (!isPlainObject(totals)) throw formatError(locale)
  for (const key of ['turns', ...TOKEN_KEYS, 'cacheShare']) if (!isCount(totals[key])) throw formatError(locale)
  if (totals.cacheWriteTokens !== undefined && !isCount(totals.cacheWriteTokens)) throw formatError(locale)
  const q = totals.cacheShareByCall
  if (q !== undefined && (!isPlainObject(q) || !isCount(q.p50) || !isCount(q.p90))) throw formatError(locale)
  if (!Array.isArray(data.byModel) || !Array.isArray(data.bySession) || !Array.isArray(data.series)) throw formatError(locale)
  for (const row of data.byModel) {
    validateTokens(row, locale)
    if (typeof row.provider !== 'string' || typeof row.model !== 'string') throw formatError(locale)
  }
  for (const row of data.bySession) {
    validateTokens(row, locale, ['turns'])
    if (typeof row.sessionKey !== 'string') throw formatError(locale)
  }
  for (const row of data.series) {
    validateTokens(row, locale, ['bucketStart'])
    if (!isPlainObject(row.byModel)) throw formatError(locale)
    for (const value of Object.values(row.byModel)) if (!isCount(value)) throw formatError(locale)
  }
  if (!isPlainObject(segments)) throw formatError(locale)
  for (const key of ['history', 'fixed', 'user']) if (!isCount(segments[key])) throw formatError(locale)
  return data
}

/** 紧凑数字：999 → 999，1234 → 1.2k，1.5e6 → 1.5M，2e9 → 2B。 */
export function formatTokens(value, locale = 'zh-CN') {
  const n = Number.isFinite(value) ? value : 0
  const abs = Math.abs(n)
  const units = [[1e9, 'B'], [1e6, 'M'], [1e3, 'k']]
  for (const [size, unit] of units) {
    if (abs >= size) {
      const scaled = n / size
      const digits = Math.abs(scaled) >= 100 ? 0 : 1
      return `${new Intl.NumberFormat(locale, { maximumFractionDigits: digits }).format(scaled)}${unit}`
    }
  }
  return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(n)
}

export function formatPercent(ratio, locale = 'zh-CN') {
  const value = Number.isFinite(ratio) ? Math.min(1, Math.max(0, ratio)) : 0
  return new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(value)
}

/** 缓存命中率：优先用 Host 给的 cacheShare（0..1），旧 Host 没给就用 缓存读取 / 输入；输入为 0 时为 0。 */
export function cacheRatio(row) {
  if (!row) return 0
  if (typeof row.cacheShare === 'number' && Number.isFinite(row.cacheShare)) return Math.min(1, Math.max(0, row.cacheShare))
  return row.inputTokens > 0 ? Math.min(1, row.cacheReadTokens / row.inputTokens) : 0
}

/** 任一层出现过缓存写入才显示该列 / 值；缺失或全为 0 时隐藏。 */
export function hasCacheWrite(stats) {
  const positive = (row) => typeof row?.cacheWriteTokens === 'number' && row.cacheWriteTokens > 0
  return positive(stats.totals) || stats.byModel.some(positive) || stats.bySession.some(positive) || stats.series.some(positive)
}

/** 每次调用的命中率分位数（新 Host 才有）；缺失返回 null。 */
export function cacheQuantiles(totals) {
  const q = totals?.cacheShareByCall
  return q && typeof q.p50 === 'number' && typeof q.p90 === 'number' ? { p50: q.p50, p90: q.p90 } : null
}

/** 命中率折线：每个桶一个点；该桶没有输入 token 时为 null（断开，而不是画成 0%）。 */
export function cacheLinePoints(series) {
  return series.map(point => ({
    bucketStart: point.bucketStart,
    value: point.inputTokens > 0 ? cacheRatio(point) : null,
  }))
}

export function modelKey(provider, model) {
  return `${provider}/${model}`
}

// 色盲友好的分类色（Okabe-Ito 变体），亮 / 暗主题都可读。
export const MODEL_PALETTE = Object.freeze([
  '#2563eb', '#e08a00', '#0f9d76', '#d6409f', '#7c5cff', '#c8553d', '#0ea5c6', '#8a8f98',
])
export const OTHER_COLOR = '#9aa0a6'

function hashKey(text) {
  let hash = 2166136261
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

/**
 * 给每个 provider/model 分一个固定颜色：按 key 排序后依次取色板，
 * 因此同一批 key 在所有图里颜色一致，且与出现顺序 / 数值无关；
 * 超过色板长度时按哈希回绕（颜色可能重复，但同一 key 始终同色）。
 */
export function buildColorMap(keys) {
  const sorted = [...new Set(keys)].sort()
  const map = new Map()
  const used = new Set()
  for (const key of sorted) {
    let slot = hashKey(key) % MODEL_PALETTE.length
    for (let step = 0; step < MODEL_PALETTE.length && used.has(slot) && used.size < MODEL_PALETTE.length; step += 1) {
      slot = (slot + 1) % MODEL_PALETTE.length
    }
    used.add(slot)
    map.set(key, MODEL_PALETTE[slot])
  }
  return map
}

export function colorFor(map, key) {
  return map.get(key) ?? OTHER_COLOR
}

/** 取数据里出现的全部 provider/model（byModel 与 series 的并集）。 */
export function collectModelKeys(stats) {
  const keys = new Set(stats.byModel.map(row => modelKey(row.provider, row.model)))
  for (const point of stats.series) for (const key of Object.keys(point.byModel)) keys.add(key)
  return [...keys]
}

/**
 * 堆叠柱：每个桶按 keys 的顺序给出 { key, value }，其余（series 里有但不在 keys 里）并入「其他」。
 * 返回 { max, bars: [{ bucketStart, total, parts }] }。
 */
export function stackSeries(series, keys) {
  const known = new Set(keys)
  let max = 0
  const bars = series.map(point => {
    const parts = []
    let sum = 0
    for (const key of keys) {
      const value = point.byModel[key] ?? 0
      if (value > 0) { parts.push({ key, value }); sum += value }
    }
    let other = 0
    for (const [key, value] of Object.entries(point.byModel)) if (!known.has(key)) other += value
    if (other > 0) { parts.push({ key: '__other__', value: other }); sum += other }
    // byModel 缺失时退回 inputTokens，柱子不至于是空的。
    const total = sum > 0 ? sum : point.inputTokens
    if (sum === 0 && point.inputTokens > 0) parts.push({ key: '__other__', value: point.inputTokens })
    max = Math.max(max, total)
    return { bucketStart: point.bucketStart, total, parts }
  })
  return { max, bars }
}

/** 图例 / 柱子保留前 N 个模型（按总输入降序），其余并入「其他」。 */
export function topModelKeys(byModel, limit = 7) {
  return [...byModel]
    .sort((a, b) => b.inputTokens - a.inputTokens)
    .slice(0, limit)
    .map(row => modelKey(row.provider, row.model))
}

/** 「niceMax」：给 Y 轴一个整齐的上限。 */
export function niceMax(value) {
  if (!(value > 0)) return 1
  const exp = Math.floor(Math.log10(value))
  const base = 10 ** exp
  for (const step of [1, 2, 2.5, 5, 10]) if (value <= step * base) return step * base
  return 10 * base
}

/** 甜甜圈切片：占比和起止角度（弧度，从 12 点顺时针）。零总量返回空数组。 */
export function donutSlices(values) {
  const total = values.reduce((sum, item) => sum + Math.max(0, item.value), 0)
  if (total <= 0) return []
  let angle = 0
  const slices = []
  for (const item of values) {
    const value = Math.max(0, item.value)
    if (value <= 0) continue
    const share = value / total
    slices.push({ ...item, share, start: angle, end: angle + share * Math.PI * 2 })
    angle += share * Math.PI * 2
  }
  return slices
}

export const SEGMENT_KEYS = Object.freeze(['history', 'fixed', 'user'])
export const SEGMENT_LABELS = Object.freeze({ history: '历史', fixed: '固定', user: '用户输入' })

export function segmentValues(segments) {
  return SEGMENT_KEYS.map(key => ({ key, value: segments[key] ?? 0 }))
}

/**
 * 拆 sessionKey：优先用 Host 给的 platform / scope / sceneId，缺失时按 `platform:scope:sceneId`
 * （scene id 里允许再有冒号）拆；拆不出来的部分为空串，原 key 始终保留。
 */
export function splitSessionKey(row) {
  const parts = String(row.sessionKey).split(':')
  const fallback = {
    platform: parts.length >= 3 ? parts[0] : '',
    scope: parts.length >= 3 ? parts[1] : parts.length === 2 ? parts[0] : '',
    sceneId: parts.length >= 3 ? parts.slice(2).join(':') : parts.length === 2 ? parts[1] : parts[0],
  }
  return {
    sessionKey: row.sessionKey,
    platform: row.platform || fallback.platform,
    scope: row.scope || fallback.scope,
    sceneId: row.sceneId || fallback.sceneId,
  }
}

export const SESSION_SORT_KEYS = Object.freeze(['turns', 'calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cache'])

function sortValue(row, key) {
  return key === 'cache' ? cacheRatio(row) : row[key] ?? 0
}

/** 会话表排序（不改原数组）；同值按 sessionKey 稳定排序。 */
export function sortSessions(rows, key = 'inputTokens', direction = 'desc') {
  const sign = direction === 'asc' ? 1 : -1
  return [...rows].sort((a, b) => {
    const diff = sortValue(a, key) - sortValue(b, key)
    return diff !== 0 ? sign * diff : a.sessionKey.localeCompare(b.sessionKey)
  })
}

function startOfDay(ms) {
  const date = new Date(ms)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

/** 预设范围 → { since, until }（本地时区的「今天」从 0 点算起）。 */
export function rangeFor(preset, now = Date.now()) {
  if (preset === 'today') return { since: startOfDay(now), until: now }
  if (preset === '30d') return { since: now - 30 * DAY, until: now }
  return { since: now - 7 * DAY, until: now }
}

/** 自动粒度：范围不超过 3 天用小时，否则天。 */
export function autoBucket(range) {
  return range.until - range.since <= AUTO_HOURLY_MAX_MS ? 'hour' : 'day'
}

export function resolveBucket(choice, range) {
  const wanted = choice === 'hour' || choice === 'day' ? choice : autoBucket(range)
  // 小时柱太多没法看，强制改成天。
  if (wanted === 'hour' && (range.until - range.since) / HOUR > MAX_HOURLY_BUCKETS) return 'day'
  return wanted
}

/** datetime-local 文本（本地时区）↔ 毫秒；非法返回 null。 */
export function parseLocalDateTime(text) {
  if (typeof text !== 'string' || !text) return null
  const ms = new Date(text).getTime()
  return Number.isFinite(ms) ? ms : null
}
export function toLocalDateTime(ms) {
  const date = new Date(ms)
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/**
 * 页面筛选 → RPC 参数；空值不发。
 * filter: { range: 'today'|'7d'|'30d'|'custom', customSince?, customUntil? (毫秒), bucket: 'auto'|'hour'|'day', session?: string }
 * 自定义范围不合法（缺失 / 反向）时返回 { error } 由页面提示。
 */
export function buildUsageInput(filter, now = Date.now()) {
  const choice = filter?.range ?? '7d'
  let range
  if (choice === 'custom') {
    const since = filter.customSince
    const until = filter.customUntil
    if (!Number.isFinite(since) || !Number.isFinite(until) || since >= until) return { error: 'range' }
    range = { since, until }
  } else {
    range = rangeFor(choice, now)
  }
  const input = { since: range.since, until: range.until, bucket: resolveBucket(filter?.bucket, range) }
  const session = typeof filter?.session === 'string' ? filter.session.trim() : ''
  if (session) input.session = session
  return { input }
}

export function isPermissionDenied(error) {
  return Boolean(error) && (error.status === 401 || error.status === 403)
}

/** 柱子横轴标签：小时粒度显示「月/日 时」，天粒度显示「月/日」。 */
export function formatBucketLabel(ms, bucket, locale = 'zh-CN') {
  const date = new Date(ms)
  return bucket === 'hour'
    ? new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric', hour: 'numeric', hour12: false }).format(date)
    : new Intl.DateTimeFormat(locale, { month: 'numeric', day: 'numeric' }).format(date)
}
