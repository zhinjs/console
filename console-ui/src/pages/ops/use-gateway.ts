import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { apiFetch } from '../../utils/auth'
import { getConsoleTransport } from '../../utils/console-client'
import { startVisiblePolling } from '../../hooks/visible-polling.mjs'
import { GATEWAY_PACKAGES_PROGRESS, gatewayErrorKind, gatewayRequestBody, readGatewayReply, type GatewayErrorKind } from './gateway-model.mjs'

type Translate = (message: string, values?: readonly unknown[]) => string

let requestSequence = 0

/** One gateway RPC (ADR 0054). Rejects with `GatewayRequestError` (Host code kept). */
export async function gatewayRequest<T = unknown>(type: string, data: Record<string, unknown>, t: Translate): Promise<T> {
  const response = await apiFetch('/api/console/request', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(gatewayRequestBody(type, data, ++requestSequence)),
  })
  let json: unknown = null
  try { json = await response.json() } catch { json = null }
  return readGatewayReply(response.status, json, t) as T
}

export interface GatewayReadState<T> {
  data: T
  loading: boolean
  loaded: boolean
  error: string | null
  errorKind: GatewayErrorKind | null
  refresh: () => void
  /** Replace the data without a request (e.g. the status a lifecycle RPC returned). */
  set: (data: T) => void
}

/**
 * Loads one gateway read, optionally polling while the tab is visible. A failed refresh keeps
 * the last good data. `merge` folds a reply into the current data (default: replace).
 */
export function useGatewayRead<T>(
  type: string,
  read: (payload: unknown, previous: T) => T,
  initial: T,
  options: { payload?: Record<string, unknown>; pollMs?: number; enabled?: boolean } = {},
): GatewayReadState<T> {
  const i18n = useI18n()
  const [state, setState] = useState<Omit<GatewayReadState<T>, 'refresh' | 'set'>>({ data: initial, loading: true, loaded: false, error: null, errorKind: null })
  const sequence = useRef(0)
  const readRef = useRef(read)
  readRef.current = read
  const key = JSON.stringify(options.payload ?? {})
  const enabled = options.enabled !== false
  const load = useCallback(() => {
    const request = ++sequence.current
    setState(previous => ({ ...previous, loading: true }))
    gatewayRequest<unknown>(type, JSON.parse(key) as Record<string, unknown>, i18n.t).then(reply => {
      if (request !== sequence.current) return
      setState(previous => ({ data: readRef.current(reply, previous.data), loading: false, loaded: true, error: null, errorKind: null }))
    }, (error: unknown) => {
      if (request !== sequence.current) return
      setState(previous => ({ ...previous, loading: false, error: error instanceof Error ? error.message : String(error), errorKind: gatewayErrorKind(error) }))
    })
  }, [type, key, i18n])
  const unsupported = state.errorKind === 'unsupported' || state.errorKind === 'forbidden'
  useEffect(() => {
    if (!enabled) return
    load()
    return () => { sequence.current += 1 }
  }, [load, enabled])
  useEffect(() => {
    // An old gateway or a missing permission will not change by asking again.
    if (!enabled || !options.pollMs || unsupported) return
    return startVisiblePolling(load, options.pollMs)
  }, [load, enabled, options.pollMs, unsupported])
  const set = useCallback((data: T) => setState(previous => ({ ...previous, data, loaded: true, error: null, errorKind: null })), [])
  return { ...state, refresh: load, set }
}

/** `gateway.packages.progress` events from the Console event stream. */
export function subscribePackageProgress(listener: (event: unknown) => void): () => void {
  return getConsoleTransport().onConsoleEvent(GATEWAY_PACKAGES_PROGRESS, envelope => listener(envelope.data))
}
