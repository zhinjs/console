/**
 * Whether the Zhin instance behind the management gateway is answering (ADR 0054). Every Console
 * request reports here; the shell shows one 「实例不可用」 banner instead of each page failing on
 * its own. Gateway-owned requests (访问控制、实例、终端、登录) keep working while the instance is down,
 * so their success says nothing about the instance and never clears the banner.
 */
import { DEFAULT_INSTANCE_RETRY_SECONDS, outcomeUnknown, statusFromError } from '../components/status-state-model.mjs'
import {
  CONSOLE_RPC_PERMISSIONS, GATEWAY_INSTANCE_RPC, GATEWAY_RPC, IAM_RPC, ONBOARDING_RPC,
} from '@zhin.js/console-protocol'

/**
 * RPC types the gateway answers itself on `POST {base}/console/request`, from `@zhin.js/console-protocol`:
 * every `gateway.*` type (the gateway refuses unknown ones itself, `GATEWAY_RPC_PREFIX`), `iam.*`
 * (`IAM_RPC`), `terminal.*` (`CONSOLE_RPC_PERMISSIONS`) and `onboarding.update` (`gateway-console.ts`
 * `createGatewayAccountRpc`). They work
 * while the instance is down, so their answers say nothing about it.
 */
const GATEWAY_RPC_PREFIX = 'gateway.'
export const GATEWAY_OWNED_RPC_TYPES = Object.freeze([...new Set([
  ...Object.values(GATEWAY_RPC),
  ...Object.values(IAM_RPC),
  ONBOARDING_RPC.UPDATE,
  ...Object.keys(CONSOLE_RPC_PERMISSIONS).filter(type => type.startsWith('terminal.')),
])])
const GATEWAY_OWNED = new Set(GATEWAY_OWNED_RPC_TYPES)

export function isGatewayOwnedRequest(type) {
  return typeof type === 'string' && (type.startsWith(GATEWAY_RPC_PREFIX) || GATEWAY_OWNED.has(type))
}

/** `{ instance, retryAfterSeconds, since, retryAt, failures }` while unavailable, else null. */
let state = null
const listeners = new Set()
const recoveryListeners = new Set()

/** The instance answered again after being unavailable: reads that failed meanwhile should re-run. */
function recovered() {
  for (const listener of [...recoveryListeners]) listener()
}

/** Called once each time the instance comes back (banner clears); returns the unsubscribe. */
export function onInstanceRecovered(listener) {
  recoveryListeners.add(listener)
  return () => recoveryListeners.delete(listener)
}

function emit() {
  for (const listener of [...listeners]) listener()
}

export function getInstanceAvailability() {
  return state
}

export function subscribeInstanceAvailability(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Records an instance failure reading (`kind: 'instance-unavailable'`); other readings are ignored. */
export function reportInstanceReading(reading, now = Date.now()) {
  if (reading?.kind !== 'instance-unavailable') return false
  const seconds = Math.max(1, Math.ceil(reading.retryAfterSeconds ?? DEFAULT_INSTANCE_RETRY_SECONDS))
  state = Object.freeze({
    instance: reading.instance ?? 'unavailable',
    retryAfterSeconds: seconds,
    since: state?.since ?? now,
    retryAt: now + seconds * 1000,
    failures: (state?.failures ?? 0) + 1,
  })
  emit()
  return true
}

/** A failed request: classified once, recorded when it is an instance failure. Returns the reading. */
export function reportRequestFailure(type, error, now = Date.now()) {
  const reading = statusFromError(error)
  // A gateway-owned request failing for its own reasons says nothing about the instance.
  if (!isGatewayOwnedRequest(type)) reportInstanceReading(reading, now)
  return reading
}

/** A request the instance answered: the instance is back. */
export function reportRequestSuccess(type) {
  if (isGatewayOwnedRequest(type) || !state) return false
  state = null
  emit()
  recovered()
  return true
}

/**
 * A raw HTTP reply from the Host (`apiFetch`): 502 / 503 / 504 with an instance code, read from the
 * body and the Retry-After header. Returns true when it was an instance failure.
 */
export function reportHttpReply({ status, body, retryAfter }, now = Date.now()) {
  if (status !== 502 && status !== 503 && status !== 504) return false
  const code = body && typeof body === 'object' && typeof body.code === 'string' ? body.code : undefined
  if (!code || !/^instance_/u.test(code)) return false
  const seconds = Number(retryAfter)
  return reportInstanceReading(statusFromError({
    message: typeof body.error === 'string' ? body.error : code,
    details: { serverCode: code, ...(Number.isFinite(seconds) && seconds > 0 ? { retryAfter: seconds } : {}), ...(typeof body.requestOutcome === 'string' ? { requestOutcome: body.requestOutcome } : {}) },
  }), now)
}

/** Whole seconds until the next automatic retry (0 when due). */
export function secondsUntilRetry(current, now = Date.now()) {
  if (!current) return 0
  return Math.max(0, Math.ceil((current.retryAt - now) / 1000))
}

/** After a failed probe the next wait doubles, capped at a minute. */
export function nextRetrySeconds(current) {
  return Math.min(60, Math.max(1, (current?.retryAfterSeconds ?? DEFAULT_INSTANCE_RETRY_SECONDS) * 2))
}

/** A probe that still failed: re-arm the countdown without losing `since`. */
export function rearmInstanceRetry(now = Date.now()) {
  if (!state) return
  const seconds = nextRetrySeconds(state)
  state = Object.freeze({ ...state, retryAfterSeconds: seconds, retryAt: now + seconds * 1000, failures: state.failures + 1 })
  emit()
}

/** Gateway instance states in which instance requests are answered. */
export function instanceStateAnswers(value) {
  return value === 'running'
}

/** An instance request used to probe when the gateway does not report the state. */
export const INSTANCE_PROBE_RPC = 'endpoint.list'

/**
 * Probe once whether the instance answers. `request` is `requestConsole`. The gateway's own
 * `gateway.instance.status` decides when it answers (`running` → yes, anything else → no); without it
 * (older gateway, no `status.view`) an instance request decides: any answer the instance itself gave
 * counts, a refusal (403 for a user without `endpoint.view`) included. Only instance failures and
 * requests without a trustworthy answer say no.
 */
export async function probeInstance(request) {
  try {
    const status = await request({ type: GATEWAY_INSTANCE_RPC.STATUS })
    if (status && typeof status === 'object' && typeof status.state === 'string') return instanceStateAnswers(status.state)
  } catch {
    // Fall through to an instance request.
  }
  try {
    await request({ type: INSTANCE_PROBE_RPC })
    return true
  } catch (error) {
    const reading = statusFromError(error)
    return reading.kind !== 'instance-unavailable' && !outcomeUnknown(reading)
  }
}

export function clearInstanceAvailability() {
  if (!state) return
  state = null
  emit()
  recovered()
}
