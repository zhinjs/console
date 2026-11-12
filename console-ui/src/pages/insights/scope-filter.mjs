/**
 * 范围过滤：运行日志、决策回放、Token 用量和群聊插话从 URL 读取同一组范围参数
 * （`adapter`、`endpoint`、`conversation`，与「记录」页签约定）。`conversation` 是会话段
 * `<kind>:<id>`（URLSearchParams 已解码一次）。纯函数：不读时钟、不发请求。
 */
import { parseScopeParams, scopeHref, scopeIdentity, scopeLevel } from '../../scope/scope-tree.mjs'

export const SCOPE_FILTER_PARAMS = Object.freeze(['adapter', 'endpoint', 'conversation'])

const text = value => typeof value === 'string' ? value.trim() : ''

/**
 * `{ active, scope, identity, invalid? }`。`conversation` 不是 `<kind>:<id>` 时退回到它的账号，
 * `invalid` 带原始段，页面据此提示；缺少上级（只有 endpoint 没有 adapter）时整组忽略。
 */
export function readScopeFilter(params) {
  const get = name => text(params?.get?.(name))
  const adapter = get('adapter')
  const endpoint = adapter ? get('endpoint') : ''
  const conversation = endpoint ? get('conversation') : ''
  const parsed = parseScopeParams({ adapter, endpoint, conversation })
  const scope = parsed.scope
  const active = scopeLevel(scope) !== 'global'
  return {
    active,
    scope,
    identity: active ? scopeIdentity(scope) : '',
    ...(parsed.ok ? {} : { invalid: parsed.segment }),
  }
}

/** URL 参数形式的范围（只写有值的层级）。 */
export function scopeFilterParams(scope) {
  const params = new URLSearchParams()
  const level = scopeLevel(scope)
  if (level === 'global') return params
  params.set('adapter', scope.adapter)
  if (level === 'endpoint' || level === 'conversation') params.set('endpoint', scope.endpoint)
  if (level === 'conversation') params.set('conversation', `${scope.kind}:${scope.id}`)
  return params
}

/** `path` 加上范围参数与额外参数；给对象页和首页指标生成带范围的入口。 */
export function scopeFilterHref(path, scope, extra) {
  const params = scopeFilterParams(scope)
  for (const [key, value] of Object.entries(extra ?? {})) if (value !== undefined && value !== null && value !== '') params.set(key, String(value))
  const search = params.toString()
  return search ? `${path}?${search}` : path
}

/** 去掉范围参数（保留其他查询参数）。 */
export function clearScopeFilter(params) {
  const next = new URLSearchParams(params)
  for (const name of SCOPE_FILTER_PARAMS) next.delete(name)
  next.delete('page')
  return next
}

/** 这个范围的对象页（`records` 等页签可选）。 */
export function scopeObjectHref(scope, tab) {
  return scopeHref(scope, tab)
}

/**
 * 运行日志没有结构化的适配器 / 账号 / 会话字段，只能按文本匹配：范围里每一层的标识都要出现在
 * 日志的消息、名称或来源里。返回从具体到概括的标识。
 */
export function logScopeTokens(scope) {
  const level = scopeLevel(scope)
  if (level === 'global') return []
  const tokens = []
  if (level === 'conversation') tokens.push(scope.id)
  if (level === 'endpoint' || level === 'conversation') tokens.push(scope.endpoint)
  tokens.push(scope.adapter)
  return tokens
}

/** Host 只接受一个文本条件 `q`：用户输入优先，否则用范围里最具体的标识。 */
export function logServerQuery(userQuery, scope) {
  const typed = text(userQuery)
  return typed || logScopeTokens(scope)[0] || ''
}

/** 一条日志是否落在范围内（全部标识都出现，不区分大小写）。 */
export function matchesLogScope(entry, tokens) {
  if (!tokens?.length) return true
  const haystack = ['message', 'name', 'source'].map(key => String(entry?.[key] ?? '')).join('\u0000').toLowerCase()
  return tokens.every(token => haystack.includes(String(token).toLowerCase()))
}

/** 决策回放的筛选：`platform` 是适配器，`sceneId` 与会话段同口径 `<kind>:<id>`。账号层没有对应字段。 */
export function replayScopeFilter(scope) {
  const level = scopeLevel(scope)
  if (level === 'global') return {}
  return {
    platform: scope.adapter,
    ...(level === 'conversation' ? { sceneId: `${scope.kind}:${scope.id}` } : {}),
  }
}

/** 决策回放无法按账号过滤：范围是账号或会话时，账号层只能靠会话段近似。 */
export function replayScopeApproximate(scope) {
  return scopeLevel(scope) === 'endpoint'
}

/** Token 用量的会话条件：会话键 `<adapter>:<endpoint>:<kind>:<id>`，上级层用 `*` 通配。 */
export function usageSessionPattern(scope) {
  const level = scopeLevel(scope)
  if (level === 'global') return ''
  if (level === 'adapter') return `${scope.adapter}:*`
  if (level === 'endpoint') return `${scope.adapter}:${scope.endpoint}:*`
  return `${scope.adapter}:${scope.endpoint}:${scope.kind}:${scope.id}`
}

/** 群聊插话的群键 `<adapter>:<群号>`；只有群聊会话有。 */
export function ambientGroupKey(scope) {
  return scopeLevel(scope) === 'conversation' && scope.kind === 'group' ? `${scope.adapter}:${scope.id}` : null
}

/** 群聊插话页预选这个群的入口（会话对象页用）；不是群聊时返回 null。 */
export function ambientSettingsHref(scope) {
  return ambientGroupKey(scope) ? scopeFilterHref('/features/ai/ambient', scope) : null
}
