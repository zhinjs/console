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
}
export function pluginHealth(plugin: InventoryPlugin | null | undefined): 'healthy' | 'pending' | 'inactive'
export function pluginInventory(plugins: readonly InventoryPlugin[] | null | undefined,
  packageList: { packages: readonly { name: string; installedVersion: string | null; dependencyType?: string; catalog?: string }[] } | null | undefined): InventoryRow[]
export function inventoryCounts(rows: readonly InventoryRow[]): { all: number; healthy: number; pending: number; inactive: number }
export function matchesHealthFilter(row: InventoryRow, filter: HealthFilter): boolean
