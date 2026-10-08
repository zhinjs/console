export function endpointAddress(adapter: string, endpointKey: string): { adapter: string; endpointKey: string }
export function requestApproval(adapter: string, endpointKey: string, platformRequestId: string): { adapter: string; endpointKey: string; platformRequestId: string }
export function consumedRows(id: number): { rowIds: number[] }
export function canShowReadEmpty(loading: boolean, error: string | null): boolean
