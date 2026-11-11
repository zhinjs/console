/**
 * Onboarding progress (ADR 0053 §4). The Host's `.zhin/onboarding.json` wins when it reports one;
 * otherwise this browser keeps its own copy per Host, so the flow still works on Hosts without
 * `onboarding.update`.
 */
import { getApiBase } from './auth'
import { updateOnboarding } from './console-auth-api'
import {
  freshOnboarding, isUnsupportedRpcError, markOnboardingStep, normalizeOnboarding, onboardingStorageKey,
  type OnboardingFlowStep,
} from './console-auth-model.mjs'
import { currentOnboarding, getConsoleSession, setHostOnboarding, setLocalOnboarding } from './console-session.mjs'
import type { ConsoleOnboardingState, OnboardingStepStatus } from '../contracts/console-auth'

function storage(): Storage | null {
  try { return typeof window === 'undefined' ? null : window.localStorage } catch { return null }
}

export function readLocalOnboarding(apiBase = getApiBase()): ConsoleOnboardingState | null {
  try {
    const raw = storage()?.getItem(onboardingStorageKey(apiBase))
    return raw ? normalizeOnboarding(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

export function writeLocalOnboarding(state: ConsoleOnboardingState | null, apiBase = getApiBase()): void {
  try {
    const key = onboardingStorageKey(apiBase)
    if (state) storage()?.setItem(key, JSON.stringify(state))
    else storage()?.removeItem(key)
  } catch { /* storage blocked: the state lasts for this page */ }
  setLocalOnboarding(state)
}

/** Loads the browser copy into the session store (call once per signed-in Host). */
export function hydrateLocalOnboarding(): void {
  setLocalOnboarding(readLocalOnboarding())
}

/** Called right after the first owner was created: start the flow unless the Host tracks it. */
export function beginOnboarding(): void {
  if (getConsoleSession().hostOnboarding) return
  writeLocalOnboarding(freshOnboarding())
}

export type OnboardingSaveResult = { readonly saved: 'host' | 'local' } | { readonly error: unknown }

/**
 * Marks a step on the Host (`onboarding.update`); Hosts without the RPC keep the state locally.
 * Other failures (permission, network) are returned and nothing changes.
 */
export async function markOnboarding(step: OnboardingFlowStep, status: OnboardingStepStatus): Promise<OnboardingSaveResult> {
  const session = getConsoleSession()
  const next = markOnboardingStep(currentOnboarding(session), step, status)
  try {
    const reported = await updateOnboarding(step, status)
    setHostOnboarding(normalizeOnboarding(reported) ?? next)
    if (session.localOnboarding) writeLocalOnboarding(null)
    return { saved: 'host' }
  } catch (error) {
    if (!isUnsupportedRpcError(error) || session.hostOnboarding) return { error }
    writeLocalOnboarding(next)
    return { saved: 'local' }
  }
}
