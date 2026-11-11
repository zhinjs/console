// Pure login-page logic: Host address normalization, login links and failure placement.

/** Existing link convention (README): `?apiBaseUrl=` prefills the Host address. */
export const LINK_API_BASE_PARAM = 'apiBaseUrl'
/** `?token=` signs in directly; it is removed from the address bar as soon as it is read. */
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

/** Reads a login link's Host address and token (trimmed; empty values count as absent). */
export function readLoginLink(search) {
  const params = new URLSearchParams(search ?? '')
  const apiBase = params.get(LINK_API_BASE_PARAM)?.trim() || null
  const token = params.get(LINK_TOKEN_PARAM)?.trim() || null
  return { apiBase, token }
}

/** The same address without login-link parameters, or `null` when there is nothing to remove. */
export function withoutLoginLink(href) {
  const url = new URL(href)
  if (!url.searchParams.has(LINK_API_BASE_PARAM) && !url.searchParams.has(LINK_TOKEN_PARAM)) return null
  url.searchParams.delete(LINK_API_BASE_PARAM)
  url.searchParams.delete(LINK_TOKEN_PARAM)
  return `${url.pathname}${url.search}${url.hash}`
}

/**
 * Reads the login link and immediately replaces the history entry with one that has no token,
 * so the token never stays in the address bar or history, whatever the sign-in result.
 */
export function consumeLoginLink(location, history) {
  if (!location?.href) return { apiBase: null, token: null }
  const link = readLoginLink(location.search)
  const next = withoutLoginLink(location.href)
  if (next !== null) history.replaceState(history.state, '', next)
  return link
}

/** Which field a failed sign-in belongs to: 401 is the token, an unreachable Host is the address. */
export function loginFailureField(result) {
  if (result?.status === 401) return 'token'
  if (result?.status === undefined) return 'apiBase'
  return 'form'
}
