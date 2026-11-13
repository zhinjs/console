/**
 * Console sign-in, first-run setup and onboarding contract (zhinjs/zhin ADR 0049 §5/§7, ADR 0053 §4).
 *
 * Route constants come from `@zhin.js/console-protocol` (`CONSOLE_AUTH_ROUTES`); the reply types
 * follow the Host's `packages/host/gateway/src/iam/{routes,service,setup-service}.ts`, which the
 * protocol package does not export.
 * Route constants live in `utils/console-auth-model.mjs` so plain-JS models and tests share them.
 */
export { CONSOLE_AUTH_ROUTES, ONBOARDING_RPC } from '../utils/console-auth-model.mjs'

/** `{ success: true, data }` on success; `{ success: false, code?, error }` otherwise. */
export type ConsoleAuthEnvelope<T> =
  | { readonly success: true; readonly data: T }
  | { readonly success: false; readonly code?: string; readonly error?: string }

export type ConsoleAuthErrorCode =
  | 'invalid_input' | 'not_found' | 'conflict' | 'forbidden' | 'last_owner'
  | 'unauthorized' | 'rate_limited' | 'unavailable' | 'setup_required' | 'failed'

export interface ConsoleUserSummary {
  readonly id: string
  readonly username: string
  readonly displayName: string
}

export type ConsoleBindingScope =
  | { readonly kind: 'global' }
  | { readonly kind: 'adapter'; readonly key: string }
  | { readonly kind: 'endpoint'; readonly key: string }

export interface ConsoleMeBinding {
  readonly role?: string
  readonly scope: ConsoleBindingScope
  readonly permissions: readonly string[]
}

/** `GET /auth/me` (public: a signed-out caller is `anonymous`). */
export interface ConsoleMe {
  readonly kind: 'anonymous' | 'bootstrap' | 'user' | 'api-token'
  /** Bootstrap only: no credential is configured, the Host is open until setup. */
  readonly open?: boolean
  readonly user?: ConsoleUserSummary
  /** Permissions held through global bindings. */
  readonly permissions: readonly string[]
  readonly bindings: readonly ConsoleMeBinding[]
  readonly setupRequired: boolean
  /** Not sent by the Host yet (ADR 0053 §4); read when present. */
  readonly onboarding?: ConsoleOnboardingState
}

/** `POST /auth/login` and `POST /auth/setup`. */
export interface ConsoleSessionIssued {
  readonly token: string
  readonly expiresAt: number
  readonly user: ConsoleUserSummary & { readonly disabled?: boolean }
}

export type OnboardingStepStatus = 'pending' | 'done' | 'skipped'
export type OnboardingStep = 'database' | 'owner' | 'ai' | 'adapters'

/** `.zhin/onboarding.json` (ADR 0053 §4). */
export interface ConsoleOnboardingState {
  readonly version: 1
  readonly steps: Readonly<Partial<Record<OnboardingStep, OnboardingStepStatus>>>
  readonly completedAt?: number | string
}

export interface SetupDatabaseSummary {
  readonly dialect: string
  readonly source: 'default' | 'config'
  /** Connection facts without secrets. */
  readonly summary: Readonly<Record<string, string | number>>
}

/** `GET /auth/setup` (bootstrap token only; 409 once initialized). */
export interface SetupStatus {
  readonly setupRequired: boolean
  readonly database: SetupDatabaseSummary
  /** ADR 0053 §4; older Hosts omit it. */
  readonly onboarding?: ConsoleOnboardingState
}

export interface SetupDatabaseField {
  readonly name: string
  readonly type: 'string' | 'integer' | 'enum'
  readonly required: boolean
  readonly secret: boolean
  readonly default?: string | number
  readonly options?: readonly string[]
  /** Env variable a secret is written to. */
  readonly env?: string
}

export interface SetupDriver {
  readonly dialect: string
  readonly label: string
  readonly description: string
  readonly available: boolean
  readonly missingPackage?: string
  readonly fields: readonly SetupDatabaseField[]
}

/** `GET /auth/setup/database`. */
export interface SetupDatabaseChoices extends SetupDatabaseSummary {
  readonly drivers: readonly SetupDriver[]
}

export interface SetupDatabaseInput {
  readonly dialect: string
  readonly connection: Readonly<Record<string, string | number>>
}

/** `POST /auth/setup/database/test`. */
export interface SetupDatabaseProbe {
  readonly ok: boolean
  readonly latencyMs?: number
  readonly error?: string
}

/** `POST /auth/setup/database`. */
export interface SetupDatabaseSaved {
  readonly restarting: boolean
  readonly restartRequired?: boolean
  readonly notice?: string
}

/** `GET /auth/tokens` → `{ tokens }`. */
export interface ConsoleApiTokenView {
  readonly id: string
  readonly userId: string
  readonly name: string
  /** `null`: the token carries all of its user's permissions. */
  readonly permissions: readonly string[] | null
  readonly expiresAt: number | null
  readonly lastUsedAt: number | null
  readonly createdAt: number
}

/** `POST /auth/tokens` → 201; the plaintext is returned only here. */
export interface ConsoleApiTokenCreated {
  readonly token: string
  readonly record: ConsoleApiTokenView
}

/** `POST /auth/password`: a session caller receives a fresh session (all sessions were revoked). */
export interface ConsolePasswordChanged {
  readonly changed: true
  readonly token?: string
  readonly expiresAt?: number
}
