import type { RestartInstanceStatus, RestartState } from './apply-outcome-model.mjs'

export interface RestartTrackerDeps {
  request(): Promise<unknown>
  readStatus(): Promise<RestartInstanceStatus | null | undefined | unknown>
  probe(): Promise<boolean>
  isConnected(): boolean
  mayHaveRun(error: unknown): boolean
  now(): number
  setTimer(fn: () => void, ms: number): unknown
  clearTimer(id: unknown): void
}
export interface RestartTracker {
  get(): RestartState
  subscribe(listener: () => void): () => void
  start(): Promise<RestartState>
  nudge(connected: boolean): void
  keepWaiting(): void
  dismiss(): void
  reset(): void
}
export function createRestartTracker(deps: RestartTrackerDeps): RestartTracker
