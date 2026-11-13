import { useCallback, useEffect, useRef, useState } from 'react'
import { useInstanceRecovery } from '../../hooks/use-instance-recovery'
import { startVisiblePolling } from '../../hooks/visible-polling.mjs'
import { statusFromError } from '../../components/status-state-model.mjs'
import { getConsoleTransport } from '../../utils/console-client'
import { requestConsole } from '../../utils/console-rpc'
import { createDebouncer } from '../attention/attention-model.mjs'
import {
  LOGIN_FLOW_DEBOUNCE_MS, LOGIN_FLOW_EVENT, LOGIN_FLOW_POLL_MS, LOGIN_RPC, flowsUnsupported, mergeRedactedFlow, newerFlow,
  readLoginFlow, readLoginFlowGet, readLoginFlowList, nextClockOffset, isLiveEnvelope, type LoginFlow,
} from './login-flow-model.mjs'

export interface LoginFlowTarget { readonly adapter: string; readonly endpointKey: string }

export type LoginFlowState =
  | { readonly status: 'loading' }
  /** The Host predates Login Assist v2 (`login.flow.list` refused or unknown): use the legacy card. */
  | { readonly status: 'legacy' }
  | { readonly status: 'error'; readonly error: unknown }
  | { readonly status: 'ready'; readonly flow: LoginFlow | null; readonly refreshing: boolean; readonly error: unknown; readonly readAt: number
      /** Server − local clock (ms), from fresh flow timestamps; QR deadlines, cooldowns and waits use it. */
      readonly clockOffset: number }

export interface LoginFlowController {
  readonly state: LoginFlowState
  /** Re-reads the flow now (live material included). */
  readonly refresh: () => void
  /**
   * A flow snapshot from a reply (e.g. `login.submit { wait: true }`); the newer revision wins.
   * `fresh`: produced just now (its `updatedAt` calibrates the server clock offset when it is the newer
   * revision); never for replayed history or a reply that only timed out.
   */
  readonly apply: (flow: LoginFlow | null | undefined, fresh?: boolean) => void
}

/**
 * The login flow of one account (ADR 0058): `login.flow.list` first (an older Host refuses it →
 * `legacy`), then live through `endpoint.login.flow` events. Events are redacted (no QR image,
 * links or sensitive copy), so each burst of events is followed by one `login.flow.get`; the
 * material already on screen stays until it lands. Every 30 s while visible, after an event-stream
 * gap and when the instance answers again, the flow is read again.
 */
export function useLoginFlow(target: LoginFlowTarget, enabled = true): LoginFlowController {
  const { adapter, endpointKey } = target
  const [state, setState] = useState<LoginFlowState>({ status: 'loading' })
  const sequence = useRef(0)
  const current = useRef<LoginFlow | null>(null)
  const offset = useRef(0)
  const commit = useCallback((next: LoginFlow | null, patch?: { refreshing?: boolean; error?: unknown }) => {
    current.current = next
    setState({ status: 'ready', flow: next, refreshing: patch?.refreshing ?? false, error: patch?.error ?? null, readAt: Date.now(), clockOffset: offset.current })
  }, [])

  const read = useCallback((mode: 'list' | 'get') => {
    if (!enabled) return
    const ticket = ++sequence.current
    setState(previous => previous.status === 'ready' ? { ...previous, refreshing: true } : previous)
    const request = mode === 'list'
      ? requestConsole<unknown>({ type: LOGIN_RPC.FLOW_LIST, adapter, endpointKey }).then(reply => readLoginFlowList(reply, { adapter, endpointKey })[0] ?? null)
      : requestConsole<unknown>({ type: LOGIN_RPC.FLOW_GET, adapter, endpointKey }).then(readLoginFlowGet)
    request.then(flow => {
      if (ticket !== sequence.current) return
      // A live read of the same revision replaces the redacted event copy; an older one never wins.
      const previous = current.current
      commit(flow && previous && previous.id === flow.id && previous.revision > flow.revision ? previous : flow)
    }, (error: unknown) => {
      if (ticket !== sequence.current) return
      setState(previous => {
        if (previous.status === 'ready') return { ...previous, refreshing: false, error }
        return flowsUnsupported(statusFromError(error)) ? { status: 'legacy' } : { status: 'error', error }
      })
    })
  }, [adapter, endpointKey, enabled, commit])

  const apply = useCallback((incoming: LoginFlow | null | undefined, fresh = false) => {
    if (!incoming || incoming.adapter !== adapter || incoming.endpointKey !== endpointKey) return
    const previous = current.current
    const chosen = newerFlow(previous, incoming)
    if (chosen === previous) return
    // A live event or an outcome reply was produced just now: its updatedAt is the server's "now".
    // Replayed history, stale revisions and timed-out replies (updatedAt = submit time) never calibrate.
    offset.current = nextClockOffset(offset.current, { incoming, chosen, fresh })
    commit(mergeRedactedFlow(previous, chosen), { refreshing: true })
  }, [adapter, endpointKey, commit])

  useEffect(() => {
    if (!enabled) return
    current.current = null
    setState({ status: 'loading' })
    read('list')
    const live = createDebouncer(() => read('get'), LOGIN_FLOW_DEBOUNCE_MS)
    const stopPolling = startVisiblePolling(() => read('list'), LOGIN_FLOW_POLL_MS)
    const transport = getConsoleTransport()
    const offFlow = transport.onConsoleEvent(LOGIN_FLOW_EVENT, envelope => {
      const flow = readLoginFlow((envelope as { data?: unknown }).data)
      if (!flow || flow.adapter !== adapter || flow.endpointKey !== endpointKey) return
      // Recovered history (reconnect / page load) is old: it must not calibrate the clock.
      apply(flow, isLiveEnvelope(envelope))
      live.trigger()
    })
    const offGap = transport.onConsoleEventRecoveryGap(() => live.trigger())
    return () => {
      live.cancel()
      stopPolling()
      offFlow()
      offGap()
      sequence.current += 1
    }
  }, [adapter, endpointKey, enabled, read, apply])
  useInstanceRecovery(() => read('list'))

  return { state, refresh: useCallback(() => read('get'), [read]), apply }
}
