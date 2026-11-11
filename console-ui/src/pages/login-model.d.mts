export const LINK_API_BASE_PARAM: 'apiBaseUrl'
export const LINK_TOKEN_PARAM: 'token'
export type HostAddressResult = { ok: true; value: string } | { ok: false; reason: 'empty' | 'protocol' | 'invalid' }
export interface LoginLink { apiBase: string | null; token: string | null; queryTokenRejected: boolean }
export type LoginField = 'apiBase' | 'token' | 'username' | 'password' | 'form'
export function isLocalNetworkHost(hostname: string): boolean
export function normalizeHostAddress(input: string | null | undefined): HostAddressResult
export function readLoginLink(location: Pick<Location, 'search' | 'hash'> | null | undefined): LoginLink
export function withoutLoginLink(href: string): string | null
export function consumeLoginLink(
  location: Pick<Location, 'href' | 'search' | 'hash'> | null | undefined,
  history: Pick<History, 'replaceState' | 'state'>,
): LoginLink
export function loginFailureField(result: { status?: number } | null | undefined): LoginField
export function linkNeedsConfirmation(apiBase: string, savedBases: readonly string[]): boolean
export type LoginMode = 'password' | 'token'
export const LOGIN_MODES: readonly LoginMode[]
export const LOGIN_MODE_STORAGE_KEY: string
export function initialLoginMode(input?: { initialToken?: string | null; savedCount?: number; storage?: Pick<Storage, 'getItem'> | null }): LoginMode
export function saveLoginMode(storage: Pick<Storage, 'setItem'> | null | undefined, mode: LoginMode): void
export function passwordFailureField(result: { code?: string } | null | undefined): LoginField
export function lockoutMs(result: { code?: string; retryAfterSec?: number | null } | null | undefined, now?: number): number
