import type { AuthFailure } from '../../utils/console-auth-model.mjs'
type Translate = (message: string, values?: readonly unknown[]) => string
export function resumeAtOwner(onboarding: unknown): boolean
export function setupBlockedTitle(failure: AuthFailure | null | undefined, t: Translate): string
export function setupNextStep(failure: AuthFailure | null | undefined, t: Translate): string
