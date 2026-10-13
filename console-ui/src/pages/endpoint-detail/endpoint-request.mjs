export function endpointAddress(adapter, endpointKey) { return { adapter, endpointKey } }
export function requestApproval(adapter, endpointKey, platformRequestId) {
  return { ...endpointAddress(adapter, endpointKey), platformRequestId }
}
export function consumedRows(id) { return { rowIds: [id] } }
export function canShowReadEmpty(loading, error) { return !loading && !error }

export function readEndpointIdentity(value) {
  if (!value || typeof value.id !== 'string' || !value.id || typeof value.adapter !== 'string' || !value.adapter) throw new Error('Host 未提供当前 Endpoint 的完整标识')
  return { id: value.id, adapter: value.adapter }
}
