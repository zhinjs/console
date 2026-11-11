/**
 * The signed-in principal (`GET /auth/me`) and onboarding state for the current Host.
 * Navigation reads permissions through `console-access.mjs`; this store feeds it.
 */
import { resetConsoleAccess, setConsoleAccess } from './console-access.mjs'
import { meAccessReport, normalizeOnboarding, resolveOnboarding } from './console-auth-model.mjs'

const EMPTY = Object.freeze({ me: null, legacy: false, hostOnboarding: null, localOnboarding: null, setupRequested: false })
let state = EMPTY
const listeners = new Set()

function update(patch) {
  state = Object.freeze({ ...state, ...patch })
  for (const listener of listeners) listener()
}

export function getConsoleSession() {
  return state
}

export function subscribeConsoleSession(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** A `/auth/me` report: updates permissions for navigation. */
export function setConsoleMe(me) {
  setConsoleAccess(meAccessReport(me))
  const hostOnboarding = normalizeOnboarding(me?.onboarding) ?? state.hostOnboarding
  update({ me, legacy: false, hostOnboarding })
}

/** The Host has no `/auth/*` (pre-RBAC): unrestricted navigation, Host enforces. */
export function setLegacySession() {
  resetConsoleAccess()
  update({ me: null, legacy: true })
}

/** Onboarding as reported by the Host (`GET /auth/setup` or `/auth/me`). */
export function setHostOnboarding(raw) {
  update({ hostOnboarding: normalizeOnboarding(raw) })
}

/** The browser's copy for Hosts that do not report onboarding. */
export function setLocalOnboarding(raw) {
  update({ localOnboarding: normalizeOnboarding(raw) })
}

/** An open local Host asks to run the setup wizard (owner creation) from inside the shell. */
export function requestSetup(requested = true) {
  update({ setupRequested: requested })
}

export function currentOnboarding(session = state) {
  return resolveOnboarding(session.hostOnboarding, session.localOnboarding)
}

export function resetConsoleSession() {
  resetConsoleAccess()
  state = EMPTY
  for (const listener of listeners) listener()
}
