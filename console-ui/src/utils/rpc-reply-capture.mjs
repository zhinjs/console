/**
 * What the published SDK's `ConsoleTransport.sendRequest` (@zhin.js/client ~1.1.31) throws away.
 *
 * It throws `MessageError('REST request failed')` (code `MESSAGE_ERROR`) for a timeout
 * (`AbortSignal.timeout`), a network failure and a reply that is not JSON alike, and keeps only
 * `json.error` of a Host refusal (code `SERVER_ERROR`): the Host's `code`, `requestOutcome`,
 * `lockedBy`, `missingEnv` and the `Retry-After` header are lost. The Console's transport fetch
 * records the reply of each RPC here, and {@link enrichRpcError} puts what the Host said back on the
 * error as `details` (the shape newer SDKs use), so `statusFromError` can tell 结果未知 from 未执行.
 *
 * Pairing a request with its reply: `sendRequest` calls `fetch` synchronously (nothing is awaited
 * before it), so the capture opened right before the call is taken by that fetch. If a future SDK
 * awaits first, nothing is taken and errors are classified from the SDK's own error alone.
 */

const RPC_PATH = /\/api\/console\/request(?:[?#]|$)/u

let open = null

/** Opens the capture the next RPC fetch takes; closed by {@link endReplyCapture}. */
export function beginReplyCapture() {
  const capture = { taken: false, status: undefined, retryAfter: null, reply: null }
  open = capture
  return capture
}

export function endReplyCapture(capture) {
  if (open === capture) open = null
}

function urlOf(input) {
  if (typeof input === 'string') return input
  if (input && typeof input === 'object' && 'href' in input) return String(input.href)
  if (input && typeof input === 'object' && 'url' in input) return String(input.url)
  return ''
}

/**
 * Wraps a fetch: an RPC request (`POST …/api/console/request`) takes the open capture
 * synchronously and records the status, `Retry-After` and a clone of the reply (its JSON body is
 * read only if the request fails). Every other request passes through untouched.
 */
export function capturingFetch(base) {
  return function fetchWithCapture(input, init) {
    const capture = open && RPC_PATH.test(urlOf(input)) ? open : null
    if (capture) { open = null; capture.taken = true }
    const pending = base(input, init)
    if (!capture) return pending
    return Promise.resolve(pending).then(response => {
      capture.status = response.status
      capture.retryAfter = response.headers?.get?.('retry-after') ?? null
      // Read only when the request failed (enrichRpcError); successful replies are not parsed twice.
      capture.reply = typeof response.clone === 'function' ? response.clone() : null
      return response
    })
  }
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)

/**
 * The SDK error with `details` from the recorded reply: `httpStatus`, `serverCode`,
 * `requestOutcome`, `lockedBy`, `retryAfter`, `missingEnv`, `errors`, `needsConfiguration`, and
 * `transport` when a reply arrived but was not JSON (`refused` for a 4xx, else `invalid-response`).
 * Returns the same error object (with `details` set).
 */
export async function enrichRpcError(error, capture) {
  if (!isRecord(error)) return error
  const details = isRecord(error.details) ? { ...error.details } : {}
  const sdkMessageError = error.code === 'MESSAGE_ERROR'
  if (capture?.taken && capture.status !== undefined) {
    details.httpStatus = capture.status
    const body = capture.reply ? await capture.reply.json().catch(() => null) : null
    if (isRecord(body)) {
      if (typeof body.code === 'string' && body.code && details.serverCode === undefined) details.serverCode = body.code
      if (typeof body.requestOutcome === 'string') details.requestOutcome = body.requestOutcome
      if (typeof body.lockedBy === 'string') details.lockedBy = body.lockedBy
      if (Array.isArray(body.missingEnv)) details.missingEnv = body.missingEnv
      if (Array.isArray(body.errors)) details.errors = body.errors
      if (body.needsConfiguration !== undefined) details.needsConfiguration = body.needsConfiguration
    }
    const seconds = Number(String(capture.retryAfter ?? '').trim())
    if (capture.retryAfter && Number.isFinite(seconds) && seconds > 0) details.retryAfter = seconds
    // The reply arrived but could not be read (a proxy's HTML page, a body cut off by the timeout):
    // a 4xx was refused before anything ran; anything else may have run.
    // (Without a reply `statusFromError` reads the SDK's `originalError` itself.)
    if (sdkMessageError && !isRecord(body)) {
      details.transport = capture.status >= 400 && capture.status < 500 ? 'refused' : 'invalid-response'
    }
  }
  if (Object.keys(details).length) {
    try { error.details = details } catch { /* frozen: keep the SDK error as is */ }
  }
  return error
}

/** Runs one SDK request with its reply captured; a failure is rethrown enriched. */
export function requestWithCapture(send) {
  const capture = beginReplyCapture()
  let pending
  try {
    pending = send()
  } finally {
    endReplyCapture(capture)
  }
  return Promise.resolve(pending).catch(async error => { throw await enrichRpcError(error, capture) })
}
