/**
 * The one `Retry-After` reader of the Console (console#124). Neither `@zhin.js/console-protocol` nor
 * `@zhin.js/client` exports a parser, so this mirrors `parseRetryAfterMs` of `@zhin.js/plugin-runtime`
 * (#1250 b80, the parser the gateway and the instance use); `tests/retry-after.test.mjs` checks the
 * two agree whenever that package is installed.
 *
 * Accepted: delta-seconds (`120`; fractional `1.5`, `.5`, `5.` and a leading `+`) or an HTTP date
 * (a date in the past is `0`). Absent, empty, negative or otherwise malformed values (`-5`, `1e3`,
 * `0x10`, `soon`, a bare `5` read as a year) are `undefined`.
 */
const DELTA_SECONDS = /^\+?(?:\d+(?:\.\d*)?|\.\d+)$/u

/** Milliseconds to wait from a `Retry-After` value; undefined when it is absent or malformed. */
export function parseRetryAfterMs(value, now = Date.now()) {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  if (DELTA_SECONDS.test(trimmed)) {
    const ms = Math.round(Number(trimmed) * 1_000)
    return Number.isSafeInteger(ms) ? ms : undefined
  }
  // An HTTP date always names its day / month; digits-only or signed values are not dates.
  if (!/[a-z]/iu.test(trimmed) || /^[+-]/u.test(trimmed)) return undefined
  const date = Date.parse(trimmed)
  if (Number.isNaN(date)) return undefined
  return Math.max(0, date - now)
}

/** Whole seconds (rounded up) from a `Retry-After` value; undefined when it is absent or malformed. */
export function parseRetryAfterSeconds(value, now = Date.now()) {
  const ms = parseRetryAfterMs(value, now)
  return ms === undefined ? undefined : Math.ceil(ms / 1_000)
}
