import type { ConsoleAccess } from '../../utils/console-access.mjs'

export const ADAPTER_CONFIG_RPC: Readonly<{ DRIFT: 'endpoint-drift'; IMPORT: 'endpoint-import'; WRITEBACK: 'endpoint-writeback' }>
export type ConfigDriftKind = 'config_only' | 'snapshot_only' | 'changed'
export interface ConfigDriftEntry {
  readonly id: string
  readonly kind: ConfigDriftKind
  readonly instanceId?: string
  readonly fields: readonly { readonly path: string; readonly sensitive: boolean }[]
}
export interface ConfigDrift {
  readonly authority: 'snapshot' | 'config'
  readonly revision: number | null
  readonly generation: number | null
  readonly canImport: boolean
  readonly canWriteback: boolean
  readonly entries: readonly ConfigDriftEntry[]
  readonly unverified: readonly { readonly id: string; readonly paths: readonly string[] }[]
}
export interface ConfigActionPermission { readonly allowed: boolean; readonly missing: readonly string[] }
export function readConfigDrift(data: unknown): ConfigDrift | null
export function adapterConfigRpcType(pluginId: string, method: string): string
export function adapterConfigPermission(pluginId: string, method: string, payload: Readonly<Record<string, unknown>> | undefined, access?: ConsoleAccess): ConfigActionPermission
export function importRequest(drift: ConfigDrift, id: string, start?: boolean): Record<string, unknown>
export function writebackRequest(drift: ConfigDrift, ids: readonly string[]): Record<string, unknown>
export function driftEntryActions(drift: ConfigDrift | null | undefined, entry: ConfigDriftEntry | null | undefined, pluginId: string | null | undefined, access?: ConsoleAccess): { import?: ConfigActionPermission; writeback?: ConfigActionPermission }
export function driftKindLabel(kind: string, locale?: 'zh-CN' | 'en'): string
export function driftRows(drift: ConfigDrift | null | undefined): ConfigDriftEntry[]
export function writebackResultText(result: unknown, locale?: 'zh-CN' | 'en'): string
