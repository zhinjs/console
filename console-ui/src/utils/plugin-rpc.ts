import { PluginRpcError } from '@zhin.js/client'
import { apiFetch, type ApiRequestContext } from './auth'

export { PluginRpcError }

type PluginRpcResponseBody<T> = { success?: boolean; data?: T; error?: string; code?: string }

/**
 * Calls a plugin-registered Console RPC (`plugin.<pluginId>.<method>`, zhinjs/zhin#970).
 * Same wire shape and error as `pluginRpc` in `@zhin.js/client`. This variant stays because the
 * SDK one takes neither an abort signal nor a pinned Host/credential context, which the approval
 * and self-change panels need. Host-owned status lives under the root PluginId, e.g.
 * `pluginRpc('root', 'ambient')`.
 */
export async function pluginRpc<T>(
  pluginId: string,
  method: string,
  data?: Readonly<Record<string, unknown>>,
  options: { readonly signal?: AbortSignal; readonly context?: ApiRequestContext } = {},
): Promise<T> {
  const requestBody = {
    type: `plugin.${pluginId}.${method}`,
    requestId: Date.now(),
    ...(data === undefined ? {} : { data }),
  }
  const response = await apiFetch('/api/console/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
    signal: options.signal,
  }, options.context)
  let body: PluginRpcResponseBody<T> = {}
  try {
    body = await response.json() as PluginRpcResponseBody<T>
  } catch {
    body = {}
  }
  if (!response.ok || !body.success) {
    const message = body.error ?? `HTTP ${response.status}`
    const code = body.code ?? 'failed'
    throw new PluginRpcError(message, code, response.status)
  }
  return body.data as T
}
