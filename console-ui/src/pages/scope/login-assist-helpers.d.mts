export const LOGIN_CAPTCHA_MESSAGE_TYPE: 'zhin.login-assist.captcha'
export const DEFAULT_CAPTCHA_HELPER_URL: string
export const CAPTCHA_NONCE_PATTERN: RegExp
export function isValidCaptchaNonce(value: unknown): value is string

export type LoginTicketParseResult =
  | Readonly<{ ok: true; ticket: string; randstr?: string }>
  | Readonly<{ ok: false; error: string }>

export interface LoginCaptchaHelperPayload {
  readonly q: string
  readonly n: string
  readonly o: string
}

export interface BuildCaptchaHelperUrlInput {
  readonly helperUrl?: string
  readonly query: string
  readonly nonce: string
  readonly origin: string
}

export interface CaptchaReply { readonly ticket: string; readonly randstr: string }

export function parseLoginTicket(raw: unknown): LoginTicketParseResult
export function extractLoginTicket(raw: string): string
export function buildCaptchaHelperUrl(input: BuildCaptchaHelperUrlInput): string
export function parseCaptchaHelperPayload(hash: string): LoginCaptchaHelperPayload | null
export function parseCaptchaHelperMessage(
  event: { readonly origin: string; readonly data: unknown },
  expected: { readonly helperOrigin: string; readonly nonce: string },
): CaptchaReply | null
export function captchaHelperOrigin(helperUrl?: string): string | null
export function isValidCaptchaHelperUrl(value: unknown): value is string
export function createCaptchaNonce(random?: { getRandomValues<T extends ArrayBufferView | null>(array: T): T }, bytes?: number): string
export interface CaptchaReplyGate {
  readonly helperOrigin: string | null
  accept(event: { readonly origin: string; readonly data: unknown }): CaptchaReply | null
  readonly used: boolean
}
export function createCaptchaReplyGate(input: { helperUrl?: string; nonce: string }): CaptchaReplyGate
export function openCaptchaPopup(win: Pick<Window, 'open'>, url: string, options?: { name?: string; features?: string }): Window | null
