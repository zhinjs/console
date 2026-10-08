export function endpointAddress(adapter, endpointKey) { return { adapter, endpointKey } }
export function requestApproval(adapter, endpointKey, platformRequestId) {
  return { ...endpointAddress(adapter, endpointKey), platformRequestId }
}
export function consumedRows(id) { return { rowIds: [id] } }
export function canShowReadEmpty(loading, error) { return !loading && !error }
