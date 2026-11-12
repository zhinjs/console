/**
 * Scope filter parameters shared by the record pages (运行日志、决策回放、Token 用量、聊天记录):
 * `adapter`, `endpoint`, `conversation` (`<kind>:<id>`, encoded like the object tree's conversation
 * segment). A lower parameter without its parent is ignored together with the whole group.
 */
const KINDS = ['private', 'group', 'channel']

/** `path` with the scope's filter parameters (全局: none). Existing query text in `path` is kept. */
export function scopeFilterHref(path, scope) {
  const [base, search = ''] = String(path).split('?')
  const params = new URLSearchParams(search)
  for (const key of ['adapter', 'endpoint', 'conversation']) params.delete(key)
  if (scope?.adapter) {
    params.set('adapter', scope.adapter)
    if (scope.endpoint) {
      params.set('endpoint', scope.endpoint)
      if (scope.kind && scope.id) params.set('conversation', `${scope.kind}:${scope.id}`)
    }
  }
  const text = params.toString()
  return text ? `${base}?${text}` : base
}

/** The scope named by those parameters, or null (missing parent, malformed conversation). */
export function readScopeFilterParams(params) {
  const get = key => (typeof params?.get === 'function' ? params.get(key)?.trim() ?? '' : '')
  const adapter = get('adapter'), endpoint = get('endpoint'), conversation = get('conversation')
  if (!adapter) return null
  if (!endpoint) return conversation ? null : { level: 'adapter', adapter }
  if (!conversation) return { level: 'endpoint', adapter, endpoint }
  const split = conversation.indexOf(':')
  const kind = conversation.slice(0, split), id = conversation.slice(split + 1)
  if (split <= 0 || !KINDS.includes(kind) || !id) return null
  return { level: 'conversation', adapter, endpoint, kind, id }
}
