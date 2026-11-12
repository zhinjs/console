import {
  createConsoleApp,
  createConsoleClient,
  type ConsoleClient,
  type ConsoleTransport,
} from '@zhin.js/client'
import { captureApiRequestContext, clearRuntimeToken, clearToken, getApiBase, getToken, observeHostGatewayReply } from './auth'
import { capturingFetch } from './rpc-reply-capture.mjs'

/** Built-in and plugin routes outlive a Host session, so the registry is owned here, not by a client. */
export const app = createConsoleApp()

let client: ConsoleClient | null = null

function runtimeEnv(): 'development' | 'production' {
  return (import.meta as unknown as { env?: { MODE?: string } }).env?.MODE === 'development'
    ? 'development'
    : 'production'
}

/**
 * The transport raises `zhin:auth-required` on a 401 but leaves the credential in place.
 * Drop a rejected credential first (as `apiFetch` does) so the next load does not retry it.
 * Its 502 / 503 / 504 `instance_*` replies reach the 实例不可用 banner like `apiFetch`'s do. RPC replies are
 * also recorded (`capturingFetch`) so `requestConsole` keeps the Host's code and Retry-After the SDK drops.
 */
const transportFetch: typeof fetch = async (input, init) => {
  const { apiBase, token } = captureApiRequestContext()
  const response = await fetch(input, init)
  observeHostGatewayReply(response)
  if (response.status === 401 && token && getApiBase() === apiBase && getToken() === token) {
    clearRuntimeToken()
    clearToken()
  }
  return response
}

/** The client of the current Host session; created and connected on first use. */
export function getConsoleClient(): ConsoleClient {
  if (!client) {
    client = createConsoleClient({ app, getRuntimeEnv: runtimeEnv, transportConfig: { fetch: capturingFetch(transportFetch) } })
    if (typeof window !== 'undefined') client.connect()
  }
  return client
}

/** Transport for code outside React; components under the provider may use the SDK hooks instead. */
export function getConsoleTransport(): ConsoleTransport {
  return getConsoleClient().transport
}

/** Ends the current Host session's transport. The route registry is kept: `client.dispose()` would clear it. */
export function resetConsoleClient(): void {
  client?.transport.dispose()
  client = null
}
