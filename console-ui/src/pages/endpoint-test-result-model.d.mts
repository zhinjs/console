export interface EndpointTestResult {
  ok: boolean
  connected?: boolean
  status?: string
  latencyMs?: number
  message?: string
}
export interface EndpointTestPresentation {
  tone: 'success' | 'error'
  role: 'status' | 'alert'
  label: string
  reason: string | undefined
  latencyText: string | undefined
  detail: string | undefined
}
export function readEndpointTestResult(payload: unknown): EndpointTestResult
export function endpointTestError(message: string): EndpointTestResult
export function endpointTestPresentation(result: EndpointTestResult, locale?: 'zh-CN' | 'en'): EndpointTestPresentation
