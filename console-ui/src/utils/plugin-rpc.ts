import { apiFetch, type ApiRequestContext } from './auth'

/** Error from a plugin Console RPC; `message` is safe to show, `code` is stable. */
export class PluginRpcError extends Error {
  readonly code: string
  readonly status: number

  constructor(message: string, code: string, status: number) {
    super(message)
    this.name = 'PluginRpcError'
    this.code = code
    this.status = status
  }
}

type PluginRpcResponseBody<T> = { success?: boolean; data?: T; error?: string; code?: string }

/**
 * Calls a plugin-registered Console RPC (`plugin.<pluginId>.<method>`, zhinjs/zhin#970).
 * Same wire shape as `pluginRpc` in `@zhin.js/client`; kept here until the site moves to a
 * client release that exports it. Host-owned status lives under the root PluginId, e.g.
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
