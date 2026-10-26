import type { ConfigSource } from '../../hooks/useConfigSource'
import type { PluginManagementState } from '../../pages/plugin-management-model.mjs'
export function isManagedConfigInstance(snapshot: ConfigSource | undefined | null, name: string, locale?: 'zh-CN' | 'en'): boolean
export function configEvidenceMatches(state: unknown, instanceKey: string, revision?: string, locale?: 'zh-CN' | 'en'): state is PluginManagementState
export function configurationSaveSummary(result: unknown, locale?: 'zh-CN' | 'en'): string

export type PendingConfigApplication = { scope: string; instanceKey: string; packageName: string; version: string; revision: string; projectRevision: string }
export type PendingConfigApplicationRead = { status: 'none' | 'unavailable' } | { status: 'pending'; pending: PendingConfigApplication }
export function readPendingConfigApplication(scope: string, instanceKey: string, storage?: Storage): PendingConfigApplicationRead
export function rememberConfigApplication(scope: string, state: PluginManagementState, storage?: Storage, locale?: 'zh-CN' | 'en'): PendingConfigApplication
export function forgetConfigApplication(scope: string, instanceKey: string, storage?: Storage): void
export function configApplicationConfirmed(state: PluginManagementState, pending: PendingConfigApplication | null): boolean
