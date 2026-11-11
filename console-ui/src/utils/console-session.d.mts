import type { ConsoleMe, ConsoleOnboardingState } from '../contracts/console-auth'

export interface ConsoleSessionState {
  readonly me: ConsoleMe | null
  /** The Host predates `/auth/*`. */
  readonly legacy: boolean
  readonly hostOnboarding: ConsoleOnboardingState | null
  readonly localOnboarding: ConsoleOnboardingState | null
  readonly setupRequested: boolean
}
export declare function getConsoleSession(): ConsoleSessionState
export declare function subscribeConsoleSession(listener: () => void): () => void
export declare function setConsoleMe(me: ConsoleMe): void
export declare function setLegacySession(): void
export declare function setHostOnboarding(raw: unknown): void
export declare function setLocalOnboarding(raw: unknown): void
export declare function requestSetup(requested?: boolean): void
export declare function currentOnboarding(session?: ConsoleSessionState): ConsoleOnboardingState | null
export declare function resetConsoleSession(): void
