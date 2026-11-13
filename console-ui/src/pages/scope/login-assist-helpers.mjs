/**
 * Pure Login Assist helpers (zhinjs/zhin ADR 0058), ported from `@zhin.js/core`:
 *
 * - `parseLoginTicket` / `extractLoginTicket` — `packages/im/core/src/built/login-assist.ts`
 * - the hosted captcha helper (`buildCaptchaHelperUrl`, `parseCaptchaHelperPayload`,
 *   `parseCaptchaHelperMessage`, …) — `packages/im/core/src/built/login-captcha.ts`
 *
 * The Console depends on the published `@zhin.js/console-protocol` only, which does not ship these.
 * Keep the behaviour byte-for-byte identical to core (tests/login-assist-helpers.test.mjs checks the
 * same vectors and URLs core produces). Error texts are core's authored Chinese copy; the UI shows
 * them through `i18n.t`.
 */

/** `postMessage` type the helper page sends back. */
export const LOGIN_CAPTCHA_MESSAGE_TYPE = 'zhin.login-assist.captcha'

/** Default hosted helper page (separate origin from any Console). */
export const DEFAULT_CAPTCHA_HELPER_URL = 'https://zhin.js.org/login-assist/tcaptcha.html'

const PASTE_HINT = '请粘贴 ticket、验证返回的 JSON 或带 ticket 的链接'

/**
 * Pure parser behind `input.extract: 'ticket-json-or-url'`: a bare ticket, `ticket,randstr`, the
 * verify JSON (`{ ticket, randstr }`, also one level under `data` / `result`) or a link with
 * `ticket=` (query or fragment). Returns `{ ok, ticket, randstr? }` or `{ ok: false, error }`.
 */
