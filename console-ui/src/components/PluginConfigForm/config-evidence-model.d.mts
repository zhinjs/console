import type { ConfigSource } from '../../hooks/useConfigSource'
import type { PluginManagementState } from '../../pages/plugin-management-model.mjs'
export function isManagedConfigInstance(snapshot: ConfigSource | undefined | null, name: string): boolean
export function configEvidenceMatches(state: unknown, instanceKey: string, revision?: string): state is PluginManagementState
export function configurationSaveSummary(result: unknown): string

export type PendingConfigApplication = { scope: string; instanceKey: string; packageName: string; version: string; revision: string; projectRevision: string }
export type PendingConfigApplicationRead = { status: 'none' | 'unavailable' } | { status: 'pending'; pending: PendingConfigApplication }
export function readPendingConfigApplication(scope: string, instanceKey: string, storage?: Storage): PendingConfigApplicationRead
export function rememberConfigApplication(scope: string, state: PluginManagementState, storage?: Storage): PendingConfigApplication
export function forgetConfigApplication(scope: string, instanceKey: string, storage?: Storage): void
export function configApplicationConfirmed(state: PluginManagementState, pending: PendingConfigApplication | null): boolean
