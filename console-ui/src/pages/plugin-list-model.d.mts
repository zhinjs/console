import type { PluginManagementState } from './plugin-management-model.mjs'

export function validatePluginList(payload: unknown, locale?: 'zh-CN' | 'en'): unknown[]

export interface InventoryPlugin {
  name: string
  status: 'active' | 'inactive'
  description?: string
  instanceKey?: string
  packageName?: string
  version?: string
  management?: PluginManagementState
  managementError?: string
}
export type PluginHealth = 'healthy' | 'pending' | 'inactive' | 'undeclared' | 'unreported'
export type HealthFilter = 'all' | 'healthy' | 'pending' | 'inactive'
export interface InventoryRow {
  key: string
  kind: 'plugin' | 'package'
  name: string
  instanceKey: string
  packageName: string
  description: string
  version: string | null
  health: PluginHealth
  plugin: InventoryPlugin | null
  /** Gateway catalog of a package row (`adapter`, `ai`, `market`), when known. */
  catalog?: string
}
export function pluginHealth(plugin: InventoryPlugin | null | undefined): 'healthy' | 'pending' | 'inactive'
export function pluginInventory(plugins: readonly InventoryPlugin[] | null | undefined,
  packageList: { packages: readonly { name: string; installedVersion: string | null; dependencyType?: string; catalog?: string }[] } | null | undefined): InventoryRow[]
export function inventoryCounts(rows: readonly InventoryRow[]): { all: number; healthy: number; pending: number; inactive: number }
export function matchesHealthFilter(row: InventoryRow, filter: HealthFilter): boolean
export type PluginType = 'adapter' | 'ai' | 'feature'
export type PluginSource = 'official' | 'npm' | 'local'
export type InventorySortKey = 'name' | 'type' | 'source' | 'version' | 'status'
export type InventoryGroupBy = 'none' | 'type' | 'source'
export function pluginIconType(row: InventoryRow): PluginType | null
export function pluginType(row: InventoryRow): PluginType
export function pluginSource(row: InventoryRow): PluginSource
export function sortInventory(rows: readonly InventoryRow[], key?: InventorySortKey, direction?: 'asc' | 'desc'): InventoryRow[]
export function groupInventory(rows: readonly InventoryRow[], by?: InventoryGroupBy): { key: string; rows: InventoryRow[] }[]
export function needsStateLabel(row: InventoryRow): boolean
/** Whether the plugins page is still waiting for the instance's first plugin list. */
export function pluginsFirstReadPending(state: { loaded: boolean; error: unknown }): boolean
