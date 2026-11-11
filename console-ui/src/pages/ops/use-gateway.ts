import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../../i18n'
import { apiFetch } from '../../utils/auth'
import { getConsoleTransport } from '../../utils/console-client'
import { startVisiblePolling } from '../../hooks/visible-polling.mjs'
import {
  EMPTY_PROGRESS, GATEWAY_PACKAGES_PROGRESS, GatewayRequestError, gatewayErrorKind, gatewayRequestBody, readGatewayReply, readTransactionResult,
  reducePackageProgress, type GatewayErrorKind, type PackageProgressState,
} from './gateway-model.mjs'

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

type TransactionResult = NonNullable<PackageProgressState['result']>

export interface GatewayTransactionOutcome {
  readonly result: TransactionResult | null
  /** The request failure, when the gateway refused or the call failed. */
  readonly error: unknown
}

/**
 * Runs one gateway transaction (`gateway.packages.install|uninstall|update`,
 * `gateway.plugins.declare`) and folds its `gateway.packages.progress` events. With
 * `keepInvalidInput`, a 400 `invalid_input` refusal (nothing was touched) is returned to the
 * caller only, so a form can show it inline.
 */
export function useGatewayTransaction() {
  const i18n = useI18n()
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<PackageProgressState>(EMPTY_PROGRESS)
  const [error, setError] = useState<string | null>(null)
  const active = useRef(false)
  const run = useCallback(async (type: string, data: Record<string, unknown>, options: { keepInvalidInput?: boolean } = {}): Promise<GatewayTransactionOutcome> => {
    if (active.current) return { result: null, error: new GatewayRequestError(i18n.t('另一个依赖事务正在进行，请等待它结束'), { status: 409, code: 'conflict' }) }
    active.current = true
    setRunning(true)
    setError(null)
    setProgress(EMPTY_PROGRESS)
    // Subscribe before sending, so the first events are not missed.
    const unsubscribe = subscribePackageProgress(event => setProgress(previous => reducePackageProgress(previous, event)))
    try {
      const result = readTransactionResult(await gatewayRequest(type, data, i18n.t))
      if (result) setProgress(previous => (previous.result ? previous : { ...previous, id: previous.id ?? result.id, operation: previous.operation ?? result.operation, result }))
      return { result, error: null }
    } catch (caught) {
      const invalid = caught instanceof GatewayRequestError && (caught.status === 400 || caught.code === 'invalid_input')
      if (options.keepInvalidInput && invalid) setProgress(EMPTY_PROGRESS)
      else setError(caught instanceof Error ? caught.message : String(caught))
      return { result: null, error: caught }
    } finally {
      unsubscribe()
      active.current = false
      setRunning(false)
    }
  }, [i18n])
  const reset = useCallback(() => { setProgress(EMPTY_PROGRESS); setError(null) }, [])
  return { running, progress, error, run, reset }
}
