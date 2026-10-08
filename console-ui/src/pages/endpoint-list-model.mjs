export function readEndpointList(payload) {
  if (!payload || !Array.isArray(payload.endpoints)) throw new Error('渠道列表响应格式不正确。')
  for (const endpoint of payload.endpoints) {
    if (!endpoint || typeof endpoint.name !== 'string' || !endpoint.name.trim() || typeof endpoint.adapter !== 'string' || !endpoint.adapter.trim() || typeof endpoint.connected !== 'boolean' || !['online', 'offline'].includes(endpoint.status)) throw new Error('渠道信息响应格式不正确。')
    for (const key of ['pendingRequestCount', 'pendingNoticeCount']) {
      if (endpoint[key] !== undefined && (!Number.isSafeInteger(endpoint[key]) || endpoint[key] < 0)) throw new Error('渠道待办数量响应格式不正确。')
    }
  }
  return payload.endpoints
}
