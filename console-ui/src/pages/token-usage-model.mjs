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

/** Series / colour key of a model row; a row already merged under a display label (provider '') is keyed by that label. */
export function modelKey(provider, model) {
  return provider ? `${provider}/${model}` : model
}

const label = value => (typeof value === 'string' && value.trim() ? value.trim() : '')

/** `services:` / `accounts:` / `profiles:` ids are opaque (a UUID behind them): never a name to show. */
const OPAQUE_ID = /(?:^|[\s(（·])(?:services|accounts|profiles):/u
export function isOpaqueProviderId(provider) {
  return typeof provider === 'string' && /^(?:services|accounts|profiles):/u.test(provider)
}
function hasOpaqueId(text) {
  return OPAQUE_ID.test(text)
}

/**
 * Service name of a byModel row / prompt-cache hint: the Host's `providerLabel` (or `label` on a
 * hint), else the provider id when it is a readable driver name (`deepseek`), else 「未知服务」.
 */
export function usageProviderLabel(row, locale = 'zh-CN') {
  const own = label(row?.providerLabel) || label(row?.serviceLabel)
  if (own && !hasOpaqueId(own)) return own
  const provider = label(row?.provider)
  return provider && provider !== 'unknown' && !isOpaqueProviderId(provider) ? provider : translate(locale, '未知服务')
}

/**
 * Display name of a byModel row, from what the Host sends (zhinjs/zhin `plugin.root.usage-stats`):
 * `displayName` (「服务名 · 模型」), else `modelLabels["<provider>/<model>"]`, else `providerLabel` +
 * model; older field names `label` / `serviceLabel` + `modelLabel` are still read. A name that is only
 * the model (the Host could not resolve the service) or carries an opaque `services:<uuid>` id becomes
 * 「未知服务 · 模型」: the raw id is never the main name.
 */
export function usageModelLabel(row, modelLabels, locale = 'zh-CN') {
  if (!row) return ''
  const model = label(row.modelLabel) || label(row.model)
  const labels = isPlainObject(modelLabels) ? modelLabels : null
  const candidates = [
    label(row.displayName),
    labels ? label(labels[modelKey(row.provider, row.model)]) : '',
    label(row.label),
  ]
  for (const name of candidates) {
    if (!name || hasOpaqueId(name)) continue
    // Just the model: the Host had no service name for an opaque or unknown provider.
    if (name === label(row.model) && !label(row.providerLabel)) break
    return name
  }
  return `${usageProviderLabel(row, locale)} · ${model}`
}

/** A raw series key (`<provider>/<model>`) the byModel rows do not explain: named without its opaque id. */
function seriesKeyLabel(key, modelLabels, locale) {
  const mapped = isPlainObject(modelLabels) ? label(modelLabels[key]) : ''
  if (mapped && !hasOpaqueId(mapped)) return mapped
  const slash = key.indexOf('/')
  // A key without a model part: an opaque id alone is still never a name.
  if (slash <= 0) return isOpaqueProviderId(key) || hasOpaqueId(key) ? translate(locale, '未知服务') : key
  return usageModelLabel({ provider: key.slice(0, slash), model: key.slice(slash + 1) }, modelLabels, locale)
}

/** Service part of a stray series key (one no byModel row explains). */
function seriesKeyService(key, modelLabels, locale) {
  const slash = key.indexOf('/')
  if (slash <= 0) return translate(locale, '未知服务')
  const mapped = isPlainObject(modelLabels) ? label(modelLabels[key]) : ''
  const dot = mapped && !hasOpaqueId(mapped) ? mapped.indexOf(' · ') : -1
  return dot > 0 ? mapped.slice(0, dot) : usageProviderLabel({ provider: key.slice(0, slash) }, locale)
}

const TOKEN_SUM_KEYS = ['calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens']

/**
 * One row per display name (`usageModelLabel`): the same model reached as `services:<id>` and
 * `accounts:<id>`, or two ids of a service with one name, become one row; `series[].byModel` is
 * re-keyed to match. Two services with one name but different Drivers (`driverLabel`, zhin 第 58 批)
 * stay apart and carry the Driver in their name. Merged rows keep their raw keys (`rawKeys`) and
 * recorded provider ids (`providerIds`) for the detail view, plus `serviceName` / `modelName` for the
 * service → model table; the main view only shows `model` (the display name). `modelServices` maps
 * every series key to its service name (the 「按服务」 trend).
 */
export function mergeUsageModels(stats, locale = 'zh-CN') {
  if (!stats || !Array.isArray(stats.byModel)) return stats
  const modelLabels = stats.modelLabels
  // Display names shared by services of different Drivers get the Driver as a qualifier.
  const drivers = new Map()
  for (const row of stats.byModel) {
    const display = usageModelLabel(row, modelLabels, locale)
    const set = drivers.get(display) ?? new Set()
    set.add(label(row.driverLabel))
    drivers.set(display, set)
  }
  const rename = new Map()
  const merged = new Map()
  const modelServices = {}
  for (const row of stats.byModel) {
    const raw = modelKey(row.provider, row.model)
    const base = usageModelLabel(row, modelLabels, locale)
    const driver = label(row.driverLabel)
    const split = (drivers.get(base)?.size ?? 0) > 1 && driver
    // 「服务（驱动）」 in Chinese, 「Service (Driver)」 in English.
    const service = split ? translate(locale, '{0}（{1}）', [usageProviderLabel(row, locale), driver]) : usageProviderLabel(row, locale)
    const modelName = label(row.modelLabel) || label(row.model)
    const display = split ? `${service} · ${modelName}` : base
    rename.set(raw, display)
    modelServices[display] = service
    const ids = Array.isArray(row.providerIds) && row.providerIds.length ? row.providerIds.filter(id => typeof id === 'string') : [row.provider].filter(Boolean)
    const into = merged.get(display)
    if (!into) {
      merged.set(display, { ...row, provider: '', model: display, displayName: display, serviceName: service, modelName, rawKeys: [raw], providerIds: [...new Set(ids)] })
      continue
    }
    for (const field of TOKEN_SUM_KEYS) {
      if (typeof row[field] === 'number' || typeof into[field] === 'number') into[field] = (into[field] ?? 0) + (row[field] ?? 0)
    }
    if (typeof row.claimsWithoutToolCall === 'number') into.claimsWithoutToolCall = (into.claimsWithoutToolCall ?? 0) + row.claimsWithoutToolCall
    // A Profile name only describes the merged row while every part ran on the same one.
    if (label(into.profileName) !== label(row.profileName)) { delete into.profileName; delete into.profileId }
    into.rawKeys = [...into.rawKeys, raw]
    into.providerIds = [...new Set([...into.providerIds, ...ids])]
    // A per-row cache share cannot be summed; recompute from the merged counts.
    delete into.cacheShare
  }
  const series = stats.series.map(point => {
    const byModel = {}
    for (const [key, value] of Object.entries(point.byModel)) {
      let target = rename.get(key)
      if (!target) {
        target = seriesKeyLabel(key, modelLabels, locale)
        modelServices[target] ??= seriesKeyService(key, modelLabels, locale)
      }
      byModel[target] = (byModel[target] ?? 0) + value
    }
    return { ...point, byModel }
  })
  return { ...stats, byModel: [...merged.values()].sort((a, b) => b.inputTokens - a.inputTokens), series, modelServices }
}

/**
 * The Profile name a model row shows next to its model, or '' (no subtitle): the Host leaves
 * `profileName` out when calls of the row ran on different or unknown Profiles, and an opaque id is
 * never a name.
 */
export function usageProfileName(row) {
  const name = label(row?.profileName)
  return name && !hasOpaqueId(name) && !isOpaqueProviderId(name) && name !== label(row?.modelName) ? name : ''
}

/** Raw ids behind a (merged) model row, for the hover / detail view: merge keys, then recorded provider ids. */
export function usageModelIds(row) {
  return usageModelIdGroups(row).flatMap(group => group.ids)
}

/**
 * The same ids in two groups, so a count next to them always matches what is listed: `keys` — the
 * `<provider>/<model>` statistics keys merged into the row; `services` — the recorded service /
 * account ids. An id appears once.
 */
export function usageModelIdGroups(row) {
  const valid = list => (Array.isArray(list) ? list : []).filter(id => typeof id === 'string' && id)
  const keys = [...new Set(valid(row?.rawKeys).length ? valid(row.rawKeys) : row ? [modelKey(row.provider, row.model)].filter(Boolean) : [])]
  const services = [...new Set(valid(row?.providerIds))].filter(id => !keys.includes(id))
  return [{ kind: 'keys', ids: keys }, { kind: 'services', ids: services }].filter(group => group.ids.length)
}

const SCOPE_NAMES = Object.freeze({ group: '群', private: '私聊', direct: '私聊', channel: '频道', guild: '频道' })
const HASHED_KEY = /^([a-z][a-z-]*):v\d+:([0-9a-f]{16,})$/u
const HASHED_NAMES = Object.freeze({ 'personal-session': '私聊会话', 'scene-task': '场景任务' })
/** Origins that are not an IM conversation (`bySession[].scopeKind`, zhin 第 58 批). */
const ORIGIN_NAMES = Object.freeze({ http: 'HTTP', a2a: 'A2A', mcp: 'MCP' })
/**
 * 「平台 · 群 名称」 as an older Host writes `displayName` (the name may be missing: 「平台 · 群」): the
 * type word is Chinese whatever the UI language.
 */
const CHINESE_SCOPE_LABEL = /^(.+?) · (群|私聊|频道)(?: (.+))?$/u
const CHINESE_SCOPE_KINDS = Object.freeze({ 群: 'group', 私聊: 'private', 频道: 'channel' })
/** 「定时任务 名称」/「内部任务 名称」/「内部 名称」 of an older Host, the name optional. */
const CHINESE_TASK_LABEL = /^(定时任务|内部任务|内部)(?: (.+))?$/u
const CHINESE_TASK_MESSAGES = Object.freeze({ 定时任务: '定时任务 {0}', 内部任务: '内部任务 {0}', 内部: '内部任务 {0}' })

/** Long keys keep their head and tail: `abcdefghij…uvwxyz`. */
function middleEllipsis(text, max = 32) {
  return text.length <= max ? text : `${text.slice(0, Math.ceil((max - 1) / 2))}…${text.slice(-Math.floor((max - 1) / 2))}`
}

function scopeWord(scope, locale) {
  return SCOPE_NAMES[scope] ? translate(locale, SCOPE_NAMES[scope]) : scope
}

/**
 * Platform of a session row: the Host's `platform` (zhin 第 58 批 sends it for hashed keys too, from
 * the recorded origin), else the first part of a `platform:endpoint:scope:sceneId` key.
 */
function sessionPlatform(row) {
  return label(splitSessionKey(row).platform)
}

/** 「#前 8 位」 of a hashed key, '' for other keys. */
function hashedTag(row) {
  const hashed = HASHED_KEY.exec(String(row?.sessionKey ?? ''))
  return hashed ? `#${hashed[2].slice(0, 8)}` : ''
}

/** 「平台 · 名称」, or just the name without a platform. */
function withPlatform(platform, body) {
  return platform ? `${platform} · ${body}` : body
}

/** 「平台 · 类型 名称」 from `scopeKind` / `sceneLabel` (zhin 第 58 批), in the UI language. */
function sessionLabelFromParts(row, locale) {
  const kind = label(row?.scopeKind)
  if (!kind) return ''
  const scene = label(row.sceneLabel)
  if (ORIGIN_NAMES[kind]) return scene ? `${ORIGIN_NAMES[kind]} · ${scene}` : ORIGIN_NAMES[kind]
  if (kind === 'schedule') return translate(locale, '定时任务 {0}', [scene]).trim()
  if (kind === 'internal') return translate(locale, '内部任务 {0}', [scene]).trim()
  // A hashed key carries no scene id: its short hash tells it apart instead of the raw key.
  const name = scene || hashedTag(row) || middleEllipsis(splitSessionKey(row).sceneId)
  return withPlatform(sessionPlatform(row), `${scopeWord(kind, locale)} ${name}`.trim())
}

/**
 * The name a session row shows: 「平台 · 类型 名称」 from `scopeKind` / `sceneLabel` in the UI language
 * when the Host sends them (zhin 第 58 批), else the Host's `displayName` (`label` / `name` from older
 * shapes; its Chinese type word is translated), else 「平台 · 类型 sceneId」 from a
 * `platform:endpoint:scope:sceneId` key, else 「平台 · 私聊会话 #前 8 位」 for a hashed key
 * (`personal-session:v1:<sha>`; the platform from `bySession[].platform`, left out when the Host has
 * none), 「定时任务 …」 for `schedule:…`, else the key shortened in the middle. The platform always
 * comes from `bySession[].platform` first, the key only when the Host sends none.
 * The full key belongs in a tooltip / detail, never in the main view.
 */
export function usageSessionLabel(row, locale = 'zh-CN') {
  const fromParts = sessionLabelFromParts(row, locale)
  if (fromParts) return fromParts
  const own = label(row?.displayName) || label(row?.label) || label(row?.name)
  if (own) {
    const chinese = CHINESE_SCOPE_LABEL.exec(own)
    if (chinese) return `${chinese[1]} · ${`${scopeWord(CHINESE_SCOPE_KINDS[chinese[2]], locale)} ${chinese[3] ?? ''}`.trim()}`
    const task = CHINESE_TASK_LABEL.exec(own)
    if (task) return translate(locale, CHINESE_TASK_MESSAGES[task[1]], [task[2] ?? '']).trim()
    return own
  }
  const key = String(row?.sessionKey ?? '')
  const hashed = HASHED_KEY.exec(key)
  if (hashed) return withPlatform(sessionPlatform(row), `${translate(locale, HASHED_NAMES[hashed[1]] ?? '会话')} #${hashed[2].slice(0, 8)}`)
  if (key.startsWith('schedule:') && key.length > 9) return translate(locale, '定时任务 {0}', [middleEllipsis(key.slice(9))])
  const parts = splitSessionKey(row)
  if (parts.platform && parts.scope) return `${parts.platform} · ${scopeWord(parts.scope, locale)} ${middleEllipsis(parts.sceneId)}`.trim()
  return middleEllipsis(key)
}

/**
 * Short key of a session row for its tooltip / detail (never a name qualifier): the Host's `shortKey` (zhin 第 58 批), else the
 * first 8 hex digits of a hashed key, else the key shortened in the middle.
 */
export function usageSessionShortKey(row) {
  const own = label(row?.shortKey)
  const key = String(row?.sessionKey ?? '')
  if (own) return middleEllipsis(own, 24)
  const hashed = HASHED_KEY.exec(key)
  return hashed ? `${hashed[1]}:${hashed[2].slice(0, 8)}` : middleEllipsis(key, 24)
}

/** The account's display name (`accountLabel`) when it is a real name: never an opaque id or the raw endpoint. */
function readableAccountName(row) {
  const own = label(row?.accountLabel)
  if (!own || hasOpaqueId(own) || isOpaqueProviderId(own)) return ''
  const parts = splitSessionKey(row ?? {})
  return own === label(parts.endpoint) || own === label(row?.shortKey) || own === label(row?.sessionKey) ? '' : own
}

/**
 * Names of a list of session rows: `name` per row, and `qualifier` (shown greyed out after the name —
 * on phones too, not only in a tooltip) for every row whose name another row of the list shares
 * (several HTTP sessions, groups with one name on different accounts). The qualifier is readable:
 * the account's display name (`accountLabel`) when it tells the row apart, else its position among
 * the rows of that name (「#1」/「#2」, in list order — the Host sends them by usage). Raw keys,
 * short keys and endpoints never become a qualifier: they belong in the tooltip and the Sheet.
 */
export function usageSessionNames(rows, locale = 'zh-CN') {
  const names = new Map()
  const byName = new Map()
  for (const row of rows ?? []) {
    const name = usageSessionLabel(row, locale)
    names.set(row.sessionKey, name)
    byName.set(name, [...(byName.get(name) ?? []), row])
  }
  const qualifiers = new Map()
  for (const group of byName.values()) {
    if (group.length < 2) continue
    const accounts = group.map(readableAccountName)
    const uses = new Map()
    for (const account of accounts) if (account) uses.set(account, (uses.get(account) ?? 0) + 1)
    group.forEach((row, index) => {
      const account = accounts[index]
      qualifiers.set(row.sessionKey, account && uses.get(account) === 1 ? account : translate(locale, '#{0}', [index + 1]))
    })
  }
  const result = new Map()
  for (const row of rows ?? []) result.set(row.sessionKey, { name: names.get(row.sessionKey), qualifier: qualifiers.get(row.sessionKey) ?? '' })
  return result
}

/**
 * The account of a session row: the Host's `accountLabel`, else the recorded endpoint (the Host leaves
 * the label out when the account's name is just its endpoint id or several platforms share it), else
 * ''. An opaque id is never shown as the name.
 */
export function usageAccountLabel(row) {
  const own = label(row?.accountLabel)
  if (own && !hasOpaqueId(own) && !isOpaqueProviderId(own)) return own
  const endpoint = label(splitSessionKey(row ?? {}).endpoint)
  return endpoint && !isOpaqueProviderId(endpoint) ? endpoint : ''
}

// 分类色来自 theme-tokens.css 的 --chart-1..8，随亮 / 暗主题切换。
export const MODEL_PALETTE = Object.freeze([
  'hsl(var(--chart-1))', 'hsl(var(--chart-2))', 'hsl(var(--chart-3))', 'hsl(var(--chart-4))',
  'hsl(var(--chart-5))', 'hsl(var(--chart-6))', 'hsl(var(--chart-7))', 'hsl(var(--chart-8))',
])
export const OTHER_COLOR = 'hsl(var(--chart-other))'

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
 * 拆 sessionKey：真实格式是 `platform:endpoint:scope:sceneId`（sceneId 里允许再有冒号）。
 * 优先用 Host 给的 platform / endpoint / scope / sceneId；缺失时按上面拆，
 * 少于 4 段（如 `schedule:assistant-profile-weatherReport`）不猜，整条 key 当作会话 ID 显示。
 */
export function splitSessionKey(row) {
  const parts = String(row.sessionKey).split(':')
  const fallback = parts.length >= 4
    ? { platform: parts[0], endpoint: parts[1], scope: parts[2], sceneId: parts.slice(3).join(':') }
    : { platform: '', endpoint: '', scope: '', sceneId: row.sessionKey }
  return {
    sessionKey: row.sessionKey,
    platform: row.platform || fallback.platform,
    endpoint: row.endpoint || fallback.endpoint,
    scope: row.scope || fallback.scope,
    sceneId: row.sceneId || fallback.sceneId,
  }
}

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

/**
 * Prompt-cache notes of the usage page (zhinjs/zhin#1250 `usage-cache-unsupported-hint`), from the
 * Host's `promptCacheHints`: one line per service that likely does not support or pass through
 * prompt caching (a long run of calls without a cache read while adjacent requests shared their
 * prefix), and `missed` when no request of the range read the cache although none is suspect.
 * Null on a Host without `promptCacheHints` (the page then shows what it showed before).
 */
export function promptCacheNotices(stats, locale = 'zh-CN') {
  if (!isPlainObject(stats) || !Array.isArray(stats.promptCacheHints)) return null
  const hints = []
  for (const hint of stats.promptCacheHints) {
    if (!isPlainObject(hint) || typeof hint.provider !== 'string' || !hint.provider) continue
    if (!isCount(hint.zeroCacheCalls) || !isCount(hint.sessions)) continue
    const ratio = typeof hint.samePrefixRatio === 'number' && Number.isFinite(hint.samePrefixRatio) ? hint.samePrefixRatio : null
    const name = usageProviderLabel({ providerLabel: hint.label, provider: hint.provider }, locale)
    hints.push({
      key: hint.provider,
      name,
      text: ratio === null
        ? translate(locale, '{0}：最近连续 {1} 次请求（{2} 个会话）没有命中提示缓存，该服务可能不支持或没有透传提示缓存。', [name, hint.zeroCacheCalls, hint.sessions])
        : translate(locale, '{0}：最近连续 {1} 次请求（{2} 个会话）没有命中提示缓存，而相邻请求有 {3} 的前缀相同——该服务可能不支持或没有透传提示缓存。',
          [name, hint.zeroCacheCalls, hint.sessions, formatPercent(ratio, locale)]),
    })
  }
  const totals = stats.totals
  const missed = !hints.length && isPlainObject(totals) && totals.calls > 0 && totals.inputTokens > 0 && totals.cacheReadTokens === 0
  return { hints, missed }
}

// ── 第 59 批：版面重排（汇总环比、服务 → 模型、Agent / 用途维度）────────────────────────────────
// zhin 第 58 批起 Host 多发一些可选字段（`schemaVersion: 2`）；下面的函数只在字段存在且形状正确时用它们，
// 旧 Host 的返回照常显示（隐藏对应页签 / 由 Console 自己再请求一次上一周期）。

/** 「输入 + 输出」：汇总卡的总 tokens。 */
export function totalTokens(row) {
  return (isCount(row?.inputTokens) ? row.inputTokens : 0) + (isCount(row?.outputTokens) ? row.outputTokens : 0)
}

function isTokenRow(row) {
  return isPlainObject(row) && TOKEN_KEYS.every(key => isCount(row[key]))
}

/**
 * The window right before `input`, as long as it: what the Console asks for when the Host sends no
 * usable `previous`. It keeps the main request's `session` and `timeZone` — the request's own zone,
 * else the one the Host answered the main request in (`stats.range.timeZone`) — so both windows are
 * cut the same way.
 */
export function previousUsageInput(input, stats) {
  if (!input || !isCount(input.since) || !isCount(input.until) || input.since >= input.until) return null
  const length = input.until - input.since
  const since = input.since - length
  // A window cut short by the epoch would compare unlike lengths: no previous window then.
  if (since < 0) return null
  const timeZone = label(input.timeZone) || label(stats?.range?.timeZone)
  return { since, until: input.since, bucket: input.bucket, ...(input.session ? { session: input.session } : {}), ...(timeZone ? { timeZone } : {}) }
}

/**
 * Totals of the previous window the Host computed (`compare: 'previous'`, zhin 第 58 批), or null:
 * absent (older Host), malformed, or cut short (`truncated: true` — rare: the Host returns the full
 * previous window of any range up to 31 days, 「近 30 天」 included; a change against a shorter window
 * would mislead).
 */
export function hostPreviousTotals(stats) {
  const previous = stats?.previous
  if (!isPlainObject(previous) || previous.truncated === true) return null
  const totals = previous.totals
  if (!isTokenRow(totals) || !isCount(totals.turns)) return null
  return totals
}

/**
 * Where the summary's 「较上一周期」 comes from: `{ totals }` — the Host's `previous` (no further
 * request); `{ request }` — the RPC input of the previous window, only when the Host sent none (an
 * older Host); `{}` — no change to show: the Host cut its window short (`truncated: true`, only near
 * the epoch — asking again would return the same short window), or no full previous window exists.
 */
export function previousUsagePlan(stats, input) {
  const totals = hostPreviousTotals(stats)
  if (totals) return { totals }
  if (isPlainObject(stats?.previous) && stats.previous.truncated === true) return {}
  const request = previousUsageInput(input, stats)
  return request ? { request } : {}
}

/**
 * Change against the previous window: `{ kind: 'change', ratio }` (+0.12 = 12 % more),
 * `{ kind: 'new' }` when the previous window had nothing, `{ kind: 'same' }` for 0 → 0, null without
 * a previous value. For a ratio (cache hit) pass `points: true`: `ratio` is then the difference in
 * percentage points (0..1 scale).
 */
export function usageDelta(current, previous, { points = false } = {}) {
  if (!Number.isFinite(current) || !Number.isFinite(previous)) return null
  if (points) return { kind: current === previous ? 'same' : 'change', ratio: current - previous }
  if (previous === 0) return current === 0 ? { kind: 'same' } : { kind: 'new' }
  return { kind: current === previous ? 'same' : 'change', ratio: (current - previous) / previous }
}

/** A rise worth a warning colour: tokens / calls at least doubled, or the cache hit rate down 20 points. */
export function isNotableDelta(delta, { points = false } = {}) {
  if (!delta || delta.kind !== 'change') return false
  return points ? delta.ratio <= -0.2 : delta.ratio >= 1
}

/** 「↑12%」/「↓3.2 个百分点」. */
export function formatDelta(delta, locale = 'zh-CN', { points = false } = {}) {
  if (!delta) return ''
  if (delta.kind === 'new') return translate(locale, '上一周期没有用量')
  if (delta.kind === 'same') return translate(locale, '与上一周期持平')
  const arrow = delta.ratio > 0 ? '↑' : '↓'
  const size = Math.abs(delta.ratio)
  if (points) return translate(locale, '{0}{1} 个百分点', [arrow, new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(size * 100)])
  return `${arrow}${new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: size >= 10 ? 0 : 1 }).format(size)}`
}

const AGENT_NAMES = Object.freeze({ '@main': '主助手', '@unrecorded': '未记录' })
const PURPOSE_NAMES = Object.freeze({
  chat: '对话', agent: '子 Agent', summary: '摘要', ambient: '插话判断', 'ambient-judge': '插话判断', perception: '媒体理解',
  intent: '意图识别', inference: '推理', discovery: '发现', approval: '审批', authorization: '授权判断', preparation: '准备', '@unrecorded': '未记录',
})

/** Name of a `byAgent` row in the UI language (the Host's `label` is Chinese for the main assistant). */
export function usageAgentLabel(row, locale = 'zh-CN') {
  const agent = label(row?.agent)
  if (AGENT_NAMES[agent]) return translate(locale, AGENT_NAMES[agent])
  return agent || label(row?.label) || translate(locale, '未记录')
}

/** Name of a `byPurpose` row in the UI language: known purposes translated, others as recorded. */
export function usagePurposeLabel(row, locale = 'zh-CN') {
  const purpose = label(row?.purpose)
  if (PURPOSE_NAMES[purpose]) return translate(locale, PURPOSE_NAMES[purpose])
  return purpose || label(row?.label) || translate(locale, '未记录')
}

/**
 * What this Host sends beyond the base shape (zhin 第 58 批), each checked on its own:
 * `agents` / `purposes` (well-formed rows of `byAgent` / `byPurpose`), `others` (`sessionsTotal` /
 * `othersTotals`). The Host sends no per-bucket Agent split, so the trend has no 「按 Agent」.
 * Malformed optional fields are left out instead of failing the page.
 */
export function usageCapabilities(stats) {
  const rows = (list, key) => Array.isArray(list) ? list.filter(row => isTokenRow(row) && typeof row[key] === 'string' && row[key]) : []
  const agents = rows(stats?.byAgent, 'agent')
  const purposes = rows(stats?.byPurpose, 'purpose')
  const others = isPlainObject(stats?.othersTotals) && isTokenRow(stats.othersTotals) && isCount(stats.othersTotals.sessions) && isCount(stats?.sessionsTotal)
    ? { sessions: stats.othersTotals.sessions, total: stats.sessionsTotal, totals: stats.othersTotals }
    : null
  return { schemaVersion: isCount(stats?.schemaVersion) ? stats.schemaVersion : 1, agents, purposes, others }
}

/**
 * Service → model rows of the 「服务与模型」 table, from merged byModel rows: one group per service
 * (`serviceName`), its models by input, the services by input. `share` is the service's part of all
 * input tokens.
 */
export function usageServiceGroups(byModel, locale = 'zh-CN') {
  const groups = new Map()
  for (const row of byModel ?? []) {
    const name = label(row.serviceName) || usageProviderLabel(row, locale)
    const group = groups.get(name) ?? { key: name, name, models: [], calls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, claimsWithoutToolCall: 0 }
    group.models.push(row)
    for (const field of ['calls', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'claimsWithoutToolCall']) group[field] += isCount(row[field]) ? row[field] : 0
    groups.set(name, group)
  }
  const total = [...groups.values()].reduce((sum, group) => sum + group.inputTokens, 0)
  return [...groups.values()]
    .map(group => ({
      ...group,
      share: total > 0 ? group.inputTokens / total : 0,
      models: group.models.sort((a, b) => b.inputTokens - a.inputTokens),
      driverLabel: [...new Set(group.models.map(row => label(row.driverLabel)).filter(Boolean))].join(' / '),
      providerIds: [...new Set(group.models.flatMap(row => Array.isArray(row.providerIds) ? row.providerIds : []))],
    }))
    .sort((a, b) => b.inputTokens - a.inputTokens || a.name.localeCompare(b.name))
}

/**
 * The trend re-keyed by dimension: `model` (the merged series) or `service` (summed through
 * `modelServices`). Keys are display names.
 */
export function usageTrendSeries(stats, dimension, locale = 'zh-CN') {
  const series = Array.isArray(stats?.series) ? stats.series : []
  if (dimension === 'service') {
    const services = isPlainObject(stats.modelServices) ? stats.modelServices : {}
    return series.map(point => {
      const byModel = {}
      for (const [key, value] of Object.entries(point.byModel)) {
        const service = services[key] ?? translate(locale, '未知服务')
        byModel[service] = (byModel[service] ?? 0) + value
      }
      return { ...point, byModel }
    })
  }
  return series
}

/** Series keys by total, largest first: the legend order and the first `limit` that get their own colour. */
export function topSeriesKeys(series, limit = 6) {
  const totals = new Map()
  for (const point of series ?? []) for (const [key, value] of Object.entries(point.byModel ?? {})) totals.set(key, (totals.get(key) ?? 0) + value)
  return [...totals.entries()].filter(([, value]) => value > 0).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, limit).map(([key]) => key)
}

/** Every key of a (re-keyed) series. */
export function seriesKeys(series) {
  const keys = new Set()
  for (const point of series ?? []) for (const key of Object.keys(point.byModel ?? {})) keys.add(key)
  return [...keys]
}
