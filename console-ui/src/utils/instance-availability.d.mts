import type { InstanceFailure, StatusReading } from '../components/status-state-model.mjs'

export interface InstanceAvailability {
  readonly instance: InstanceFailure
  readonly retryAfterSeconds: number
  readonly since: number
  readonly retryAt: number
  readonly failures: number
}

export function isGatewayOwnedRequest(type: unknown): boolean
export function getInstanceAvailability(): InstanceAvailability | null
export function subscribeInstanceAvailability(listener: () => void): () => void
export function reportInstanceReading(reading: StatusReading | null | undefined, now?: number): boolean
export function reportRequestFailure(type: string, error: unknown, now?: number): StatusReading
export function reportRequestSuccess(type: string): boolean
export function reportHttpReply(reply: { status: number; body: unknown; retryAfter?: string | null }, now?: number): boolean
export function secondsUntilRetry(current: InstanceAvailability | null, now?: number): number
export function nextRetrySeconds(current: InstanceAvailability | null): number
export function rearmInstanceRetry(now?: number): void
export function instanceStateAnswers(value: unknown): boolean
export function clearInstanceAvailability(): void
export function onInstanceRecovered(listener: () => void): () => void
