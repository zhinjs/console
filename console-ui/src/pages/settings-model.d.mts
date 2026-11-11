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
  readonly editor?: 'inference'
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
}
export function buildSettingsCatalog(config: Record<string, unknown>, configKeys: readonly string[], configPaths?: Readonly<Record<string, readonly string[]>>): SettingsGroup[]
export function filterSettingsCatalog(catalog: readonly SettingsGroup[], query: string, translate?: (message: string) => string): readonly SettingsGroup[]
export function resolveSettingsSelection(selection: string | undefined, catalog: readonly SettingsGroup[]): SettingsSelection
export interface SettingsLocation {
  /** A group id, entry id or legacy `plugin:<configKey>` selection. */
  readonly selection: string
  /** The raw URL value that asked for this location ('' for the default page). */
  readonly requested: string
  readonly query: string
}
export interface UnresolvedSettingsLocation {
  readonly kind: 'unknown-plugin' | 'plugin-without-settings' | 'unknown-section'
  readonly value: string
}
export function settingsLocationFromParams(params: URLSearchParams, config?: Record<string, unknown>): SettingsLocation
export function settingsLocationParams(current: URLSearchParams, selection: string, query?: string): URLSearchParams
export function unresolvedSettingsLocation(location: SettingsLocation, catalog: readonly SettingsGroup[], config?: Record<string, unknown>): UnresolvedSettingsLocation | null
