export function historyQuery(params) {
  const positive = (value, fallback) => /^\d+$/.test(value ?? '') && Number(value) > 0 ? Number(value) : fallback
  const level = ['debug', 'info', 'warn', 'error'].includes(params.get('level')) ? params.get('level') : 'all'
  const pageSize = positive(params.get('pageSize'), 100)
  return { page: positive(params.get('page'), 1), pageSize: [50,100,200].includes(pageSize) ? pageSize : 100, level, source: params.get('source') ?? '', q: params.get('q') ?? '' }
}
export function historyParams(query) {
  const params = new URLSearchParams({page:String(query.page),pageSize:String(query.pageSize)})
  if(query.level !== 'all') params.set('level',query.level)
  if(query.source) params.set('source',query.source)
  if(query.q) params.set('q',query.q)
  return params
}
export function changeHistoryFilter(params, name, value) {
  const next = new URLSearchParams(params)
  if(value && value !== 'all') next.set(name,String(value)); else next.delete(name)
  next.delete('page')
  return next
}
export function validateHistoryResponse(payload) {
  if (payload?.success && Array.isArray(payload.data)
    && ['page','pageSize','totalPages','sources'].some(key => !(key in payload))) throw new Error('Host 不支持日志历史分页')
  if (!payload?.success || !Array.isArray(payload.data) || !Array.isArray(payload.sources)
    || !Number.isInteger(payload.total) || payload.total < 0
    || !Number.isInteger(payload.page) || payload.page < 1
    || !Number.isInteger(payload.pageSize) || payload.pageSize < 1
    || !Number.isInteger(payload.totalPages) || payload.totalPages < 1
    || payload.data.some(row => row.id == null || typeof row.message !== 'string' || typeof row.source !== 'string' || typeof row.level !== 'string' || typeof row.timestamp !== 'string')
    || payload.sources.some(row => typeof row.source !== 'string' || !Number.isInteger(row.count) || row.count < 0)) throw new Error('日志历史分页响应无效')
  return payload
}
export function selectedHistoryEntry(rows, selected) {
  if (selected) return rows.find(row => String(row.id) === String(selected.id)) ?? selected
  return rows[0] ?? null
}

export function isCurrentHistoryRequest(current,controller,key) {
  return !controller.signal.aborted && current?.controller === controller && current.key === key
}
