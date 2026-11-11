import type {
  ConsoleMe, ConsoleOnboardingState, OnboardingStepStatus, SetupDatabaseInput, SetupDriver,
} from '../contracts/console-auth'

export declare const CONSOLE_AUTH_ROUTES: Readonly<{
  LOGIN: '/auth/login'
  LOGOUT: '/auth/logout'
  ME: '/auth/me'
  PASSWORD: '/auth/password'
  TOKENS: '/auth/tokens'
  TOKENS_REVOKE: '/auth/tokens/revoke'
  SETUP: '/auth/setup'
  SETUP_DATABASE: '/auth/setup/database'
  SETUP_DATABASE_TEST: '/auth/setup/database/test'
}>
export declare const ONBOARDING_RPC: Readonly<{ UPDATE: 'onboarding.update' }>
export declare const API_PREFIX: '/api'
export declare function authUrl(apiBase: string, route: string): string

export type AuthFailureCode =
  | 'invalid_input' | 'not_found' | 'conflict' | 'forbidden' | 'last_owner' | 'unauthorized'
  | 'rate_limited' | 'unavailable' | 'setup_required' | 'unsupported' | 'unreachable' | 'failed' | (string & {})

export interface AuthFailure {
  readonly ok: false
  /** `0` when the Host could not be reached. */
  readonly status: number
  readonly code: AuthFailureCode
  /** The Host's message (may be Chinese); empty when it sent none. */
  readonly message: string
  /** 429 only; `null` when the Host's Retry-After is not readable. */
  readonly retryAfterSec?: number | null
}
export interface AuthSuccess<T> { readonly ok: true; readonly status: number; readonly data: T }
export type AuthResult<T> = AuthSuccess<T> | AuthFailure

export declare function retryAfterSeconds(header: string | null | undefined, body?: unknown, now?: number): number | null
export declare function readAuthResponse<T = unknown>(input: { status: number; body: unknown; retryAfter?: string | null; now?: number }): AuthResult<T>
export declare function unreachableResult(): AuthFailure
export type AuthErrorContext = 'generic' | 'login' | 'password' | 'setup' | 'tokens'
export declare function authErrorMessage(
  error: AuthResult<unknown> | null | undefined,
  t: (message: string, values?: readonly unknown[]) => string,
  context?: AuthErrorContext,
): string

export declare const USERNAME_PATTERN: RegExp
export declare const MIN_PASSWORD_LENGTH: number
export declare function normalizeUsername(value: unknown): string
export declare function usernameProblem(value: unknown): 'empty' | 'format' | null
export declare function newPasswordProblem(password: unknown, confirm?: unknown): 'empty' | 'short' | 'mismatch' | null

export declare function sessionView(me: ConsoleMe | null | undefined): 'setup' | 'shell' | 'signed-out'
export declare function meAccessReport(me: ConsoleMe | null | undefined): { permissions: readonly string[] } | null
export declare function readMe(data: unknown): ConsoleMe | null
export declare function principalLabel(me: ConsoleMe | null | undefined, t: (message: string) => string): string

export declare function initialConnectionValues(driver: SetupDriver | null | undefined): Record<string, string>
export declare function connectionPayload(driver: SetupDriver | null | undefined, values: Readonly<Record<string, string>>): SetupDatabaseInput
export declare function missingConnectionFields(driver: SetupDriver | null | undefined, values: Readonly<Record<string, string>>): string[]
export declare function connectionKey(payload: SetupDatabaseInput | null | undefined): string
export declare const KEEP_DATABASE: 'keep'
export declare function defaultDatabaseChoice(): 'keep'
export declare function databaseSummaryText(summary: unknown): string
export declare function waitForHost(options: {
  probe: () => Promise<boolean>
  intervalMs?: number
  timeoutMs?: number
  initialDelayMs?: number
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  signal?: AbortSignal
}): Promise<boolean>

export type OnboardingFlowStep = 'ai' | 'adapters' | 'finish'
export declare const ONBOARDING_FLOW_STEPS: readonly OnboardingFlowStep[]
export declare function normalizeOnboarding(raw: unknown): ConsoleOnboardingState | null
export declare function freshOnboarding(): ConsoleOnboardingState
export declare function onboardingComplete(state: ConsoleOnboardingState | null | undefined): boolean
export declare function onboardingIncomplete(state: ConsoleOnboardingState | null | undefined): boolean
export declare function nextOnboardingStep(state: ConsoleOnboardingState | null | undefined): OnboardingFlowStep
export declare function markOnboardingStep(
  state: ConsoleOnboardingState | null | undefined, step: OnboardingFlowStep, status: OnboardingStepStatus, now?: number,
): ConsoleOnboardingState
export declare function resolveOnboarding(hostState: unknown, localState: unknown): ConsoleOnboardingState | null
export declare function isUnsupportedRpcError(error: unknown): boolean
export declare const ONBOARDING_STORAGE_PREFIX: string
export declare function onboardingStorageKey(apiBase: string): string

export declare const TOKEN_EXPIRY_DAYS: readonly number[]
export declare function tokenExpiresAt(days: number, now?: number): number | null
export declare function tokenState(token: { expiresAt: number | null } | null | undefined, now?: number): 'active' | 'expired'
export declare function tokenNameProblem(name: unknown): 'empty' | 'long' | null
