export type SettingsGroupId = 'general' | 'models' | 'presets' | 'plugins'
export type SettingsSection = 'general' | 'builtin' | 'extensions' | 'unavailable'
export interface SettingsEntry {
  readonly id: string
  readonly configKey: string
  readonly group: SettingsGroupId
  readonly section: SettingsSection
  readonly sectionTitle: string
  readonly title: string
  readonly description: string
  readonly fieldNames?: readonly string[]
  readonly excludedFieldNames?: readonly string[]
  readonly writable: boolean
  readonly builtin: boolean
}
export interface SettingsGroup {
  readonly id: SettingsGroupId
  readonly title: string
  readonly description: string
  readonly entries: readonly SettingsEntry[]
}
export interface SettingsSelection {
  readonly group: SettingsGroupId
  readonly entry?: SettingsEntry
  readonly source?: 'yaml' | 'declarations'
}
export function buildSettingsCatalog(config: Record<string, unknown>, configKeys: readonly string[], configPaths?: Readonly<Record<string, readonly string[]>>): SettingsGroup[]
export function filterSettingsCatalog(catalog: readonly SettingsGroup[], query: string): readonly SettingsGroup[]
export function resolveSettingsSelection(selection: string | undefined, catalog: readonly SettingsGroup[]): SettingsSelection