export function parseLoginTicket(raw) {
  if (typeof raw !== 'string') return Object.freeze({ ok: false, error: PASTE_HINT })
  const text = raw.trim()
  if (!text) return Object.freeze({ ok: false, error: PASTE_HINT })
  const done = (ticket, randstr) => {
    const value = typeof ticket === 'string' ? ticket.trim() : ''
    if (!value) return Object.freeze({ ok: false, error: '没有找到 ticket' })
    if (/\s/u.test(value)) return Object.freeze({ ok: false, error: 'ticket 不应包含空白字符，请只粘贴 ticket 本身' })
    const extra = typeof randstr === 'string' && randstr.trim() ? { randstr: randstr.trim() } : {}
    return Object.freeze({ ok: true, ticket: value, ...extra })
  }
  if (text.startsWith('{')) {
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return Object.freeze({ ok: false, error: 'JSON 格式不完整，请复制完整的返回内容' })
    }
    const candidates = [parsed, parsed?.data, parsed?.result]
    for (const candidate of candidates) {
      if (candidate && typeof candidate === 'object' && typeof candidate.ticket === 'string') {
        return done(candidate.ticket, candidate.randstr)
      }
    }
    return Object.freeze({ ok: false, error: 'JSON 中没有 ticket 字段' })
  }
  if (/^https?:\/\//iu.test(text)) {
    let url
    try {
      url = new URL(text)
    } catch {
      return Object.freeze({ ok: false, error: '链接格式不正确' })
    }
    const hash = new URLSearchParams(url.hash.replace(/^#/u, ''))
    const ticket = url.searchParams.get('ticket') ?? hash.get('ticket')
    if (!ticket) return Object.freeze({ ok: false, error: '链接中没有 ticket 参数' })
    return done(ticket, url.searchParams.get('randstr') ?? hash.get('randstr') ?? undefined)
  }
  const comma = text.split(',')
  if (comma.length === 2 && comma[0].trim() && comma[1].trim()) return done(comma[0], comma[1])
  if (comma.length > 2) return Object.freeze({ ok: false, error: '格式应为 ticket 或 ticket,randstr' })
  return done(text)
}

/** Ticket text for an input with `extract: 'ticket-json-or-url'` (the raw text when unparseable). */
export function extractLoginTicket(raw) {
  const parsed = parseLoginTicket(raw)
  return parsed.ok ? parsed.ticket : raw.trim()
}

/**
 * `${helperUrl}#${base64url(JSON {q, n, o})}`. The payload goes in the fragment so it never reaches
 * a server log. Throws on a non-https helper (http only for localhost) or an invalid origin.
 */
export function buildCaptchaHelperUrl(input) {
  const helper = validHelperUrl(input.helperUrl ?? DEFAULT_CAPTCHA_HELPER_URL)
  if (!helper) throw new TypeError('captcha helper URL must be https (http only on localhost)')
  const origin = validOrigin(input.origin)
  if (!origin) throw new TypeError('opener origin is invalid')
  if (typeof input.nonce !== 'string' || input.nonce.length < 8) throw new TypeError('nonce must have at least 8 characters')
  const query = typeof input.query === 'string' ? input.query.replace(/^\?/u, '') : ''
  if (!query) throw new TypeError('captcha query is required')
  helper.hash = encodeBase64Url(JSON.stringify({ q: query, n: input.nonce, o: origin }))
  return helper.toString()
}

/** Decodes the fragment payload on the helper page (`location.hash`); `null` when malformed. */
export function parseCaptchaHelperPayload(hash) {
  try {
    const parsed = JSON.parse(decodeBase64Url(hash.replace(/^#/u, '')))
    if (typeof parsed.q !== 'string' || !parsed.q || typeof parsed.n !== 'string' || !parsed.n) return null
    const origin = typeof parsed.o === 'string' ? validOrigin(parsed.o) : null
    return origin ? Object.freeze({ q: parsed.q, n: parsed.n, o: origin }) : null
  } catch {
    return null
  }
}

/**
 * Accepts a helper `message` event only from `helperOrigin` and with the expected nonce.
 * Returns the ticket and randstr, or `null`.
 */
export function parseCaptchaHelperMessage(event, expected) {
  if (!event || event.origin !== expected.helperOrigin || !expected.nonce) return null
  const data = event.data
  if (!data || typeof data !== 'object' || data.type !== LOGIN_CAPTCHA_MESSAGE_TYPE || data.nonce !== expected.nonce) return null
  const ticket = typeof data.ticket === 'string' ? data.ticket.trim() : ''
  const randstr = typeof data.randstr === 'string' ? data.randstr.trim() : ''
  if (!ticket || /[\s,]/u.test(ticket) || /[\s,]/u.test(randstr) || ticket.length > 4096 || randstr.length > 256) return null
  return Object.freeze({ ticket, randstr })
}

/** Origin of a helper URL (for `parseCaptchaHelperMessage`); `null` when invalid. */
export function captchaHelperOrigin(helperUrl = DEFAULT_CAPTCHA_HELPER_URL) {
  return validHelperUrl(helperUrl)?.origin ?? null
}

/** Whether a configured helper URL is usable (https, or http on localhost). */
export function isValidCaptchaHelperUrl(value) {
  return typeof value === 'string' && validHelperUrl(value) !== null
}

// ---------------------------------------------------------------- Console-only additions

/** Opener nonce rule shared with the helper page: 16–64 characters from `[A-Za-z0-9._~-]`. */
export const CAPTCHA_NONCE_PATTERN = /^[A-Za-z0-9._~-]{16,64}$/u

/** Whether a nonce satisfies {@link CAPTCHA_NONCE_PATTERN}. */
export function isValidCaptchaNonce(value) {
  return typeof value === 'string' && CAPTCHA_NONCE_PATTERN.test(value)
}

/**
 * A fresh opener nonce: base64url (no `+`, `/`, `=`) of `bytes` bytes from a CSPRNG
 * (`crypto.getRandomValues`); 18 bytes give 24 characters. Throws without a CSPRNG (a guessable
 * nonce would let another window answer the challenge) or when the result breaks the nonce rule.
 */
export function createCaptchaNonce(random = globalThis.crypto, bytes = 18) {
  if (!random || typeof random.getRandomValues !== 'function') throw new TypeError('crypto.getRandomValues is required')
  const buffer = random.getRandomValues(new Uint8Array(bytes))
  let binary = ''
  for (const byte of buffer) binary += String.fromCharCode(byte)
  const nonce = btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
  if (!isValidCaptchaNonce(nonce)) throw new RangeError('nonce must have 16–64 characters from [A-Za-z0-9._~-]')
  return nonce
}

/**
 * One-shot acceptance of helper replies: the first valid reply for this nonce is taken, every later
 * one (a replay, a second click in the helper) is ignored.
 */
export function createCaptchaReplyGate({ helperUrl, nonce }) {
  const helperOrigin = captchaHelperOrigin(helperUrl)
  let used = false
  return Object.freeze({
    helperOrigin,
    accept(event) {
      if (used || !helperOrigin) return null
      const reply = parseCaptchaHelperMessage(event, { helperOrigin, nonce })
      if (reply) used = true
      return reply
    },
    get used() { return used },
  })
}

/**
 * Opens the helper page in a popup without leaking the Console's address: the popup starts on
 * `about:blank` (same origin, so it can be prepared), gets a `no-referrer` policy, and navigates
 * itself through a `rel="noreferrer"` link. The helper therefore sees `document.referrer === ''`
 * (Tencent's loader reads it), yet keeps `window.opener` for its `postMessage` — the `noreferrer`
 * window feature would imply `noopener` and break that. Returns the popup, or `null` when the
 * browser blocked it or it could not be prepared (the caller offers a link instead).
 */
export function openCaptchaPopup(win, url, { name = 'zhin-login-captcha', features = 'popup=yes,width=440,height=640' } = {}) {
  const popup = win.open('about:blank', name, features)
  if (!popup) return null
  try {
    const doc = popup.document
    const meta = doc.createElement('meta')
    meta.setAttribute('name', 'referrer')
    meta.setAttribute('content', 'no-referrer')
    ;(doc.head ?? doc.documentElement).appendChild(meta)
    const link = doc.createElement('a')
    link.setAttribute('href', url)
    link.setAttribute('rel', 'noreferrer')
    link.setAttribute('referrerpolicy', 'no-referrer')
    ;(doc.body ?? doc.documentElement).appendChild(link)
    link.click()
    return popup
  } catch {
    // Never fall back to a navigation that would send the referrer.
    try { popup.close() } catch { /* already gone */ }
    return null
  }
}

function validHelperUrl(value) {
  try {
    const url = new URL(value)
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '[::1]'
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) return null
    if (url.username || url.password) return null
    url.hash = ''
    return url
  } catch {
    return null
  }
}

function validOrigin(value) {
  try {
    const url = new URL(value)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null
    return url.origin === value.replace(/\/$/u, '') ? url.origin : null
  } catch {
    return null
  }
}

function encodeBase64Url(text) {
  const bytes = new TextEncoder().encode(text)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/gu, '-').replace(/\//gu, '_').replace(/=+$/u, '')
}

function decodeBase64Url(text) {
  const base64 = text.replace(/-/gu, '+').replace(/_/gu, '/')
  const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4))
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)))
}
