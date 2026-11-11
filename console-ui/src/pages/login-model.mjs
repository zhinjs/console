// Pure login-page logic: Host address normalization, login links and failure placement.

/** Existing link convention (README): `?apiBaseUrl=` or `#apiBaseUrl=` prefills the Host address. */
export const LINK_API_BASE_PARAM = 'apiBaseUrl'
/**
 * `#token=` signs in directly. The token is accepted only in the URL fragment, which browsers never
 * send to the server; a `?token=` is removed from the address bar and never used.
 */
export const LINK_TOKEN_PARAM = 'token'

const SCHEME = /^([a-z][a-z0-9+.-]*):\/\//i

function isIpv4(hostname) {
  const parts = hostname.split('.')
  return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)
}

/** Loopback, private-range and single-label/mDNS names, which a bot is reached over plain http. */
export function isLocalNetworkHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal')) return true
  if (!host.includes('.') && !host.includes(':')) return true
  if (isIpv4(host)) {
    const [a, b] = host.split('.').map(Number)
    return a === 127 || a === 10 || a === 0 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254)
  }
  if (host.includes(':')) return host === '::1' || /^f[cd]/.test(host) || /^fe[89ab]/.test(host)
  return false
}

/**
 * Turns what a person typed into the Host address the Console connects to.
 * Without a scheme, IP addresses and local-network names get `http://` (matching the
 * `http://localhost:8086` default) and other domain names get `https://`. Trailing slashes are dropped.
 * @returns {{ok: true, value: string} | {ok: false, reason: 'empty' | 'protocol' | 'invalid'}}
 */
export function normalizeHostAddress(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { ok: false, reason: 'empty' }
  if (/\s/.test(raw)) return { ok: false, reason: 'invalid' }
  const scheme = SCHEME.exec(raw)?.[1]?.toLowerCase()
  if (scheme && scheme !== 'http' && scheme !== 'https') return { ok: false, reason: 'protocol' }
  let url
  try {
    if (scheme) url = new URL(raw)
    else {
      const host = new URL(`http://${raw}`).hostname
      url = new URL(`${isIpv4(host) || host.startsWith('[') || isLocalNetworkHost(host) ? 'http' : 'https'}://${raw}`)
    }
  } catch { return { ok: false, reason: 'invalid' } }
  // Credentials, queries and fragments are never part of a Host API base.
  if (!url.hostname || url.username || url.password || url.search || url.hash || raw.endsWith('?') || raw.endsWith('#')) return { ok: false, reason: 'invalid' }
  return { ok: true, value: `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, '')}` }
}

function fragmentParams(hash) {
  const body = String(hash ?? '').replace(/^#/, '')
  return body.includes('=') ? new URLSearchParams(body) : new URLSearchParams()
}

/**
 * Reads a login link. The token comes only from the fragment (`#token=`); the Host address from
 * `#apiBaseUrl=` or, for existing links, `?apiBaseUrl=`. Values are trimmed; empty ones count as absent.
 * `queryTokenRejected` reports a `?token=` that was present and must not be used.
 */
export function readLoginLink(location) {
  const query = new URLSearchParams(location?.search ?? '')
  const fragment = fragmentParams(location?.hash)
  const apiBase = fragment.get(LINK_API_BASE_PARAM)?.trim() || query.get(LINK_API_BASE_PARAM)?.trim() || null
  const token = fragment.get(LINK_TOKEN_PARAM)?.trim() || null
  return { apiBase, token, queryTokenRejected: query.has(LINK_TOKEN_PARAM) }
}

/** The same address without login-link parameters (query and fragment), or `null` when there is nothing to remove. */
export function withoutLoginLink(href) {
  const url = new URL(href)
  const fragment = fragmentParams(url.hash)
  const names = [LINK_API_BASE_PARAM, LINK_TOKEN_PARAM]
  const inQuery = names.some(name => url.searchParams.has(name)), inFragment = names.some(name => fragment.has(name))
  if (!inQuery && !inFragment) return null
  for (const name of names) { url.searchParams.delete(name); fragment.delete(name) }
  const rest = fragment.toString()
  const hash = inFragment ? (rest ? `#${rest}` : '') : url.hash
  return `${url.pathname}${url.search}${hash}`
}

/**
 * Reads the login link and immediately replaces the history entry with one that has no token,
 * so the token never stays in the address bar or history, whatever the sign-in result.
 */
export function consumeLoginLink(location, history) {
  if (!location?.href) return { apiBase: null, token: null, queryTokenRejected: false }
  const link = readLoginLink(location)
  const next = withoutLoginLink(location.href)
  if (next !== null) history.replaceState(history.state, '', next)
  return link
}

/** Whether a link may sign in without asking: only to a Host the person already saved. */
export function linkNeedsConfirmation(apiBase, savedBases) {
  const target = normalizeHostAddress(apiBase)
  if (!target.ok) return true
  return !savedBases.some(saved => { const known = normalizeHostAddress(saved); return known.ok && known.value === target.value })
}

/** Which field a failed sign-in belongs to: 401 is the token, an unreachable Host is the address. */
export function loginFailureField(result) {
  if (result?.status === 401) return 'token'
  if (result?.status === undefined) return 'apiBase'
  return 'form'
}
